import {randomUUID,createHash} from "node:crypto";
import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect} from "vitest";
import {Pool} from "pg";
import sharp from "sharp";
import {createApplication} from "../../src/server/application";
import {readServerConfig} from "../../src/server/config";
import {migrateDatabase} from "../../src/server/db/migrate";
import {provisionSyntheticMember} from "../../src/server/db/synthetic";
import {createObjectStore,type ObjectStore} from "../../src/server/storage";
import {createStorageBudget} from "../../src/server/storage/quota";
import {createAccess} from "../../src/server/access";
import {createAuth} from "../../src/server/auth/options";
import {createCaptureService} from "../../src/server/capture";
import {createCaptureRenderer} from "../../src/server/capture/renderer";
import {issueGrant} from "../../src/server/permissions/service";
import type {CaptureDto,CaptureArtifactDto,CapturePreviewDto,CaptureFinalizeInput,CaptureDestination} from "../../src/shared/capture-contract";
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
describe("Capture author-only drafts, physical objects and atomic publication",()=>{
 const config=readServerConfig();
 if(config.environment!=="local"||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??""))throw new Error("Owned synthetic bench required");
 const pool=new Pool({connectionString:config.databaseUrl,max:8}),real=createObjectStore();
 let putHook:((key:string)=>Promise<void>)|undefined,getHook:((key:string)=>Promise<void>)|undefined,deleteHook:((key:string)=>Promise<void>)|undefined;
 const store:ObjectStore={async put(k,b,t){await real.put(k,b,t);await putHook?.(k);},async getRange(k,s,e){const b=await real.getRange(k,s,e);await getHook?.(k);return b;},async delete(k){await deleteHook?.(k);await real.delete(k);}};
 let fixedNow:Date|undefined;
 const app=createApplication(pool,config,{store,now:()=>fixedNow??new Date()});
 const access=createAccess(pool,config,createAuth(pool,config));
 const capture=createCaptureService(pool,access,{store,budget:createStorageBudget(),clock:async()=>fixedNow??new Date()});
 const users:{id:string;email:string;cookie:string}[]=[];const password="Synthetic Capture phrase only!";
 let folderId:string,image:Buffer;
 function req(body?:unknown,user=0,method?:string,path="/api/hestia/capture"){
  const headers=new Headers({origin:config.origin,cookie:users[user]?.cookie??""});if(body!==undefined)headers.set("content-type",body instanceof Uint8Array?"application/octet-stream":"application/json");
  return new Request(config.origin+path,{method:method??(body===undefined?"GET":"POST"),headers,...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});
 }
 async function login(index:number){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const response=await app.handleAuth(req({email:users[index].email,password},index,"POST","/api/auth/sign-in/email"));expect(response.status).toBe(200);users[index].cookie=response.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");}
 async function body<T>(r:Response,status=200):Promise<T>{const json=await r.json();expect(r.status,JSON.stringify(json)).toBe(status);return json as T;}
 async function make(kind:"camera"|"import"="camera"){return (await body<{capture:CaptureDto}>(await app.handleCaptures(req({kind,idempotencyKey:randomUUID(),currentFolderId:null})),201)).capture;}
 async function add(c:CaptureDto,bytes=image){
  const reservation=await body<{upload:{id:string};captureVersion:number}>(await app.handleCapturePages(req({version:c.version,idempotencyKey:randomUUID(),fileName:"synthetic.png",mediaType:"image/png",size:bytes.length,sha256:hash(bytes)}),c.id));
  for(let offset=0;offset<bytes.length;offset+=2*1024*1024)expect((await app.handleCapturePageChunk(req(bytes.subarray(offset,offset+2*1024*1024),0,"PUT"),c.id,reservation.upload.id,String(offset/(2*1024*1024)))).status).toBe(200);
  return (await body<{capture:CaptureDto}>(await app.handleCapturePageComplete(req({version:reservation.captureVersion}),c.id,reservation.upload.id))).capture;
 }
 async function prepare(c:CaptureDto){return body<{capture:CaptureDto;artifact:CaptureArtifactDto}>(await app.handleCapturePrepare(req({version:c.version}),c.id));}
 async function preview(c:CaptureDto,a:CaptureArtifactDto,destination:CaptureDestination={kind:"existing",folderId},keepDuplicate=false){
  const input={version:c.version,artifactId:a.id,destination,keepDuplicate};const result=await body<{preview:CapturePreviewDto}>(await app.handleCapturePreview(req(input),c.id));
  return {...input,previewToken:result.preview.previewToken,idempotencyKey:randomUUID()};
 }
 async function finalize(c:CaptureDto,input:CaptureFinalizeInput){return body<{status:string;document:{id:string;sha256:string;folderId:string;size:number;mediaType:string}}>(await app.handleCaptureFinalize(req(input),c.id));}
 beforeAll(async()=>{
  expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);
  for(const role of ["member","admin"] as const){const email=`capture-${randomUUID()}@example.invalid`;users.push({id:await provisionSyntheticMember(pool,{email,name:role==="admin"?"Admin Synthétique":"Camille Synthétique",password,role}),email,cookie:""});await login(users.length-1);}
  image=await sharp({create:{width:120,height:80,channels:3,background:"#ee4433"}}).png().toBuffer();
 });
 beforeEach(async()=>{const f=await body<{folder:{id:string}}>(await app.handleFolders(req({name:`Capture ${randomUUID()}`})),201);folderId=f.folder.id;});
 afterEach(async()=>{putHook=undefined;getHook=undefined;deleteHook=undefined;fixedNow=undefined;await pool.query("UPDATE hestia_member SET active=true,recovering=false WHERE user_id=ANY($1::text[])",[users.map(u=>u.id)]);for(let i=0;i<users.length;i++)await login(i);await pool.query("UPDATE hestia_capture SET state='abandoned' WHERE actor_id=ANY($1::text[]) AND state IN ('open','preparing')",[users.map(u=>u.id)]);await app.cleanupCaptures(100,1000);});
 afterAll(async()=>{await pool.end();});
 it("distinguishes a pre-action capture lock refusal without reserving bytes or changing the draft",async()=>{
  const c=await add(await make()),holder=await pool.connect();
  const before=(await pool.query("SELECT object_key,charged_bytes FROM hestia_capture_object WHERE capture_id=$1 ORDER BY object_key",[c.id])).rows;
  try{
   await holder.query("SELECT pg_advisory_lock(hashtextextended($1,4819))",[c.id]);
   const refused=await app.handleCapturePrepare(req({version:c.version}),c.id);
   expect(refused.status).toBe(409);expect((await refused.json()).error.code).toBe("CAPTURE_OPERATION_BUSY");
   expect((await pool.query("SELECT object_key,charged_bytes FROM hestia_capture_object WHERE capture_id=$1 ORDER BY object_key",[c.id])).rows).toEqual(before);
   expect((await pool.query("SELECT state,version FROM hestia_capture WHERE id=$1",[c.id])).rows[0]).toEqual({state:"open",version:c.version});
  }finally{await holder.query("SELECT pg_advisory_unlock(hashtextextended($1,4819))",[c.id]);holder.release();}
  expect((await prepare(c)).artifact.pageCount).toBe(1);
 });
 it("keeps empty and saved camera drafts private even from the household administrator",async()=>{
  let c=await make();expect(c.pages).toHaveLength(0);expect(new Date(c.expiresAt).getTime()-new Date(c.createdAt).getTime()).toBe(168*3600000);
  expect((await app.handleCapture(req(undefined,1),c.id)).status).toBe(404);expect((await body<{captures:CaptureDto[]}>(await app.handleCaptures(req(undefined,1)))).captures).toHaveLength(0);
  expect((await app.handleCapturePrepare(req({version:c.version}),c.id)).status).toBe(409);c=await add(c);expect(c.pages).toHaveLength(1);
  const resumed=await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id));expect(resumed.capture).toEqual(c);
 });
 it("serves separate bounded derivatives, reuses their objects and keeps passive reads inactive",async()=>{
  const large=await sharp({create:{width:2400,height:1800,channels:3,background:"#ee4433"}}).png().toBuffer();
  const c=await add(await make(),large),p=c.pages[0];let renders=0;
  const service=createCaptureService(pool,access,{store,budget:createStorageBudget(),renderer:input=>{renders++;return createCaptureRenderer()(input);}});
  const stamp=async()=>(await pool.query('SELECT p.session_id,p.touched_at FROM hestia_session_policy p JOIN session s ON s.id=p.session_id WHERE s."userId"=$1 ORDER BY p.session_id',[users[0].id])).rows;
  const before=await stamp();
  async function read(variant:string|null,expected=p.version){const r=req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&offset=0&length=2097152${variant?`&variant=${variant}&pageVersion=${expected}`:""}`);r.headers.set("X-Hestia-Activity","passive");return service.handleCaptureContent(r,c.id);}
  const hashes:string[]=[];
  for(const [variant,size] of [["thumbnail",640],["settings",1600]] as const){
   const first=await read(variant);expect(first.status).toBe(206);expect(first.headers.get("cache-control")).toBe("private, no-store");const bytes=new Uint8Array(await first.arrayBuffer());hashes.push(hash(bytes));
   const meta=await sharp(bytes).metadata();expect(meta.width).toBe(size);expect(meta.height).toBe(size*3/4);
   const again=await read(variant);expect(hash(new Uint8Array(await again.arrayBuffer()))).toBe(hash(bytes));
  }
  expect(renders).toBe(2);expect(new Set(hashes).size).toBe(2);expect(await stamp()).toEqual(before);
  const legacy=await read(null);expect((await sharp(new Uint8Array(await legacy.arrayBuffer())).metadata()).width).toBe(2400);expect(renders).toBe(3);
  expect((await read("thumbnail",p.version+1)).status).toBe(409);expect((await read("unknown")).status).toBe(400);expect(renders).toBe(3);
  expect((await service.handleCaptureContent(req(undefined,1,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&variant=thumbnail&pageVersion=${p.version}&offset=0&length=2097152`),c.id)).status).toBe(404);
  expect((await service.handleCaptureContent(req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&variant=thumbnail&offset=0&length=2097152`),c.id)).status).toBe(400);
  const list=req();list.headers.set("X-Hestia-Activity","passive");expect((await service.handleCaptures(list)).status).toBe(200);
  const detail=req();detail.headers.set("X-Hestia-Activity","passive");expect((await service.handleCapture(detail,c.id)).status).toBe(200);expect(await stamp()).toEqual(before);
 });
 it("reconciles new derivative slots after legacy edit/removal SQL without touching original bytes",async()=>{
  const c=await add(await make()),p=c.pages[0];
  const read=(variant:string)=>app.handleCaptureContent(req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&variant=${variant}&pageVersion=${p.version}&offset=0&length=2097152`),c.id);
  expect((await read("thumbnail")).status).toBe(206);expect((await read("settings")).status).toBe(206);
  const before=(await pool.query("SELECT * FROM hestia_capture_page WHERE id=$1",[p.id])).rows[0];
  // The old application's updates deliberately do not know the two new slots.
  await pool.query("UPDATE hestia_capture_page SET rotation=90,version=version+1,preview_key=NULL,preview_version=NULL WHERE id=$1",[p.id]);
  await pool.query("UPDATE hestia_capture SET version=version+1 WHERE id=$1",[c.id]);
  expect((await read("thumbnail")).status).toBe(409);
  const newRead=await app.handleCaptureContent(req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&variant=thumbnail&pageVersion=${p.version+1}&offset=0&length=2097152`),c.id);expect(newRead.status).toBe(206);
  const meta=await sharp(new Uint8Array(await newRead.arrayBuffer())).metadata();expect([meta.width,meta.height]).toEqual([80,120]);
  await app.cleanupCaptures(100,1000);
  const old=(await pool.query("SELECT deleted_at,charged_bytes FROM hestia_capture_object WHERE object_key=ANY($1::text[])",[[before.thumbnail_key,before.settings_key]])).rows;expect(old).toHaveLength(2);expect(old.every(o=>o.deleted_at&&o.charged_bytes===0)).toBe(true);
  const current=(await pool.query("SELECT thumbnail_key FROM hestia_capture_page WHERE id=$1",[p.id])).rows[0];
  await pool.query("UPDATE hestia_capture_page SET status='removed' WHERE id=$1",[p.id]);await app.cleanupCaptures(100,1000);
  expect((await pool.query("SELECT deleted_at FROM hestia_capture_object WHERE object_key=$1",[current.thumbnail_key])).rows[0].deleted_at).toBeTruthy();
  expect(hash(await store.getRange(before.object_key,0,image.length-1))).toBe(hash(image));
 });
 it("withholds even a cached derivative after revocation during its object read",async()=>{
  const c=await add(await make()),p=c.pages[0];
  const read=()=>app.handleCaptureContent(req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&variant=thumbnail&pageVersion=${p.version}&offset=0&length=2097152`),c.id);
  expect((await read()).status).toBe(206);
  getHook=async()=>{getHook=undefined;await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1",[users[0].id]);};
  expect((await read()).status).toBe(401);
 });
 it("does not prolong an expired session through automatic preview or draft refresh",async()=>{
  const c=await add(await make()),p=c.pages[0];
  await pool.query('UPDATE hestia_session_policy p SET touched_at=clock_timestamp()-interval \'31 minutes\' FROM session s WHERE s.id=p.session_id AND s."userId"=$1',[users[0].id]);
  const read=req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&variant=thumbnail&pageVersion=${p.version}&offset=0&length=2097152`);read.headers.set("X-Hestia-Activity","passive");
  expect((await app.handleCaptureContent(read,c.id)).status).toBe(401);
  const list=req();list.headers.set("X-Hestia-Activity","passive");expect((await app.handleCaptures(list)).status).toBe(401);
 });
 it("keeps no-op artifact bytes and uses new confirmation identity for a title change",async()=>{
  let c=await add(await make());let renders=0;
  const service=createCaptureService(pool,access,{store,budget:createStorageBudget(),renderer:input=>{renders++;return createCaptureRenderer()(input);}});
  const prepared=await body<{artifact:CaptureArtifactDto}>(await service.handleCapturePrepare(req({version:c.version}),c.id));
  const oldInput=await preview(c,prepared.artifact),p=c.pages[0];
  const edit=(title:string)=>({version:c.version,title,format:c.format,pages:[{id:p.id,rotation:p.rotation,crop:p.crop}]});
  const noop=await body<{capture:CaptureDto}>(await app.handleCapture(req(edit(c.title),0,"PATCH"),c.id));expect(noop.capture.version).toBe(c.version);
  const same=await body<{artifact:CaptureArtifactDto}>(await service.handleCapturePrepare(req({version:c.version}),c.id));expect(same.artifact).toEqual(prepared.artifact);expect(renders).toBe(1);
  c=(await body<{capture:CaptureDto}>(await app.handleCapture(req(edit("Titre modifié"),0,"PATCH"),c.id))).capture;
  expect(c.version).toBe(noop.capture.version+1);expect((await app.handleCaptureFinalize(req(oldInput),c.id)).status).toBe(409);
  const renamed=await body<{artifact:CaptureArtifactDto}>(await service.handleCapturePrepare(req({version:c.version}),c.id));expect(renamed.artifact.sha256).toBe(prepared.artifact.sha256);expect(renamed.artifact.id).not.toBe(prepared.artifact.id);expect(renamed.artifact.fileName).toBe("Titre modifié.pdf");expect(renders).toBe(1);
  const objects=(await pool.query("SELECT DISTINCT object_key FROM hestia_capture_artifact WHERE capture_id=$1",[c.id])).rows;expect(objects).toHaveLength(1);
  expect((await service.handleCaptureContent(req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?artifactId=${renamed.artifact.id}&variant=thumbnail&pageVersion=1&offset=0&length=10`),c.id)).status).toBe(400);
  c=(await body<{capture:CaptureDto}>(await app.handleCapture(req({...edit(c.title),pages:[{id:p.id,rotation:90,crop:p.crop}]},0,"PATCH"),c.id))).capture;
  await service.handleCapturePrepare(req({version:c.version}),c.id);expect(renders).toBe(2);
  expect((await pool.query("SELECT purge FROM hestia_capture_object WHERE object_key=$1",[objects[0].object_key])).rows[0].purge).toBe(true);
 });
 it("does not mistake cancellation of an uploading page for a no-op",async()=>{
  const c=await add(await make()),p=c.pages[0];
  const pending=await body<{upload:{id:string}}>(await app.handleCapturePages(req({version:c.version,idempotencyKey:randomUUID(),fileName:"pending.png",mediaType:"image/png",size:image.length,sha256:hash(image)}),c.id));
  const edit={version:c.version,title:c.title,format:c.format,pages:[{id:p.id,rotation:p.rotation,crop:p.crop}]};
  const patched=await body<{capture:CaptureDto}>(await app.handleCapture(req(edit,0,"PATCH"),c.id));expect(patched.capture.version).toBe(c.version+1);
  expect((await pool.query("SELECT status FROM hestia_capture_page WHERE id=$1",[pending.upload.id])).rows[0].status).toBe("removed");
  expect((await app.handleCapture(req(edit,0,"PATCH"),c.id)).status).toBe(409);
 });
 it("rebuilds once when an old artifact lacks the current renderer/content attestation",async()=>{
  const c=await add(await make());let renders=0;
  const service=createCaptureService(pool,access,{store,budget:createStorageBudget(),renderer:input=>{renders++;return createCaptureRenderer()(input);}});
  const first=await body<{artifact:CaptureArtifactDto}>(await service.handleCapturePrepare(req({version:c.version}),c.id));
  const confirmed=await preview(c,first.artifact);
  await pool.query("UPDATE hestia_capture_artifact SET content_sha=NULL WHERE id=$1",[first.artifact.id]);
  expect((await app.handleCaptureFinalize(req(confirmed),c.id)).status).toBe(409);
  const refreshed=await body<{artifact:CaptureArtifactDto}>(await service.handleCapturePrepare(req({version:c.version}),c.id));
  expect(renders).toBe(2);expect(refreshed.artifact.id).not.toBe(first.artifact.id);
  const again=await body<{artifact:CaptureArtifactDto}>(await service.handleCapturePrepare(req({version:c.version}),c.id));expect(again.artifact).toEqual(refreshed.artifact);expect(renders).toBe(2);
  const attested=(await pool.query("SELECT content_sha FROM hestia_capture_artifact WHERE id=$1",[refreshed.artifact.id])).rows[0].content_sha;expect(attested).toMatch(/^[a-f0-9]{64}$/);
  await pool.query("UPDATE hestia_capture_artifact SET content_sha=$2 WHERE id=$1",[refreshed.artifact.id,"0".repeat(64)]);
  const renamed=(await body<{capture:CaptureDto}>(await app.handleCapture(req({version:c.version,title:"Après ancien moteur",format:c.format,pages:c.pages.map(p=>({id:p.id,rotation:p.rotation,crop:p.crop}))},0,"PATCH"),c.id))).capture;
  await body(await service.handleCapturePrepare(req({version:renamed.version}),c.id));expect(renders).toBe(3);
 });
 it("rejects a multi-frame camera image after full validation while preserving the same import",async()=>{
  const pixels=Buffer.alloc(12*8*3,120);pixels.fill(220,12*4*3);
  const bytes=await sharp(pixels,{raw:{width:12,height:8,channels:3,pageHeight:4}}).webp({loop:0,delay:[100,100]}).toBuffer();
  for(const kind of ["camera","import"] as const){const c=await make(kind);
   const pending=await body<{upload:{id:string}}>(await app.handleCapturePages(req({version:c.version,idempotencyKey:randomUUID(),fileName:"animation.webp",mediaType:"image/webp",size:bytes.length,sha256:hash(bytes)}),c.id));
   expect((await app.handleCapturePageChunk(req(bytes,0,"PUT"),c.id,pending.upload.id,"0")).status).toBe(200);
   const complete=await app.handleCapturePageComplete(req({version:c.version}),c.id,pending.upload.id);expect(complete.status).toBe(kind==="camera"?422:200);
   if(kind==="import"){const saved=(await complete.json()).capture as CaptureDto;expect((await prepare(saved)).artifact.sha256).toBe(hash(bytes));}
  }
 });
 it("imports are transient, not listed, and their final bytes are unchanged",async()=>{
  const c=await add(await make("import"));expect(new Date(c.expiresAt).getTime()-new Date(c.createdAt).getTime()).toBe(3600000);
  expect((await body<{captures:CaptureDto[]}>(await app.handleCaptures(req()))).captures.some(x=>x.id===c.id)).toBe(false);
  const {artifact}=await prepare(c);expect(artifact.sha256).toBe(hash(image));const input=await preview(c,artifact);const result=await finalize(c,input);expect(result.document.sha256).toBe(hash(image));
  const content=await app.handleDocumentContent(req(undefined,0,"GET",`/api/hestia/documents/${result.document.id}/content?intent=download&offset=0&length=${image.length}`),result.document.id);
  expect(content.status).toBe(206);expect(hash(new Uint8Array(await content.arrayBuffer()))).toBe(hash(image));
 });
 it("publishes one immutable PDF and one full path; repeat and receipt never duplicate",async()=>{
  const c=await add(await add(await make()));const {artifact}=await prepare(c);expect(artifact.pageCount).toBe(2);const names=[`Équipement ${randomUUID()}`,"Factures"];
  const input=await preview(c,artifact,{kind:"create",parentId:folderId,levels:names});const result=await finalize(c,input);expect(result.status).toBe("recorded");expect(result.document.mediaType).toBe("application/pdf");
  const repeated=await finalize(c,input);expect(repeated.document.id).toBe(result.document.id);
  const receipt=await body<{status:string;document:{id:string}}>(await app.handleCaptureOperation(req({captureId:c.id,...input}),input.idempotencyKey));expect(receipt.document.id).toBe(result.document.id);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE name=$1 AND parent_folder_id=$2",[names[0],folderId])).rowCount).toBe(1);
  expect((await pool.query("SELECT 1 FROM hestia_document WHERE id=$1",[result.document.id])).rowCount).toBe(1);
  expect((await pool.query("SELECT 1 FROM hestia_upload WHERE document_id=$1 AND status='completed'",[result.document.id])).rowCount).toBe(1);
  expect((await app.handleCaptureFinalize(req({...input,keepDuplicate:!input.keepDuplicate}),c.id)).status).toBe(409);
 });
 it("saves exactly adjusted pixels and invalidates stale artifact and confirmations",async()=>{
  let c=await add(await make());const old=await prepare(c),oldInput=await preview(c,old.artifact);const p=c.pages[0];
  c=(await body<{capture:CaptureDto}>(await app.handleCapture(req({version:c.version,title:"Ajusté",format:"image",pages:[{id:p.id,rotation:90,crop:{t:0,r:0,b:25,l:0}}]},0,"PATCH"),c.id))).capture;
  expect(c.pages[0].version).toBe(p.version+1);expect((await app.handleCaptureFinalize(req(oldInput),c.id)).status).toBe(409);
  const result=await app.handleCaptureContent(req(undefined,0,"GET",`/api/hestia/capture/${c.id}/content?pageId=${p.id}&offset=0&length=2097152`),c.id);expect(result.status).toBe(206);const bytes=new Uint8Array(await result.arrayBuffer());expect(result.headers.get("content-range")).toBe(`bytes 0-${bytes.length-1}/${bytes.length}`);const metadata=await sharp(bytes).metadata();expect(metadata.width).toBe(80);expect(metadata.height).toBe(90);
  const generated=await prepare(c);const final=await finalize(c,await preview(c,generated.artifact));expect(final.document.sha256).toBe(hash(bytes));
 });
 it("creates a private root and suffix atomically for an ordinary member without sharing",async()=>{
  const c=await add(await make("import")),{artifact}=await prepare(c),name=`Private ${randomUUID()}`;
  const destination:CaptureDestination={kind:"create",parentId:null,levels:[name,"Nori","Soins"]};
  const before=await body<{preview:CapturePreviewDto}>(await app.handleCapturePreview(req({version:c.version,artifactId:artifact.id,destination,keepDuplicate:false}),c.id));
  expect(before.preview.path.map(p=>p.isNew)).toEqual([true,true,true]);
  expect(before.preview.access.people?.map(p=>p.id)).toEqual([users[0].id]);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE created_by=$1 AND name=$2",[users[0].id,name])).rowCount).toBe(0);
  const input={version:c.version,artifactId:artifact.id,destination,keepDuplicate:false,previewToken:before.preview.previewToken,idempotencyKey:randomUUID()};
  const result=await finalize(c,input),again=await finalize(c,input);expect(again.document.id).toBe(result.document.id);
  const root=(await pool.query("SELECT id,reference_grant_id FROM hestia_folder WHERE created_by=$1 AND parent_folder_id IS NULL AND name=$2",[users[0].id,name])).rows[0];
  expect(root.reference_grant_id).toBeTruthy();
  const grants=(await pool.query("SELECT user_id,capability,kind FROM hestia_grant WHERE folder_id=$1",[root.id])).rows;
  expect(grants).toHaveLength(7);expect(grants.every(g=>g.user_id===users[0].id)).toBe(true);
  expect(grants.find(g=>g.capability==="administrer").kind).toBe("reference");
  expect((await pool.query("SELECT 1 FROM hestia_grant WHERE folder_id=$1",[result.document.folderId])).rowCount).toBe(0);
  expect((await app.handleFolder(req(undefined,1),root.id)).status).toBe(404);
  expect((await app.handleFolder(req(undefined,1),result.document.folderId)).status).toBe(404);
 });
 it("reuses an existing prefix and treats a complete path as deposit with duplicate protection",async()=>{
  const child=(await body<{folder:{id:string}}>(await app.handleFolders(req({name:"Existing child",parentId:folderId})),201)).folder.id;
  const c=await add(await make("import")),{artifact}=await prepare(c);
  const input=await preview(c,artifact,{kind:"create",parentId:folderId,levels:["EXISTING CHILD","New suffix"]});
  const result=await finalize(c,input);
  expect((await pool.query("SELECT parent_folder_id FROM hestia_folder WHERE id=$1",[result.document.folderId])).rows[0].parent_folder_id).toBe(child);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE parent_folder_id=$1",[folderId])).rowCount).toBe(1);
  await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2 AND capability='modifier'",[folderId,users[0].id]);
  const next=await add(await make("import")),prepared=await prepare(next);
  const existing=await preview(next,prepared.artifact,{kind:"create",parentId:folderId,levels:["Existing child","New suffix"]});
  expect((await app.handleCaptureFinalize(req(existing),next.id)).status).toBe(409);
  const accepted=await preview(next,prepared.artifact,{kind:"existing",folderId:result.document.folderId},true);
  expect((await finalize(next,accepted)).document.folderId).toBe(result.document.folderId);
 });
 it("rolls back a new root including its grants and receipt when quota refuses publication",async()=>{
  const c=await add(await make("import")),{artifact}=await prepare(c),name=`Rollback root ${randomUUID()}`;
  const input=await preview(c,artifact,{kind:"create",parentId:null,levels:[name,"Child"]});
  const grants=(await pool.query("SELECT count(*) FROM hestia_grant")).rows[0].count;
  const limited=createApplication(pool,config,{store,limits:{memberBytes:1,globalBytes:1}});
  expect((await limited.handleCaptureFinalize(req(input),c.id)).status).toBe(413);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE name=$1",[name])).rowCount).toBe(0);
  expect((await pool.query("SELECT count(*) FROM hestia_grant")).rows[0].count).toBe(grants);
  expect((await pool.query("SELECT 1 FROM hestia_capture_receipt WHERE capture_id=$1",[c.id])).rowCount).toBe(0);
  expect((await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id))).capture.state).toBe("open");
  expect((await finalize(c,input)).status).toBe("recorded");
 });
 it("reuses a shared isolated entry without exposing its private parent or adding creator grants",async()=>{
  const hidden=(await body<{folder:{id:string}}>(await app.handleFolders(req({name:`PRIVATE ANCESTOR ${randomUUID()}`},1)),201)).folder.id;
  const name=`Shared entry ${randomUUID()}`;
  const leaf=(await body<{folder:{id:string}}>(await app.handleFolders(req({name,parentId:hidden},1)),201)).folder.id;
  const authority=(await pool.query("SELECT reference_grant_id FROM hestia_folder WHERE id=$1",[hidden])).rows[0].reference_grant_id;
  for(const capability of ["consulter","déposer","modifier"])await access.transaction(client=>issueGrant(client,users[1].id,leaf,{authorityId:authority,subject:users[0].id,capability}));
  const c=await add(await make("import")),{artifact}=await prepare(c);
  const destination:CaptureDestination={kind:"create",parentId:null,levels:[name,"Child"]};
  const response=await body<{preview:CapturePreviewDto}>(await app.handleCapturePreview(req({version:c.version,artifactId:artifact.id,destination,keepDuplicate:false}),c.id));
  expect(response.preview.path).toEqual([{id:leaf,name,isNew:false},{name:"Child",isNew:true}]);
  expect(response.preview.access.people).toBeUndefined();expect(JSON.stringify(response)).not.toContain("PRIVATE ANCESTOR");
  const result=await finalize(c,{version:c.version,artifactId:artifact.id,destination,keepDuplicate:false,previewToken:response.preview.previewToken,idempotencyKey:randomUUID()});
  expect((await pool.query("SELECT parent_folder_id FROM hestia_folder WHERE id=$1",[result.document.folderId])).rows[0].parent_folder_id).toBe(leaf);
  expect((await pool.query("SELECT 1 FROM hestia_grant WHERE folder_id=$1",[result.document.folderId])).rowCount).toBe(0);
 });
 it("requires an anchored choice when authorized root names are ambiguous",async()=>{
  const name=`Homonym ${randomUUID()}`;
  const own=(await body<{folder:{id:string}}>(await app.handleFolders(req({name})),201)).folder.id;
  const other=(await body<{folder:{id:string}}>(await app.handleFolders(req({name},1)),201)).folder.id;
  const authority=(await pool.query("SELECT reference_grant_id FROM hestia_folder WHERE id=$1",[other])).rows[0].reference_grant_id;
  for(const capability of ["consulter","déposer","modifier"])await access.transaction(client=>issueGrant(client,users[1].id,other,{authorityId:authority,subject:users[0].id,capability}));
  const c=await add(await make("import")),{artifact}=await prepare(c);
  const denied=await body<{error:{code:string}}>(await app.handleCapturePreview(req({version:c.version,artifactId:artifact.id,destination:{kind:"create",parentId:null,levels:[name,"Child"]},keepDuplicate:false}),c.id),409);
  expect(denied.error.code).toBe("AMBIGUOUS_PATH");
  const input=await preview(c,artifact,{kind:"create",parentId:other,levels:["Child"]});
  const result=await finalize(c,input);
  expect((await pool.query("SELECT parent_folder_id FROM hestia_folder WHERE id=$1",[result.document.folderId])).rows[0].parent_folder_id).toBe(other);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE parent_folder_id=$1",[own])).rowCount).toBe(0);
 });
 it("refuses rename and move round trips after preview even when the visible path returns unchanged",async()=>{
  const child=(await body<{folder:{id:string}}>(await app.handleFolders(req({name:"Stable",parentId:folderId})),201)).folder.id;
  const other=(await body<{folder:{id:string}}>(await app.handleFolders(req({name:`Other ${randomUUID()}`})),201)).folder.id;
  const c=await add(await make("import")),{artifact}=await prepare(c);
  const renamed=await preview(c,artifact,{kind:"create",parentId:child,levels:["Never created"]});
  await pool.query("UPDATE hestia_folder SET name='Temporary',version=version+1 WHERE id=$1",[child]);
  await pool.query("UPDATE hestia_folder SET name='Stable',version=version+1 WHERE id=$1",[child]);
  expect((await app.handleCaptureFinalize(req(renamed),c.id)).status).toBe(409);
  const moved=await preview(c,artifact,{kind:"create",parentId:child,levels:["Never created"]});
  await pool.query("UPDATE hestia_folder SET parent_folder_id=$2,version=version+1 WHERE id=$1",[child,other]);
  await pool.query("UPDATE hestia_folder SET parent_folder_id=$2,version=version+1 WHERE id=$1",[child,folderId]);
  expect((await app.handleCaptureFinalize(req(moved),c.id)).status).toBe(409);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE parent_folder_id=$1",[child])).rowCount).toBe(0);
  expect((await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id))).capture.state).toBe("open");
 });
 it("rejects two editors rather than overwriting saved adjustments",async()=>{
  const c=await add(await make()),p=c.pages[0];const input={version:c.version,title:"Premier",format:"pdf",pages:[{id:p.id,rotation:0,crop:p.crop}]};
  expect((await app.handleCapture(req(input,0,"PATCH"),c.id)).status).toBe(200);expect((await app.handleCapture(req({...input,title:"Second"},0,"PATCH"),c.id)).status).toBe(409);
 });
 it("expires exactly at seven days and never extends expiration",async()=>{
  const c=await add(await make());fixedNow=new Date(new Date(c.expiresAt).getTime()-1);expect((await app.handleCapture(req(),c.id)).status).toBe(200);
  fixedNow=new Date(c.expiresAt);expect((await app.handleCapture(req(),c.id)).status).toBe(410);expect((await app.handleCapturePrepare(req({version:c.version}),c.id)).status).toBe(410);
  await app.cleanupCaptures(100,1000);expect((await pool.query("SELECT count(*) FROM hestia_capture_object WHERE capture_id=$1 AND deleted_at IS NULL AND NOT promoted",[c.id])).rows[0].count).toBe("0");
 });
 it("resumes partial chunk upload without advertising an unsaved page",async()=>{
  const c=await make(),input={version:c.version,idempotencyKey:randomUUID(),fileName:"capture.png",mediaType:"image/png",size:image.length,sha256:hash(image)};
  const reserve=await body<{upload:{id:string}}>(await app.handleCapturePages(req(input),c.id));const twice=await body<{upload:{id:string}}>(await app.handleCapturePages(req(input),c.id));expect(twice.upload.id).toBe(reserve.upload.id);
  expect((await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id))).capture.pages).toHaveLength(0);
  expect((await app.handleCapturePageComplete(req({version:c.version}),c.id,reserve.upload.id)).status).toBe(409);
  expect((await app.handleCapturePageChunk(req(image,0,"PUT"),c.id,reserve.upload.id,"0")).status).toBe(200);
  const completed=await body<{capture:CaptureDto}>(await app.handleCapturePageComplete(req({version:c.version}),c.id,reserve.upload.id));expect(completed.capture.pages).toHaveLength(1);
  expect((await app.handleCapturePageComplete(req({version:c.version}),c.id,reserve.upload.id)).status).toBe(200);
 });
 it("retains cleanup debt through a failed deletion, then releases it once",async()=>{
  const c=await add(await make());const budget=createStorageBudget();const before=await pool.connect();let initial=0;try{initial=(await budget.usage(before,users[0].id)).memberBytes;}finally{before.release();}
  await app.handleCapture(req({version:c.version},0,"DELETE"),c.id);deleteHook=async()=>{throw new Error("synthetic delete unavailable");};const failed=await app.cleanupCaptures(100,1000);expect(failed.failed).toBeGreaterThan(0);
  const mid=await pool.connect();try{expect((await budget.usage(mid,users[0].id)).memberBytes).toBe(initial);}finally{mid.release();}
  deleteHook=undefined;await app.cleanupCaptures(100,1000);const after=await pool.connect();try{expect((await budget.usage(after,users[0].id)).memberBytes).toBeLessThan(initial);}finally{after.release();}
  expect((await app.cleanupCaptures(100,1000)).cleaned).toBe(0);
 });
 it("rolls back the complete new path and preserves draft if publication quota fails",async()=>{
  const c=await add(await make()),{artifact}=await prepare(c);const name=`Atomic ${randomUUID()}`,input=await preview(c,artifact,{kind:"create",parentId:folderId,levels:[name,"Enfant"]});
  const limited=createApplication(pool,config,{store,limits:{memberBytes:1,globalBytes:1}});const denied=await limited.handleCaptureFinalize(req(input),c.id);expect(denied.status).toBe(413);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE parent_folder_id=$1 AND name=$2",[folderId,name])).rowCount).toBe(0);
  expect((await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id))).capture.state).toBe("open");
  const retry=await finalize(c,input);expect(retry.status).toBe("recorded");
 });
 it("revalidates authority after object reads and invalidates old membership epochs",async()=>{
  const c=await add(await make()),{artifact}=await prepare(c);const selection={captureId:c.id,version:c.version,artifactId:artifact.id};const identity=await access.withActor(req(),(client,actor)=>capture.analysis.inspect(client,actor,selection));
  getHook=async()=>{getHook=undefined;await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1",[users[0].id]);};await expect(capture.analysis.readBytes(req(),identity)).rejects.toMatchObject({status:401});
  await pool.query("UPDATE hestia_member SET active=true WHERE user_id=$1",[users[0].id]);await login(0);expect((await app.handleCapture(req(),c.id)).status).toBe(404);
 });
 it("reports in-progress under writer lock, without exposing another author's operation",async()=>{
  const c=await add(await make()),{artifact}=await prepare(c),input=await preview(c,artifact);const lock=await pool.connect();
  try{await lock.query("SELECT pg_advisory_lock(hashtextextended($1,4819))",[c.id]);
   const mine=await body<{status:string}>(await app.handleCaptureOperation(req({captureId:c.id,...input}),input.idempotencyKey));expect(mine.status).toBe("in-progress");
   expect((await app.handleCaptureOperation(req({captureId:c.id,...input},1),input.idempotencyKey)).status).toBe(404);
  }finally{await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,4819))",[c.id]);lock.release();}
  expect((await body<{status:string}>(await app.handleCaptureOperation(req({captureId:c.id,...input}),input.idempotencyKey))).status).toBe("not-recorded");
 });
 it("refuses a destination whose rights changed after preview, with no partial effect",async()=>{
  const c=await add(await make()),{artifact}=await prepare(c),input=await preview(c,artifact);
  await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2 AND capability='déposer'",[folderId,users[0].id]);
  expect((await app.handleCaptureFinalize(req(input),c.id)).status).toBe(404);expect((await pool.query("SELECT 1 FROM hestia_document WHERE folder_id=$1",[folderId])).rowCount).toBe(0);
 });
 it("promoted finals survive Capture cleanup and follow document trash/purge",async()=>{
  const c=await add(await make()),{artifact}=await prepare(c),input=await preview(c,artifact),result=await finalize(c,input);await app.cleanupCaptures(100,1000);
  const live=(await pool.query("SELECT object_key FROM hestia_document WHERE id=$1",[result.document.id])).rows[0];expect(hash(await real.getRange(live.object_key,0,result.document.size-1))).toBe(result.document.sha256);
  expect((await app.handleDocumentTrash(req({version:1}),result.document.id)).status).toBe(200);await pool.query("UPDATE hestia_document SET trashed_at=clock_timestamp()-interval '8 days' WHERE id=$1",[result.document.id]);await app.cleanupTrash(100);
  expect((await pool.query("SELECT object_key FROM hestia_document WHERE id=$1",[result.document.id])).rows[0].object_key).toBeNull();expect((await app.handleCaptureFinalize(req(input),c.id)).status).not.toBe(200);
 });
 it("retries an uncertain source put without publishing or discarding the page",async()=>{
  const c=await make(),input={version:c.version,idempotencyKey:randomUUID(),fileName:"retry.png",mediaType:"image/png",size:image.length,sha256:hash(image)};
  const reserved=await body<{upload:{id:string}}>(await app.handleCapturePages(req(input),c.id));const pageId=reserved.upload.id;
  expect((await app.handleCapturePageChunk(req(image,0,"PUT"),c.id,pageId,"0")).status).toBe(200);
  const source=(await pool.query("SELECT object_key FROM hestia_capture_page WHERE id=$1",[pageId])).rows[0].object_key;
  putHook=async key=>{if(key===source)throw new Error("synthetic lost put response");};expect((await app.handleCapturePageComplete(req({version:c.version}),c.id,pageId)).status).toBe(503);
  expect((await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id))).capture.pages).toHaveLength(0);
  expect((await pool.query("SELECT ready FROM hestia_capture_object WHERE object_key=$1",[source])).rows[0].ready).toBe(false);
  putHook=undefined;expect((await app.handleCapturePageComplete(req({version:c.version}),c.id,pageId)).status).toBe(200);
  expect((await pool.query("SELECT count(*) FROM hestia_capture_page WHERE capture_id=$1 AND status='saved'",[c.id])).rows[0].count).toBe("1");
 });
 it("never publishes a prepared artefact if the draft expires while its object is written",async()=>{
  const c=await add(await make());putHook=async key=>{if(key.startsWith("originals/"))fixedNow=new Date(c.expiresAt);};
  expect((await app.handleCapturePrepare(req({version:c.version}),c.id)).status).toBe(410);putHook=undefined;
  expect((await pool.query("SELECT count(*) FROM hestia_capture_artifact WHERE capture_id=$1",[c.id])).rows[0].count).toBe("0");
  expect((await pool.query("SELECT count(*) FROM hestia_capture_page WHERE capture_id=$1 AND status='saved'",[c.id])).rows[0].count).toBe("1");
  await app.cleanupCaptures(100,1000);expect((await pool.query("SELECT count(*) FROM hestia_capture_object WHERE capture_id=$1 AND deleted_at IS NULL",[c.id])).rows[0].count).toBe("0");
 });
 it("serializes two finalizers across application instances and detects a late path collision",async()=>{
  const c=await add(await make()),{artifact}=await prepare(c),input=await preview(c,artifact);
  const other=createApplication(pool,config,{store});const results=await Promise.all([app.handleCaptureFinalize(req(input),c.id),other.handleCaptureFinalize(req(input),c.id)]);
  expect(results.some(r=>r.status===200)).toBe(true);expect(results.every(r=>[200,409].includes(r.status))).toBe(true);expect((await finalize(c,input)).status).toBe("recorded");
  expect((await pool.query("SELECT count(*) FROM hestia_capture_receipt WHERE capture_id=$1",[c.id])).rows[0].count).toBe("1");
  const next=await add(await make()),prepared=await prepare(next),name=`Collision ${randomUUID()}`,second=await preview(next,prepared.artifact,{kind:"create",parentId:folderId,levels:[name,"Never created"]});
  expect((await app.handleFolders(req({name,parentId:folderId}))).status).toBe(201);expect((await app.handleCaptureFinalize(req(second),next.id)).status).toBe(409);
  expect((await pool.query("SELECT 1 FROM hestia_folder WHERE name='Never created'",[])).rowCount).toBe(0);
 });
 it("previews, records and reconciles a maximum-depth Unicode path above the ordinary JSON limit",async()=>{
  const c=await add(await make("import")),{artifact}=await prepare(c);
  const levels=Array.from({length:20},(_,i)=>i===0?randomUUID()+"é".repeat(84):String(i).padStart(2,"0")+"é".repeat(118));
  const target={kind:"create" as const,parentId:null,levels};
  expect(Buffer.byteLength(JSON.stringify({destination:target}))).toBeGreaterThan(4096);
  const input=await preview(c,artifact,target),saved=await finalize(c,input);
  const reconciled=await body<{status:string;document:{id:string}}>(await app.handleCaptureOperation(req({captureId:c.id,...input}),input.idempotencyKey));
  expect(reconciled.status).toBe("recorded");expect(reconciled.document.id).toBe(saved.document.id);
  let parent:string|null=null;
  for(const name of levels){const rows:{id:string}[]=(await pool.query<{id:string}>("SELECT id FROM hestia_folder WHERE name=$1 AND parent_folder_id IS NOT DISTINCT FROM $2::uuid AND created_by=$3",[name,parent,users[0].id])).rows;expect(rows).toHaveLength(1);parent=rows[0].id;}
  expect(parent).toBe(saved.document.folderId);expect(saved.document.sha256).toBe(hash(image));
 });
 it("imports exactly 20 MiB through ten Capture chunks and publishes unchanged bytes",async()=>{
  const max=20*1024*1024,chunk=2*1024*1024;
  // Valid ancillary PNG text, as in the existing Documents boundary fixture.
  // Pixels remain tiny, and the real isolated decoder validates the whole file.
  const padding=Buffer.alloc(max-image.length-12,97);padding.write("padding\0",0,"binary");
  const data=Buffer.concat([Buffer.from("tEXt"),padding]);
  const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  let crc=0xffffffff;for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);
  const prefix=Buffer.alloc(4),suffix=Buffer.alloc(4);prefix.writeUInt32BE(padding.length);suffix.writeUInt32BE((crc^0xffffffff)>>>0);
  const bytes=Buffer.concat([image.subarray(0,image.length-12),prefix,data,suffix,image.subarray(image.length-12)]),sha=hash(bytes);
  expect(bytes.length).toBe(max);
  const c=await add(await make("import"),bytes);
  expect(c.pages).toHaveLength(1);expect(c.pages[0].size).toBe(max);
  const chunks=await pool.query("SELECT count(*) AS count,sum(o.size)::bigint AS size FROM hestia_capture_chunk ch JOIN hestia_capture_object o ON o.object_key=ch.object_key WHERE ch.page_id=$1 AND o.ready",[c.pages[0].id]);
  expect(chunks.rows[0]).toEqual({count:"10",size:String(max)});
  const {artifact}=await prepare(c);expect(artifact).toMatchObject({size:max,sha256:sha,mediaType:"image/png"});
  const result=await finalize(c,await preview(c,artifact));expect(result.document).toMatchObject({size:max,sha256:sha,mediaType:"image/png"});
  const downloaded=createHash("sha256");
  for(let offset=0;offset<max;offset+=chunk){
   const range=await app.handleDocumentContent(req(undefined,0,"GET",`/api/hestia/documents/${result.document.id}/content?intent=download&offset=${offset}&length=${chunk}`),result.document.id);
   expect(range.status).toBe(206);expect(range.headers.get("content-range")).toBe(`bytes ${offset}-${offset+chunk-1}/${max}`);
   const piece=new Uint8Array(await range.arrayBuffer());expect(piece.length).toBe(chunk);downloaded.update(piece);
  }
  expect(downloaded.digest("hex")).toBe(sha);
 },60000);
 it("rejects a Capture reservation one byte above 20 MiB before storage and preserves the draft",async()=>{
  const c=await make("import");let puts=0;putHook=async()=>{puts++;};
  const rejected=await app.handleCapturePages(req({version:c.version,idempotencyKey:randomUUID(),fileName:"oversized.png",mediaType:"image/png",size:20*1024*1024+1,sha256:hash(image)}),c.id);
  expect(rejected.status).toBe(400);expect(puts).toBe(0);
  expect((await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id))).capture).toEqual(c);
  expect((await pool.query("SELECT 1 FROM hestia_capture_object WHERE capture_id=$1",[c.id])).rowCount).toBe(0);
  expect((await pool.query("SELECT 1 FROM hestia_capture_page WHERE capture_id=$1",[c.id])).rowCount).toBe(0);
  expect((await pool.query("SELECT 1 FROM hestia_document WHERE folder_id=$1",[folderId])).rowCount).toBe(0);
 });
});
