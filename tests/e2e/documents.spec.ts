import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.HESTIA_TEST_PASSWORD;
if (!password || process.env.HESTIA_ENVIRONMENT !== "local") throw new Error("Use npm run test:e2e to provision isolated synthetic accounts.");
async function login(page: Page, email = "camille@hestia.invalid") {
  await page.goto("/");
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    const submitted = page.waitForResponse(res => res.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    const result = await submitted;
    if (result.status() !== 429) { expect(result.status()).toBe(200); break; }
    // Exercise the deployed limiter unchanged; do not weaken it for browser QA.
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
}

test("un dossier privé persiste après renommage, rechargement et reconnexion", async ({ page, browser }) => {
  const name = `Lave-linge ${randomUUID().slice(0, 8)}`;
  const renamed = `${name} cuisine`;
  await login(page);
  await page.getByRole("button", { name: "Nouveau dossier", exact: true }).click();
  await page.getByLabel("Nom du dossier").fill(name);
  await page.getByRole("button", { name: "Créer le dossier", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Renommer", exact: true }).click();
  await page.getByLabel("Nom du dossier").fill(renamed);
  await page.getByRole("button", { name: "Enregistrer le nom", exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("private-folder.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole("main").getByRole("button", { name: `${renamed} Aucun document`, exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();

  // An administrator is not implicitly a reader of another member's folder.
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:3210" });
  try {
    const alex = await second.newPage();
    await login(alex, "alex@hestia.invalid");
    await expect(alex.getByText(renamed, { exact: true })).toHaveCount(0);
    const listing = await second.request.get("/api/hestia/folders");
    expect(listing.status()).toBe(200);
    expect((await listing.json()).folders.some((f: { name: string }) => f.name === renamed)).toBe(false);
  } finally { await second.close(); }

  if (!await page.getByRole("button", { name: "Se déconnecter", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Moi", exact: true }).click();
  }
  const signedOut = page.waitForResponse(res => res.request().method() === "POST" && res.url().endsWith("/api/auth/sign-out"));
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  expect((await signedOut).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
  expect((await page.request.get("/api/hestia/folders")).status()).toBe(401);
  await login(page);
  await page.getByRole("main").getByRole("button", { name: `${renamed} Aucun document`, exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
});

test("refus anonyme, inscription fermée et aucune donnée dans le stockage navigateur", async ({ page, request }) => {
  expect((await request.get("/api/hestia/folders")).status()).toBe(401);
  expect((await request.post("/api/auth/sign-up/email", { data: {} })).status()).toBe(404);
  const external: string[] = [];
  page.on("request", req => { if (new URL(req.url()).hostname !== "127.0.0.1") external.push(req.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
  await login(page);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ local: 0, session: 0, cookies: "" });
  expect(external).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("folders.png"), fullPage: true });
});

test("une panne de chargement ne devient pas un dossier vide", async ({ page }) => {
  await login(page);
  await page.route("**/api/hestia/folders", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Service momentanément indisponible. Réessayez." } }) }));
  await page.reload();
  await expect(page.getByText("Connexion indisponible.", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucun dossier accessible pour le moment", { exact: true })).toHaveCount(0);
});

test("un conflit de renommage préserve la modification concurrente", async ({ page }) => {
  const name = `Notice ${randomUUID().slice(0, 8)}`;
  await login(page);
  await page.getByRole("button", { name: "Nouveau dossier", exact: true }).click();
  await page.getByLabel("Nom du dossier").fill(name);
  await page.getByRole("button", { name: "Créer le dossier", exact: true }).click();
  await page.getByRole("button", { name: "Renommer", exact: true }).click();
  const folders = (await (await page.request.get("/api/hestia/folders")).json()).folders;
  const folder = folders.find((f: { name: string }) => f.name === name);
  const current = `${name} serveur`;
  const update = await page.request.patch(`/api/hestia/folders/${folder.id}`, {
    headers: { Origin: "http://127.0.0.1:3210" }, data: { name: current, version: folder.version },
  });
  expect(update.status()).toBe(200);
  await page.getByLabel("Nom du dossier").fill(`${name} ancien`);
  await page.getByRole("button", { name: "Enregistrer le nom", exact: true }).click();
  await expect(page.getByText("Le dossier a changé.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: current, exact: true })).toBeVisible();
});

test("une session perdue efface aussi le nom privé contenu dans la confirmation", async ({ page }) => {
  const name = `Privé ${randomUUID().slice(0, 8)}`;
  await login(page);
  await page.getByRole("button", { name: "Nouveau dossier", exact: true }).click();
  await page.getByLabel("Nom du dossier").fill(name);
  await page.getByRole("button", { name: "Créer le dossier", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const logout = await page.request.post("/api/auth/sign-out", { headers: { Origin: "http://127.0.0.1:3210" }, data: {} });
  expect(logout.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
  await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("login.png"), fullPage: true });
});
