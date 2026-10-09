import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.HESTIA_TEST_PASSWORD;
if (!password || process.env.HESTIA_ENVIRONMENT !== "local") throw new Error("Use the owned local E2E harness.");
async function login(page: Page, member = "camille") {
  await page.goto("/");
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByLabel("Adresse e-mail").fill(`${member}@hestia.invalid`);
    await page.getByLabel("Mot de passe", {exact:true}).fill(password!);
    const response = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", {name:"Se connecter",exact:true}).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading", {name:"Dossiers",exact:true})).toBeVisible();
}
async function openShare(page: Page) {
  await page.getByRole("tab", {name:"Accès",exact:true}).click();
  await page.getByRole("button", {name:"Donner accès",exact:true}).click();
}
async function createFolder(page: Page) {
  const name = `Accès ${randomUUID().slice(0,8)}`;
  await login(page);
  await page.getByRole("button", {name:"Nouveau dossier",exact:true}).click();
  await page.getByLabel("Nom du dossier").fill(name);
  const created = page.waitForResponse(r => r.url().endsWith("/api/hestia/folders") && r.request().method() === "POST");
  await page.getByRole("button", {name:"Créer le dossier",exact:true}).click();
  const {folder} = await (await created).json();
  await expect(page.getByRole("heading", {name,exact:true})).toBeVisible();
  return folder as {id: string; name: string};
}

test("partage borné, accès réel d’Alex et retrait confirmé", async ({page, browser, isMobile}) => {
  const folder = await createFolder(page);
  await openShare(page);
  const share = page.getByRole("complementary", {name:/^Donner accès à/});
  const mainEmpty = page.getByRole("tabpanel",{name:"Accès",exact:true,includeHidden:true});
  await expect(mainEmpty).toBeAttached();
  if (!isMobile) await expect(mainEmpty).toBeVisible();
  await share.getByLabel("Personne du foyer").selectOption({label:"Alex"});
  await expect(share.getByRole("checkbox", {name:"Exporter",exact:true})).not.toBeChecked();
  await share.getByRole("checkbox", {name:"Déposer",exact:true}).check();
  await page.screenshot({path:test.info().outputPath("share.png"),fullPage:true});
  await share.getByRole("button", {name:"Donner accès",exact:true}).click();
  await expect(page.getByText("Accès accordé.",{exact:true})).toBeVisible();
  await expect(page.getByText("Dossier créé.",{exact:true})).toHaveCount(0);
  await expect(page.getByText(/est privé : personne d’autre que vous/)).toHaveCount(0);
  await openShare(page);
  const mainAccess = page.getByRole("tabpanel",{name:"Accès",exact:true,includeHidden:true});
  await expect(mainAccess.getByText("Alex",{exact:true})).toBeAttached();
  if (!isMobile) await expect(mainAccess.getByText("Alex",{exact:true})).toBeVisible();
  await share.getByRole("button",{name:"Fermer",exact:true}).click();
  const alexContext = await browser.newContext({baseURL:"http://127.0.0.1:3210"});
  try {
    const alex = await alexContext.newPage(); await login(alex,"alex");
    const result = await (await alex.request.get("/api/hestia/folders")).json();
    const shared = result.folders.find((f: {id: string}) => f.id === folder.id);
    expect(shared.capabilities.sort()).toEqual(["consulter","déposer"].sort());
    expect(shared.canShare).toBe(false); expect(shared.canAdminister).toBe(false);
    await alex.getByRole("main").getByRole("button",{name:new RegExp(folder.name)}).click();
    await expect(alex.getByRole("button",{name:"Ajouter un document",exact:true})).toBeVisible();
    await expect(alex.getByRole("button",{name:"Donner accès",exact:true})).toHaveCount(0);
    await expect(alex.getByRole("tab",{name:"Accès",exact:true})).toHaveCount(0);
    await expect(alex.getByRole("tab",{name:"Corbeille",exact:true})).toHaveCount(0);
    expect((await alex.request.get(`/api/hestia/folders/${folder.id}/access`)).status()).toBe(404);
    const access = page.getByRole("tabpanel",{name:"Accès",exact:true});
    await expect(access.getByText("Alex",{exact:true})).toBeVisible();
    await access.getByRole("button",{name:/Alex/}).click();
    await page.getByRole("complementary",{name:"Alex",exact:true}).getByRole("button",{name:"Retirer l’accès propre",exact:true}).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button",{name:"Annuler",exact:true})).toBeFocused();
    await dialog.getByRole("button",{name:"Annuler",exact:true}).click();
    await page.getByRole("complementary",{name:"Alex",exact:true}).getByRole("button",{name:"Retirer l’accès propre",exact:true}).click();
    await dialog.getByRole("button",{name:"Retirer l’accès propre",exact:true}).click();
    await expect(page.getByText("Accès retiré.",{exact:true})).toBeVisible();
    await expect(access.getByText("Alex",{exact:true})).toHaveCount(0);
    const after = await (await alex.request.get("/api/hestia/folders")).json();
    expect(after.folders.some((f: {id: string}) => f.id === folder.id)).toBe(false);
    await page.screenshot({path:test.info().outputPath(isMobile ? "access-mobile.png" : "access-desktop.png"),fullPage:true});
  } finally { await alexContext.close(); }
});

