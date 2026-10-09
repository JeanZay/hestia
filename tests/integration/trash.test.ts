import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { createObjectStore, type ObjectStore } from "../../src/server/storage";
import { handleMaintenance } from "../../src/server/documents/maintenance";

describe("trash retention, current rights and physical deletion", () => {
  const config=readServerConfig();
  if(config.environment!=="local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw Error("Owned synthetic bench required");
  const pool=new Pool({connectionString:config.databaseUrl,max:8,options:"-c timezone=Europe/Paris"}), real=createObjectStore();
  let now=new Date(), failDelete=false, loseDeleteResponse=false, getHook:(()=>Promise<void>)|undefined, deleteHook:(()=>Promise<void>)|undefined;
  const store:ObjectStore={put:(...args)=>real.put(...args),async getRange(...args){const b=await real.getRange(...args);await getHook?.();return b;},async delete(key){if(failDelete)throw Error("Injected unavailable object store");await deleteHook?.();await real.delete(key);if(loseDeleteResponse)throw Error("Injected lost deletion response");}};
  const app=createApplication(pool,config,{store,now:()=>now});
  const bytes=readFileSync(new URL("../fixtures/documents/synthetic.png",import.meta.url));
  const digest=createHash("sha256").update(bytes).digest("hex"), password="Synthetic trash validation phrase!";
  let otherId:string,cookie:string,otherCookie:string,folderId:string;
  function req(path:string,body?:unknown,method=body===undefined?"GET":"POST",selected=cookie){return new Request(config.origin+path,{method,headers:{origin:config.origin,cookie:selected,...(body===undefined?{}:{"content-type":body instanceof Uint8Array?"application/octet-stream":"application/json"})},...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});}
  async function login(email:string){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(req("/api/auth/sign-in/email",{email,password},"POST",""));expect(r.status).toBe(200);return r.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");}
  async function add(instance=app){
    const metadata={folderId,idempotencyKey:randomUUID(),fileName:"synthetic.png",title:"Facture test corbeille",size:bytes.length,mediaType:"image/png",sha256:digest,source:"import"};
    const start=await instance.handleUploads(req("/api/hestia/uploads",metadata));expect(start.status).toBe(201);const id=(await start.json()).operation.id;
    expect((await instance.handleUploadChunk(req(`/api/hestia/uploads/${id}/chunks/0`,bytes,"PUT"),id,"0")).status).toBe(200);
    const result=await instance.handleUploadComplete(req(`/api/hestia/uploads/${id}/complete`,{keepDuplicate:true}),id);expect(result.status).toBe(200);
    return {operationId:id,document:(await result.json()).document,metadata};
  }
  const trash=(id:string,version=1,selected=cookie)=>app.handleDocumentTrash(req(`/api/hestia/documents/${id}/trash`,{version},"POST",selected),id);
  const restore=(id:string,version=2,selected=cookie)=>app.handleDocumentRestore(req(`/api/hestia/documents/${id}/restore`,{version},"POST",selected),id);
  const content=(id:string)=>app.handleDocumentContent(req(`/api/hestia/documents/${id}/content?intent=download&offset=0&length=${bytes.length}`),id);
  const list=()=>app.handleDocuments(req(`/api/hestia/documents?folderId=${folderId}&trash=true`));
  beforeAll(async()=>{
    if(!(await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker)throw Error("Missing bench marker");
    await migrateDatabase(pool,config);
    const email=`trash-${randomUUID()}@example.invalid`,other=`trash-other-${randomUUID()}@example.invalid`;
    await provisionSyntheticMember(pool,{email,name:"Camille Test",password});
    otherId=await provisionSyntheticMember(pool,{email:other,name:"Alex Test",password});
    cookie=await login(email);otherCookie=await login(other);
  });
  beforeEach(async()=>{now=new Date();const r=await app.handleFolders(req("/api/hestia/folders",{name:`Corbeille test ${randomUUID()}`}));expect(r.status).toBe(201);folderId=(await r.json()).folder.id;});
  afterEach(()=>{failDelete=false;loseDeleteResponse=false;getHook=undefined;deleteHook=undefined;});
  afterAll(async()=>{await pool.end();});

  it("removes from normal views and content, restores same immutable original, and makes exact retries harmless",async()=>{
    const {document:d}=await add();
    const first=await trash(d.id);expect(first.status).toBe(200);const receipt=await first.json();
    expect(await (await trash(d.id)).json()).toEqual(receipt);
    expect((await content(d.id)).status).toBe(404);
    expect((await (await app.handleDocuments(req(`/api/hestia/documents?folderId=${folderId}`))).json()).documents).toEqual([]);
    const rows=await (await list()).json();expect(rows.documents).toHaveLength(1);expect(rows.documents[0]).toMatchObject({title:d.title,version:2,trashedByName:"Camille Test"});
    expect(rows.documents[0].restorableUntil).toBe(new Date(now.getTime()+7*86400000).toISOString());
    const revived=await restore(d.id);expect(revived.status).toBe(200);expect((await revived.json()).document).toMatchObject({id:d.id,folderId,sha256:digest,version:3});
    expect((await restore(d.id)).status).toBe(200);
    expect((await trash(d.id,1)).status).toBe(409);
    expect(Buffer.from(await (await content(d.id)).arrayBuffer())).toEqual(bytes);
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_document WHERE id=$1",[d.id])).rows[0].n).toBe(1);
  });
  it("requires current read plus delete for listing, trash and restore, including another member's deletion",async()=>{
    const {document:d}=await add();
    for(const capability of ["consulter","déposer"]){await pool.query("INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind) VALUES($1,$2,$3,$4,'direct')",[randomUUID(),folderId,otherId,capability]);}
    expect((await trash(d.id,1,otherCookie)).status).toBe(404);
    expect((await app.handleDocuments(req(`/api/hestia/documents?folderId=${folderId}&trash=true`,undefined,"GET",otherCookie))).status).toBe(404);
    await pool.query("INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind) VALUES($1,$2,$3,'supprimer','direct')",[randomUUID(),folderId,otherId]);
    expect((await trash(d.id,1,otherCookie)).status).toBe(200);
    expect((await restore(d.id)).status).toBe(200);
    expect((await trash(d.id,3)).status).toBe(200);
    await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2 AND capability='supprimer'",[folderId,otherId]);
    expect((await restore(d.id,4,otherCookie)).status).toBe(404);
  });
  it("enforces the exact seven-day boundary independently of the physical cleaner",async()=>{
    const {document:d}=await add();await trash(d.id);
    now=new Date(now.getTime()+7*86400000);
    expect((await restore(d.id)).status).toBe(404);
    expect((await (await list()).json()).documents).toEqual([]);
    expect((await content(d.id)).status).toBe(404);
    expect((await pool.query("SELECT purged_at FROM hestia_document WHERE id=$1",[d.id])).rows[0].purged_at).toBeNull();
  });
  it("restores just before the deadline even after a quota reduction without charging twice",async()=>{
    const {document:d}=await add();await trash(d.id);now=new Date(now.getTime()+7*86400000-1);
    const small=createApplication(pool,config,{store,now:()=>now,limits:{memberBytes:1}});
    expect((await small.handleDocumentRestore(req(`/api/hestia/documents/${d.id}/restore`,{version:2}),d.id)).status).toBe(200);
    expect((await pool.query("SELECT sum(size)::int AS n FROM hestia_document WHERE folder_id=$1",[folderId])).rows[0].n).toBe(bytes.length);
  });
  it.each(["2026-03-28T12:00:00+01:00","2026-10-24T12:00:00+02:00"])("keeps listing and purge on 168 elapsed hours across DST from %s",async(start)=>{
    const {document:d}=await add();now=new Date(start);await trash(d.id);
    now=new Date(new Date(start).getTime()+168*3600000-30*60000);
    expect((await (await list()).json()).documents.map((row:{id:string})=>row.id)).toContain(d.id);
    await app.cleanupTrash(100);
    expect((await pool.query("SELECT purged_at FROM hestia_document WHERE id=$1",[d.id])).rows[0].purged_at).toBeNull();
    now=new Date(new Date(start).getTime()+168*3600000+30*60000);
    expect((await (await list()).json()).documents).toEqual([]);
    expect((await restore(d.id)).status).toBe(404);
    await app.cleanupTrash(100);
    expect((await pool.query("SELECT object_key,purged_at FROM hestia_document WHERE id=$1",[d.id])).rows[0]).toMatchObject({object_key:null,purged_at:expect.any(Date)});
  });
  it("rechecks a trash operation after S3 bytes arrive, before returning a portion",async()=>{
    const {document:d}=await add();getHook=async()=>{getHook=undefined;expect((await trash(d.id)).status).toBe(200);};
    expect((await content(d.id)).status).toBe(404);
  });
  it("does not silently overwrite a concurrent rename",async()=>{
    const {document:d}=await add();const renamed=await app.handleDocument(req(`/api/hestia/documents/${d.id}`,{title:"Titre corrigé",version:1},"PATCH"),d.id);expect(renamed.status).toBe(200);
    expect((await trash(d.id,1)).status).toBe(409);expect((await trash(d.id,2)).status).toBe(200);
  });
  it("retries uncertain deletion, keeps quota charged, scrubs metadata and blocks old upload replay",async()=>{
    const {document:d,operationId,metadata}=await add();await trash(d.id);now=new Date(now.getTime()+7*86400000);
    failDelete=true;const first=await app.cleanupTrash(100);expect(first.failed).toBeGreaterThan(0);
    const marked=(await pool.query("SELECT title,file_name,purged_at,size,object_key FROM hestia_document WHERE id=$1",[d.id])).rows[0];
    expect(marked.title).toBeNull();expect(marked.file_name).toBeNull();expect(marked.purged_at).not.toBeNull();expect(marked.size).toBe(bytes.length);
    expect((await pool.query("SELECT deleted_at FROM hestia_upload_object WHERE object_key=$1",[marked.object_key])).rows[0].deleted_at).toBeNull();
    expect((await restore(d.id)).status).toBe(404);
    failDelete=false;await Promise.all([app.cleanupTrash(100),app.cleanupTrash(100)]);
    const purged=(await pool.query("SELECT title,sha256,size,object_key FROM hestia_document WHERE id=$1",[d.id])).rows[0];
    expect(purged).toEqual({title:null,sha256:null,size:null,object_key:null});
    const upload=(await pool.query("SELECT title,file_name,sha256,size FROM hestia_upload WHERE id=$1",[operationId])).rows[0];expect(upload).toEqual({title:null,file_name:null,sha256:null,size:null});
    await app.cleanupUploads(100);
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_upload_object WHERE upload_id=$1",[operationId])).rows[0].n).toBe(0);
    // Recover an interrupted cleanup whose final object was already acknowledged.
    await pool.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,chunk_index,size,sha256,ready,deleted_at) VALUES($1,$2,'chunk',0,$3,$4,true,clock_timestamp())",[randomUUID(),operationId,bytes.length,digest]);
    await app.cleanupUploads(100);
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_upload_object WHERE upload_id=$1",[operationId])).rows[0].n).toBe(0);
    expect((await app.handleUploads(req("/api/hestia/uploads",metadata))).status).toBe(201);
    const replay=await app.handleUploadComplete(req(`/api/hestia/uploads/${operationId}/complete`,{keepDuplicate:true}),operationId);expect(replay.status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_document WHERE id=$1",[d.id])).rows[0].n).toBe(1);
    expect((await app.cleanupTrash(100)).failed).toBe(0);
  });
  it("never purges a document restored before a cleaner claim",async()=>{
    const {document:d}=await add();await trash(d.id);expect((await restore(d.id)).status).toBe(200);now=new Date(now.getTime()+8*86400000);await app.cleanupTrash(100);
    expect((await content(d.id)).status).toBe(206);
  });
  it("refuses restoration during a claimed physical purge and safely retries a lost deletion response",async()=>{
    const {document:d}=await add();await trash(d.id);now=new Date(now.getTime()+7*86400000);
    let entered!:()=>void,release!:()=>void;
    const reached=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    deleteHook=async()=>{entered();await gate;};loseDeleteResponse=true;
    const pending=app.cleanupTrash(100);
    await reached;
    try {expect((await restore(d.id)).status).toBe(404);}finally{release();}
    expect((await pending).failed).toBeGreaterThan(0);
    deleteHook=undefined;loseDeleteResponse=false;
    expect((await app.cleanupTrash(100)).failed).toBe(0);
    expect((await pool.query("SELECT object_key,size FROM hestia_document WHERE id=$1",[d.id])).rows[0]).toEqual({object_key:null,size:null});
  });
  it("authenticates maintenance separately and keeps the endpoint closed without its server secret",async()=>{
    const secret="synthetic-maintenance-secret-for-tests-only";
    let invoked=0;const application=()=>{invoked++;return app;};
    expect((await handleMaintenance(req('/api/hestia/maintenance'),undefined,application)).status).toBe(404);
    expect((await handleMaintenance(req('/api/hestia/maintenance'),secret,application)).status).toBe(401);
    expect(invoked).toBe(0);
    const request=new Request(config.origin+'/api/hestia/maintenance',{headers:{authorization:`Bearer ${secret}`}});
    expect((await handleMaintenance(request,secret,application)).status).toBe(200);expect(invoked).toBe(1);
  });
});
