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
import type {CaptureDto,CaptureArtifactDto,CapturePreviewDto,CaptureFinalizeInput} from "../../src/shared/capture-contract";
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
 async function preview(c:CaptureDto,a:CaptureArtifactDto,destination:{kind:"existing";folderId:string}|{kind:"create";parentId:string;levels:string[]}={kind:"existing",folderId},keepDuplicate=false){
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
 it("keeps empty and saved camera drafts private even from the household administrator",async()=>{
  let c=await make();expect(c.pages).toHaveLength(0);expect(new Date(c.expiresAt).getTime()-new Date(c.createdAt).getTime()).toBe(168*3600000);
  expect((await app.handleCapture(req(undefined,1),c.id)).status).toBe(404);expect((await body<{captures:CaptureDto[]}>(await app.handleCaptures(req(undefined,1)))).captures).toHaveLength(0);
  expect((await app.handleCapturePrepare(req({version:c.version}),c.id)).status).toBe(409);c=await add(c);expect(c.pages).toHaveLength(1);
  const resumed=await body<{capture:CaptureDto}>(await app.handleCapture(req(),c.id));expect(resumed.capture).toEqual(c);
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
