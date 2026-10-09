import {randomUUID} from "node:crypto";
import {test,expect,type Page,type APIRequestContext} from "@playwright/test";
const password=process.env.HESTIA_TEST_PASSWORD;
if(!password||process.env.HESTIA_ENVIRONMENT!=="local")throw new Error("Use the owned synthetic E2E harness.");
const headers={Origin:"http://127.0.0.1:3210"};
type Folder={id:string;name:string;version:number};
async function login(page:Page,member="camille"){
  await page.goto("/");for(let attempt=0;attempt<4;attempt++){
    await page.getByLabel("Adresse e-mail").fill(`${member}@hestia.invalid`);await page.getByLabel("Mot de passe",{exact:true}).fill(password!);
    const response=page.waitForResponse(result=>result.url().endsWith("/api/auth/sign-in/email"));await page.getByRole("button",{name:"Se connecter",exact:true}).click();const result=await response;
    if(result.status()!==429){expect(result.status()).toBe(200);break;}await page.waitForTimeout(10_100);
  }await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
}
async function create(api:APIRequestContext,name:string,parentId:string|null=null):Promise<Folder>{const result=await api.post("/api/hestia/folders",{headers,data:{name,parentId,idempotencyKey:randomUUID()}});expect(result.status()).toBe(201);return(await result.json()).folder;}
async function open(page:Page,folder:Folder){await page.reload();await page.getByRole("main").getByRole("button",{name:new RegExp(folder.name)}).click();await expect(page.getByRole("heading",{name:folder.name,exact:true})).toBeVisible();}
async function start(page:Page){await page.getByRole("button",{name:"Actions",exact:true}).click();await page.getByRole("menuitem",{name:"Mettre à la corbeille…",exact:true}).click();return page.getByRole("dialog");}
async function trashApi(api:APIRequestContext,folder:Folder){const preview=await api.post(`/api/hestia/folders/${folder.id}/trash/preview`,{headers,data:{}});expect(preview.ok()).toBe(true);const result=await preview.json();expect(result.allowed).toBe(true);expect((await api.post(`/api/hestia/folders/${folder.id}/trash`,{headers,data:{previewToken:result.previewToken,idempotencyKey:randomUUID()}})).ok()).toBe(true);return(await(await api.get("/api/hestia/trash")).json()).groups.find((g:{folderId:string})=>g.folderId===folder.id);}
async function corbeille(page:Page){await page.reload();await page.getByRole("button",{name:"Corbeille",exact:true}).click();await expect(page.getByRole("heading",{name:"Corbeille",exact:true})).toBeVisible();}
async function restore(page:Page,folder:Folder){await page.getByRole("button",{name:`Restaurer « ${folder.name} »`,exact:true}).click();return page.getByRole("complementary",{name:`Restaurer « ${folder.name} »`,exact:true});}

