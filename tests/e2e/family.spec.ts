import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { readServerConfig } from "../../src/server/config";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { identityCrypto } from "../../src/server/identity/crypto";
import { dispatchIdentityMail, type IdentityMail } from "../../src/server/identity/outbox";

const config = readServerConfig();
if (config.environment !== "local" || new URL(config.databaseUrl).hostname !== "127.0.0.1" || !/^\/hestia_test_/.test(new URL(config.databaseUrl).pathname)) throw new Error("Only the owned synthetic E2E database is accepted.");
const password = process.env.HESTIA_TEST_PASSWORD;
if (!password) throw new Error("Ephemeral test password missing.");
const pool = new Pool({ connectionString: config.databaseUrl });
const mail = new Map<string, IdentityMail[]>();
test.afterAll(async () => { await pool.end(); });
async function collect(email: string, field: "url" | "otp") {
  for (let i = 0; i < 200; i++) {
    const messages = mail.get(email) || [], found = messages.findLast(message => !!message[field]);
    if (found) { messages.splice(messages.indexOf(found), 1); return found[field]!; }
    const result = await dispatchIdentityMail(pool, identityCrypto(config.secret), async message => { const items = mail.get(message.parameters.email) || []; items.push(message.parameters); mail.set(message.parameters.email, items); });
    if (result.state === "idle") await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Synthetic mail was not available in the local collector.");
}
async function clickVisible(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click(); }
async function login(page: Page, email: string, secret = password!, delayInitialStatus = false) {
  let releaseStatus = () => {}, receivedStatus: number | undefined;
  const heldStatus = new Promise<void>(resolve => { releaseStatus = resolve; });
  if (delayInitialStatus) await page.route("**/api/hestia/identity/status", async route => {
    // Preserve the real completed flow response and control only its delivery.
    const response = await route.fetch(); receivedStatus = response.status();
    await heldStatus; await route.fulfill({ response });
  }, { times: 1 });
  await page.goto("/");
  if (delayInitialStatus) {
    try {
      await expect.poll(() => receivedStatus).toBe(200);
      // Initial restoration can insert a banner and move the submit button.
      // The product must prevent editing/submission until that state is settled.
      await expect(page.getByLabel("Adresse e-mail", { exact: true })).toBeDisabled();
      await expect(page.getByLabel("Mot de passe", { exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "J’ai perdu mon accès", exact: true })).toBeDisabled();
    } finally { releaseStatus(); }
    await expect(page.getByLabel("Adresse e-mail", { exact: true })).toBeEnabled();
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(secret);
    const response = page.waitForResponse(result => result.url().endsWith("/api/auth/sign-in/email"), { timeout: 10_000 });
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
}
async function activate(page: Page, link: string, email: string, secret: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /Rejoindre le foyer|Revenir dans le foyer/ })).toBeVisible();
  // Reading or preloading the capability never creates a user/session.
  const before = await page.request.get("/api/hestia/session"); expect(before.status()).toBe(401);
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
  await page.getByLabel("Code reçu par e-mail").fill(await collect(email, "otp"));
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await page.getByLabel("Nouveau mot de passe", { exact: true }).and(page.locator("input[type=password]")).fill(secret);
  await page.getByLabel("Saisissez-le de nouveau").fill(secret);
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await expect(page.getByRole("list", { name: "Codes de secours" }).locator("li")).toHaveCount(8);
  await page.getByRole("checkbox", { name: "J’ai conservé ces codes hors de Hestia", exact: true }).check();
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await page.getByRole("button", { name: /Activer mon compte|Revenir dans le foyer/ }).click();
  await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
}

