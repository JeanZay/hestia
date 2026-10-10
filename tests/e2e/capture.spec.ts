import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const password=process.env.HESTIA_TEST_PASSWORD;
if(!password||process.env.HESTIA_ENVIRONMENT!=="local")throw new Error("Use the owned synthetic local harness.");
async function login(page:Page,email="camille@hestia.invalid"){
  await page.goto("/");
  for(let attempt=0;attempt<4;attempt++){
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe",{exact:true}).fill(password!);
    const response=page.waitForResponse(r=>r.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button",{name:"Se connecter",exact:true}).click();
    if((await response).status()!==429)break;
    await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
}
async function createFolder(page:Page){const name=`Capture ${randomUUID().slice(0,8)}`;const r=await page.request.post("/api/hestia/folders",{headers:{origin:"http://127.0.0.1:3210"},data:{name,parentId:null,idempotencyKey:randomUUID()}});expect(r.ok()).toBeTruthy();return (await r.json()).folder as {id:string;name:string};}
async function drafts(page:Page){await page.getByRole("button",{name:"Moi",exact:true}).click();await expect(page.getByRole("button",{name:"Suggestions de rangement (IA)",exact:true})).toHaveCount(0);await page.getByRole("button",{name:"Brouillons",exact:true}).last().click();}
async function picker(page:Page,label:string,hidden=false){
  const chosen=page.waitForEvent("filechooser");await page.getByRole("button",{name:label,exact:true}).click();const input=await chosen;
  if(hidden){await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});});}
  await input.setFiles("tests/fixtures/documents/synthetic.png");
  await expect(page.getByText("Page sauvegardée.",{exact:true})).toBeVisible({timeout:30_000});
}
async function choose(page:Page,name:string){await page.getByRole("button",{name:"Parcourir les dossiers",exact:true}).click();await page.getByRole("radio",{name,exact:true}).click();await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();await expect(page.getByRole("heading",{name:"Qui pourra accéder au document",exact:true})).toBeVisible();}