test("corbeille confirmée, ancien contenu refusé, restauration même original", async ({page,isMobile}) => {
  const folder = await createFolder(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Ajouter un document",exact:true}).click();
  await (await chooser).setFiles("tests/fixtures/documents/synthetic.png");
  const upload = page.getByRole("complementary",{name:"Ajout de documents",exact:true});
  await upload.getByLabel("Titre du document").fill("Document à récupérer");
  await upload.getByRole("button",{name:"Enregistrer",exact:true}).click();
  await expect(upload.getByText("Document enregistré.",{exact:true})).toBeVisible({timeout:30_000});
  await upload.getByRole("button",{name:"Terminé",exact:true}).click();
  const before = await (await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json();
  const original = before.documents[0];
  await page.getByRole("main").getByRole("button",{name:/Document à récupérer/}).click();
  const detail = page.getByRole("complementary",{name:"Document",exact:true});
  if (!isMobile) {
    await expect(detail).toBeVisible();
    await openShare(page);
    await expect(page.getByRole("complementary",{name:/^Donner accès à/})).toBeVisible();
    await expect(detail).toHaveCount(0);
    await page.getByRole("tab",{name:/^Contenu/}).click();
    await page.getByRole("main").getByRole("button",{name:/Document à récupérer/}).click();
    await expect(detail).toBeVisible();
    await expect(page.getByRole("complementary",{name:/^Donner accès à/})).toHaveCount(0);
  }
  await detail.getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button",{name:"Annuler",exact:true})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await detail.getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button",{name:/Document à récupérer/})).toHaveCount(0);
  expect((await page.request.get(`/api/hestia/documents/${original.id}/content?intent=download&offset=0&length=${original.size}`)).status()).toBe(404);
  const search = await (await page.request.get("/api/hestia/documents?q=Document%20%C3%A0%20r%C3%A9cup%C3%A9rer")).json();
  expect(search.documents.some((d: {id: string}) => d.id === original.id)).toBe(false);
  await page.getByRole("tab",{name:"Corbeille",exact:true}).click();
  await expect(page.getByText("Document à récupérer",{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath("trash.png"),fullPage:true});
  await openShare(page);
  const mainAccessDuringShare = page.getByRole("tabpanel",{name:"Accès",exact:true,includeHidden:true});
  await expect(mainAccessDuringShare).toBeAttached();
  if (!isMobile) await expect(mainAccessDuringShare).toBeVisible();
  await page.getByRole("complementary",{name:/^Donner accès à/}).getByRole("button",{name:"Fermer",exact:true}).click();
  await page.getByRole("tab",{name:"Corbeille",exact:true}).click();
  await page.getByRole("button",{name:"Restaurer « Document à récupérer »",exact:true}).click();
  await expect(page.getByText("Restauré.",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"La corbeille est vide",exact:true})).toBeVisible();
  const after = await (await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json();
  expect(after.documents).toHaveLength(1);
  expect(after.documents[0].id).toBe(original.id); expect(after.documents[0].sha256).toBe(original.sha256);
  await page.getByRole("tab",{name:/^Contenu/}).click();
  await expect(page.getByRole("main").getByRole("button",{name:/Document à récupérer/})).toBeVisible();
});

test("enveloppe serveur borne les options même si le membre détient les capacités", async ({page}) => {
  const folder = await createFolder(page);
  await page.route(`**/api/hestia/folders/${folder.id}/sharing`, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({response,json:{members:data.members.map((member: {id: string; name: string}) => ({...member,canExport:false,canDeposit:false,canExportAndDeposit:false,allowedCapabilitySets:[["consulter"]]}))}});
  });
  await openShare(page);
  const panel = page.getByRole("complementary",{name:/^Donner accès à/});
  await expect(panel.getByRole("checkbox",{name:"Exporter",exact:true})).toBeDisabled();
  await expect(panel.getByRole("checkbox",{name:"Exporter",exact:true})).not.toBeChecked();
  await expect(panel.getByRole("checkbox",{name:"Déposer",exact:true})).toBeDisabled();
});