test("inviter, activer, récupérer puis renouveler depuis Moi", async ({ page, browser, isMobile }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8), email = `family-${suffix}@example.invalid`, name = `Morgan ${suffix}`;
  const secret = `Synthetic family ${randomUUID()}!`, renewed = `Synthetic renewed ${randomUUID()}!`;
  await login(page, "alex@hestia.invalid");
  await clickVisible(page, "Foyer");
  await page.getByRole("button", { name: "Inviter une personne", exact: true }).click();
  await page.getByLabel("Prénom et nom").fill(name); await page.getByLabel("Adresse e-mail personnelle").fill(email);
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  await expect(page.getByText("Invitation enregistrée.", { exact: true })).toBeVisible();
  const recipient = await browser.newContext({ baseURL: config.origin, ...(isMobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  try {
    const member = await recipient.newPage();
    await activate(member, await collect(email, "url"), email, secret);
    await login(member, email, secret, true);
    await expect(member.getByRole("button", { name: "Foyer", exact: true })).toHaveCount(0);
    await clickVisible(member, "Moi");
    await expect(member.getByText("8 codes de secours disponibles", { exact: true })).toBeVisible();
    await clickVisible(member, "Se déconnecter");
    await member.getByRole("button", { name: "J’ai perdu mon accès", exact: true }).click();
    await member.getByRole("button", { name: "Continuer", exact: true }).click();
    await member.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    let recoveryRequests = 0;
    member.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/hestia/identity/recover")) recoveryRequests++; });
    await member.getByRole("button", { name: "Envoyer un code", exact: true }).click();
    await expect(member.getByRole("heading", { name: "Consultez votre boîte e-mail", exact: true })).toBeVisible();
    // A mobile switch to the mailbox preserves the public flow, while clearing
    // typed secrets; restoring the page must not send a second recovery request.
    await member.getByLabel("Code reçu", { exact: true }).fill("saisie à effacer");
    await member.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await member.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await expect(member.getByRole("heading", { name: "Consultez votre boîte e-mail", exact: true })).toBeVisible();
    await expect(member.getByLabel("Code reçu", { exact: true })).toHaveValue("");
    await member.reload();
    await expect(member.getByRole("heading", { name: "Consultez votre boîte e-mail", exact: true })).toBeVisible();
    expect(recoveryRequests).toBe(1);
    await member.getByLabel("Code reçu", { exact: true }).fill(await collect(email, "otp"));
    await member.getByRole("button", { name: "Continuer", exact: true }).click();
    await member.getByLabel("Nouveau mot de passe", { exact: true }).and(member.locator("input[type=password]")).fill(renewed); await member.getByLabel("Saisissez-le de nouveau").fill(renewed);
    await member.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(member.getByRole("heading", { name: "Accès rétabli", exact: true })).toBeVisible();
    await member.getByRole("button", { name: "Aller à la connexion", exact: true }).click();
    await login(member, email, renewed); await clickVisible(member, "Moi");
    await expect(member.getByText("0 code de secours disponible", { exact: true })).toBeVisible();
    await member.screenshot({ path: test.info().outputPath("family-moi-zero.png"), fullPage: true });
    await member.getByRole("button", { name: "Renouveler mes codes", exact: true }).click();
    await expect(member.getByRole("dialog").getByRole("button", { name: "Annuler", exact: true })).toBeFocused();
    await member.getByLabel("Votre mot de passe actuel").fill(renewed);
    await member.getByRole("button", { name: "Renouveler", exact: true }).click();
    await expect(member.getByRole("list", { name: "Codes de secours" }).locator("li")).toHaveCount(8);
    await member.getByRole("checkbox", { name: "J’ai conservé ces codes hors de Hestia", exact: true }).check();
    await member.route("**/api/hestia/me/recovery-codes/confirm", async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); }, { times: 1 });
    await member.getByRole("button", { name: "Terminé", exact: true }).click();
    await expect(member.getByRole("button", { name: "Vérifier le résultat", exact: true })).toBeVisible();
    const codesPanel = member.getByRole("complementary", { name: "Vos nouveaux codes de secours", exact: true });
    await expect(codesPanel.getByRole("button", { name: "Fermer", exact: true })).toBeDisabled();
    await member.keyboard.press("Escape"); await expect(codesPanel).toBeVisible();
    await member.getByRole("button", { name: "Vérifier le résultat", exact: true }).click();
    await expect(member.getByText("Codes renouvelés.", { exact: true })).toBeVisible();
    await expect(member.getByRole("list", { name: "Codes de secours" })).toHaveCount(0);
    await member.getByRole("button", { name: "Renouveler mes codes", exact: true }).click();
    await member.getByLabel("Votre mot de passe actuel").fill(renewed);
    await member.getByRole("button", { name: "Renouveler", exact: true }).click();
    await expect(codesPanel.getByRole("button", { name: "Terminé", exact: true })).toBeEnabled();
    await expect(codesPanel.getByRole("button", { name: "Vérifier le résultat", exact: true })).toHaveCount(0);
    await codesPanel.getByRole("button", { name: "Fermer", exact: true }).click();
  } finally { await recipient.close(); }
});

