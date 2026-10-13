import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";

const password=process.env.HESTIA_TEST_PASSWORD;
if(!password||process.env.HESTIA_ENVIRONMENT!=="local")throw new Error("Use the owned local E2E harness.");
const headers={Origin:"http://127.0.0.1:3210"};
const workspace=(url:string)=>new URL(url).pathname==="/api/hestia/workspace";
async function login(page:Page){
  await page.goto("/");
  for(let attempt=0;attempt<4;attempt++){
    await page.getByLabel("Adresse e-mail").fill("camille@hestia.invalid");await page.getByLabel("Mot de passe",{exact:true}).fill(password!);
    const submitted=page.waitForResponse(response=>response.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button",{name:"Se connecter",exact:true}).click();const result=await submitted;
    if(result.status()!==429){expect(result.status()).toBe(200);break;}await page.waitForTimeout(10_100);
  }
  await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
}
async function create(page:Page,name:string,parentId:string|null=null){
  const response=await page.request.post("/api/hestia/folders",{headers,data:{name,parentId,idempotencyKey:randomUUID()}});expect(response.status()).toBe(201);
  return(await response.json()).folder as {id:string;name:string};
}
async function open(page:Page,folder:{name:string}){
  await page.getByRole("main").getByRole("button",{name:new RegExp(folder.name)}).click();await expect(page.getByRole("heading",{name:folder.name,exact:true})).toBeVisible();
}
async function rename(page:Page,title:string){
  await page.getByRole("button",{name:"Actions",exact:true}).click();await page.getByRole("menuitem",{name:"Renommer",exact:true}).click();
  await page.getByLabel("Nom du dossier").fill(title);await page.getByRole("button",{name:"Enregistrer le nom",exact:true}).click();
}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
async function deliver(route:Route,response:Awaited<ReturnType<Route["fetch"]>>){try{await route.fulfill({response});}catch{/* The superseded fetch can already be aborted. */}}

test("navigation agrégée unique et retour au premier plan passif regroupé",async({page})=>{
  await login(page);const folder=await create(page,`Workspace ${randomUUID().slice(0,8)}`);await page.reload();
  await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
  const calls:{url:string;activity:string|undefined}[]=[];
  page.on("request",request=>{if(request.method()==="GET"&&new URL(request.url()).pathname.startsWith("/api/hestia/"))calls.push({url:request.url(),activity:request.headers()["x-hestia-activity"]});});
  await open(page,folder);await page.waitForTimeout(200);
  expect(calls.filter(call=>workspace(call.url))).toHaveLength(1);
  expect(calls.filter(call=>/\/api\/hestia\/(?:session|folders|documents)(?:[/?]|$)/.test(call.url))).toEqual([]);
  expect(calls[0].activity).toBe("interactive");calls.length=0;
  const fresh=page.waitForResponse(response=>workspace(response.url()));
  await page.evaluate(()=>{window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("pageshow"));document.dispatchEvent(new Event("visibilitychange"));});
  expect((await fresh).status()).toBe(200);await page.waitForTimeout(180);
  expect(calls.filter(call=>workspace(call.url))).toHaveLength(1);expect(calls[0].activity).toBeUndefined();
});

test("une réponse ancienne ne remplace pas un renommage confirmé et une seule relecture suit le PATCH",async({page})=>{
  await login(page);const folder=await create(page,`Avant ${randomUUID().slice(0,8)}`);await page.reload();await open(page,folder);
  const held=gate(),reached=gate(),delivered=gate();let requests=0,patches=0;
  page.on("request",request=>{if(request.method()==="PATCH"&&request.url().endsWith(`/folders/${folder.id}`))patches++;});
  await page.route("**/api/hestia/workspace?**",async route=>{
    const phase=++requests,response=await route.fetch();if(phase===1){reached.release();await held.promise;await deliver(route,response);delivered.release();}else await route.fulfill({response});
  });
  try{
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await reached.promise;
    const title=`Après ${randomUUID().slice(0,8)}`;await rename(page,title);await expect(page.getByText("Renommé.",{exact:true})).toBeVisible();
    held.release();await delivered.promise;await page.waitForTimeout(100);
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();await expect(page.getByText(folder.name,{exact:true})).toHaveCount(0);
    expect(patches).toBe(1);expect(requests).toBe(2);
  }finally{held.release();}
});