test("suppression groupée puis restauration entière au clavier sans reprendre un groupe antérieur",async({page})=>{
  await login(page);const suffix=randomUUID().slice(0,8),source=await create(page.request,`Archives ${suffix}`),child=await create(page.request,`Actuel ${suffix}`,source.id),old=await create(page.request,`Ancien ${suffix}`,source.id);
  const oldGroup=await trashApi(page.request,old);await open(page,source);const dialog=await start(page);
  await expect(dialog.getByText(/1 sous-dossier/)).toBeVisible();await expect(dialog.getByText("Ce qui se trouve déjà à la corbeille n’est pas concerné : chaque élément garde sa propre échéance.")).toBeVisible();await expect(dialog.getByText(old.name,{exact:false})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath("folder-trash-confirm.png"),fullPage:true});await dialog.getByRole("button",{name:"Mettre à la corbeille",exact:true}).focus();await page.keyboard.press("Enter");await expect(page.getByRole("heading",{name:"Corbeille",exact:true})).toBeVisible();
  const row=page.getByRole("listitem").filter({has:page.getByText(source.name,{exact:true})});await expect(row.getByText(/Dossier et son contenu/)).toBeVisible();await expect(row.getByText(/sous-dossier/)).toHaveCount(0);
  const panel=await restore(page,source);await expect(panel.getByText(/Sera restauré.*1 sous-dossier/)).toBeVisible();await page.screenshot({path:test.info().outputPath("folder-restore-review.png"),fullPage:true});await panel.getByRole("button",{name:"Restaurer ici",exact:true}).click();
  await expect(page.getByRole("button",{name:`Restaurer « ${source.name} »`,exact:true})).toHaveCount(0);
  const listing=await(await page.request.get("/api/hestia/folders")).json();expect(listing.folders.some((f:Folder)=>f.id===child.id)).toBe(true);expect(listing.folders.some((f:Folder)=>f.id===old.id)).toBe(false);
  const after=await(await page.request.get("/api/hestia/trash")).json();expect(after.groups.find((g:{id:string})=>g.id===oldGroup.id).restorableUntil).toBe(oldGroup.restorableUntil);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("collision : renommage explicite vérifié avant restauration, sans fusion",async({page})=>{
  await login(page);const name=`Doublon ${randomUUID().slice(0,8)}`,source=await create(page.request,name);await trashApi(page.request,source);const neighbor=await create(page.request,name);await corbeille(page);const panel=await restore(page,source);
  await expect(panel.getByRole("button",{name:"Restaurer ici",exact:true})).toHaveCount(0);await panel.getByLabel(`Nouveau nom pour « ${name} »`).fill(`${name} restauré`);await panel.getByRole("button",{name:"Vérifier les effets",exact:true}).click();await panel.getByRole("button",{name:"Restaurer ici",exact:true}).click();await expect(panel).toHaveCount(0);
  const listing=await(await page.request.get("/api/hestia/folders")).json();expect(listing.folders.find((f:Folder)=>f.id===source.id).name).toBe(`${name} restauré`);expect(listing.folders.find((f:Folder)=>f.id===neighbor.id).name).toBe(name);
});

test("parent indisponible : choisir une destination au clavier et vérifier ses effets",async({page})=>{
  await login(page);const suffix=randomUUID().slice(0,8),frame=await create(page.request,`Cadre ${suffix}`),parent=await create(page.request,`Parent ${suffix}`,frame.id),source=await create(page.request,`Enfant ${suffix}`,parent.id),destination=await create(page.request,`Arrivée ${suffix}`,frame.id);await trashApi(page.request,source);await trashApi(page.request,parent);await corbeille(page);const panel=await restore(page,source);
  await expect(panel.getByText("Emplacement indisponible.",{exact:true})).toBeVisible();await panel.getByRole("button",{name:`Ouvrir « ${frame.name} »`,exact:true}).click();const radio=panel.getByRole("radio",{name:destination.name,exact:true});await radio.focus();await page.keyboard.press("Space");await expect(radio).toHaveAttribute("aria-checked","true");await panel.getByRole("button",{name:"Vérifier les effets",exact:true}).click();await expect(panel.getByText("Effets sur les accès",{exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath("folder-restore-alternative-impact.png"),fullPage:true});await panel.getByRole("button",{name:"Restaurer ici",exact:true}).click();await expect(panel).toHaveCount(0);
  const listing=await(await page.request.get("/api/hestia/folders")).json();expect(listing.folders.find((f:{id:string})=>f.id===source.id).visibleParentId).toBe(destination.id);
});

test("réponse de suppression perdue : vérification du reçu sans rejouer",async({page})=>{
  await login(page);const source=await create(page.request,`Incertain ${randomUUID().slice(0,8)}`);await open(page,source);let commits=0;
  await page.route(`**/api/hestia/folders/${source.id}/trash`,async route=>{commits++;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort("failed");});
  const dialog=await start(page);await dialog.getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();await expect(page.getByText("Résultat incertain.",{exact:true})).toBeVisible();await page.getByRole("button",{name:"Vérifier le résultat",exact:true}).click();await expect(page.getByRole("heading",{name:"Corbeille",exact:true})).toBeVisible();expect(commits).toBe(1);await expect(page.getByRole("button",{name:`Restaurer « ${source.name} »`,exact:true})).toBeVisible();
});

test("contenu changé : première confirmation refusée, nouvelle lecture requise",async({page})=>{
  await login(page);const source=await create(page.request,`Concurrent ${randomUUID().slice(0,8)}`);await open(page,source);const dialog=await start(page);await expect(dialog).toBeVisible();const child=await create(page.request,`Ajout ${randomUUID().slice(0,8)}`,source.id);await dialog.getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();await expect(page.getByText("Contenu modifié.",{exact:true})).toBeVisible();expect((await page.request.get(`/api/hestia/folders/${child.id}`)).ok()).toBe(true);await page.getByRole("button",{name:"Vérifier les effets",exact:true}).click();await expect(page.getByRole("dialog").getByText(/1 sous-dossier/)).toBeVisible();await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("révocation connue : la ligne et le panneau privés disparaissent",async({page,browser,isMobile})=>{
  await login(page);const parent=await create(page.request,`Partagé ${randomUUID().slice(0,8)}`),source=await create(page.request,`Révoqué ${randomUUID().slice(0,8)}`,parent.id);const sharing=await(await page.request.get(`/api/hestia/folders/${parent.id}/sharing`)).json();const alex=sharing.members.find((member:{name:string})=>member.name==="Alex");
  expect((await page.request.post(`/api/hestia/folders/${parent.id}/sharing`,{headers,data:{memberId:alex.id,export:false,deposit:false,modify:false,delete:true,idempotencyKey:randomUUID()}})).ok()).toBe(true);
  const access=await(await page.request.get(`/api/hestia/folders/${parent.id}/access`)).json();const grant=access.grants.find((g:{memberId:string;canRevoke:boolean})=>g.memberId===alex.id&&g.canRevoke);await trashApi(page.request,source);
  const context=await browser.newContext({baseURL:"http://127.0.0.1:3210",viewport:page.viewportSize(),isMobile,hasTouch:isMobile});try{const receiver=await context.newPage();await login(receiver,"alex");await receiver.getByRole("button",{name:"Corbeille",exact:true}).click();const panel=await restore(receiver,source);await expect(panel.getByRole("button",{name:"Restaurer ici",exact:true})).toBeVisible();
    expect((await page.request.delete(`/api/hestia/folders/${parent.id}/access/${grant.id}`,{headers})).ok()).toBe(true);const refreshed=receiver.waitForResponse(r=>r.url().endsWith("/api/hestia/trash"));await receiver.evaluate(()=>window.dispatchEvent(new Event("focus")));await refreshed;await expect(receiver.getByText(source.name,{exact:false})).toHaveCount(0);await expect(receiver.getByRole("complementary",{name:/^Restaurer/})).toHaveCount(0);await expect(receiver.getByText("La corbeille a été mise à jour.",{exact:true})).toBeVisible();
  }finally{await context.close();}
});

test("échec de rechargement : aucun ancien détail privé, erreur puis nouvelle tentative",async({page})=>{
  await login(page);const source=await create(page.request,`Rechargement ${randomUUID().slice(0,8)}`);await trashApi(page.request,source);await corbeille(page);const panel=await restore(page,source);await expect(panel.getByRole("button",{name:"Restaurer ici",exact:true})).toBeVisible();
  await page.route("**/api/hestia/trash",route=>route.fulfill({status:503,json:{error:{code:"UNAVAILABLE",message:"Impossible de joindre Hestia. Réessayez."}}}));
  const failed=page.waitForResponse(r=>r.url().endsWith("/api/hestia/trash")&&r.status()===503);await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await failed;
  await expect(page.getByText(source.name,{exact:false})).toHaveCount(0);await expect(page.getByRole("complementary",{name:/^Restaurer/})).toHaveCount(0);await expect(page.getByText("L’action n’a pas pu aboutir.",{exact:true})).toBeVisible();await expect(page.getByText("La corbeille est vide",{exact:true})).toHaveCount(0);
  await page.unroute("**/api/hestia/trash");await page.getByRole("button",{name:"Réessayer",exact:true}).click();await expect(page.getByRole("button",{name:`Restaurer « ${source.name} »`,exact:true})).toBeVisible();await expect(page.getByText("L’action n’a pas pu aboutir.",{exact:true})).toHaveCount(0);
});

test("aperçu suppression indisponible après rafraîchissement : fermer ou réessayer reste possible",async({page})=>{
  await login(page);const source=await create(page.request,`Aperçu ${randomUUID().slice(0,8)}`);await create(page.request,`Enfant ${randomUUID().slice(0,8)}`,source.id);await open(page,source);await start(page);await expect(page.getByRole("dialog").getByText(/1 sous-dossier/)).toBeVisible();
  await page.route(`**/api/hestia/folders/${source.id}/trash/preview`,route=>route.fulfill({status:503,json:{error:{code:"UNAVAILABLE",message:"Impossible de joindre Hestia. Réessayez."}}}));
  const failed=page.waitForResponse(r=>r.url().endsWith(`/folders/${source.id}/trash/preview`)&&r.status()===503);await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await failed;
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByText("L’action n’a pas pu aboutir.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Fermer",exact:true})).toBeVisible();
  await page.unroute(`**/api/hestia/folders/${source.id}/trash/preview`);await page.getByRole("button",{name:"Vérifier les effets",exact:true}).click();await expect(page.getByRole("dialog").getByText(/1 sous-dossier/)).toBeVisible();await page.keyboard.press("Escape");expect((await page.request.get(`/api/hestia/folders/${source.id}`)).ok()).toBe(true);
});

test("quitter la corbeille pour rechercher puis ouvrir un résultat actif",async({page,isMobile})=>{
  await login(page);const suffix=randomUUID().slice(0,8),target=await create(page.request,`Trouvable ${suffix}`),trashed=await create(page.request,`Retiré ${suffix}`);await trashApi(page.request,trashed);await corbeille(page);
  if(isMobile){
    const navigation=page.getByRole("navigation",{name:"Navigation principale mobile",exact:true});await navigation.getByRole("button",{name:"Rechercher",exact:true}).click();await expect(navigation.getByRole("button",{name:"Rechercher",exact:true})).toHaveAttribute("aria-current","page");await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  }else await page.getByLabel("Rechercher un document ou un dossier",{exact:true}).fill(suffix);
  await expect(page.getByRole("heading",{name:"Recherche",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Corbeille",exact:true})).toHaveCount(0);await page.getByRole("main").getByLabel("Rechercher",{exact:true}).fill(suffix);
  await expect(page.getByRole("main").getByRole("button",{name:new RegExp(target.name)})).toBeVisible();await expect(page.getByRole("main").getByText(trashed.name,{exact:true})).toHaveCount(0);await page.getByRole("main").getByRole("button",{name:new RegExp(target.name)}).click();await expect(page.getByRole("heading",{name:target.name,exact:true})).toBeVisible();
});
