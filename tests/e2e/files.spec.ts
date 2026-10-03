import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.HESTIA_TEST_PASSWORD;
if (!password || process.env.HESTIA_ENVIRONMENT !== "local") throw new Error("Use the owned local E2E harness.");
async function login(page: Page) {
  await page.goto("/");
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByLabel("Adresse e-mail").fill("camille@hestia.invalid");
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    const response = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
}
async function folder(page: Page) {
  const name = `Documents ${randomUUID().slice(0, 8)}`;
  await login(page);
  await page.getByRole("button", { name: "Nouveau dossier", exact: true }).click();
  await page.getByLabel("Nom du dossier").fill(name);
  const created = page.waitForResponse(r => r.url().endsWith("/api/hestia/folders") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Créer le dossier", exact: true }).click();
  const result = await (await created).json();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return result.folder.id as string;
}
async function selectFiles(page: Page, paths: string | string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter un document", exact: true }).click();
  await (await chooser).setFiles(paths);
}
const panel = (page: Page) => page.getByRole("complementary", { name: "Ajout de documents", exact: true });
const fileList = async (page: Page, id: string) => (await (await page.request.get(`/api/hestia/documents?folderId=${id}`)).json()).documents;

test("PNG/PDF : originaux, aperçu, titre, recherche et export intègres", async ({ page, isMobile }) => {
  const id = await folder(page);
  await selectFiles(page, ["tests/fixtures/documents/synthetic.png", "tests/fixtures/documents/synthetic.pdf"]);
  const fields = panel(page).getByLabel("Titre du document");
  await fields.nth(0).fill("Étiquette synthétique");
  await fields.nth(1).fill("Facture synthétique");
  await panel(page).getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(panel(page).getByText("Document enregistré.", { exact: true })).toHaveCount(2, { timeout: 30_000 });
  await panel(page).getByRole("button", { name: "Terminé", exact: true }).click();
  const documents = await fileList(page, id);
  expect(documents).toHaveLength(2);
  await page.getByRole("main").getByRole("button", { name: /Étiquette synthétique/ }).click();
  const detail = page.getByRole("complementary", { name: "Document", exact: true });
  await expect(detail.getByRole("img", { name: "Aperçu de Étiquette synthétique" })).toBeVisible();
  await expect(detail.getByText("synthetic.png", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await detail.getByRole("button", { name: "Télécharger", exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(createHash("sha256").update(await readFile(path!)).digest("hex")).toBe(documents.find((d: {mediaType: string}) => d.mediaType === "image/png").sha256);
  await detail.getByRole("button", { name: "Renommer", exact: true }).click();
  await detail.getByLabel("Titre du document").fill("Étiquette corrigée");
  await detail.getByRole("button", { name: "Enregistrer le titre", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Étiquette corrigée", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: /Facture synthétique/ }).click();
  await expect(detail.getByRole("img", { name: /Aperçu de Facture synthétique, page 1/ })).toBeVisible({ timeout: 30_000 });
  expect(await page.locator("iframe").count()).toBe(0);
  await page.screenshot({ path: test.info().outputPath("file-pdf.png"), fullPage: true });
  await detail.getByRole("button", { name: "Fermer", exact: true }).click();
  if (isMobile) { await page.getByRole("button", {name: "Rechercher", exact: true}).click(); await page.getByLabel("Rechercher", {exact: true}).fill("etiquette corrigee"); }
  else await page.getByLabel("Rechercher un document ou un dossier", { exact: true }).fill("etiquette corrigee");
  await expect(page.getByRole("main").getByRole("button", { name: /Étiquette corrigée/ })).toBeVisible();
  await page.getByLabel("Rechercher", {exact: true}).fill("aucun-resultat-" + randomUUID());
  await expect(page.getByRole("heading", {name: "Aucun résultat", exact: true})).toBeVisible();
  await page.route("**/api/hestia/documents?**", route => route.fulfill({status: 503, json: {error: {message: "Service indisponible."}}}));
  await page.getByLabel("Rechercher", {exact: true}).fill("facture");
  await expect(page.getByText("Chargement impossible.", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Aucun résultat", exact: true})).toHaveCount(0);
});

test("doublon explicite, réponse perdue idempotente et fichier corrompu refusé", async ({page}) => {
  const id = await folder(page);
  await selectFiles(page, "tests/fixtures/documents/synthetic.png");
  let lost = false;
  await page.route("**/api/hestia/uploads/*/complete", async route => { const response = await route.fetch(); if (!lost && response.ok()) { lost = true; await route.abort(); } else await route.fulfill({response}); });
  await panel(page).getByRole("button", {name:"Enregistrer", exact:true}).click();
  await expect(panel(page).getByText("Sans confirmation.", {exact:true})).toBeVisible({timeout:30_000});
  await panel(page).getByRole("button", {name:"Vérifier et réessayer", exact:true}).click();
  await expect(panel(page).getByText("Document enregistré.", {exact:true})).toBeVisible();
  expect(await fileList(page,id)).toHaveLength(1);
  await panel(page).getByRole("button", {name:"Terminé", exact:true}).click();
  await selectFiles(page, "tests/fixtures/documents/synthetic.png");
  await panel(page).getByRole("button", {name:"Enregistrer", exact:true}).click();
  await expect(panel(page).getByText("Déjà présent.", {exact:true})).toBeVisible({timeout:30_000});
  await panel(page).getByRole("button", {name:"L’ajouter quand même", exact:true}).click();
  await expect(panel(page).getByText("Document enregistré.", {exact:true})).toBeVisible();
  expect(await fileList(page,id)).toHaveLength(2);
  await panel(page).getByRole("button", {name:"Terminé", exact:true}).click();
  await selectFiles(page, "tests/fixtures/documents/corrupt.png");
  await panel(page).getByRole("button", {name:"Enregistrer", exact:true}).click();
  await expect(panel(page).getByText("Fichier refusé.", {exact:true})).toBeVisible({timeout:30_000});
  expect(await fileList(page,id)).toHaveLength(2);
});

test("capture mobile après arrière-plan, annulation, puis confirmation ; PC inactif", async ({page,isMobile}) => {
  const id = await folder(page);
  const camera = page.getByRole("button", {name:"Prendre une photo", exact:true});
  if (!isMobile) { await expect(camera).toBeDisabled(); return; }
  const selected = page.waitForEvent("filechooser");
  await camera.click(); const picker = await selected;
  expect(await picker.element().getAttribute("capture")).toBe("environment");
  await page.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("heading", {name:/Documents /})).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,get:()=>false}); });
  await picker.setFiles("tests/fixtures/documents/synthetic.png");
  const photo = page.getByRole("complementary",{name:"Photo",exact:true});
  await expect(photo.getByRole("img",{name:"Aperçu de la photo prise"})).toBeVisible();
  expect(await fileList(page,id)).toHaveLength(0);
  await photo.getByRole("button", {name:"Annuler",exact:true}).click();
  await expect(photo.getByText("Prise de photo annulée.",{exact:true})).toBeVisible();
  expect(await fileList(page,id)).toHaveLength(0);
  const again = page.waitForEvent("filechooser"); await photo.getByRole("button", {name:"Reprendre une photo",exact:true}).click(); await (await again).setFiles("tests/fixtures/documents/synthetic.png");
  await photo.getByRole("button", {name:"Utiliser cette photo",exact:true}).click();
  expect(await fileList(page,id)).toHaveLength(0);
  await panel(page).getByRole("button",{name:"Enregistrer",exact:true}).click();
  await expect(panel(page).getByText("Document enregistré.",{exact:true})).toBeVisible({timeout:30_000});
  expect((await fileList(page,id))[0].source).toBe("camera");
});

test("aperçu sans Exporter, révocation et purge des URLs privées", async ({page}) => {
  await folder(page);
  await selectFiles(page,"tests/fixtures/documents/synthetic.png");
  await panel(page).getByRole("button",{name:"Enregistrer",exact:true}).click();
  await expect(panel(page).getByText("Document enregistré.",{exact:true})).toBeVisible({timeout:30_000});
  await panel(page).getByRole("button",{name:"Terminé",exact:true}).click();
  // UI capability projection only; server authorization is separately covered by integration tests.
  await page.route(/\/api\/hestia\/documents\/[^/?]+$/, async route => { const response=await route.fetch(); const body=await response.json(); body.document.capabilities=["consulter"]; await route.fulfill({response,json:body}); });
  await page.getByRole("main").getByRole("button",{name:/synthetic/}).click();
  const detail=page.getByRole("complementary",{name:"Document",exact:true});
  await expect(detail.getByRole("img",{name:"Aperçu de synthetic"})).toBeVisible();
  await expect(detail.getByRole("button",{name:"Télécharger",exact:true})).toHaveCount(0);
  const blob=await detail.locator("img").getAttribute("src");
  await page.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("complementary")).toHaveCount(0);
  expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } },blob)).toBe(true);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});
