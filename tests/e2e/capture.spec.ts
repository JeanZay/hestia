import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { ClassificationResultDto } from "../../src/shared/capture-contract";
import { execFileSync } from "node:child_process";

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

const localOrigin={origin:"http://127.0.0.1:3210"};
async function namedFolder(page:Page,name:string,parentId:string|null=null){
  const response=await page.request.post("/api/hestia/folders",{headers:localOrigin,data:{name,parentId,idempotencyKey:randomUUID()}});expect(response.status()).toBe(201);return (await response.json()).folder as {id:string;name:string};
}
async function assistedImport(page:Page,result:ClassificationResultDto){
  let analyses=0;
  await page.route("**/api/hestia/capture/*/analyze",async route=>{analyses++;await route.fulfill({status:200,json:{analysisId:randomUUID(),status:"complete",result}});});
  await page.reload();await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();await drafts(page);await picker(page,"Importer un fichier");
  await page.getByLabel("Titre du document").fill("Garantie synthétique");await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();
  await expect(page.getByRole("heading",{name:"3. Créer un chemin (proposé)",exact:true})).toBeVisible();return ()=>analyses;
}

const emptyFeedbackText="Aucune suggestion pertinente pour ce document. Choisissez un dossier vous-même.";
const emptyFeedback=(page:Page)=>page.getByRole("status",{name:"Aucune suggestion pertinente.",exact:true});
async function feedbackImport(page:Page){
  await drafts(page);await picker(page,"Importer un fichier");
  await page.getByLabel("Titre du document").fill("Capture synthétique sans destination");
  await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible();
}

