import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import sharp from "sharp";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { createObjectStore, type ObjectStore } from "../../src/server/storage";
import { CHUNK_SIZE, MAX_FILE_SIZE } from "../../src/server/documents/service";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("private immutable originals over SQL and real S3", () => {
  const config = readServerConfig();
  if (config.environment!=="local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw new Error("Owned synthetic integration bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  const realStore = createObjectStore();
  let putHook: ((key:string,bytes:Uint8Array)=>Promise<void>) | undefined;
  let getHook: ((key:string)=>Promise<void>) | undefined;
  let deleteHook: ((key:string)=>Promise<void>) | undefined;
  const store: ObjectStore = {
    async put(key,bytes,type) { await realStore.put(key,bytes,type); await putHook?.(key,bytes); },
    async getRange(key,start,end) { const bytes = await realStore.getRange(key,start,end); await getHook?.(key); return bytes; },
    async delete(key) { await deleteHook?.(key); await realStore.delete(key); },
  };
  const app = createApplication(pool,config,{store});
  const password = "Synthetic document phrase only!";
  let actorId:string, otherId:string, cookie:string, otherCookie:string, folderId:string, image:Buffer;
  const email = `document-${randomUUID()}@example.invalid`, otherEmail = `depositor-${randomUUID()}@example.invalid`;
  function request(path:string, body?:unknown, selectedCookie=cookie, method?:string) {
    const headers = new Headers({ origin:config.origin, cookie:selectedCookie });
    if (body!==undefined) headers.set("content-type", body instanceof Uint8Array ? "application/octet-stream" : "application/json");
    return new Request(config.origin+path,{ method:method ?? (body===undefined ? "GET" : "POST"),headers,
      ...(body===undefined ? {} : {body: body instanceof Uint8Array ? new Uint8Array(body) : JSON.stringify(body)}) });
  }
  async function login(email:string) {
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const result = await app.handleAuth(request("/api/auth/sign-in/email",{email,password},""));
    expect(result.status).toBe(200);
    return result.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
  }
  async function folder(selectedCookie=cookie) {
    const result = await app.handleFolders(request("/api/hestia/folders",{name:`Appareil synthétique ${randomUUID()}`},selectedCookie));
    expect(result.status).toBe(201); return (await result.json()).folder.id as string;
  }
  const metadata = (bytes=image, extra:Record<string,unknown>={}) => ({folderId,idempotencyKey:randomUUID(),fileName:"Facture-énergie.png",title:"Facture été",size:bytes.length,mediaType:"image/png",sha256:digest(bytes),source:"import",...extra});
  async function begin(input=metadata(), instance=app, selectedCookie=cookie) {
    const result = await instance.handleUploads(request("/api/hestia/uploads",input,selectedCookie));
    expect(result.status).toBe(201); return (await result.json()).operation.id as string;
  }
  async function chunks(id:string, bytes=image, instance=app, selectedCookie=cookie) {
    for (let offset=0; offset<bytes.length; offset+=CHUNK_SIZE) {
      const result = await instance.handleUploadChunk(request(`/api/hestia/uploads/${id}/chunks/${offset/CHUNK_SIZE}`,bytes.subarray(offset,offset+CHUNK_SIZE),selectedCookie,"PUT"),id,String(offset/CHUNK_SIZE));
      expect(result.status).toBe(200);
    }
  }
  const finish = (id:string, keepDuplicate=false, instance=app, selectedCookie=cookie) => instance.handleUploadComplete(request(`/api/hestia/uploads/${id}/complete`,{keepDuplicate},selectedCookie),id);
  async function add(bytes=image, extra:Record<string,unknown>={}) {
    const id=await begin(metadata(bytes,extra)); await chunks(id,bytes);
    const result=await finish(id); expect(result.status).toBe(200); return {id,document:(await result.json()).document};
  }
  const content = (id:string,length:number, intent="download",offset=0,instance=app,selectedCookie=cookie) => instance.handleDocumentContent(request(`/api/hestia/documents/${id}/content?offset=${offset}&length=${length}&intent=${intent}`,undefined,selectedCookie),id);
  beforeAll(async () => {
    const marker = await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker");
    if (!marker.rows[0].marker) throw new Error("Missing owned bench marker");
    await migrateDatabase(pool,config);
    actorId=await provisionSyntheticMember(pool,{email,name:"Camille Synthétique",password});
    otherId=await provisionSyntheticMember(pool,{email:otherEmail,name:"Alex Synthétique",password});
    cookie=await login(email); otherCookie=await login(otherEmail);
    image=await sharp({create:{width:4,height:4,channels:3,background:"#123456"}}).png().toBuffer();
  });
  beforeEach(async () => { folderId=await folder(); });
  afterEach(async () => {
    putHook=undefined; getHook=undefined; deleteHook=undefined;
    await pool.query("UPDATE hestia_member SET active=true WHERE user_id IN ($1,$2)",[actorId,otherId]);
    // Each next case creates a fresh folder and new grants at the current epoch.
    // Departed identities never regain historical rights during fixture cleanup.
    cookie=await login(email); otherCookie=await login(otherEmail);
    await pool.query("UPDATE hestia_upload SET status='cancelled' WHERE actor_id IN ($1,$2) AND status IN ('uploading','finalizing')",[actorId,otherId]);
    await app.cleanupUploads(100);
  });
  afterAll(async()=>{await pool.end();});

  it("publishes original and provenance together, retries without duplicate billing and detects identity conflicts",async()=>{
    const input=metadata(), id=await begin(input); await chunks(id); await chunks(id);
    const result=await finish(id); expect(result.status).toBe(200);
    const document=(await result.json()).document;
    expect(document).toMatchObject({title:"Facture été",fileName:"Facture-énergie.png",source:"import",sha256:digest(image),uploadedByName:"Camille Synthétique"});
    expect(document.object_key).toBeUndefined();
    expect(await begin(input)).toBe(id);
    expect((await (await finish(id)).json()).document.id).toBe(document.id);
    const changed=await app.handleUploads(request("/api/hestia/uploads",{...input,title:"Différent"}));
    expect(changed.status).toBe(409);
    expect((await pool.query("SELECT id FROM hestia_document WHERE folder_id=$1",[folderId])).rowCount).toBe(1);
    const listed=await app.handleFolders(request("/api/hestia/folders"));
    expect((await listed.json()).folders.find((f:{id:string})=>f.id===folderId).documentCount).toBe(1);
  });
  it("signals only a consultable duplicate and permits an explicit independent original",async()=>{
    const first=await add(), id=await begin(); await chunks(id);
    const duplicate=await finish(id); expect(duplicate.status).toBe(409); expect((await duplicate.json()).error.code).toBe("DUPLICATE");
    const kept=await finish(id,true); expect(kept.status).toBe(200);
    expect((await kept.json()).document.id).not.toBe(first.document.id);
    const rows=(await pool.query("SELECT object_key FROM hestia_document WHERE folder_id=$1",[folderId])).rows;
    expect(new Set(rows.map(r=>r.object_key)).size).toBe(2);
    expect((await finish(id,false)).status).toBe(409);
  });
  it("accepts deposit without read, hides duplicates and charges the folder creator",async()=>{
    await add();
    await pool.query("INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind) VALUES($1,$2,$3,'déposer','direct')",[randomUUID(),folderId,otherId]);
    const id=await begin(metadata(),app,otherCookie); await chunks(id,image,app,otherCookie);
    const result=await finish(id,false,app,otherCookie); expect(result.status).toBe(200); expect(await result.json()).toEqual({success:true,document:null});
    expect((await pool.query("SELECT owner_id,uploaded_by FROM hestia_document WHERE folder_id=$1 ORDER BY created_at DESC",[folderId])).rows[0]).toEqual({owner_id:actorId,uploaded_by:otherId});
    const hidden=await app.handleDocuments(request(`/api/hestia/documents?folderId=${folderId}`,undefined,otherCookie)); expect(hidden.status).toBe(404);
  });
  it("searches accent/case-insensitive permitted metadata and keeps renames versioned and immutable",async()=>{
    const {document}=await add();
    const found=await app.handleDocuments(request(`/api/hestia/documents?q=ENERGIE`));
    expect((await found.json()).documents.some((d:{id:string})=>d.id===document.id)).toBe(true);
    const rename=(title:string)=>app.handleDocument(request(`/api/hestia/documents/${document.id}`,{title,version:1},cookie,"PATCH"),document.id);
    expect((await Promise.all([rename("Garantie"),rename("Preuve")])).map(r=>r.status).sort()).toEqual([200,409]);
    const restarted=createApplication(pool,config,{store});
    const download=await content(document.id,image.length,"download",0,restarted); expect(download.status).toBe(206);
    expect(digest(new Uint8Array(await download.arrayBuffer()))).toBe(digest(image));
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    await pool.query("UPDATE hestia_document SET trashed_at=clock_timestamp() WHERE id=$1",[document.id]);
    expect((await content(document.id,image.length)).status).toBe(404);
    expect((await app.handleDocument(request(`/api/hestia/documents/${document.id}`),document.id)).status).toBe(404);
  });
  it("requires export separately and rechecks revocation after bytes arrive from S3",async()=>{
    const {document}=await add();
    await pool.query("UPDATE hestia_grant SET revoked_at=now() WHERE folder_id=$1 AND capability='exporter'",[folderId]);
    expect((await content(document.id,image.length)).status).toBe(404);
    expect((await content(document.id,image.length,"preview")).status).toBe(206);
    getHook=async()=>{ await pool.query("UPDATE hestia_grant SET revoked_at=now() WHERE folder_id=$1 AND capability='consulter'",[folderId]); };
    const denied=await content(document.id,image.length,"preview"); expect(denied.status).toBe(404);
    expect((await denied.text()).includes("sha256")).toBe(false);
  });
  it("rejects bounded malformed content, excess size, reordered and changed chunks",async()=>{
    expect((await app.handleUploads(request("/api/hestia/uploads",metadata(image,{size:MAX_FILE_SIZE+1})))).status).toBe(413);
    const bad=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),id=await begin(metadata(bad)); await chunks(id,bad);
    expect((await finish(id)).status).toBe(422);
    expect((await app.handleUploadChunk(request("/chunk",Buffer.alloc(CHUNK_SIZE+1),cookie,"PUT"),id,"0")).status).toBe(400);
    expect((await app.handleUploadChunk(request("/chunk",Buffer.alloc(bad.length,1),cookie,"PUT"),id,"0")).status).toBe(409);
    expect((await app.handleUploadChunk(request("/chunk",image,cookie,"PUT"),id,"1")).status).toBe(400);
    expect((await pool.query("SELECT id FROM hestia_document WHERE folder_id=$1",[folderId])).rowCount).toBe(0);
  });
  it("rechecks deposit rights and admission between final object put and publication",async()=>{
    const id=await begin(); await chunks(id);
    putHook=async key=>{ if(key.startsWith("originals/")) await pool.query("UPDATE hestia_grant SET revoked_at=now() WHERE folder_id=$1 AND capability='déposer'",[folderId]); };
    expect((await finish(id)).status).toBe(404);
    expect((await pool.query("SELECT id FROM hestia_document WHERE folder_id=$1",[folderId])).rowCount).toBe(0);
    putHook=async key=>{ if(key.startsWith("originals/")) await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1",[actorId]); };
    await pool.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,author_id,subject_epoch)
      SELECT $1,$2,$3,'déposer','direct',$3,departure_epoch FROM hestia_member WHERE user_id=$3`,[randomUUID(),folderId,actorId]);
    expect((await finish(id)).status).toBe(401);
  });
  it("retains private uncertain puts and SQL failures for cleanup without incomplete visibility",async()=>{
    const id=await begin(); await chunks(id);
    putHook=async key=>{ if(key.startsWith("originals/")) throw new Error("Synthetic lost S3 response"); };
    expect((await finish(id)).status).toBe(503);
    expect((await pool.query("SELECT id FROM hestia_document WHERE folder_id=$1",[folderId])).rowCount).toBe(0);
    putHook=undefined;
    await pool.query(`CREATE FUNCTION hestia_test_fail_document() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic SQL failure'; END $$;
      CREATE TRIGGER hestia_test_fail_document BEFORE INSERT ON hestia_document FOR EACH ROW EXECUTE FUNCTION hestia_test_fail_document()`);
    try { expect((await finish(id)).status).toBe(503); }
    finally { await pool.query("DROP TRIGGER hestia_test_fail_document ON hestia_document; DROP FUNCTION hestia_test_fail_document()"); }
    const pending=(await pool.query("SELECT object_key FROM hestia_upload_object WHERE upload_id=$1 AND kind='original' AND deleted_at IS NULL",[id])).rows;
    expect(pending.length).toBe(1);
    expect((await finish(id)).status).toBe(200);
    await app.cleanupUploads();
    const committed=(await pool.query("SELECT object_key FROM hestia_document WHERE folder_id=$1",[folderId])).rows[0];
    expect(digest(await realStore.getRange(committed.object_key,0,image.length-1))).toBe(digest(image));
  });
  it("serializes finalizers and prevents cleanup deleting a slow writer even after expiry",async()=>{
    const id=await begin(); await chunks(id);
    let release!:()=>void, signal!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}), entered=new Promise<void>(resolve=>{signal=resolve;});
    putHook=async key=>{if(key.startsWith("originals/")){signal();await held;}};
    const first=finish(id); await entered;
    try {
      expect((await finish(id)).status).toBe(409);
      await pool.query("UPDATE hestia_upload SET expires_at=now()-interval '1 second',lease_until=now()-interval '1 second' WHERE id=$1",[id]);
      expect((await app.cleanupUploads()).cleaned).toBe(0);
    } finally { release(); }
    expect((await first).status).toBe(409);
    putHook=undefined; await app.cleanupUploads();
    expect((await pool.query("SELECT status,reservation_released FROM hestia_upload WHERE id=$1",[id])).rows[0]).toEqual({status:"cancelled",reservation_released:true});
    expect((await finish(id)).status).toBe(409);
  });
  it("cancellation racing finalization stays neutral and cannot resurrect a committed or purged document",async()=>{
    const input=metadata(),id=await begin(input); await chunks(id);
    putHook=async key=>{if(key.startsWith("originals/")) expect((await app.handleUpload(request(`/upload/${id}`,undefined,cookie,"DELETE"),id)).status).toBe(200);};
    expect((await finish(id)).status).toBe(409); putHook=undefined;
    expect((await app.handleUploads(request("/uploads",input))).status).toBe(409);
    const added=await add();
    expect(await (await app.handleUpload(request("/upload",undefined,cookie,"DELETE"),added.id)).json()).toEqual({success:true,status:"completed"});
    await pool.query("UPDATE hestia_document SET purged_at=now() WHERE id=$1",[added.document.id]);
    expect((await finish(added.id)).status).toBe(409);
  });
  it("reserves creator quota atomically across folders and retains trash and failed cleanup charges",async()=>{
    const another=await folder();
    await pool.query("INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind) VALUES($1,$2,$3,'déposer','direct')",[randomUUID(),another,otherId]);
    const used=Number((await pool.query("SELECT COALESCE(sum(d.size),0) AS n FROM hestia_document d JOIN hestia_upload_object o ON o.object_key=d.object_key WHERE d.owner_id=$1 AND o.deleted_at IS NULL",[actorId])).rows[0].n);
    const limited=createApplication(pool,config,{store,limits:{memberBytes:used+image.length}});
    const results=await Promise.all([
      limited.handleUploads(request("/uploads",metadata())),
      limited.handleUploads(request("/uploads",metadata(image,{folderId:another}),otherCookie)),
    ]);
    expect(results.map(r=>r.status).sort()).toEqual([201,413]);
    const winning=results.find(r=>r.status===201)!;const id=(await winning.json()).operation.id;
    const actor=(await pool.query("SELECT actor_id FROM hestia_upload WHERE id=$1",[id])).rows[0].actor_id;
    const selectedCookie=actor===actorId?cookie:otherCookie;
    await chunks(id,image,limited,selectedCookie);
    await limited.handleUpload(request("/upload",undefined,selectedCookie,"DELETE"),id);
    deleteHook=async()=>{throw new Error("Synthetic deletion outage");};
    await expect(limited.cleanupUploads()).rejects.toThrow();
    const retained=Number((await pool.query("SELECT sum(size) AS n FROM hestia_upload WHERE id=$1 AND NOT reservation_released",[id])).rows[0].n);
    expect(retained).toBe(image.length);
    deleteHook=undefined; await limited.cleanupUploads();
    expect((await pool.query("SELECT reservation_released FROM hestia_upload WHERE id=$1",[id])).rows[0].reservation_released).toBe(true);
  });
  it("prioritizes the requesting actor's expired upload over older multi-part cleanup",async()=>{
    const otherFolder=await folder(otherCookie), oldBytes=Buffer.alloc(CHUNK_SIZE*2+1,65);
    const older=await begin(metadata(oldBytes,{folderId:otherFolder}),app,otherCookie);
    await chunks(older,oldBytes,app,otherCookie);
    const own=await begin(); await chunks(own);
    await pool.query("UPDATE hestia_upload SET expires_at=now()-interval '1 second' WHERE id IN ($1,$2)",[older,own]);
    const removed:string[]=[];
    deleteHook=async key=>{removed.push(key);};
    const next=await begin(); expect(next).not.toBe(own);
    expect(removed).toHaveLength(1); expect(removed[0]).toContain(`/`+own+`/`);
    expect((await pool.query("SELECT status,reservation_released FROM hestia_upload WHERE id=$1",[own])).rows[0]).toEqual({status:"cancelled",reservation_released:true});
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_upload_object WHERE upload_id=$1 AND deleted_at IS NULL",[older])).rows[0].n).toBe(3);
    expect((await finish(own)).status).toBe(409);
  });
  it("does not let unrelated deletion failure block deposits and still enforces busy state and retained quota",async()=>{
    const otherFolder=await folder(otherCookie),older=await begin(metadata(image,{folderId:otherFolder}),app,otherCookie);
    await chunks(older,image,app,otherCookie);
    await pool.query("UPDATE hestia_upload SET expires_at=now()-interval '1 second' WHERE id=$1",[older]);
    let attempted=0;
    deleteHook=async()=>{attempted++;throw new Error("Synthetic unrelated cleanup outage");};
    const own=await begin(); expect(attempted).toBe(1);
    expect((await pool.query("SELECT status,reservation_released FROM hestia_upload WHERE id=$1",[older])).rows[0]).toEqual({status:"cancelled",reservation_released:false});
    const occupied=await app.handleUploads(request("/uploads",metadata()));
    expect(occupied.status).toBe(409); expect((await occupied.json()).error.code).toBe("OPERATION_BUSY");
    await app.handleUpload(request("/upload",undefined,cookie,"DELETE"),own);
    // Complete the object-free own cancellation; the failed foreign deletion
    // remains both in the ledger and in the global reservation calculation.
    await app.cleanupUploads(1,1,actorId);
    const charged=Number((await pool.query(`SELECT COALESCE(sum(size),0) AS n FROM (
      SELECT d.size FROM hestia_document d JOIN hestia_upload_object o ON o.object_key=d.object_key WHERE o.deleted_at IS NULL
      UNION ALL SELECT size FROM hestia_upload WHERE status<>'completed' AND NOT reservation_released) charged`)).rows[0].n);
    const limited=createApplication(pool,config,{store,limits:{globalBytes:charged+image.length-1}});
    const denied=await limited.handleUploads(request("/uploads",metadata()));
    expect(denied.status).toBe(413); expect((await denied.json()).error.code).toBe("QUOTA_EXCEEDED");
  });
  it("restores synthetic SQL metadata and object bytes with a checked SHA manifest",async()=>{
    const {id,document}=await add();
    const snapshot=(await pool.query("SELECT row_to_json(d) AS data FROM hestia_document d WHERE id=$1",[document.id])).rows[0].data;
    const bytes=await realStore.getRange(snapshot.object_key,0,snapshot.size-1);
    const manifest={key:snapshot.object_key,size:bytes.length,sha256:digest(bytes)};
    expect(manifest.sha256).toBe(snapshot.sha256);
    await pool.query("UPDATE hestia_upload SET document_id=NULL WHERE id=$1",[id]);
    await pool.query("DELETE FROM hestia_document WHERE id=$1",[document.id]);
    await realStore.delete(manifest.key);
    expect((await content(document.id,image.length)).status).toBe(404);
    await realStore.put(manifest.key,bytes,snapshot.media_type);
    await pool.query("INSERT INTO hestia_document SELECT * FROM json_populate_record(NULL::hestia_document,$1::json)",[JSON.stringify(snapshot)]);
    await pool.query("UPDATE hestia_upload SET document_id=$2 WHERE id=$1",[id,document.id]);
    const restarted=createApplication(pool,config,{store});
    const restored=await content(document.id,manifest.size,"download",0,restarted);
    expect(restored.status).toBe(206); expect(digest(new Uint8Array(await restored.arrayBuffer()))).toBe(manifest.sha256);
    expect((await (await finish(id,false,restarted)).json()).document.id).toBe(document.id);
  });
  it("uploads and reads the exact 20 MiB protocol boundary with bounded HTTP chunks",async()=>{
    // Valid PNG ancillary text pads an otherwise tiny image without increasing
    // decompressed pixels; the real sandboxed parser still validates the file.
    const padding=Buffer.alloc(MAX_FILE_SIZE-image.length-12,97); padding.write("padding\0",0,"binary");
    const type=Buffer.from("tEXt"), data=Buffer.concat([type,padding]);
    const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
    let crc=0xffffffff; for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);
    const prefix=Buffer.alloc(4),suffix=Buffer.alloc(4);prefix.writeUInt32BE(padding.length);suffix.writeUInt32BE((crc^0xffffffff)>>>0);
    const large=Buffer.concat([image.subarray(0,image.length-12),prefix,data,suffix,image.subarray(image.length-12)]);
    expect(large.length).toBe(MAX_FILE_SIZE);
    const start=performance.now(),memory=process.memoryUsage().rss;
    const {document}=await add(large,{title:"Limite synthétique 20 Mio"});
    const result=createHash("sha256");
    for(let offset=0;offset<large.length;offset+=CHUNK_SIZE){
      const range=await content(document.id,Math.min(CHUNK_SIZE,large.length-offset),"download",offset);
      expect(range.status).toBe(206);result.update(new Uint8Array(await range.arrayBuffer()));
    }
    expect(result.digest("hex")).toBe(digest(large));
    console.info(JSON.stringify({test:"20MiB real SQL/S3",durationMs:Math.round(performance.now()-start),rssBefore:memory,rssAfter:process.memoryUsage().rss,limit:MAX_FILE_SIZE}));
  },60000);
});