test("une écriture confirmée puis refresh 503 ne rejoue pas l’écriture",async({page})=>{
  await login(page);const folder=await create(page,`Confirmé ${randomUUID().slice(0,8)}`);await page.reload();await open(page,folder);
  let patches=0,fail=true;page.on("request",request=>{if(request.method()==="PATCH"&&request.url().endsWith(`/folders/${folder.id}`))patches++;});
  await page.route("**/api/hestia/workspace?**",route=>fail?route.fulfill({status:503,json:{error:{message:"Synthetic refresh failure"}}}):route.continue());
  const title=`Enregistré ${randomUUID().slice(0,8)}`;await rename(page,title);
  await expect(page.getByText("Renommé. Actualisation indisponible.",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();expect(patches).toBe(1);
  fail=false;await page.getByRole("button",{name:"Actualiser",exact:true}).click();
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();expect(patches).toBe(1);
  expect((await(await page.request.get(`/api/hestia/folders/${folder.id}`)).json()).folder.name).toBe(title);
});

test("création d’un sous-dossier actualise aussi le compteur du parent",async({page,isMobile})=>{
  await login(page);const parent=await create(page,`Parent ${randomUUID().slice(0,8)}`);await page.reload();await open(page,parent);
  await page.getByRole("button",{name:"Nouveau sous-dossier",exact:true}).click();const child=`Enfant ${randomUUID().slice(0,8)}`;
  await page.getByLabel("Nom du dossier").fill(child);let reads=0;page.on("request",request=>{if(workspace(request.url()))reads++;});
  await page.getByRole("button",{name:"Créer le dossier",exact:true}).click();await expect(page.getByText("Dossier créé.",{exact:true})).toBeVisible();expect(reads).toBe(1);
  if(isMobile)await page.getByRole("button",{name:`Revenir à « ${parent.name} »`,exact:true}).click();
  else await page.getByRole("navigation",{name:"Fil d’Ariane"}).getByRole("button",{name:parent.name,exact:true}).click();
  await expect(page.getByText(/1 sous-dossier · 0 document/)).toBeVisible();await expect(page.getByRole("main").getByRole("button",{name:new RegExp(child)})).toBeVisible();
});

test("une liste tardive ne réintroduit pas un document mis à la corbeille",async({page})=>{
  await login(page);const folder=await create(page,`Suppression ${randomUUID().slice(0,8)}`),title=`Fichier ${randomUUID().slice(0,8)}`;
  const bytes=await readFile("tests/fixtures/documents/synthetic.png");
  const upload=await page.request.post("/api/hestia/uploads",{headers,data:{folderId:folder.id,idempotencyKey:randomUUID(),fileName:"synthetic.png",title,size:bytes.length,mediaType:"image/png",sha256:createHash("sha256").update(bytes).digest("hex"),source:"import"}});expect(upload.ok()).toBe(true);const {operation}=await upload.json();
  expect((await page.request.put(`/api/hestia/uploads/${operation.id}/chunks/0`,{headers:{...headers,"Content-Type":"application/octet-stream"},data:bytes})).ok()).toBe(true);
  expect((await page.request.post(`/api/hestia/uploads/${operation.id}/complete`,{headers,data:{keepDuplicate:false}})).ok()).toBe(true);
  await page.reload();await open(page,folder);await page.getByRole("main").getByRole("button",{name:new RegExp(title)}).click();
  await expect(page.getByRole("img",{name:`Aperçu de ${title}`})).toBeVisible();const held=gate(),reached=gate(),delivered=gate();let calls=0;
  await page.route("**/api/hestia/workspace?**",async route=>{const phase=++calls,response=await route.fetch();if(phase===1){reached.release();await held.promise;await deliver(route,response);delivered.release();}else await route.fulfill({response});});
  try{
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await reached.promise;
    await page.getByRole("complementary",{name:"Document",exact:true}).getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Mettre à la corbeille",exact:true}).click();await expect(page.getByRole("heading",{name:"Ce dossier est vide",exact:true})).toBeVisible();
    held.release();await delivered.promise;await expect(page.getByRole("main").getByRole("button",{name:new RegExp(title)})).toHaveCount(0);
    await expect(page.getByText(/0 sous-dossier · 0 document/)).toBeVisible();expect(calls).toBe(2);
  }finally{held.release();}
});

test("masquage et expiration effacent le snapshot et rejettent sa réponse tardive",async({page})=>{
  await login(page);const folder=await create(page,`Privé ${randomUUID().slice(0,8)}`);await page.reload();await open(page,folder);
  const held=gate(),reached=gate(),delivered=gate();let first=true;
  await page.route("**/api/hestia/workspace?**",async route=>{const isFirst=first;first=false;const response=await route.fetch();if(isFirst){reached.release();await held.promise;await deliver(route,response);delivered.release();}else await route.fulfill({response});});
  try{
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await reached.promise;
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});
    await expect(page.getByText(folder.name,{exact:false})).toHaveCount(0);
    expect((await page.request.post("/api/auth/sign-out",{headers,data:{}})).ok()).toBe(true);
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));});
    await expect(page.getByRole("heading",{name:"Connexion",exact:true})).toBeVisible();held.release();await delivered.promise;
    await expect(page.getByText(folder.name,{exact:false})).toHaveCount(0);
    expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  }finally{held.release();}
});

