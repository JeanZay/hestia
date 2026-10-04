import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { readServerConfig } from "../../src/server/config";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
const config = readServerConfig();
if (config.environment !== "local" || new URL(config.databaseUrl).hostname !== "127.0.0.1" || !/^\/hestia_test_/.test(new URL(config.databaseUrl).pathname)) throw new Error("Only the owned synthetic E2E database is accepted.");
const password = process.env.HESTIA_TEST_PASSWORD;
if (!password) throw new Error("Ephemeral test password missing.");
const pool = new Pool({ connectionString: config.databaseUrl });
test.afterAll(async () => { await pool.end(); });
async function clickVisible(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click(); }
async function login(page: Page, email: string, secret = password!) {
  await page.goto("/");
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(secret);
    const response = page.waitForResponse(result => result.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
}

test("transmettre toute la gestion puis nommer un lecteur après le départ, sans droit documentaire ajouté", async ({ page, browser, isMobile }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8), creatorName = `Lou ${suffix}`, successorName = `Noé ${suffix}`;
  const creatorEmail = `lou-${suffix}@example.invalid`, successorEmail = `noe-${suffix}@example.invalid`;
  const creatorId = await provisionSyntheticMember(pool, { name: creatorName, email: creatorEmail, password: password! });
  const successorId = await provisionSyntheticMember(pool, { name: successorName, email: successorEmail, password: password! });
  await login(page, creatorEmail);
  const created = await page.request.post("/api/hestia/folders", { headers: { origin: config.origin }, data: { name: `Transmission ${suffix}` } });
  expect(created.status()).toBe(201); const { folder } = await created.json();
  const granted = await page.request.post(`/api/hestia/folders/${folder.id}/sharing`, { headers: { origin: config.origin }, data: { memberId: successorId, export: false, deposit: false, idempotencyKey: randomUUID() } });
  expect(granted.status()).toBe(200);
  await page.reload(); await page.getByRole("main").getByRole("button", { name: new RegExp(`Transmission ${suffix}`) }).click();
  await page.getByRole("tab", { name: "Accès", exact: true }).click();
  await page.getByRole("button", { name: "Transmettre la gestion", exact: true }).click();
  await page.getByRole("radio", { name: new RegExp(successorName) }).check();
  await expect(page.getByText("Ce que la personne reprend", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Partager|Administrer/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Annuler", exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("family-transfer-confirm.png"), fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "Confier la gestion", exact: true }).click();
  await expect(page.getByText("Gestion transmise.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ce dossier est vide", exact: true })).toBeVisible();
  expect((await page.request.get("/api/hestia/session")).status()).toBe(200);
  expect((await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toHaveCount(0);
  const rights = await pool.query("SELECT capability FROM hestia_grant WHERE user_id=$1 AND folder_id=$2 AND revoked_at IS NULL", [successorId, folder.id]);
  expect(rights.rows.some(row => ["déposer", "modifier", "supprimer", "exporter"].includes(row.capability))).toBe(false);
  const adminContext = await browser.newContext({ baseURL: config.origin, ...(isMobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  try {
    const admin = await adminContext.newPage(); await login(admin, "alex@hestia.invalid"); await clickVisible(admin, "Foyer");
    await admin.getByRole("button", { name: new RegExp(successorName) }).click();
    await admin.getByRole("button", { name: "Retirer du foyer", exact: true }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Retirer du foyer", exact: true }).click();
    await expect(admin.getByText("La personne a été retirée du foyer.", { exact: true })).toBeVisible();
    const vacant = await (await admin.request.get("/api/hestia/household/folders/without-manager?offset=0&limit=50")).json();
    const item = vacant.folders.find((entry: { id: string }) => entry.id === folder.id);
    expect(!!item).toBe(true);
    await expect(admin.getByText(`Transmission ${suffix}`, { exact: true })).toHaveCount(0);
    await admin.locator(".hf-person").filter({ hasText: item.adminReference }).getByRole("button", { name: "Nommer", exact: true }).click();
    const nomination = admin.getByRole("complementary", { name: "Nommer un gestionnaire", exact: true });
    await expect(nomination).toBeVisible();
    if (isMobile) await expect(admin.getByRole("heading", { name: "Foyer", exact: true })).not.toBeVisible();
    await admin.getByRole("radio", { name: new RegExp(creatorName) }).check();
    await expect(nomination.getByText("Partager", { exact: true })).toBeVisible();
    await expect(nomination.getByText("Administrer", { exact: true })).toBeVisible();
    await admin.screenshot({ path: test.info().outputPath("family-nomination.png"), fullPage: true });
    await admin.getByRole("button", { name: "Nommer", exact: true }).filter({ visible: true }).last().click();
    await admin.getByRole("dialog").getByRole("button", { name: "Nommer", exact: true }).click();
    await expect(admin.getByRole("complementary", { name: "Nommer un gestionnaire", exact: true })).toHaveCount(0);
    await page.reload(); await page.getByRole("main").getByRole("button", { name: new RegExp(`Transmission ${suffix}`) }).click();
    await page.getByRole("tab", { name: "Accès", exact: true }).click();
    await expect(page.getByRole("button", { name: "Transmettre la gestion", exact: true })).toBeVisible();
    const after = await (await page.request.get(`/api/hestia/folders/${folder.id}/management-transfer`)).json();
    expect(after.eligible.some((person: { id: string }) => person.id === successorId)).toBe(false);
    expect(creatorId !== successorId).toBe(true);
  } finally { await adminContext.close(); }
});