test("retirer puis réadmettre un membre sans restaurer ses droits", async ({ page, browser, isMobile }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  // Recovery and return use independent identities: the real email budget allows
  // three sends per 15 minutes, which the combined accelerated journey exceeds.
  // This test preserves the removed member's existing session cookie throughout.
  const suffix = randomUUID().slice(0, 8), email = `return-${suffix}@example.invalid`, name = `Robin ${suffix}`;
  const secret = `Synthetic return ${randomUUID()}!`;
  await provisionSyntheticMember(pool, { name, email, password: secret });
  await test.step("Connexion de l’administration", async () => { await login(page, "alex@hestia.invalid"); });
  const recipient = await browser.newContext({ baseURL: config.origin, ...(isMobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  recipient.setDefaultTimeout(10_000);
  try {
    const member = await recipient.newPage();
    await test.step("Connexion du membre avant retrait", async () => { await login(member, email, secret); });
    await test.step("Partage explicite et retrait du foyer", async () => {
    // Explicit sharing remains independent of household admission.
    const created = await page.request.post("/api/hestia/folders", { headers: { origin: config.origin }, data: { name: `Dossier ${suffix}` } });
    expect(created.status()).toBe(201); const folder = await created.json();
    let target: { id: string; email: string } | undefined, offset: number | null = 0;
    while (offset !== null && !target) {
      const membership: { members: { id: string; email: string }[]; nextOffset: number | null } = await (await page.request.get(`/api/hestia/household/members?status=active&offset=${offset}&limit=50`)).json();
      target = membership.members.find(item => item.email === email); offset = membership.nextOffset;
    }
    expect(!!target).toBe(true);
    expect((await page.request.post(`/api/hestia/folders/${folder.folder.id}/sharing`, { headers: { origin: config.origin }, data: { memberId: target!.id, export: false, deposit: false, idempotencyKey: randomUUID() } })).status()).toBe(200);
    await page.reload(); await clickVisible(page, "Foyer");
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Retirer du foyer", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Annuler", exact: true })).toBeFocused();
    await page.getByRole("dialog").getByRole("button", { name: "Retirer du foyer", exact: true }).click();
    await expect(page.getByText("La personne a été retirée du foyer.", { exact: true })).toBeVisible();
    expect((await member.request.get("/api/hestia/session")).status()).toBe(401);
    });
    await test.step("Préparation du retour", async () => {
    await page.getByRole("tab", { name: "Anciens membres", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Préparer son retour", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Préparer le retour", exact: true }).click();
    await expect(page.getByText("Retour préparé.", { exact: true })).toBeVisible();
    });
    await test.step("Activation du retour avec l’ancienne session", async () => { await activate(member, await collect(email, "url"), email, secret); });
    await test.step("Connexion après retour et absence de droits restaurés", async () => {
    await login(member, email, secret, true);
    const listing = await (await member.request.get("/api/hestia/folders")).json();
    expect(listing.folders).toHaveLength(0);
    await member.screenshot({ path: test.info().outputPath("family-return-empty.png"), fullPage: true });
    });
  } finally { await recipient.close(); }
});

test("connexion clavier et recours exceptionnel sans demande automatique", async ({ page }) => {
  await page.goto("/");
  const emailField = page.getByLabel("Adresse e-mail", { exact: true });
  await expect(emailField).toBeEnabled();
  await emailField.focus();
  await expect(emailField).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByLabel("Mot de passe", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "J’ai perdu mon accès", exact: true }).click();
  await page.getByRole("radio", { name: "Ni l’un ni l’autre", exact: true }).check();
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hestia ne peut pas vous rendre l’accès seul", exact: true })).toBeFocused();
  await expect(page.getByText(/cette page n’envoie aucune demande/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("family-exceptional.png"), fullPage: true });
});