test("options par bénéficiaire : deux enveloppes séparées ne permettent pas leur combinaison", async ({page}) => {
  const folder = await createFolder(page);
  await page.route(`**/api/hestia/folders/${folder.id}/sharing`, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch(); const data = await response.json();
    const alex = data.members.find((member: {name: string}) => member.name === "Alex");
    expect(alex).toBeTruthy();
    await route.fulfill({response,json:{members:[
      {...alex,canExport:true,canDeposit:true,canExportAndDeposit:false,allowedCapabilitySets:[["consulter","exporter"],["consulter","déposer"]]},
      {id:randomUUID(),name:"Morgan synthétique",canExport:false,canDeposit:true,canExportAndDeposit:false,allowedCapabilitySets:[["consulter","déposer"]]}
    ]}});
  });
  await openShare(page);
  const panel = page.getByRole("complementary",{name:/^Donner accès à/});
  const exp = panel.getByRole("checkbox",{name:"Exporter",exact:true});
  const deposit = panel.getByRole("checkbox",{name:"Déposer",exact:true});
  await expect(exp).not.toBeChecked(); await expect(deposit).not.toBeChecked(); await expect(deposit).toBeEnabled();
  await exp.check(); await expect(deposit).toBeDisabled(); await exp.uncheck(); await expect(deposit).toBeEnabled(); await deposit.check();
  await expect(exp).not.toBeChecked(); await expect(exp).toBeDisabled();
  await panel.getByLabel("Personne du foyer").selectOption({label:"Morgan synthétique"});
  await expect(exp).not.toBeChecked(); await expect(exp).toBeDisabled();
  await expect(deposit).not.toBeChecked(); await expect(deposit).toBeEnabled();
  await deposit.check();
  await panel.getByLabel("Personne du foyer").selectOption({label:"Alex"});
  await expect(exp).not.toBeChecked(); await expect(exp).toBeEnabled();
  await expect(deposit).not.toBeChecked(); await expect(deposit).toBeEnabled();
  await exp.check(); await expect(deposit).toBeDisabled();
  const submitted = page.waitForRequest(request => request.url().endsWith(`/folders/${folder.id}/sharing`) && request.method() === "POST");
  await panel.getByRole("button",{name:"Donner accès",exact:true}).click();
  expect((await submitted).postDataJSON()).toMatchObject({export:true,deposit:false});
  await expect(page.getByText("Accès accordé.",{exact:true})).toBeVisible();
});

test("ouvrir le partage abandonne le dépôt non confirmé et conserve le corps du dossier", async ({page,isMobile}) => {
  test.skip(isMobile, "Sur mobile, le panneau de dépôt masque les actions du dossier selon le hand-off.");
  const folder = await createFolder(page);
  let releaseChunk = () => {};
  const heldChunk = new Promise<void>(resolve => { releaseChunk = resolve; });
  await page.route("**/api/hestia/uploads/*/chunks/*", async route => { await heldChunk; await route.abort().catch(() => {}); });
  try {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button",{name:"Ajouter un document",exact:true}).click();
    await (await chooser).setFiles("tests/fixtures/documents/synthetic.png");
    const upload = page.getByRole("complementary",{name:"Ajout de documents",exact:true});
    const started = page.waitForResponse(response => response.url().endsWith("/api/hestia/uploads") && response.request().method() === "POST");
    const chunk = page.waitForRequest(request => /\/uploads\/[^/]+\/chunks\/0$/.test(request.url()));
    await upload.getByRole("button",{name:"Enregistrer",exact:true}).click();
    const {operation} = await (await started).json(); await chunk;
    const cancelled = page.waitForResponse(response => response.url().endsWith(`/api/hestia/uploads/${operation.id}`) && response.request().method() === "DELETE");
    await openShare(page);
    expect((await cancelled).status()).toBe(200);
    await expect(upload).toHaveCount(0);
    await expect(page.getByRole("complementary",{name:/^Donner accès à/})).toBeVisible();
    await expect(page.getByRole("tabpanel",{name:"Accès",exact:true})).toBeVisible();
    const result = await (await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json();
    expect(result.documents).toEqual([]);
  } finally { releaseChunk(); await page.unroute("**/api/hestia/uploads/*/chunks/*"); }
});
