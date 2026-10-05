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

async function shareFromAccess(page: Page, name: string, id: string) {
  await page.getByRole("button", { name: "Donner accès", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Donner accès", exact: true });
  await panel.getByLabel("Personne du foyer").selectOption(id);
  await panel.getByRole("checkbox", { name: /Exporter :/ }).uncheck();
  await panel.getByRole("button", { name: "Donner accès", exact: true }).click();
  await expect(page.getByText("Accès accordé.", { exact: true })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Accès" }).getByText(name, { exact: true }).first()).toBeVisible();
}

test("partager depuis Accès puis transmettre réussit à la première confirmation", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8), name = `Camille ${suffix}`;
  const email = `gestion-${suffix}@example.invalid`;
  await provisionSyntheticMember(pool, { name: `Lou ${suffix}`, email, password: password! });
  const reader = await provisionSyntheticMember(pool, { name, email: `lecteur-${suffix}@example.invalid`, password: password! });
  await login(page, email);
  const created = await page.request.post("/api/hestia/folders", { headers: { origin: config.origin }, data: { name: `Fraîcheur ${suffix}` } });
  expect(created.status()).toBe(201); const { folder } = await created.json();
  const endpoint = `/api/hestia/folders/${folder.id}/management-transfer`;
  // An already eligible reader makes the stale version fail at confirmation,
  // rather than merely disappearing from the candidate list.
  expect((await page.request.post(`/api/hestia/folders/${folder.id}/sharing`, { headers: { origin: config.origin }, data: { memberId: reader, export: false, deposit: false, idempotencyKey: randomUUID() } })).status()).toBe(200);
  await page.reload(); await page.getByRole("main").getByRole("button", { name: new RegExp(`Fraîcheur ${suffix}`) }).click();
  const initial = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "GET");
  await page.getByRole("tab", { name: "Accès", exact: true }).click();
  expect((await initial).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Transmettre la gestion", exact: true })).toBeVisible();
  await shareFromAccess(page, name, reader);
  await page.getByRole("button", { name: "Transmettre la gestion", exact: true }).click();
  await page.getByRole("radio", { name: new RegExp(name) }).check();
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  const transferred = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Confier la gestion", exact: true }).click();
  expect((await transferred).status()).toBe(200);
  await expect(page.getByText("Gestion transmise.", { exact: true })).toBeVisible();
  expect((await pool.query("SELECT capability FROM hestia_grant WHERE folder_id=$1 AND user_id=$2 AND revoked_at IS NULL ORDER BY capability", [folder.id, reader])).rows.map(row => row.capability)).toEqual(["administrer", "consulter", "consulter"]);
});

test("transfert : lecture échouée ou tardive, conflit réel et résultat incertain restent maîtrisés", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8), name = `Noé ${suffix}`, email = `race-${suffix}@example.invalid`;
  const creator = await provisionSyntheticMember(pool, { name: `Lou ${suffix}`, email, password: password! });
  const reader = await provisionSyntheticMember(pool, { name, email: `race-reader-${suffix}@example.invalid`, password: password! });
  await login(page, email);
  const created = await page.request.post("/api/hestia/folders", { headers: { origin: config.origin }, data: { name: `Relecture ${suffix}` } });
  expect(created.status()).toBe(201); const { folder } = await created.json();
  const endpoint = `/api/hestia/folders/${folder.id}/management-transfer`;
  const grant = async (canExport = false) => expect((await page.request.post(`/api/hestia/folders/${folder.id}/sharing`, { headers: { origin: config.origin }, data: { memberId: reader, export: canExport, deposit: false, idempotencyKey: randomUUID() } })).status()).toBe(200);
  await grant();
  await page.reload(); await page.getByRole("main").getByRole("button", { name: new RegExp(`Relecture ${suffix}`) }).click();
  await page.getByRole("tab", { name: "Accès", exact: true }).click();
  const open = page.getByRole("button", { name: "Transmettre la gestion", exact: true });
  const panel = page.getByRole("complementary", { name: "Transmettre la gestion", exact: true });
  await expect(open).toBeVisible();
  let mode: "fail" | "delay" | "normal" | "lost" = "fail", posts = 0;
  let release!: () => void, arrived!: () => void, delivered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const captured = new Promise<void>(resolve => { arrived = resolve; });
  const settled = new Promise<void>(resolve => { delivered = resolve; });
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() === "POST") {
      posts++;
      if (mode === "lost") {
        // The server commits, but the browser receives no usable confirmation.
        expect((await route.fetch()).status()).toBe(200);
        await route.fulfill({ status: 503, json: {} }); return;
      }
    } else if (mode === "fail") { await route.fulfill({ status: 503, json: {} }); return; }
    else if (mode === "delay") {
      const response = await route.fetch(); arrived(); await held;
      await route.fulfill({ response }); delivered(); return;
    }
    await route.continue();
  });
  try {
    await open.click();
    await expect(page.getByText("Gestion indisponible.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer", exact: true })).toHaveCount(0);
    expect(posts).toBe(0);
    mode = "delay"; await open.click(); await captured;
    await expect(panel.getByRole("radio")).toHaveCount(0);
    await panel.getByRole("button", { name: "Fermer", exact: true }).click();
    await grant(true); mode = "normal";
    await open.click();
    const nominee = page.getByRole("radio", { name: new RegExp(`${name}.*exporter`) });
    await nominee.check(); release(); await settled;
    await expect(nominee).toBeChecked();
    // A real change after the displayed review must still reject the mutation.
    await grant();
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    const conflict = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Confier la gestion", exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(page.getByText("Choix à vérifier.", { exact: true })).toBeVisible();
    expect(posts).toBe(1);
    expect((await pool.query("SELECT g.user_id FROM hestia_folder f JOIN hestia_grant g ON g.id=f.reference_grant_id WHERE f.id=$1", [folder.id])).rows[0].user_id).toBe(creator);
    await expect(nominee).not.toBeChecked(); await nominee.check();
    mode = "lost";
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confier la gestion", exact: true }).click();
    await expect(page.getByText("Résultat incertain.", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Fermer", exact: true }).click();
    await open.click();
    await expect(page.getByRole("button", { name: "Continuer", exact: true })).toBeDisabled();
    // An inconclusive receipt followed by a failed re-read must retain the key
    // so another explicit check can still discover the committed operation.
    let receiptReads = 0;
    await page.route("**/api/hestia/membership-operations/*", async route => {
      receiptReads++;
      if (receiptReads === 1) await route.fulfill({ json: { status: "not-recorded" } });
      else await route.continue();
    });
    mode = "fail";
    await page.getByRole("button", { name: "Vérifier le résultat", exact: true }).click();
    await expect(page.getByText("Vérification impossible.", { exact: true })).toBeVisible();
    await open.click(); mode = "normal";
    await page.getByRole("button", { name: "Vérifier le résultat", exact: true }).click();
    await expect(page.getByText("Gestion transmise.", { exact: true })).toBeVisible();
    expect(receiptReads).toBe(2);
    expect(posts).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS count FROM hestia_membership_receipt WHERE actor_id=$1 AND kind='transfer'", [creator])).rows[0].count).toBe(1);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("transmettre toute la gestion puis nommer un lecteur après le départ, sans droit documentaire ajouté", async ({ page, browser, isMobile }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8), creatorName = `Lou ${suffix}`, successorName = `Noé ${suffix}`;
  const creatorEmail = `lou-${suffix}@example.invalid`, successorEmail = `noe-${suffix}@example.invalid`;
  const creatorId = await provisionSyntheticMember(pool, { name: creatorName, email: creatorEmail, password: password! });
  const successorId = await provisionSyntheticMember(pool, { name: successorName, email: successorEmail, password: password! });
  await login(page, creatorEmail);
  const created = await page.request.post("/api/hestia/folders", { headers: { origin: config.origin }, data: { name: `Transmission ${suffix}` } });
  expect(created.status()).toBe(201); const { folder } = await created.json();
  await page.reload(); await page.getByRole("main").getByRole("button", { name: new RegExp(`Transmission ${suffix}`) }).click();
  await page.getByRole("tab", { name: "Accès", exact: true }).click();
  await expect(page.getByRole("button", { name: "Transmettre la gestion", exact: true })).toBeVisible();
  await shareFromAccess(page, successorName, successorId);
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