test("un retour au premier plan pendant une lecture conserve l’invalidation",async({page})=>{
  await login(page);const folder=await create(page,`Ancien ${randomUUID().slice(0,8)}`);await page.reload();await open(page,folder);
  const held=gate(),reached=gate(),delivered=gate();let reads=0;
  await page.route("**/api/hestia/workspace?**",async route=>{
    const phase=++reads,response=await route.fetch();
    if(phase===1){reached.release();await held.promise;await deliver(route,response);delivered.release();}else await route.fulfill({response});
  });
  try{
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await reached.promise;
    const current=(await(await page.request.get(`/api/hestia/folders/${folder.id}`)).json()).folder;
    const title=`Concurrent ${randomUUID().slice(0,8)}`;
    expect((await page.request.patch(`/api/hestia/folders/${folder.id}`,{headers,data:{name:title,version:current.version,idempotencyKey:randomUUID()}})).ok()).toBe(true);
    await page.evaluate(()=>{window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("pageshow"));document.dispatchEvent(new Event("visibilitychange"));});
    await expect.poll(()=>reads,{timeout:2500}).toBe(2);
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
    held.release();await delivered.promise;await page.waitForTimeout(120);
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();expect(reads).toBe(2);
    await expect(page.getByText(folder.name,{exact:true})).toHaveCount(0);
  }finally{held.release();}
});

test("un poll qui remplace la relecture conserve la confirmation même en erreur 503",async({page})=>{
  await page.clock.install();
  await login(page);const folder=await create(page,`Confirmation ${randomUUID().slice(0,8)}`);await page.reload();await open(page,folder);
  const held=gate(),reached=gate(),delivered=gate();let reads=0,patches=0;
  page.on("request",request=>{if(request.method()==="PATCH"&&request.url().endsWith(`/folders/${folder.id}`))patches++;});
  await page.route("**/api/hestia/workspace?**",async route=>{
    if(++reads===1){const response=await route.fetch();reached.release();await held.promise;await deliver(route,response);delivered.release();}
    else await route.fulfill({status:503,json:{error:{message:"Synthetic replacement read failure"}}});
  });
  try{
    const title=`Confirmé malgré lecture ${randomUUID().slice(0,8)}`;await rename(page,title);await reached.promise;
    await page.clock.runFor(30_000);
    await expect.poll(()=>reads,{timeout:2500}).toBe(2);
    await expect(page.getByText("Renommé. Actualisation indisponible.",{exact:true})).toBeVisible();
    held.release();await delivered.promise;
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();expect(patches).toBe(1);
    await expect(page.getByText("Résultat incertain.",{exact:true})).toHaveCount(0);
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});
    await expect(page.getByText("Renommé. Actualisation indisponible.",{exact:true})).toHaveCount(0);
    await expect(page.getByText(title,{exact:true})).toHaveCount(0);
  }finally{held.release();}
});