test("Résultat IA vide : retour accessible renouvelé et classement manuel sans relance implicite",async({page})=>{
  await login(page);const folder=await createFolder(page),before=(await(await page.request.get("/api/hestia/folders")).json()).folders;
  let analyses=0,deliver=()=>{};const held=new Promise<void>(resolve=>{deliver=resolve;});
  await page.route("**/api/hestia/capture/*/analyze",async route=>{
    analyses++;if(analyses===2)await held;
    await route.fulfill({status:200,json:{analysisId:randomUUID(),status:"complete",result:{existing:[],created:[]}}});
  });
  await feedbackImport(page);await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();
  const feedback=emptyFeedback(page);await expect(feedback).toHaveText(emptyFeedbackText);await expect(feedback).toHaveAttribute("aria-live","polite");
  await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeDisabled();expect(analyses).toBe(1);
  await choose(page,folder.name);await page.getByRole("button",{name:"Retour",exact:true}).click();
  await expect(page.getByText("Destination choisie.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();
  await expect(page.getByRole("button",{name:"Ne plus attendre",exact:true})).toBeVisible();await expect(feedback).toHaveCount(0);
  deliver();await expect(feedback).toHaveText(emptyFeedbackText);await expect(page.getByText("Destination choisie.",{exact:true})).toBeVisible();
  expect(analyses).toBe(2);expect((await(await page.request.get("/api/hestia/folders")).json()).folders).toEqual(before);
  expect((await(await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json()).documents).toHaveLength(0);
  await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeEnabled();
});

test("Résultat IA vide : transitions existant, vide puis nouveau chemin sans faux état vide",async({page})=>{
  await login(page);const folder=await createFolder(page),rootName=`Soins ${randomUUID().slice(0,8)}`;
  const results:ClassificationResultDto[]=[{existing:[{folderId:folder.id,reason:"Dossier témoin synthétique."}],created:[]},{existing:[],created:[]},{existing:[],created:[{parentId:null,levels:[rootName],reason:"Chemin synthétique à confirmer."}]}];
  let analyses=0;await page.route("**/api/hestia/capture/*/analyze",async route=>{
    const result=results[analyses++];expect(result).toBeDefined();await route.fulfill({status:200,json:{analysisId:randomUUID(),status:"complete",result}});
  });
  await feedbackImport(page);await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();
  await expect(page.getByRole("radio",{name:folder.name,exact:true})).toBeVisible();await expect(emptyFeedback(page)).toHaveCount(0);
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await expect(emptyFeedback(page)).toHaveText(emptyFeedbackText);
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await expect(page.getByRole("heading",{name:"3. Créer un chemin (proposé)",exact:true})).toBeVisible();
  await expect(emptyFeedback(page)).toHaveCount(0);await page.locator(".hc-path-suggestion").getByRole("button",{name:"Choisir cette proposition",exact:true}).click();
  await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeEnabled();
  expect((await(await page.request.get("/api/hestia/folders")).json()).folders.some((f:{name:string})=>f.name===rootName)).toBe(false);expect(analyses).toBe(3);
});

test("Résultat IA vide : erreur et réponse annulée distinctes, puis succès courant après polling",async({page})=>{
  await login(page);let analyses=0,polls=0,deliver=()=>{};const held=new Promise<void>(resolve=>{deliver=resolve;});
  await page.route("**/api/hestia/capture/*/analyze",async route=>{
    analyses++;const attempt=analyses;if(attempt===3)await held;
    await route.fulfill({status:200,json:{analysisId:randomUUID(),status:attempt===2?"failed":attempt===4?"pending":"complete",...(attempt===2||attempt===4?{}:{result:{existing:[],created:[]}})}});
  });
  await page.route("**/api/hestia/capture/*/analyses/*",async route=>{polls++;await route.fulfill({status:200,json:{analysisId:randomUUID(),status:"complete",result:{existing:[],created:[]}}});});
  await feedbackImport(page);await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();await expect(emptyFeedback(page)).toHaveText(emptyFeedbackText);
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await expect(page.getByText("Suggestions indisponibles.",{exact:true})).toBeVisible();await expect(emptyFeedback(page)).toHaveCount(0);
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await expect(page.getByRole("button",{name:"Ne plus attendre",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Ne plus attendre",exact:true}).click();const lateResponse=page.waitForResponse(r=>r.url().endsWith("/analyze"));deliver();await lateResponse;
  await expect(page.getByText("Vous n’attendez plus les suggestions.",{exact:true})).toBeVisible();await expect(emptyFeedback(page)).toHaveCount(0);
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await expect(emptyFeedback(page)).toHaveText(emptyFeedbackText);
  expect(analyses).toBe(4);expect(polls).toBe(1);await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeDisabled();
});

test("Résultat IA vide : modification du document invalide le message et la réponse ancienne",async({page})=>{
  await login(page);let analyses=0,deliver=()=>{};const held=new Promise<void>(resolve=>{deliver=resolve;});
  await page.route("**/api/hestia/capture/*/analyze",async route=>{
    analyses++;if(analyses===2)await held;
    await route.fulfill({status:200,json:{analysisId:randomUUID(),status:"complete",result:{existing:[],created:[]}}});
  });
  await feedbackImport(page);await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();await expect(emptyFeedback(page)).toHaveText(emptyFeedbackText);
  await page.getByRole("button",{name:"Redemander (nouvelle analyse)",exact:true}).click();await expect(page.getByRole("button",{name:"Ne plus attendre",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Retour",exact:true}).click();await page.getByLabel("Titre du document").fill("Document synthétique modifié");
  await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible();
  const staleResponse=page.waitForResponse(r=>r.url().endsWith("/analyze"));deliver();await staleResponse;
  await expect(emptyFeedback(page)).toHaveCount(0);await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Demander des suggestions",exact:true}).click();await expect(emptyFeedback(page)).toHaveText(emptyFeedbackText);expect(analyses).toBe(3);
});

test("Guide Capture : nouvelle racine privée, changement annulé et rétabli avant confirmation",async({page,browser})=>{
  await login(page);const existing=await createFolder(page),rootName=`Animaux ${randomUUID().slice(0,8)}`;
  const count=await assistedImport(page,{existing:[],created:[{parentId:null,levels:[rootName,"Soins"],reason:"Document vétérinaire synthétique."}]});
  const card=page.locator(".hc-path-suggestion");await expect(card.getByText("Nouvelle racine privée",{exact:true})).toBeVisible();
  await card.getByRole("button",{name:"Changer de point de départ",exact:true}).click();await card.getByRole("button",{name:"Annuler le changement",exact:true}).click();
  await expect(card.getByText("Nouvelle racine privée",{exact:true})).toBeVisible();
  await card.getByRole("button",{name:"Changer de point de départ",exact:true}).click();await card.getByRole("radio",{name:existing.name,exact:true}).click();
  await expect(card.getByText("Point de départ modifié par vous",{exact:true})).toBeVisible();
  await card.getByRole("button",{name:"Revenir au point de départ proposé",exact:true}).click();await expect(card.getByText("Nouvelle racine privée",{exact:true})).toBeVisible();
  await card.getByRole("button",{name:"Choisir cette proposition",exact:true}).focus();await page.keyboard.press("Enter");
  const previewResponse=page.waitForResponse(r=>r.url().endsWith("/preview")&&r.request().method()==="POST");await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();
  const preview=(await(await previewResponse).json()).preview;expect(preview.path.map((p:{isNew:boolean})=>p.isNew)).toEqual([true,true]);expect(preview.access.people).toHaveLength(1);
  await expect(page.getByRole("list",{name:"Chemin exact",exact:true})).toContainText("Racine de votre espace · privé");
  expect((await(await page.request.get("/api/hestia/folders")).json()).folders.some((f:{name:string})=>f.name===rootName)).toBe(false);
  await page.getByRole("list",{name:"Chemin exact",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath("capture-private-root-review.png"),fullPage:true});
  await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible();
  const rows=(await(await page.request.get("/api/hestia/folders")).json()).folders as {id:string;name:string;visibleParentId:string|null}[];
  const root=rows.find(f=>f.name===rootName)!;expect(root.visibleParentId).toBeNull();const child=rows.find(f=>f.visibleParentId===root.id&&f.name==="Soins")!;
  expect((await(await page.request.get(`/api/hestia/documents?folderId=${child.id}`)).json()).documents).toHaveLength(1);expect(count()).toBe(1);
  const context=await browser.newContext({baseURL:"http://127.0.0.1:3210"});try{const other=await context.newPage();await login(other,"alex@hestia.invalid");expect((await other.request.get(`/api/hestia/folders/${root.id}`)).status()).toBe(404);}finally{await context.close();}
});

test("Guide Capture : préfixe réutilisé et collision après aperçu, sans nouvelle analyse",async({page})=>{
  await login(page);const root=await createFolder(page),equipment=await namedFolder(page,"Équipements",root.id);
  const count=await assistedImport(page,{existing:[],created:[{parentId:null,levels:[root.name,"Équipements","Garanties"],reason:"Garanties de l’équipement synthétique."}]});
  const card=page.locator(".hc-path-suggestion");await expect(card.getByText("Chemin dans vos dossiers existants",{exact:true})).toBeVisible();
  await expect(card.locator('[data-status="reused"]')).toHaveCount(2);await expect(card.locator('[data-status="new"]')).toHaveCount(1);
  await card.getByRole("button",{name:"Choisir cette proposition",exact:true}).click();await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Qui pourra accéder au document",exact:true})).toBeVisible();
  const appeared=await namedFolder(page,"Garanties",equipment.id);
  await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible();
  await expect(page.getByText("Accès modifiés.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true})).toBeDisabled();
  await expect(card.getByText("Tout ce chemin existe déjà : aucun dossier ne sera créé.",{exact:true})).toBeVisible();
  expect((await(await page.request.get(`/api/hestia/documents?folderId=${appeared.id}`)).json()).documents).toHaveLength(0);
  await card.getByRole("button",{name:"Choisir « Garanties » (existant)",exact:true}).click();
  await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();await expect(page.getByRole("list",{name:"Chemin exact",exact:true}).locator('[data-status="new"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible();expect(count()).toBe(1);
  const rows=(await(await page.request.get("/api/hestia/folders")).json()).folders;expect(rows.filter((f:{visibleParentId:string;name:string})=>f.visibleParentId===equipment.id&&f.name==="Garanties")).toHaveLength(1);
  expect((await(await page.request.get(`/api/hestia/documents?folderId=${appeared.id}`)).json()).documents).toHaveLength(1);
});

test("Guide Capture : homonymes et sous-dossier partagé, ancêtre privé invisible",async({page,browser})=>{
  await login(page);const suffix=randomUUID().slice(0,8),sameName=`Équipement ${suffix}`;await namedFolder(page,sameName);
  const context=await browser.newContext({baseURL:"http://127.0.0.1:3210"});
  try{
    const owner=await context.newPage();await login(owner,"alex@hestia.invalid");const hidden=await namedFolder(owner,`Privé ${suffix}`),shared=await namedFolder(owner,sameName,hidden.id);
    const sharing=await(await owner.request.get(`/api/hestia/folders/${shared.id}/sharing`)).json();const camille=sharing.members.find((m:{name:string})=>m.name==="Camille");expect(camille).toBeTruthy();
    expect((await owner.request.post(`/api/hestia/folders/${shared.id}/sharing`,{headers:localOrigin,data:{memberId:camille.id,export:false,deposit:true,modify:true,delete:false,idempotencyKey:randomUUID()}})).status()).toBe(200);
    const count=await assistedImport(page,{existing:[],created:[{parentId:null,levels:[sameName,"Garanties"],reason:"Choisissez l’équipement concerné."}]});
    const card=page.locator(".hc-path-suggestion");await expect(card.getByText("Chemin à préciser",{exact:true})).toBeVisible();await expect(card.getByRole("button",{name:"Choisir cette proposition",exact:true})).toBeDisabled();
    await expect(card.getByRole("radio")).toHaveCount(2);await card.getByRole("radio",{name:/Créé par Alex/}).click();
    await expect(card.getByRole("radio")).toHaveCount(0);await expect(card.getByText("Chemin dans vos dossiers existants",{exact:true})).toBeVisible();
    await expect(card.getByText("Nouvelle racine privée",{exact:true})).toHaveCount(0);await expect(page.getByText(hidden.name,{exact:false})).toHaveCount(0);
    await card.getByRole("button",{name:"Choisir cette proposition",exact:true}).click();const response=page.waitForResponse(r=>r.url().endsWith("/preview")&&r.request().method()==="POST");await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();
    const preview=(await(await response).json()).preview;expect(preview.path.map((p:{name:string})=>p.name)).toEqual([sameName,"Garanties"]);expect(preview.access.people).toBeUndefined();expect(JSON.stringify(preview)).not.toContain(hidden.name);
    await page.getByRole("list",{name:"Chemin exact",exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:test.info().outputPath("capture-shared-prefix-review.png"),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible();expect(count()).toBe(1);
    const rows=(await(await owner.request.get("/api/hestia/folders")).json()).folders;expect(rows.filter((f:{name:string;visibleParentId:string})=>f.name==="Garanties"&&f.visibleParentId===shared.id)).toHaveLength(1);
  }finally{await context.close();}
});

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
  let automaticLists=0;page.on("request",request=>{if(request.method()==="GET"&&new URL(request.url()).pathname==="/api/hestia/capture")automaticLists++;});
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));});
  await expect(page.getByText("Résultat incertain.",{exact:true})).toBeVisible();await page.waitForTimeout(200);expect(automaticLists).toBe(0);
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

test("Remplissage non focalisé : réglages et Capture restent ouverts, recherche volontaire conservée",async({page,isMobile})=>{
  await login(page,"alex@hestia.invalid");
  await page.getByRole("button",{name:"Moi",exact:true}).click();
  await page.getByRole("button",{name:"Suggestions de rangement (IA)",exact:true}).click();
  const heading=page.getByRole("heading",{name:"Suggestions de rangement",exact:true});
  const search=page.getByRole("searchbox",{name:"Rechercher un document ou un dossier",exact:true,includeHidden:true});
  const key=page.getByLabel("Clé API",{exact:true});
  await expect(key).toBeVisible();
  const forbiddenRequests:string[]=[];
  page.on("request",r=>{if(r.url().includes("autofill-witness")||r.url().endsWith("/classification-settings/check")||r.url().endsWith("/classification-settings")&&r.method()!=="GET")forbiddenRequests.push(r.url());});
  // Reproduce input/change from a password manager without claiming a native
  // password-manager simulation. The real saved-profile case is a Dev recipe.
  async function unsolicitedFill(){
    await expect(search).not.toBeFocused();
    await search.evaluate(el=>{
      const input=el as HTMLInputElement;
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
      for(const type of ["input","change"]){
        setter.call(input,"autofill-witness@example.invalid");
        input.dispatchEvent(new Event(type,{bubbles:true}));
      }
    });
    await expect(search).toHaveValue("");
  }
  await unsolicitedFill();await expect(heading).toBeVisible();
  expect(await key.evaluate(el=>(el as HTMLInputElement).form===document.querySelector("form[role=search]"))).toBe(false);
  await key.fill("synthetic-placeholder-not-a-credential");await key.press("Enter");
  await expect(heading).toBeVisible();await expect(key).toHaveValue("synthetic-placeholder-not-a-credential");
  await key.fill("");await expect(key).toHaveValue("");
  await page.getByRole("main").getByRole("button",{name:"Moi",exact:true}).click();
  await page.getByRole("button",{name:"Brouillons",exact:true}).last().click();await picker(page,"Importer un fichier");
  await unsolicitedFill();await expect(page.getByRole("heading",{name:"Titre et format",exact:true})).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
  // The top-bar search is hidden on mobile; its unsolicited changes must still
  // be ignored, but only desktop exposes it for intentional keyboard input.
  if(isMobile){await page.getByRole("button",{name:"Fermer",exact:true}).click();return;}
  await search.focus();await search.pressSequentially("recherche clavier");
  await expect(page.getByRole("heading",{name:"Recherche",exact:true})).toBeVisible();
  await expect(search).toHaveValue("recherche clavier");
  await search.fill("recherche collée");await search.press("Enter");
  await expect(search).toHaveValue("recherche collée");
  await search.fill("");await expect(search).toHaveValue("");
  await expect(page.getByRole("heading",{name:"Recherche",exact:true})).toBeVisible();
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
  await expect(page.getByRole("button",{name:"Choisir cette proposition",exact:true})).toBeVisible();
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
  await page.getByRole("button",{name:"Choisir cette proposition",exact:true}).click();
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

test("confirmation capture réconcilie le workspace, même avec une ancienne réponse et un refresh 503",async({page})=>{
  await login(page);const folder=await createFolder(page);await page.reload();await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();await drafts(page);
  await picker(page,"Importer un fichier");await page.getByLabel("Titre du document").fill(`Confirmé ${folder.name}`);
  await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();await choose(page,folder.name);
  let release!:()=>void,reached!:()=>void,delivered!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{reached=resolve;}),sent=new Promise<void>(resolve=>{delivered=resolve;});
  let reads=0,writes=0,fail=true;const activity:(string|undefined)[]=[];
  page.on("request",request=>{if(request.method()==="POST"&&request.url().endsWith("/finalize"))writes++;});
  await page.route("**/api/hestia/workspace?**",async route=>{
    activity.push(route.request().headers()["x-hestia-activity"]);const phase=++reads;
    if(phase===1){const response=await route.fetch();reached();await held;try{await route.fulfill({response});}catch{/* obsolete fetch */}finally{delivered();}}
    else if(fail)await route.fulfill({status:503,json:{error:{message:"Synthetic refresh failure"}}});else await route.continue();
  });
  try{
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await ready;
    await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible();
    await expect(page.getByText("Action enregistrée. Actualisation indisponible.",{exact:true})).toBeVisible();
    release();await sent;expect(reads).toBe(2);expect(writes).toBe(1);expect(activity).toEqual([undefined,undefined]);
    fail=false;const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/hestia/workspace");
    await page.getByRole("button",{name:"Actualiser",exact:true}).click();expect((await refreshed).status()).toBe(200);expect(writes).toBe(1);
    const docs=(await(await page.request.get(`/api/hestia/documents?folderId=${folder.id}`)).json()).documents;expect(docs).toHaveLength(1);
  }finally{release();}
});

test("Photos : vrai worker JPEG, dérivées bornées, PDF inchangé réutilisé et purge visible",async({page,isMobile})=>{
  test.skip(!isMobile,"The camera route uses the existing mobile capability gate.");
  test.setTimeout(120_000);
  const source=execFileSync(process.execPath,["tests/fixtures/mobile-photos/single.mjs","camera"],{maxBuffer:21*1024*1024,timeout:60_000,windowsHide:true});
  await page.addInitScript(()=>{
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),live=new Set<string>();
    URL.createObjectURL=blob=>{const url=create(blob);live.add(url);return url;};
    URL.revokeObjectURL=url=>{live.delete(url);revoke(url);};
    Object.defineProperty(window,"__photoLiveUrls",{value:live});
  });
  await login(page);
  await page.getByRole("button",{name:"Photo",exact:true}).click();
  const chosen=page.waitForEvent("filechooser");await page.getByRole("button",{name:"Prendre la première page",exact:true}).click();const chooser=await chosen;
  const worker=page.waitForEvent("worker");
  const reservation=page.waitForResponse(r=>/\/capture\/[^/]+\/pages$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST");
  const completion=page.waitForResponse(r=>/\/pages\/[^/]+\/complete$/.test(new URL(r.url()).pathname));
  await chooser.setFiles({name:"synthetic-camera.jpg",mimeType:"image/jpeg",buffer:source});
  const actualWorker=await worker;expect(new URL(actualWorker.url()).origin).toBe("http://127.0.0.1:3210");
  expect(new URL(actualWorker.url()).pathname).toContain("/_next/");
  const reserved=await reservation;expect(reserved.status()).toBe(200);
  const identity=reserved.request().postDataJSON() as {size:number;sha256:string;mediaType:string};
  expect(identity.size).toBeLessThan(source.length);expect(identity.mediaType).toBe("image/jpeg");
  expect(identity.sha256).not.toBe(createHash("sha256").update(source).digest("hex"));
  const completed=await completion;expect(completed.status()).toBe(200);
  const capture=(await completed.json()).capture;expect(Math.max(capture.pages[0].width,capture.pages[0].height)).toBe(3200);
  await expect(page.getByText("Page sauvegardée.",{exact:true})).toBeVisible();
  const thumbnail=page.getByRole("list",{name:"Pages du document"}).locator("img");
  await expect.poll(()=>thumbnail.evaluate((img:HTMLImageElement)=>img.complete?Math.max(img.naturalWidth,img.naturalHeight):0)).toBe(640);
  await page.getByRole("button",{name:"Ajuster la page",exact:true}).click();
  const settings=page.getByRole("group",{name:"Ajuster la page 1",exact:true}).locator("img");
  await expect.poll(()=>settings.evaluate((img:HTMLImageElement)=>img.complete?Math.max(img.naturalWidth,img.naturalHeight):0)).toBe(1600);
  await page.getByRole("button",{name:"Fermer les ajustements",exact:true}).click();
  await page.getByRole("button",{name:"Continuer",exact:true}).click();await page.getByLabel("Titre du document").fill("PDF synthétique sans changement");
  const first=page.waitForResponse(r=>r.url().endsWith("/prepare")&&r.request().method()==="POST");await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();
  const firstResult=await(await first).json();await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Retour",exact:true}).click();
  const second=page.waitForResponse(r=>r.url().endsWith("/prepare")&&r.request().method()==="POST");await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();
  const secondResult=await(await second).json();expect(secondResult.artifact.id).toBe(firstResult.artifact.id);expect(secondResult.artifact.sha256).toBe(firstResult.artifact.sha256);expect(secondResult.capture.version).toBe(firstResult.capture.version);
  await page.getByRole("button",{name:"Retour",exact:true}).click();
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__photoLiveUrls:Set<string>}).__photoLiveUrls.size)).toBe(0);
  await expect(page.locator("img[src^='blob:']")).toHaveCount(0);
});

test("Photos : worker indisponible conserve le JPEG exact et import assisté reste intact",async({page,isMobile})=>{
  test.skip(!isMobile,"Camera fallback is exercised on the mobile profile.");
  const source=execFileSync(process.execPath,["tests/fixtures/mobile-photos/single.mjs","compact"],{maxBuffer:21*1024*1024,timeout:60_000,windowsHide:true});
  await page.addInitScript(()=>{Object.defineProperty(window,"Worker",{configurable:true,value:class {constructor(){throw new Error("Synthetic unsupported worker");}}});});
  await login(page);await page.getByRole("button",{name:"Photo",exact:true}).click();
  const chosen=page.waitForEvent("filechooser");await page.getByRole("button",{name:"Prendre la première page",exact:true}).click();const chooser=await chosen;
  const reservation=page.waitForResponse(r=>/\/capture\/[^/]+\/pages$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST");
  await chooser.setFiles({name:"fallback.jpg",mimeType:"image/jpeg",buffer:source});
  const identity=(await reservation).request().postDataJSON();expect(identity.size).toBe(source.length);expect(identity.sha256).toBe(createHash("sha256").update(source).digest("hex"));
  await expect(page.getByText("Page sauvegardée.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Fermer",exact:true}).click();await drafts(page);
  const imported=page.waitForEvent("filechooser");await page.getByRole("button",{name:"Importer un fichier",exact:true}).click();const importChooser=await imported;
  const importReservation=page.waitForResponse(r=>/\/capture\/[^/]+\/pages$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST");
  await importChooser.setFiles({name:"untouched-import.jpg",mimeType:"image/jpeg",buffer:source});
  const original=(await importReservation).request().postDataJSON();expect(original.size).toBe(source.length);expect(original.sha256).toBe(identity.sha256);
  await expect(page.getByText("Page sauvegardée.",{exact:true})).toBeVisible();
});
