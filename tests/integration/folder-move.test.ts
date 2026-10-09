import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import sharp from 'sharp';
import { createApplication } from '../../src/server/application';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { issueGrant, POLICY_LOCK_KEY } from '../../src/server/permissions/service';
import type { MoveInput } from '../../src/server/documents/moves';
import { createObjectStore } from '../../src/server/storage';

describe('atomic folder and document placement with real sessions, SQL and original storage',()=>{
  const config=readServerConfig();
  if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic bench required');
  const pool=new Pool({connectionString:config.databaseUrl,max:8}),app=createApplication(pool,config,{store:createObjectStore()});
  const users:{id:string;email:string;cookie:string}[]=[],password='Synthetic move phrase only!';
  let root:string,reference:string,left:string,right:string,source:string,image:Buffer;
  function req(path:string,body?:unknown,user=0,method?:string){return new Request(config.origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{origin:config.origin,cookie:users[user]?.cookie??'',...(body===undefined?{}:{'content-type':body instanceof Uint8Array?'application/octet-stream':'application/json'})},...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});}
  async function tx<T>(action:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock($1)',[POLICY_LOCK_KEY]);const result=await action(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function folder(name:string,parentId:string|null=root,user=0){const r=await app.handleFolders(req('/api/hestia/folders',{name,parentId,idempotencyKey:randomUUID()},user));expect(r.status).toBe(201);return (await r.json()).folder.id as string;}
  const grant=(user:number,capability:string,folderId=root)=>tx(c=>issueGrant(c,users[0].id,folderId,{authorityId:reference,subject:users[user].id,capability}));
  const preview=(body:MoveInput,user=0,instance=app)=>instance.handleMovePreview(req('/api/hestia/move-preview',body,user));
  const move=(body:MoveInput&{previewToken:string;idempotencyKey:string},user=0,instance=app)=>instance.handleMove(req('/api/hestia/moves',body,user));
  const input=():MoveInput=>({kind:'folder',sourceId:source,destinationId:right});
  async function prepared(body=input(),user=0,instance=app){const r=await preview(body,user,instance);expect(r.status).toBe(200);const p=await r.json();expect(p.allowed,JSON.stringify(p)).toBe(true);return {...body,previewToken:p.previewToken as string,idempotencyKey:randomUUID()};}
  async function row(id=source){return (await pool.query('SELECT * FROM hestia_folder WHERE id=$1',[id])).rows[0];}
  async function document(folderId=source,title='Original synthétique'){
    const sha256=createHash('sha256').update(image).digest('hex');
    const begin=await app.handleUploads(req('/api/hestia/uploads',{folderId,idempotencyKey:randomUUID(),fileName:'original.png',title,size:image.length,mediaType:'image/png',sha256,source:'import'}));
    expect(begin.status).toBe(201);const id=(await begin.json()).operation.id;
    expect((await app.handleUploadChunk(req(`/api/hestia/uploads/${id}/chunks/0`,image,0,'PUT'),id,'0')).status).toBe(200);
    const end=await app.handleUploadComplete(req(`/api/hestia/uploads/${id}/complete`,{keepDuplicate:true}),id);expect(end.status).toBe(200);return (await end.json()).document.id as string;
  }
  async function original(id:string){const r=await app.handleDocumentContent(req(`/api/hestia/documents/${id}/content?offset=0&length=${image.length}&intent=download`),id);expect(r.status).toBe(206);return Buffer.from(await r.arrayBuffer());}
  beforeAll(async()=>{
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);
    for(let n=0;n<3;n++){const email=`move-${randomUUID()}@example.invalid`;users.push({email,id:await provisionSyntheticMember(pool,{email,name:`Déplacement synthétique ${n}`,password}),cookie:''});}
    image=await sharp({create:{width:4,height:4,channels:3,background:'#123456'}}).png().toBuffer();
  });
  beforeEach(async()=>{
    for(const user of users){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(req('/api/auth/sign-in/email',{email:user.email,password}));expect(r.status).toBe(200);user.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
    root=await folder(`Move ${randomUUID()}`,null);reference=(await row(root)).reference_grant_id;
    left=await folder('Branche A');right=await folder('Branche B');source=await folder('À déplacer',left);
  });
  afterAll(async()=>{await pool.end();});
  it('moves the entire subtree without rewriting original, provenance, ownership or independent grants',async()=>{
    const leaf=await folder('Petit enfant',source),doc=await document(leaf);
    await grant(1,'consulter',leaf);
    const oldDoc=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0],oldSource=await row(),oldLeaf=await row(leaf);
    const grants=(await pool.query('SELECT * FROM hestia_grant ORDER BY id')).rows;
    const body=await prepared();expect((await move(body)).status).toBe(200);
    expect(await row()).toEqual({...oldSource,parent_folder_id:right,version:oldSource.version+1,updated_at:expect.any(Date)});
    expect(await row(leaf)).toEqual(oldLeaf);expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0]).toEqual(oldDoc);
    expect((await pool.query('SELECT * FROM hestia_grant ORDER BY id')).rows).toEqual(grants);expect(await original(doc)).toEqual(image);
  });
  it('needs no sharing authority when effective rights remain identical',async()=>{
    await grant(1,'consulter');await grant(1,'modifier');
    const body=await prepared(input(),1);expect((await move(body,1)).status).toBe(200);expect((await row()).parent_folder_id).toBe(right);
    expect((await pool.query('SELECT capability FROM hestia_grant WHERE user_id=$1',[users[1].id])).rows.every(r=>!['partager','administrer'].includes(r.capability))).toBe(true);
  });
  it('requires source and destination rights and reveals no hidden destination name',async()=>{
    await grant(1,'consulter',source);await grant(1,'modifier',source);
    const r=await preview(input(),1);expect(r.status).toBe(200);const p=await r.json();expect(p).toMatchObject({allowed:false,previewToken:null,groups:[]});expect(JSON.stringify(p)).not.toContain('Branche B');
    expect((await preview(input(),2)).status).toBe(404);
    expect((await preview(input(),99)).status).toBe(401);expect((await row()).parent_folder_id).toBe(left);
    const forged=await app.handleMovePreview(req('/api/hestia/move-preview',{...input(),authorityId:reference}));expect(forged.status).toBe(400);
    const crossOrigin=new Request(config.origin+'/api/hestia/move-preview',{method:'POST',headers:{origin:'https://untrusted.invalid',cookie:users[0].cookie,'content-type':'application/json'},body:JSON.stringify(input())});
    expect((await app.handleMovePreview(crossOrigin)).status).toBe(403);
  });
  it('requires document deposit at destination, preserves identity and permits duplicate document titles',async()=>{
    const doc=await document(),other=await document(right);
    await grant(1,'consulter');await grant(1,'modifier');
    const request:MoveInput={kind:'document',sourceId:doc,destinationId:right};
    expect(await (await preview(request,1)).json()).toMatchObject({allowed:false,groups:[]});
    await grant(1,'déposer');const before=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0];
    expect((await move(await prepared(request,1),1)).status).toBe(200);
    expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0]).toEqual({...before,folder_id:right,version:before.version+1});
    expect((await pool.query('SELECT id FROM hestia_document WHERE folder_id=$1',[right])).rows.map(r=>r.id).sort()).toEqual([doc,other].sort());expect(await original(doc)).toEqual(image);
    expect(await (await preview({...request,destinationId:null})).json()).toMatchObject({allowed:false,groups:[]});
  });
  it('refuses self, deep descendant and a silently substituted management anchor',async()=>{
    const leaf=await folder('Descendant',source),unrelated=await folder('Autre cadre',null);
    for(const destinationId of [source,leaf])expect(await (await preview({...input(),destinationId})).json()).toMatchObject({allowed:false,groups:[]});
    for(const destinationId of [unrelated,null])expect(await (await preview({...input(),destinationId})).json()).toMatchObject({allowed:false,refusal:{code:'NO_MANAGEMENT'},groups:[]});
    expect((await row()).parent_folder_id).toBe(left);
  });
  it('requires explicit collision rename with NFC, case and edge spaces but preserves accents',async()=>{
    await folder('  ÉTAGE  ',right);
    expect(await (await preview({...input(),name:'e\u0301tage'})).json()).toMatchObject({allowed:false,collision:true,groups:[]});
    const body=await prepared({...input(),name:'Etage'});expect((await move(body)).status).toBe(200);expect(await row()).toMatchObject({name:'Etage',parent_folder_id:right});
  });
  it('allows root extraction only after explicit bounded management transfer and keeps its attestation',async()=>{
    await grant(1,'consulter');await grant(1,'modifier');
    const review=await app.handleManagementTransfer(req('/api/hestia/test'),source);expect(review.status).toBe(200);const p=await review.json();
    const transfer=await app.handleManagementTransfer(req('/api/hestia/test',{idempotencyKey:randomUUID(),referenceId:p.referenceId,nomineeId:users[1].id,reviewVersion:p.reviewVersion}),source);expect(transfer.status).toBe(200);
    const local=await row(),grants=(await pool.query('SELECT * FROM hestia_grant WHERE folder_id=$1 ORDER BY id',[source])).rows;
    const body=await prepared({...input(),destinationId:null},1);const result=await move(body,1);expect(result.status).toBe(200);expect(await result.json()).toEqual({status:'committed'});
    expect(await row()).toMatchObject({parent_folder_id:null,reference_grant_id:local.reference_grant_id,created_by:users[0].id});
    expect((await pool.query('SELECT * FROM hestia_grant WHERE folder_id=$1 ORDER BY id',[source])).rows).toEqual(grants);
  });
  it('refuses hidden descendant effects neutrally before reporting a management problem',async()=>{
    const hidden=await folder('SECRET DESCENDANT',source);await grant(1,'consulter');await grant(1,'modifier');
    expect((await app.handleFolderRestriction(req('/api/hestia/test',{memberId:users[1].id,capabilities:['consulter'],restricted:true}),hidden)).status).toBe(200);
    for(const destinationId of [right,null]){
      const result=await preview({...input(),destinationId},1);expect(result.status).toBe(200);const p=await result.json();
      expect(p).toMatchObject({allowed:false,groups:[],previewToken:null,refusal:{code:'RIGHTS_UNAVAILABLE'}});
      expect(JSON.stringify(p)).not.toContain('SECRET DESCENDANT');expect(JSON.stringify(p)).not.toContain(hidden);
    }
    expect((await row()).parent_folder_id).toBe(left);
  });
  it('serializes inverse placements without creating a cycle',async()=>{
    const sibling=await folder('Frère',left);
    const first=await prepared({...input(),destinationId:sibling}),second=await prepared({kind:'folder',sourceId:sibling,destinationId:source});
    const results=await Promise.all([move(first),move(second)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const a=await row(),b=await row(sibling);expect(a.parent_folder_id===sibling&&b.parent_folder_id===source).toBe(false);
  });
  it('shows gains and losses before committing and invalidates after a changed grant',async()=>{
    await grant(1,'consulter',left);await grant(2,'consulter',right);
    const p=await (await preview(input())).json();expect(p.allowed).toBe(true);
    expect(p.groups.map((g:{title:string})=>g.title).sort()).toEqual(['Gagnent un accès','Perdent leur accès'].sort());
    expect(JSON.stringify(p.groups)).toContain('Déplacement synthétique 1');
    const body={...input(),previewToken:p.previewToken,idempotencyKey:randomUUID()};await grant(2,'exporter',right);
    expect((await move(body)).status).toBe(409);expect((await row()).parent_folder_id).toBe(left);
    expect((await move(await prepared())).status).toBe(200);
  });
  it('invalidates a preview after descendant content changes even without an access change',async()=>{
    const body=await prepared();await folder('Ajout après aperçu',source);
    expect((await move(body)).status).toBe(409);expect((await row()).parent_folder_id).toBe(left);
    const fresh=await prepared();await document();expect((await move(fresh)).status).toBe(409);
  });
  it('serializes two confirmations and reconciles a lost response without moving twice',async()=>{
    const body=await prepared(),responses=await Promise.all([move(body),move(body)]);expect(responses.map(r=>r.status)).toEqual([200,200]);expect((await row()).version).toBe(2);
    const {idempotencyKey,...check}=body,restarted=createApplication(pool,config);
    const receipt=await restarted.handleMoveOperation(req('/api/hestia/move-operations/'+idempotencyKey,check),idempotencyKey);
    expect(await receipt.json()).toEqual({status:'committed'});
    expect((await move({...body,name:'Corps modifié'})).status).toBe(409);
    expect(await (await app.handleMoveOperation(req('/api/hestia/move-operations/'+idempotencyKey,check,1),idempotencyKey)).json()).toEqual({status:'not-recorded'});
    expect((await pool.query('SELECT * FROM hestia_move_receipt WHERE actor_id=$1 AND idempotency_key=$2',[users[0].id,idempotencyKey])).rowCount).toBe(1);
  });
  it('keeps old receipts minimal after another move and later revocation without replaying placement',async()=>{
    await grant(1,'consulter');await grant(1,'modifier');const first=await prepared(input(),1);expect((await move(first,1)).status).toBe(200);
    expect((await move(await prepared({...input(),destinationId:left}))).status).toBe(200);
    await pool.query('UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2',[root,users[1].id]);
    const repeat=await move(first,1);expect(repeat.status).toBe(200);expect(await repeat.json()).toEqual({status:'committed'});expect((await row()).parent_folder_id).toBe(left);expect((await row()).version).toBe(3);
  });
  it('rolls back placement and version if durable receipt insertion fails',async()=>{
    const body=await prepared(),before=await row();
    await pool.query(`CREATE FUNCTION hestia_test_move_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key='${body.idempotencyKey}'::uuid THEN RAISE EXCEPTION 'synthetic move failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER hestia_test_move_failure BEFORE INSERT ON hestia_move_receipt FOR EACH ROW EXECUTE FUNCTION hestia_test_move_failure()`);
    try{expect((await move(body)).status).toBe(503);expect(await row()).toEqual(before);expect((await pool.query('SELECT * FROM hestia_move_receipt WHERE idempotency_key=$1',[body.idempotencyKey])).rowCount).toBe(0);}
    finally{await pool.query('DROP TRIGGER hestia_test_move_failure ON hestia_move_receipt; DROP FUNCTION hestia_test_move_failure()');}
    expect((await move(body)).status).toBe(200);
  });
  it('uses current time after waiting for the policy lock, never transaction start time',async()=>{
    const grantId=await grant(1,'consulter',left);
    await pool.query("UPDATE hestia_grant SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[grantId]);
    const body=await prepared(),blocker=await pool.connect();let pending:Promise<Response>|undefined;
    try{await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock($1)',[POLICY_LOCK_KEY]);pending=move(body);await blocker.query('SELECT pg_sleep(1.15)');await blocker.query('COMMIT');expect((await pending).status).toBe(409);}
    finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
    expect((await row()).parent_folder_id).toBe(left);
  });
  it('accounts for recoverable deleted content without extending its retention deadline',async()=>{
    const doc=await document();expect((await app.handleDocumentTrash(req(`/api/hestia/documents/${doc}/trash`,{version:1}),doc)).status).toBe(200);
    const before=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0];
    const cutoff=before.trashed_at.getTime()+168*60*60*1000;
    let now=cutoff-1;const timed=createApplication(pool,config,{store:createObjectStore(),now:()=>new Date(now)}),body=await prepared(input(),0,timed);
    now=cutoff;expect((await move(body,0,timed)).status).toBe(409);
    expect((await move(await prepared())).status).toBe(200);
    expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0]).toEqual(before);
    expect((await app.handleDocumentContent(req(`/api/hestia/documents/${doc}/content?offset=0&length=${image.length}&intent=download`),doc)).status).toBe(404);
  });
  it('rechecks the current placement after reading S3 and withholds bytes after the reader loses access',async()=>{
    const doc=await document();await grant(1,'consulter',source);await grant(1,'exporter',source);
    const body=await prepared({kind:'document',sourceId:doc,destinationId:right}),store=createObjectStore();let moved=false;
    const reader=createApplication(pool,config,{store:{...store,async getRange(key,start,end){const bytes=await store.getRange(key,start,end);expect((await move(body)).status).toBe(200);moved=true;return bytes;}}});
    const response=await reader.handleDocumentContent(req(`/api/hestia/documents/${doc}/content?offset=0&length=${image.length}&intent=download`,undefined,1),doc);
    expect(moved).toBe(true);expect(response.status).toBe(404);expect(Buffer.from(await response.arrayBuffer())).not.toEqual(image);expect(await original(doc)).toEqual(image);
  });
  it('retains only a minimal tombstone receipt after purge and refuses it after an actor epoch changes',async()=>{
    const doc=await document();for(const capability of ['consulter','modifier','déposer'])await grant(1,capability);
    const body=await prepared({kind:'document',sourceId:doc,destinationId:right},1);expect((await move(body,1)).status).toBe(200);
    expect((await app.handleDocumentTrash(req(`/api/hestia/documents/${doc}/trash`,{version:2}),doc)).status).toBe(200);
    await pool.query("UPDATE hestia_document SET trashed_at=clock_timestamp()-interval '169 hours' WHERE id=$1",[doc]);await app.cleanupTrash(100);
    const before=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0];expect(before.purged_at).toBeInstanceOf(Date);
    expect(await (await move(body,1)).json()).toEqual({status:'committed'});expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0]).toEqual(before);
    await pool.query('UPDATE hestia_member SET epoch=epoch+1 WHERE user_id=$1',[users[1].id]);
    expect((await move(body,1)).status).toBe(401);
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const login=await app.handleAuth(req('/api/auth/sign-in/email',{email:users[1].email,password}));expect(login.status).toBe(200);
    users[1].cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    expect((await move(body,1)).status).toBe(404);
    const {idempotencyKey,...receiptBody}=body;expect((await app.handleMoveOperation(req('/api/hestia/move-operations/'+idempotencyKey,receiptBody,1),idempotencyKey)).status).toBe(404);
    expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rows[0]).toEqual(before);
  });
});
