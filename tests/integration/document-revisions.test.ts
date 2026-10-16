import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { createApplication } from '../../src/server/application';
import { createAccess } from '../../src/server/access';
import { createAuth } from '../../src/server/auth/options';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { createObjectStore, type ObjectStore } from '../../src/server/storage';
import { createStorageBudget } from '../../src/server/storage/quota';
import { createRevisionsService, promoteInboxContent } from '../../src/server/documents/revisions';
import { issueGrant } from '../../src/server/permissions/service';

describe('immutable document revisions over isolated PostgreSQL and S3', () => {
  const config = readServerConfig();
  if (config.environment !== 'local' || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? '')) throw new Error('Owned synthetic integration bench required');
  const pool = new Pool({connectionString:config.databaseUrl,max:8}), realStore = createObjectStore();
  let fixedNow:Date|undefined, getHook:(()=>Promise<void>)|undefined, failDelete=false;
  const store:ObjectStore = { put:(...args)=>realStore.put(...args), async getRange(...args){const bytes=await realStore.getRange(...args);await getHook?.();return bytes;},
    async delete(key){if(failDelete)throw new Error('synthetic delete failure');await realStore.delete(key);} };
  const access=createAccess(pool,config,createAuth(pool,config)), budget=createStorageBudget();
  const app=createApplication(pool,config,{store,now:()=>fixedNow??new Date()});
  const revisions=createRevisionsService(pool,access,{store,budget,now:()=>fixedNow??new Date()});
  const users:{id:string;email:string;cookie:string}[]=[], password='Synthetic revisions password only!';
  let folderId:string,image:Buffer;
  const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  function req(body?:unknown,user=0,path='/api/hestia/documents') {
    const headers=new Headers({origin:config.origin,cookie:users[user]?.cookie??''});
    if(body!==undefined)headers.set('content-type',body instanceof Uint8Array?'application/octet-stream':'application/json');
    return new Request(config.origin+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});
  }
  async function body<T=Record<string,unknown>>(result:Response,status=200):Promise<T>{const data=await result.json();expect(result.status,JSON.stringify(data)).toBe(status);return data as T;}
  async function login(index:number){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const result=await app.handleAuth(req({email:users[index].email,password},index,'/api/auth/sign-in/email'));expect(result.status).toBe(200);users[index].cookie=result.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
  async function newContent(bytes:Uint8Array=image,user=0){
    const id=randomUUID(),key=`originals/${randomUUID()}`;
    await access.transaction(async client=>{await budget.assertAdditional(client,[{ownerId:users[user].id,bytes:bytes.length}]);
      await client.query(`INSERT INTO hestia_content(id,object_key,owner_id,size,sha256,media_type,file_name,preview_supported)
        VALUES($1,$2,$3,$4,$5,'image/png','Original synthétique.png',true)`,[id,key,users[user].id,bytes.length,hash(bytes)]);});
    await store.put(key,bytes,'image/png');return {id,key,size:bytes.length};
  }
  async function promote(contentId:string,documentId?:string,version?:number,user=0,selectedBudget=budget){
    return access.withActor(req(undefined,user),async(client,actor)=>{
      if(fixedNow)await client.query("SELECT set_config('hestia.revision_now',$1,true)",[fixedNow.toISOString()]);
      return promoteInboxContent(client,actor,{contentId,folderId,title:'Document synthétique',documentId,documentVersion:version},selectedBudget);
    });
  }
  async function pair(){const firstContent=await newContent(),first=await promote(firstContent.id);const secondContent=await newContent();
    const second=await promote(secondContent.id,first.documentId,first.version);return {firstContent,first,secondContent,second};}
  const restore=(id:string,rid:string,version:number,idempotencyKey=randomUUID(),user=0)=>revisions.handleDocumentRevisionRestore(req({version,idempotencyKey},user),id,rid);
  async function usage(ownerId=users[0].id){const client=await pool.connect();try{return await budget.usage(client,ownerId);}finally{client.release();}}
  beforeAll(async()=>{
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);
    for(let i=0;i<2;i++){const email=`revision-${randomUUID()}@example.invalid`;users.push({id:await provisionSyntheticMember(pool,{email,name:`Révision synthétique ${i}`,password}),email,cookie:''});await login(i);}
    image=await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer();
  });
  beforeEach(async()=>{fixedNow=new Date();folderId=(await body<{folder:{id:string}}>(await app.handleFolders(req({name:`Versions ${randomUUID()}`})),201)).folder.id;});
  afterEach(async()=>{getHook=undefined;failDelete=false;fixedNow=undefined;await pool.query('UPDATE hestia_member SET active=true,recovering=false WHERE user_id=ANY($1::text[])',[users.map(u=>u.id)]);for(let i=0;i<users.length;i++)await login(i);});
  afterAll(()=>pool.end());

  it('publishes every real original separately, preserves target identity and creates immutable revisions',async()=>{
    const {first,firstContent,second,secondContent}=await pair();
    expect(second.documentId).toBe(first.documentId);expect(second.version).toBe(first.version+1);expect(second.revisionId).not.toBe(first.revisionId);
    const result=await body<{versions:{id:string;current:boolean;recoverableUntil:string|null}[]}>(await revisions.handleDocumentVersions(req(),first.documentId));
    expect(result.versions).toHaveLength(2);expect(result.versions.find(v=>v.id===first.revisionId)?.recoverableUntil).toBe(new Date(fixedNow!.getTime()+168*3600000).toISOString());
    expect(result.versions.find(v=>v.current)?.id).toBe(second.revisionId);
    await expect(pool.query('UPDATE hestia_content SET sha256=$2 WHERE id=$1',[firstContent.id,'a'.repeat(64)])).rejects.toThrow('immutable content');
    await expect(pool.query('UPDATE hestia_document_revision SET content_id=$2 WHERE id=$1',[first.revisionId,secondContent.id])).rejects.toThrow('immutable revision');
    expect((await pool.query('SELECT owner_id FROM hestia_document WHERE id=$1',[first.documentId])).rows[0].owner_id).toBe(users[0].id);
  });
  it('restores the exact original identity and its summary, keeps the displaced revision recoverable, and retries a lost response once',async()=>{
    const {first,firstContent,second,secondContent}=await pair();
    await pool.query("INSERT INTO hestia_content_summary(content_id,status,text) VALUES($1,'ready','Premier original.') ON CONFLICT(content_id) DO UPDATE SET status='ready',text='Premier original.'",[firstContent.id]);
    await pool.query("INSERT INTO hestia_content_summary(content_id,status,text) VALUES($1,'ready','Deuxième original.') ON CONFLICT(content_id) DO UPDATE SET status='ready',text='Deuxième original.'",[secondContent.id]);
    const key=randomUUID(),before=await usage();
    const restored=await body<{revisionId:string;version:number}>(await restore(first.documentId,first.revisionId,second.version,key));
    expect(restored.revisionId).toBe(first.revisionId);expect(restored.version).toBe(3);
    expect(await body(await restore(first.documentId,first.revisionId,second.version,key))).toEqual(restored);
    expect((await usage()).memberBytes).toBe(before.memberBytes);
    const doc=await body<{document:{revisionId:string;summary:{text:string}}}>(await app.handleDocument(req(),first.documentId));
    expect(doc.document).toMatchObject({revisionId:first.revisionId,summary:{text:'Premier original.'}});
    const listed=await body<{versions:{id:string;summary:{text:string};recoverableUntil:string|null}[]}>(await revisions.handleDocumentVersions(req(),first.documentId));
    expect(listed.versions.find(v=>v.id===second.revisionId)?.summary.text).toBe('Deuxième original.');
    expect(listed.versions.find(v=>v.id===second.revisionId)?.recoverableUntil).toBe(new Date(fixedNow!.getTime()+168*3600000).toISOString());
    expect((await pool.query('SELECT count(*)::int AS n FROM hestia_document_revision WHERE document_id=$1',[first.documentId])).rows[0].n).toBe(2);
    expect((await restore(first.documentId,second.revisionId,3,key)).status).toBe(409);
  });
  it('rejects an old document version without changing contents, revisions or quota',async()=>{
    const {first,second}=await pair(),before=await usage();
    expect((await restore(first.documentId,first.revisionId,first.version)).status).toBe(409);
    expect((await pool.query('SELECT current_revision_id,version FROM hestia_document WHERE id=$1',[first.documentId])).rows[0]).toEqual({current_revision_id:second.revisionId,version:second.version});
    expect(await usage()).toEqual(before);
  });
  it('refuses at the exact 168-hour boundary and never purges the current revision',async()=>{
    const {first,firstContent,secondContent}=await pair();fixedNow=new Date(fixedNow!.getTime()+168*3600000);
    expect((await restore(first.documentId,first.revisionId,2)).status).toBe(404);
    const listed=await body<{versions:{id:string;expired:boolean;canDownload:boolean;canRestore:boolean;fileName?:string;sha256?:string;summary:{status:string}}[]}>(await revisions.handleDocumentVersions(req(),first.documentId));
    const expired=listed.versions.find(v=>v.id===first.revisionId);expect(expired).toMatchObject({expired:true,canDownload:false,canRestore:false,summary:{status:'unavailable'}});
    expect(expired).not.toHaveProperty('fileName');expect(expired).not.toHaveProperty('sha256');
    await revisions.cleanupVersions(100,100);
    expect((await pool.query('SELECT deleted_at FROM hestia_content WHERE id=$1',[firstContent.id])).rows[0].deleted_at).not.toBeNull();
    expect((await pool.query('SELECT deleted_at FROM hestia_content WHERE id=$1',[secondContent.id])).rows[0].deleted_at).toBeNull();
  });
  it('keeps current and recoverable revisions accessible after more than one thousand expired tombstones',async()=>{
    const {first,second}=await pair();
    await pool.query(`WITH ids AS (SELECT gen_random_uuid() AS id FROM generate_series(1,1001)),
      contents AS (INSERT INTO hestia_content(id,object_key,owner_id,size,sha256,media_type,file_name,preview_supported,created_at,deleted_at)
      SELECT id,'expired-history/'||id,$1,1,repeat('a',64),'application/octet-stream',NULL,false,'2020-01-01','2020-01-09' FROM ids RETURNING id)
      INSERT INTO hestia_document_revision(document_id,content_id,created_at,recoverable_until)
      SELECT $2,id,'2020-01-01','2020-01-08' FROM contents`,[users[0].id,first.documentId]);
    for(let pass=0;pass<2;pass++){
      const listed=await body<{versions:{id:string;current:boolean;expired:boolean;canDownload:boolean;canRestore:boolean;fileName?:string}[]}>(await revisions.handleDocumentVersions(req(),first.documentId));
      expect(listed.versions).toHaveLength(102);
      expect(listed.versions.find(v=>v.id===second.revisionId)).toMatchObject({current:true,expired:false,canDownload:true});
      expect(listed.versions.find(v=>v.id===first.revisionId)).toMatchObject({current:false,expired:false,canDownload:true,canRestore:true});
      const expired=listed.versions.filter(v=>v.expired);expect(expired).toHaveLength(100);expect(expired.every(v=>!v.canDownload&&!v.canRestore&&v.fileName===undefined)).toBe(true);
      if(pass===0)await revisions.cleanupVersions(100,100);
    }
    const download=await revisions.handleDocumentRevisionContent(req(undefined,0,`/api/hestia/documents/${first.documentId}/versions/${first.revisionId}/content?offset=0&length=${image.length}`),first.documentId,first.revisionId);
    expect(download.status).toBe(206);expect(hash(new Uint8Array(await download.arrayBuffer()))).toBe(hash(image));
  });
  it('rolls back a restore if its deadline is crossed during the SQL effect',async()=>{
    const {first,second}=await pair(),expiry=fixedNow!.getTime()+168*3600000;
    const before=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[first.documentId])).rows[0];
    let reads=0;
    const crossing=createRevisionsService(pool,access,{store,budget,now:()=>new Date(++reads<3?expiry-1:expiry)});
    const key=randomUUID();
    expect((await crossing.handleDocumentRevisionRestore(req({version:second.version,idempotencyKey:key}),first.documentId,first.revisionId)).status).toBe(404);
    expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[first.documentId])).rows[0]).toEqual(before);
    expect((await pool.query('SELECT 1 FROM hestia_revision_operation WHERE idempotency_key=$1',[key])).rowCount).toBe(0);
  });
  it('retains charge after delete failure, prevents restore during purge, and reconciles a retry',async()=>{
    const {first,firstContent}=await pair();fixedNow=new Date(fixedNow!.getTime()+168*3600000);const before=await usage();failDelete=true;
    expect((await revisions.cleanupVersions(100,100)).failed).toBeGreaterThan(0);expect(await usage()).toEqual(before);
    expect((await pool.query('SELECT purge_pending_at FROM hestia_content WHERE id=$1',[firstContent.id])).rows[0].purge_pending_at).not.toBeNull();
    fixedNow=new Date(fixedNow.getTime()-1000);expect((await restore(first.documentId,first.revisionId,2)).status).toBe(404);
    fixedNow=new Date(fixedNow.getTime()+1000);failDelete=false;await revisions.cleanupVersions(100,100);
    expect((await usage()).memberBytes).toBeLessThan(before.memberBytes);
  });
  it('protects recoverable originals from legacy upload cleanup and counts both versions once',async()=>{
    const before=await usage(),{firstContent,secondContent}=await pair(),after=await usage();
    expect(after.memberBytes-before.memberBytes).toBe(firstContent.size+secondContent.size);
    await app.cleanupUploads(100);
    for(const c of [firstContent,secondContent]){expect((await pool.query('SELECT deleted_at FROM hestia_content WHERE id=$1',[c.id])).rows[0].deleted_at).toBeNull();expect(await store.getRange(c.key,0,0)).toHaveLength(1);}
    // This shared bench may also reconcile other suites' unreferenced chunks.
    // Our member charge and both original identities must remain unchanged.
    expect((await usage()).memberBytes).toBe(after.memberBytes);
  });
  it('reserves the extra physical upload copy before writing it and releases chunks only after confirmed deletion',async()=>{
    const before=await usage();
    const limited=createApplication(pool,config,{store,limits:{memberBytes:before.memberBytes+image.length}});
    const created=await body<{operation:{id:string}}>(await limited.handleUploads(req({folderId,idempotencyKey:randomUUID(),fileName:'Upload synthétique.png',title:'Copie temporaire',size:image.length,mediaType:'image/png',sha256:hash(image),source:'import'})),201);
    const id=created.operation.id;
    expect((await limited.handleUploadChunk(new Request(req(image),{method:'PUT'}),id,'0')).status).toBe(200);
    const denied=await limited.handleUploadComplete(req({keepDuplicate:false}),id);
    expect(denied.status).toBe(413);expect((await denied.json()).error.code).toBe('QUOTA_EXCEEDED');
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_upload_object WHERE upload_id=$1 AND kind='original'",[id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM hestia_upload_object WHERE upload_id=$1 AND kind='chunk' AND deleted_at IS NULL",[id])).rows[0].n).toBe(1);
    expect((await app.handleUploadComplete(req({keepDuplicate:false}),id)).status).toBe(200);
    expect((await usage()).memberBytes-before.memberBytes).toBe(image.length*2);
    await app.cleanupUploads(100,1100);
    expect((await usage()).memberBytes-before.memberBytes).toBe(image.length);
  });
  it('revokes download after remote I/O and bounds byte responses',async()=>{
    const {first,firstContent}=await pair();
    const request=()=>req(undefined,0,`/api/hestia/documents/${first.documentId}/versions/${first.revisionId}/content?offset=0&length=${image.length}`);
    const downloaded=await revisions.handleDocumentRevisionContent(request(),first.documentId,first.revisionId);
    expect(downloaded.status).toBe(206);expect(downloaded.headers.get('cache-control')).toBe('private, no-store');expect(downloaded.headers.get('content-disposition')).toContain('attachment;');
    expect(hash(new Uint8Array(await downloaded.arrayBuffer()))).toBe(hash(image));
    getHook=async()=>{await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[users[0].id]);};
    expect((await revisions.handleDocumentRevisionContent(request(),first.documentId,first.revisionId)).status).toBe(401);
    expect((await pool.query('SELECT deleted_at FROM hestia_content WHERE id=$1',[firstContent.id])).rows[0].deleted_at).toBeNull();
  });
  it('requires Exporter for historical downloads and Modifier for restore',async()=>{
    const {first}=await pair();
    const authority=(await pool.query("SELECT id FROM hestia_grant WHERE folder_id=$1 AND user_id=$2 AND kind='reference' AND capability='administrer'",[folderId,users[0].id])).rows[0].id;
    await access.transaction(client=>issueGrant(client,users[0].id,folderId,{authorityId:authority,subject:users[1].id,capability:'consulter'}));
    expect((await revisions.handleDocumentVersions(req(undefined,1),first.documentId)).status).toBe(200);
    expect((await revisions.handleDocumentRevisionContent(req(undefined,1,`/content?offset=0&length=1`),first.documentId,first.revisionId)).status).toBe(404);
    expect((await restore(first.documentId,first.revisionId,2,randomUUID(),1)).status).toBe(404);
  });
  it('rejects a quota transfer atomically and preserves the private arrival and target',async()=>{
    const {first,second}=await pair(),content=await newContent(image,1),before=await usage();
    const authority=(await pool.query("SELECT id FROM hestia_grant WHERE folder_id=$1 AND user_id=$2 AND kind='reference' AND capability='administrer'",[folderId,users[0].id])).rows[0].id;
    for(const capability of ['consulter','modifier'])await access.transaction(client=>issueGrant(client,users[0].id,folderId,{authorityId:authority,subject:users[1].id,capability}));
    await expect(promote(content.id,first.documentId,second.version,1,createStorageBudget(1,4*1024**3))).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
    expect((await pool.query('SELECT owner_id FROM hestia_content WHERE id=$1',[content.id])).rows[0].owner_id).toBe(users[1].id);
    expect((await pool.query('SELECT current_revision_id FROM hestia_document WHERE id=$1',[first.documentId])).rows[0].current_revision_id).toBe(second.revisionId);
    expect(await usage()).toEqual(before);
    const senderBefore=await usage(users[1].id);
    const promoted=await promote(content.id,first.documentId,second.version,1);
    expect(promoted.documentId).toBe(first.documentId);
    expect((await pool.query('SELECT owner_id FROM hestia_content WHERE id=$1',[content.id])).rows[0].owner_id).toBe(users[0].id);
    expect((await usage()).memberBytes).toBe(before.memberBytes+content.size);
    expect((await usage(users[1].id)).memberBytes).toBe(senderBefore.memberBytes-content.size);
    expect((await usage()).totalBytes).toBe(before.totalBytes);
  });
  it('renames without creating a new revision and hides every revision while the document is trashed',async()=>{
    const content=await newContent(),document=await promote(content.id);
    const renamed=await app.handleDocument(new Request(config.origin+'/api/hestia/documents',{method:'PATCH',headers:{origin:config.origin,cookie:users[0].cookie,'content-type':'application/json'},body:JSON.stringify({title:'Titre modifié',version:1})}),document.documentId);
    expect(renamed.status).toBe(200);expect((await pool.query('SELECT count(*)::int AS n FROM hestia_document_revision WHERE document_id=$1',[document.documentId])).rows[0].n).toBe(1);
    expect((await app.handleDocumentTrash(req({version:2}),document.documentId)).status).toBe(200);
    expect((await revisions.handleDocumentVersions(req(),document.documentId)).status).toBe(404);
    expect((await restore(document.documentId,document.revisionId,3)).status).toBe(404);
  });
});
