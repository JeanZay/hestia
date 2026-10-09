import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import sharp from 'sharp';
import { createApplication } from '../../src/server/application';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { issueGrant, POLICY_LOCK_KEY } from '../../src/server/permissions/service';
import { createObjectStore, type ObjectStore } from '../../src/server/storage';

describe('whole folder trash with real sessions, policy, SQL and S3',()=>{
  const config=readServerConfig();
  if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    ||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic bench required');
  const pool=new Pool({connectionString:config.databaseUrl,max:8}),realStore=createObjectStore();
  let deleteHook:((key:string)=>Promise<void>)|undefined;
  const store:ObjectStore={put:(...args)=>realStore.put(...args),getRange:(...args)=>realStore.getRange(...args),async delete(key){await deleteHook?.(key);await realStore.delete(key);}};
  const app=createApplication(pool,config,{store}),users:{id:string;email:string;cookie:string}[]=[],password='Synthetic trash phrase only!';
  let root:string,source:string,child:string,destination:string,reference:string,image:Buffer;
  function req(path:string,body?:unknown,user=0,method?:string){return new Request(config.origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{origin:config.origin,cookie:users[user]?.cookie??'',...(body===undefined?{}:{'content-type':body instanceof Uint8Array?'application/octet-stream':'application/json'})},...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});}
  async function tx<T>(action:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock($1)',[POLICY_LOCK_KEY]);const result=await action(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function folder(name:string,parentId:string|null=root){const r=await app.handleFolders(req('/api/hestia/folders',{name,parentId,idempotencyKey:randomUUID()}));expect(r.status).toBe(201);return (await r.json()).folder.id as string;}
  const grant=(user:number,capability:string,folderId=root)=>tx(c=>issueGrant(c,users[0].id,folderId,{authorityId:reference,subject:users[user].id,capability}));
  const row=async(id=source)=>(await pool.query('SELECT * FROM hestia_folder WHERE id=$1',[id])).rows[0];
  const groups=async(user=0,instance=app)=>{const r=await instance.handleTrashGroups(req('/api/hestia/trash',undefined,user));expect(r.status).toBe(200);return (await r.json()).groups as {id:string;folderId:string;name:string;restorableUntil:string}[];};
  async function prepareTrash(id=source,user=0,instance=app){const r=await instance.handleFolderTrashPreview(req(`/api/hestia/folders/${id}/trash/preview`,{},user),id);expect(r.status).toBe(200);const p=await r.json();expect(p.allowed,JSON.stringify(p)).toBe(true);return {previewToken:p.previewToken as string,idempotencyKey:randomUUID()};}
  async function trash(id=source,user=0,instance=app){const body=await prepareTrash(id,user,instance);expect((await instance.handleFolderTrash(req(`/api/hestia/folders/${id}/trash`,body,user),id)).status).toBe(200);return {body,group:(await groups(user,instance)).find(g=>g.folderId===id)!};}
  const restorePreview=(id:string,input:Record<string,unknown>={},user=0,instance=app)=>instance.handleFolderRestorePreview(req(`/api/hestia/trash/${id}/restore/preview`,input,user),id);
  async function restore(id:string,input:Record<string,unknown>={},user=0,instance=app){const r=await restorePreview(id,input,user,instance);expect(r.status).toBe(200);const p=await r.json();expect(p.allowed,JSON.stringify(p)).toBe(true);const body={...input,previewToken:p.previewToken,idempotencyKey:randomUUID()};const result=await instance.handleFolderRestore(req(`/api/hestia/trash/${id}/restore`,body,user),id);expect(result.status).toBe(200);return body;}
  async function document(folderId=child){const begin=await app.handleUploads(req('/api/hestia/uploads',{folderId,idempotencyKey:randomUUID(),fileName:'original.png',title:'Original synthétique',size:image.length,mediaType:'image/png',sha256:createHash('sha256').update(image).digest('hex'),source:'import'}));expect(begin.status).toBe(201);const upload=(await begin.json()).operation.id;expect((await app.handleUploadChunk(req(`/api/hestia/uploads/${upload}/chunks/0`,image,0,'PUT'),upload,'0')).status).toBe(200);const end=await app.handleUploadComplete(req(`/api/hestia/uploads/${upload}/complete`,{keepDuplicate:true}),upload);expect(end.status).toBe(200);return (await end.json()).document.id as string;}
  beforeAll(async()=>{expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);for(let n=0;n<3;n++){const email=`trash-${randomUUID()}@example.invalid`;users.push({email,id:await provisionSyntheticMember(pool,{email,name:`Corbeille synthétique ${n}`,password}),cookie:''});}image=await sharp({create:{width:4,height:4,channels:3,background:'#654321'}}).png().toBuffer();});
  beforeEach(async()=>{deleteHook=undefined;for(const u of users){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(req('/api/auth/sign-in/email',{email:u.email,password}));expect(r.status).toBe(200);u.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}root=await folder(`Trash ${randomUUID()}`,null);reference=(await row(root)).reference_grant_id;source=await folder('Dossier à supprimer');child=await folder('Sous-dossier',source);destination=await folder('Autre destination');});
  afterAll(()=>pool.end());
  it('trashes and restores the exact whole group, retaining originals, ownership and grants',async()=>{
    const doc=await document(),before=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0];
    const grants=(await pool.query('SELECT * FROM hestia_grant ORDER BY id')).rows;
    const {group}=await trash();expect(group).toBeTruthy();
    expect((await row()).trashed_at).toBeInstanceOf(Date);expect((await row(child)).trashed_at).toEqual((await row()).trashed_at);
    expect((await app.handleFolder(req(`/api/hestia/folders/${source}`),source)).status).toBe(404);
    expect((await app.handleDocument(req(`/api/hestia/documents/${doc}`),doc)).status).toBe(404);
    expect((await app.handleDocumentRestore(req(`/api/hestia/documents/${doc}/restore`,{version:2}),doc)).status).toBe(404);
    expect((await app.handleDocuments(req('/api/hestia/documents?trash=true')).then(r=>r.json())).documents.some((d:{id:string})=>d.id===doc)).toBe(false);
    await restore(group.id);
    expect((await row()).trashed_at).toBeNull();expect((await row(child)).trashed_at).toBeNull();
    const after=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0];for(const key of ['object_key','owner_id','uploaded_by','sha256','size'])expect(after[key]).toEqual(before[key]);
    expect((await pool.query('SELECT * FROM hestia_grant ORDER BY id')).rows).toEqual(grants);
    const content=await app.handleDocumentContent(req(`/api/hestia/documents/${doc}/content?offset=0&length=${image.length}&intent=download`),doc);expect(content.status).toBe(206);expect(Buffer.from(await content.arrayBuffer())).toEqual(image);
  });
  it('excludes previously trashed groups and individual documents without changing their deadlines',async()=>{
    const oldDoc=await document(source);expect((await app.handleDocumentTrash(req(`/api/hestia/documents/${oldDoc}/trash`,{version:1}),oldDoc)).status).toBe(200);
    const oldDocTime=(await pool.query('SELECT trashed_at FROM hestia_document WHERE id=$1',[oldDoc])).rows[0].trashed_at;
    const older=await trash(child),parent=await trash(source);expect((await groups()).find(g=>g.id===older.group.id)?.restorableUntil).toBe(older.group.restorableUntil);
    await restore(parent.group.id);expect((await row(child)).trashed_at).not.toBeNull();
    expect((await pool.query('SELECT trashed_at FROM hestia_document WHERE id=$1',[oldDoc])).rows[0].trashed_at).toEqual(oldDocTime);
    await restore(older.group.id);expect((await row(child)).trashed_at).toBeNull();
  });
  it('refuses the entire deletion neutrally when a descendant loses a required capability',async()=>{
    await grant(1,'consulter');await grant(1,'supprimer');
    await pool.query("INSERT INTO hestia_folder_restriction(id,folder_id,user_id,capability,authority_grant_id,author_id) VALUES($1,$2,$3,'supprimer',$4,$5)",[randomUUID(),child,users[1].id,reference,users[0].id]);
    const result=await app.handleFolderTrashPreview(req(`/api/hestia/folders/${source}/trash/preview`,{},1),source);expect(result.status).toBe(200);const p=await result.json();expect(p.allowed).toBe(false);expect(p.counts).toBeUndefined();expect(JSON.stringify(p)).not.toContain('Sous-dossier');expect((await row()).trashed_at).toBeNull();
  });
  it('lists only knowable roots without member counts and blocks partial restoration',async()=>{
    await grant(1,'consulter');await grant(1,'supprimer');const {group}=await trash();
    await pool.query("INSERT INTO hestia_folder_restriction(id,folder_id,user_id,capability,authority_grant_id,author_id) VALUES($1,$2,$3,'consulter',$4,$5)",[randomUUID(),child,users[1].id,reference,users[0].id]);
    const visible=(await groups(1)).find(g=>g.id===group.id)!;expect(visible).toBeTruthy();expect(visible).not.toHaveProperty('counts');
    const r=await restorePreview(group.id,{},1);expect(r.status).toBe(200);const p=await r.json();expect(p.allowed).toBe(false);expect(p.counts).toBeUndefined();expect(JSON.stringify(p)).not.toContain('Sous-dossier');
    await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE user_id=$1 AND folder_id=$2 AND capability='consulter'",[users[1].id,root]);expect((await groups(1)).some(g=>g.id===group.id)).toBe(false);expect((await restorePreview(group.id,{},1)).status).toBe(404);
  });
  it('rechecks rights after preview and commits no partial effect',async()=>{
    await grant(1,'consulter');await grant(1,'supprimer');const body=await prepareTrash(source,1);
    await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE user_id=$1 AND folder_id=$2 AND capability='supprimer'",[users[1].id,root]);
    const r=await app.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body,1),source);expect(r.status).not.toBe(200);expect((await row()).trashed_at).toBeNull();expect((await row(child)).trashed_at).toBeNull();
  });
  it('rejects a preview if membership changes before confirmation',async()=>{
    const body=await prepareTrash();await folder('Ajout concurrent',source);
    expect((await app.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body),source)).status).toBe(409);expect((await row()).trashed_at).toBeNull();
  });
  it('restores elsewhere, requires explicit collision rename and never overwrites',async()=>{
    const {group}=await trash();const collision=await folder('Dossier à supprimer',destination);
    const p=await restorePreview(group.id,{destinationId:destination}).then(r=>r.json());expect(p.allowed).toBe(false);
    await restore(group.id,{destinationId:destination,name:'Dossier retrouvé'});expect((await row()).parent_folder_id).toBe(destination);expect((await row()).name).toBe('Dossier retrouvé');expect((await row(collision)).name).toBe('Dossier à supprimer');
  });
  it('offers an alternative when the original parent is trashed and leaves the old parent group untouched',async()=>{
    const {group}=await trash(child);const parent=await trash(source);const p=await restorePreview(group.id).then(r=>r.json());expect(p.allowed).toBe(false);
    await restore(group.id,{destinationId:destination});expect((await row(child)).parent_folder_id).toBe(destination);expect((await row(source)).trashed_at).not.toBeNull();expect((await groups()).find(g=>g.id===parent.group.id)?.restorableUntil).toBe(parent.group.restorableUntil);
  });
  it('includes old group effects in alternative placement without restoring or extending them',async()=>{
    const older=await trash(child),parent=await trash();await restore(parent.group.id,{destinationId:destination});expect((await row(child)).trashed_at).not.toBeNull();expect((await groups()).find(g=>g.id===older.group.id)?.restorableUntil).toBe(older.group.restorableUntil);
  });
  it('closes reads and restore at exactly 168 hours while still available immediately before',async()=>{
    const {group}=await trash(),deadline=new Date(group.restorableUntil).getTime();
    const before=createApplication(pool,config,{store,now:()=>new Date(deadline-1)}),at=createApplication(pool,config,{store,now:()=>new Date(deadline)});
    expect((await groups(0,before)).some(g=>g.id===group.id)).toBe(true);expect((await groups(0,at)).some(g=>g.id===group.id)).toBe(false);expect((await restorePreview(group.id,{},0,at)).status).not.toBe(200);
  });
  it('retains charged originals after deletion failure and purges them on retry',async()=>{
    const doc=await document(),{group}=await trash(),deadline=new Date(group.restorableUntil).getTime();const expired=createApplication(pool,config,{store,now:()=>new Date(deadline+1)});
    const original=(await pool.query('SELECT object_key,size FROM hestia_document WHERE id=$1',[doc])).rows[0];
    deleteHook=async(key)=>{if(key===original.object_key)throw Error('Synthetic deletion interruption');};
    expect((await expired.cleanupTrash(100)).failed).toBeGreaterThan(0);expect((await pool.query('SELECT object_key FROM hestia_document WHERE id=$1',[doc])).rows[0].object_key).toBe(original.object_key);
    deleteHook=undefined;await expired.cleanupTrash(100);expect((await pool.query('SELECT object_key,title,size FROM hestia_document WHERE id=$1',[doc])).rows[0]).toEqual({object_key:null,title:null,size:null});
    expect((await restorePreview(group.id,{},0,expired)).status).not.toBe(200);
  });
  it('records a stable historical result and never repeats deletion after restoration',async()=>{
    const {group,body}=await trash();await restore(group.id);
    expect((await app.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body),source)).status).toBe(200);expect((await row()).trashed_at).toBeNull();
    const receipt=await app.handleTrashOperation(req(`/api/hestia/trash/operations/${body.idempotencyKey}`,{action:'trash',sourceId:source,previewToken:body.previewToken}),body.idempotencyKey);expect(receipt.status).toBe(200);expect(await receipt.json()).toEqual({status:'committed'});
  });
  it('replays no restoration after a new trash cycle and no receipt leaks to another actor',async()=>{
    const first=await trash(),body=await restore(first.group.id);const second=await trash();
    expect((await app.handleFolderRestore(req(`/api/hestia/trash/${first.group.id}/restore`,body),first.group.id)).status).toBe(200);expect((await row()).trashed_at).not.toBeNull();expect((await groups()).some(g=>g.id===second.group.id)).toBe(true);
    const r=await app.handleTrashOperation(req(`/api/hestia/trash/operations/${body.idempotencyKey}`,{action:'restore',sourceId:first.group.id,previewToken:body.previewToken},1),body.idempotencyKey);expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'not-recorded'});
  });
  it('serializes duplicate confirmations and refuses conflicting operation identities',async()=>{
    const body=await prepareTrash();
    const results=await Promise.all([0,1].map(()=>app.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body),source)));
    expect(results.map(r=>r.status)).toEqual([200,200]);expect((await groups()).filter(g=>g.folderId===source)).toHaveLength(1);
    const group=(await groups()).find(g=>g.folderId===source)!;const p=await restorePreview(group.id).then(r=>r.json());const key=randomUUID();
    // A key for a different intention must never commit a second mutation.
    await pool.query('INSERT INTO hestia_trash_receipt(actor_id,idempotency_key,actor_epoch,request_sha256) SELECT $1,$2,epoch,$3 FROM hestia_member WHERE user_id=$1',[users[0].id,key,'0'.repeat(64)]);
    const r=await app.handleFolderRestore(req(`/api/hestia/trash/${group.id}/restore`,{previewToken:p.previewToken,idempotencyKey:key}),group.id);expect(r.status).toBe(409);expect((await row()).trashed_at).not.toBeNull();
  });
  it('cannot confirm an alternative after an older empty group expires without a SQL change',async()=>{
    const older=await trash(child),newer=await trash(source),deadline=new Date(older.group.restorableUntil).getTime();
    let time=deadline-1;const timed=createApplication(pool,config,{store,now:()=>new Date(time)});
    const p=await restorePreview(newer.group.id,{destinationId:destination},0,timed).then(r=>r.json());expect(p.allowed).toBe(true);
    time=deadline;
    const r=await timed.handleFolderRestore(req(`/api/hestia/trash/${newer.group.id}/restore`,{destinationId:destination,previewToken:p.previewToken,idempotencyKey:randomUUID()}),newer.group.id);
    expect(r.status).toBe(409);expect((await row()).trashed_at).not.toBeNull();
  });
  it('keeps receipts after physical purge and refuses metadata or operation replay',async()=>{
    const {group,body}=await trash();const expired=createApplication(pool,config,{store,now:()=>new Date(new Date(group.restorableUntil).getTime()+1)});
    await expired.cleanupTrash(100);expect((await row()).name).toBeNull();expect((await row()).name_key).toBeNull();
    const r=await expired.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body),source);expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'committed'});expect((await row()).name).toBeNull();
    expect((await expired.handleFolder(req(`/api/hestia/folders/${source}`),source)).status).toBe(404);
  });
  it('rolls the complete group back when durable receipt storage fails',async()=>{
    const body=await prepareTrash(),name=`trash_receipt_${randomUUID().replaceAll('-','')}`;
    if(!/^trash_receipt_[a-f0-9]{32}$/.test(name))throw Error('Invalid synthetic trigger name');
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key='${body.idempotencyKey}'::uuid THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$`);
    try{
      await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON hestia_trash_receipt FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      const result=await app.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body),source);expect(result.status).toBe(503);
      expect((await row()).trashed_at).toBeNull();expect((await row(child)).trashed_at).toBeNull();expect((await groups()).some(g=>g.folderId===source)).toBe(false);
    }finally{await pool.query(`DROP TRIGGER IF EXISTS ${name} ON hestia_trash_receipt; DROP FUNCTION ${name}()`);}
    expect((await app.handleFolderTrash(req(`/api/hestia/folders/${source}/trash`,body),source)).status).toBe(200);expect((await groups()).filter(g=>g.folderId===source)).toHaveLength(1);
  });
  it('keeps an opaque expired parent when an independent group remains recoverable',async()=>{
    // Independent group deadlines are authoritative even if server clocks have
    // moved backwards between operations. Never infer expiry from an ancestor.
    const future=createApplication(pool,config,{store,now:()=>new Date(Date.now()+24*60*60*1000)});
    const later=await trash(child,0,future),parent=await trash(source);
    const expired=createApplication(pool,config,{store,now:()=>new Date(new Date(parent.group.restorableUntil).getTime()+1)});
    await expired.cleanupTrash(100);expect((await row(source)).name).toBeNull();expect((await row(child)).name).toBe('Sous-dossier');
    expect((await groups(0,expired)).find(g=>g.id===later.group.id)?.restorableUntil).toBe(later.group.restorableUntil);
    await restore(later.group.id,{destinationId:destination},0,expired);expect((await row(child)).parent_folder_id).toBe(destination);expect((await row(child)).trashed_at).toBeNull();expect((await row(source)).name).toBeNull();
  });
});