test("Capture mobile : pages ajustées, reprise privée, PDF multipage et classement manuel",async({page,isMobile})=>{
  test.skip(!isMobile,"A physical camera is not claimed; this test injects synthetic files on the mobile profile.");
  await login(page);const folder=await createFolder(page);await page.reload();await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Photo",exact:true}).click();
  await expect(page.getByText("Choisir une image existante",{exact:true})).toHaveCount(0);
  await picker(page,"Prendre la première page",true);await picker(page,"Ajouter une page",true);
  await expect(page.getByRole("list",{name:"Pages du document"}).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button",{name:"Monter la page 2",exact:true}).click();
  await expect(page.getByRole("button",{name:"Continuer",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Ajuster la page",exact:true}).first().click();
  await page.getByRole("button",{name:"Tourner à droite",exact:true}).click();
  await expect(page.getByRole("button",{name:"Rogner davantage en haut",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Rogner davantage en haut",exact:true}).click();
  await expect(page.getByText("rogné de 5 %",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Fermer",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Fermer",exact:true}).click();await drafts(page);
  const row=page.locator("li").filter({hasText:"2 page(s) sauvegardée(s)"}).last();
  await row.getByRole("button",{name:"Reprendre",exact:true}).click();
  await expect(page.getByRole("list",{name:"Pages du document"}).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button",{name:"Continuer",exact:true}).click();await page.getByLabel("Titre du document").fill(`PDF ${folder.name}`);
  await expect(page.getByRole("radio",{name:"Image",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible({timeout:30_000});
  await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();await expect(page.getByText("Suggestions indisponibles.",{exact:true})).toBeVisible();
  await choose(page,folder.name);await page.screenshot({path:test.info().outputPath("capture-review-mobile.png"),fullPage:true});
  // Capture uses an internal scroller. Check that its last disclosure can be
  // read above the sticky confirmation bar, not merely present in the DOM.
  await page.getByRole("main").evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const disclosure=page.locator(".hc-note");await expect(disclosure).toBeInViewport();
  const disclosureBox=await disclosure.boundingBox(),footerBox=await page.locator(".hc-footer").boundingBox();
  expect(disclosureBox).not.toBeNull();expect(footerBox).not.toBeNull();
  expect(disclosureBox!.y+disclosureBox!.height).toBeLessThanOrEqual(footerBox!.y);
  await page.screenshot({path:test.info().outputPath("capture-review-mobile-scrolled.png"),fullPage:true});
  await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible({timeout:30_000});
  const docs=(await (await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json()).documents;
  expect(docs).toHaveLength(1);expect(docs[0].mediaType).toBe("application/pdf");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("Import assisté intact : réponse perdue puis reçu unique, sans brouillon durable",async({page})=>{
  await login(page);const folder=await createFolder(page);await page.reload();await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();await drafts(page);
  await picker(page,"Importer un fichier");await page.getByLabel("Titre du document").fill(`Import ${folder.name}`);await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();await choose(page,folder.name);
  let finalized=0;
  await page.route("**/api/hestia/capture/*/finalize",async route=>{finalized++;const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort();});
  await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Résultat incertain.",{exact:true})).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));});
  await page.getByRole("button",{name:"Vérifier le résultat",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible();expect(finalized).toBe(1);
  const docs=(await (await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json()).documents;
  expect(docs).toHaveLength(1);expect(docs[0].sha256).toBe(createHash("sha256").update(await readFile("tests/fixtures/documents/synthetic.png")).digest("hex"));
  const listing=await (await page.request.get("/api/hestia/capture")).json();expect(listing.captures.every((c:{kind:string})=>c.kind==="camera")).toBe(true);
  await page.screenshot({path:test.info().outputPath("capture-import-confirmed.png"),fullPage:true});
});

test("Réglages IA : clé write-only, catalogue absent honnête et aucun appel implicite",async({page})=>{
  await login(page,"alex@hestia.invalid");await page.getByRole("button",{name:"Moi",exact:true}).click();
  let checks=0;page.on("request",r=>{if(r.url().endsWith("/classification-settings/check"))checks++;});
  await page.getByRole("button",{name:"Suggestions de rangement (IA)",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Suggestions de rangement",exact:true})).toBeVisible();
  await expect(page.getByLabel("Plafond mensuel de dépenses (en euros)")).toBeVisible();
  await expect(page.getByLabel("Clé API",{exact:true})).toHaveAttribute("type","password");
  await expect(page.getByLabel("Fournisseur",{exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Enregistrer",exact:true})).toBeDisabled();expect(checks).toBe(0);
  await page.screenshot({path:test.info().outputPath("capture-settings-inactive.png"),fullPage:true});
});

test("Import assisté : confirmation de page perdue, reprise sans renvoyer les portions",async({page})=>{
  await login(page);await drafts(page);
  let completions=0,chunks=0;
  page.on("request",r=>{if(/\/capture\/[^/]+\/pages\/[^/]+\/chunks\//.test(r.url()))chunks++;});
  await page.route("**/api/hestia/capture/*/pages/*/complete",async route=>{
    completions++;
    if(completions===1){const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort();}
    else await route.continue();
  });
  const chooser=page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Importer un fichier",exact:true}).click();
  await (await chooser).setFiles("tests/fixtures/documents/synthetic.png");
  await expect(page.getByRole("button",{name:"Réessayer l’envoi",exact:true})).toBeVisible();
  const sent=chunks;expect(sent).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Réessayer l’envoi",exact:true}).click();
  await expect(page.getByText("Page sauvegardée.",{exact:true})).toBeVisible();
  expect(chunks).toBe(sent);expect(completions).toBe(2);
  await expect(page.getByRole("button",{name:"Choisir où ranger",exact:true})).toBeEnabled();
});

// Uses existing login/createFolder/drafts/picker helpers. The provider response
// alone is mocked; session, original, preview, rights, folders and final stay real.
test("Suggestions tardives : choix manuel préservé puis chemin confirmé atomiquement",async({page})=>{
  await login(page);
  const first=await createFolder(page),second=await createFolder(page);
  const suffix=randomUUID().slice(0,8),levels=["Contrats synthétiques "+suffix,"Année 2026"];
  await page.reload();await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();await drafts(page);
  await picker(page,"Importer un fichier");await page.getByLabel("Titre du document").fill("Classement proposé "+suffix);
  await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible();
  let requested!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{requested=resolve;});
  const delivered=new Promise<void>(resolve=>{release=resolve;});
  let analyses=0;
  await page.route("**/api/hestia/capture/*/analyze",async route=>{
    analyses++;if(analyses===2){requested();await delivered;}
    await route.fulfill({status:200,json:{analysisId:randomUUID(),status:"complete",result:{
      existing:[{folderId:first.id,reason:"Premier dossier synthétique compatible."},{folderId:second.id,reason:"Second dossier synthétique compatible."}],
      created:[{parentId:second.id,levels,reason:"Proposition synthétique à confirmer."}]
    }}});
  });
  await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();
  await expect(page.getByRole("button",{name:"Choisir ce chemin",exact:true})).toBeVisible();
  await expect(page.getByRole("radio",{name:first.name,exact:true})).toHaveAttribute("aria-checked","false");
  await expect(page.getByRole("radio",{name:second.name,exact:true})).toHaveAttribute("aria-checked","false");
  await expect(page.getByText("Destination choisie.",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await started;
  await page.getByRole("button",{name:"Parcourir les dossiers",exact:true}).click();
  await page.getByRole("group",{name:"Choisir un dossier",exact:true}).getByRole("radio",{name:first.name,exact:true}).click();
  await expect(page.getByText("Destination choisie.",{exact:true})).toBeVisible();
  release();
  await expect(page.getByText("Suggestions arrivées après votre choix : votre sélection n’a pas changé.",{exact:true})).toBeVisible();
  await expect(page.getByRole("radio",{name:first.name,exact:true})).toHaveAttribute("aria-checked","true");
  await expect(page.getByRole("radio",{name:second.name,exact:true})).toHaveAttribute("aria-checked","false");
  const before=(await (await page.request.get("/api/hestia/folders")).json()).folders;
  expect(before.some((f:{name:string})=>f.name===levels[0])).toBe(false);
  await page.getByRole("button",{name:"Choisir ce chemin",exact:true}).click();
  await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Qui pourra accéder au document",exact:true})).toBeVisible();
  await expect(page.getByText(second.name+" / "+levels[0]+" (à créer) / "+levels[1]+" (à créer)",{exact:true})).toBeVisible();
  const previewOnly=(await (await page.request.get("/api/hestia/folders")).json()).folders;
  expect(previewOnly.some((f:{name:string})=>f.name===levels[0])).toBe(false);
  await page.screenshot({path:test.info().outputPath("capture-assistance-confirmation.png"),fullPage:true});
  await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();
  await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible();
  const after=(await (await page.request.get("/api/hestia/folders")).json()).folders as {id:string;name:string;visibleParentId:string|null}[];
  const level1=after.filter(f=>f.name===levels[0]&&f.visibleParentId===second.id);expect(level1).toHaveLength(1);
  const level2=after.filter(f=>f.name===levels[1]&&f.visibleParentId===level1[0].id);expect(level2).toHaveLength(1);
  const documents=(await (await page.request.get("/api/hestia/documents?folderId="+level2[0].id)).json()).documents;
  expect(documents).toHaveLength(1);expect(documents[0].sha256).toBe(createHash("sha256").update(await readFile("tests/fixtures/documents/synthetic.png")).digest("hex"));
  expect(analyses).toBe(2);
});
