import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../../src/server/application';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { getFolderAccess, issueGrant, reduceMandate, POLICY_LOCK_KEY } from '../../src/server/permissions/service';
import { createObjectStore, type ObjectStore } from '../../src/server/storage';

describe('normalized folder sharing and mandate boundaries',()=>{
  const config=readServerConfig();
  if(config.environment!=='local' || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??'')) throw new Error('Owned synthetic integration bench required');
  const pool=new Pool({connectionString:config.databaseUrl,max:8}),app=createApplication(pool,config);
  const password='Synthetic access phrase only!';
  const users:{id:string;email:string;cookie:string}[]=[];
  let folderId:string, reference:string;
  function req(path:string,body?:unknown,user=0,method?:string){return new Request(config.origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{origin:config.origin,cookie:users[user]?.cookie??'',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  async function tx<T>(action:(client:PoolClient)=>Promise<T>){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[POLICY_LOCK_KEY]);const result=await action(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async function caps(user:number){return tx(async c=>(await getFolderAccess(c,users[user].id,folderId)).capabilities);}
  async function grant(user:number,capability:string,transmit:string[]=[],authorityId=reference,actor=0,expiresAt:Date|null=null){return tx(c=>issueGrant(c,users[actor].id,folderId,{authorityId,subject:users[user].id,capability,transmit,expiresAt}));}
  async function share(user=1,actor=0,extra:Record<string,unknown>={}){return app.handleSharing(req(`/api/hestia/folders/${folderId}/sharing`,{memberId:users[user].id,export:true,deposit:false,idempotencyKey:randomUUID(),...extra},actor),folderId);}
  async function listing(user=0){return app.handleFolderAccess(req(`/api/hestia/folders/${folderId}/access`,undefined,user),folderId);}
  async function revoke(id:string,user=0){return app.handleRevokeAccess(req(`/api/hestia/folders/${folderId}/access/${id}`,undefined,user,'DELETE'),folderId,id);}
  beforeAll(async()=>{
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();
    await migrateDatabase(pool,config);
    for(let i=0;i<4;i++){const email=`access-${randomUUID()}@example.invalid`;const id=await provisionSyntheticMember(pool,{email,name:['Camille','Alex','Sam','Morgan'][i]+' Synthétique',password,role:i===3?'admin':'member'});users.push({id,email,cookie:''});}
  });
  beforeEach(async()=>{
    await pool.query('UPDATE hestia_member SET active=true WHERE user_id=ANY($1::text[])',[users.map(u=>u.id)]);
    for(const user of users){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(req('/api/auth/sign-in/email',{email:user.email,password}));expect(r.status).toBe(200);user.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
    const r=await app.handleFolders(req('/api/hestia/folders',{name:`Dossier partage synthétique ${randomUUID()}`}));expect(r.status).toBe(201);folderId=(await r.json()).folder.id;
    reference=(await pool.query("SELECT id FROM hestia_grant WHERE folder_id=$1 AND kind='reference'",[folderId])).rows[0].id;
  });
  afterAll(async()=>{await pool.end();});

  it('shares current and future folder content with only selected rights and server provenance',async()=>{
    expect((await share(1,0,{deposit:true})).status).toBe(200);
    expect((await caps(1)).sort()).toEqual(['consulter','déposer','exporter'].sort());
    const rows=(await pool.query('SELECT * FROM hestia_grant WHERE folder_id=$1 AND user_id=$2',[folderId,users[1].id])).rows;
    expect(rows.every(g=>g.kind==='direct' && g.parent_id===null && g.origin==='reference-command')).toBe(true);
    const list=await listing();expect(list.status).toBe(200);const groups=(await list.json()).grants;
    expect(groups.filter((g:{memberId:string})=>g.memberId===users[1].id)).toHaveLength(1);
    expect(groups.find((g:{kind:string})=>g.kind==='reference').canRevoke).toBe(false);
    expect((await listing(1)).status).toBe(404);
    expect((await listing(3)).status).toBe(404);
    expect((await share(2,1)).status).toBe(404);
    expect((await share(2,0,{parent_id:reference})).status).toBe(400);
  });
  it('is idempotent without recreating a withdrawn share and rejects changed request identity',async()=>{
    const idempotencyKey=randomUUID();expect((await share(1,0,{idempotencyKey})).status).toBe(200);expect((await share(1,0,{idempotencyKey})).status).toBe(200);
    const group=(await (await listing()).json()).grants.find((g:{memberId:string})=>g.memberId===users[1].id);
    expect((await revoke(group.id)).status).toBe(200);expect(await caps(1)).toEqual([]);
    expect((await share(1,0,{idempotencyKey})).status).toBe(200);expect(await caps(1)).toEqual([]);
    expect((await share(2,0,{idempotencyKey})).status).toBe(409);
  });
  it('keeps independent grants while cascading a retired mandate and denies peer mandate removal',async()=>{
    const mandate=await grant(1,'administrer',['consulter','exporter','déposer']);
    await grant(1,'consulter');
    expect((await share(2,1)).status).toBe(200);
    const delegated=(await pool.query('SELECT parent_id,kind FROM hestia_grant WHERE folder_id=$1 AND user_id=$2',[folderId,users[2].id])).rows;
    expect(delegated.every(g=>g.kind==='delegated' && g.parent_id===mandate)).toBe(true);
    const independent=await grant(2,'consulter');
    const peer=await grant(3,'administrer',['consulter']);
    expect((await revoke(peer,1)).status).toBe(404);
    expect((await revoke(reference,1)).status).toBe(404);
    expect((await revoke(mandate)).status).toBe(200);
    expect(await caps(2)).toEqual(['consulter']);
    expect((await revoke(independent)).status).toBe(200);expect(await caps(2)).toEqual([]);
  });
  it('requires one genuine authority and prevents self extension through a sharing intermediary',async()=>{
    const mandate=await grant(1,'administrer',['consulter','partager','exporter']);
    await expect(grant(1,'consulter',[],mandate,1)).rejects.toMatchObject({status:404});
    const bridge=await grant(2,'partager',['consulter'],mandate,1);
    await expect(grant(1,'consulter',[],bridge,2)).rejects.toMatchObject({status:404});
    expect((await share(3,2,{export:false})).status).toBe(200);
    const sharingView=await listing(2);expect(sharingView.status).toBe(200);
    expect((await sharingView.json()).grants.every((g:{canRevoke:boolean})=>!g.canRevoke)).toBe(true);
    expect((await share(3,2)).status).toBe(404);
    expect(await caps(1)).toEqual(['administrer']);
    await expect(grant(3,'administrer',[],mandate,1)).rejects.toMatchObject({status:404});
  });
  it('projects recipient combinations without unioning separate export and deposit authorities',async()=>{
    await grant(1,'administrer',['consulter','exporter']);
    await grant(1,'administrer',['consulter','déposer']);
    const result=await app.handleSharing(req(`/api/hestia/folders/${folderId}/sharing`,undefined,1),folderId);
    expect(result.status).toBe(200);const context=await result.json();
    expect(context.canExport).toBeUndefined();expect(context.canDeposit).toBeUndefined();
    expect(context.members.find((m:{id:string})=>m.id===users[2].id)).toMatchObject({canExport:true,canDeposit:true,canExportAndDeposit:false});
    expect((await share(2,1,{export:true,deposit:true})).status).toBe(404);
    expect(await caps(2)).toEqual([]);
    expect((await share(2,1,{export:true,deposit:false})).status).toBe(200);
    expect((await share(2,1,{export:false,deposit:true})).status).toBe(200);
    expect((await caps(2)).sort()).toEqual(['consulter','déposer','exporter'].sort());
  });
  it('projects each recipient options from its permitted lineage rather than actor-wide authority',async()=>{
    const parent=await grant(1,'partager',['consulter','partager','exporter']);
    await grant(2,'partager',['consulter','exporter'],parent,1);
    await grant(2,'partager',['consulter','déposer']);
    const result=await app.handleSharing(req(`/api/hestia/folders/${folderId}/sharing`,undefined,2),folderId);
    expect(result.status).toBe(200);const context=await result.json();
    expect(context.members.find((m:{id:string})=>m.id===users[1].id)).toMatchObject({canExport:false,canDeposit:true,canExportAndDeposit:false});
    expect(context.members.find((m:{id:string})=>m.id===users[3].id)).toMatchObject({canExport:true,canDeposit:true,canExportAndDeposit:false});
    expect((await share(1,2,{export:true,deposit:false})).status).toBe(404);
    expect((await share(1,2,{export:false,deposit:true})).status).toBe(200);
  });
  it('reports a surviving independent deposit after withdrawing reading and exporting',async()=>{
    const deposit=await grant(1,'déposer');expect((await share(1)).status).toBe(200);
    const groups=(await (await listing()).json()).grants;
    const shareGroup=groups.find((g:{memberId:string;capabilities:string[]})=>g.memberId===users[1].id && g.capabilities.includes('consulter'));
    const removed=await revoke(shareGroup.id);expect(removed.status).toBe(200);expect((await removed.json()).remainingAccess).toBe(true);
    expect(await caps(1)).toEqual(['déposer']);
    const final=await revoke(deposit);expect(final.status).toBe(200);expect((await final.json()).remainingAccess).toBe(false);
  });
  it('clips nested envelopes and expiry on reduction without expanding retained powers',async()=>{
    const expires=new Date(Date.now()+60_000),mandate=await grant(1,'administrer',['consulter','partager','exporter'],reference,0,expires);
    const bridge=await grant(2,'partager',['consulter','exporter'],mandate,1,expires);
    await grant(3,'consulter',[],bridge,2,expires);await grant(3,'exporter',[],bridge,2,expires);
    await tx(c=>reduceMandate(c,users[0].id,folderId,{grantId:mandate,transmit:['partager','exporter']}));
    expect(await caps(3)).toEqual(['exporter']);
    await expect(tx(c=>reduceMandate(c,users[0].id,folderId,{grantId:mandate,transmit:['consulter','partager','exporter']}))).rejects.toMatchObject({status:400});
    await tx(c=>reduceMandate(c,users[0].id,folderId,{grantId:mandate,expiresAt:new Date(0)}));
    expect(await caps(3)).toEqual([]);
  });
  it('filters access listings and revokes only the local administration envelope',async()=>{
    await grant(1,'administrer',['consulter']);expect((await share(2)).status).toBe(200);
    const groups=(await (await listing(1)).json()).grants;
    expect(groups.filter((g:{memberId:string})=>g.memberId!==users[1].id).every((g:{capabilities:string[]})=>g.capabilities.every(c=>c==='consulter'))).toBe(true);
    expect(groups.filter((g:{memberId:string})=>g.memberId===users[1].id).every((g:{canRevoke:boolean})=>!g.canRevoke)).toBe(true);
    const read=groups.find((g:{memberId:string})=>g.memberId===users[2].id);
    expect((await revoke(read.id,1)).status).toBe(200);expect(await caps(2)).toEqual(['exporter']);
  });
  it('prevents rewriting grant provenance into a cycle',async()=>{
    const first=await grant(1,'partager',['consulter','partager']),second=await grant(2,'partager',['consulter','partager'],first,1);
    await grant(3,'consulter',[],second,2);
    await expect(pool.query("UPDATE hestia_grant SET kind='delegated',parent_id=$2 WHERE id=$1",[first,second])).rejects.toMatchObject({code:'23514'});
    expect(await caps(3)).toEqual(['consulter']);
  });
  it('matches the policy.mjs oracle for delegated authority and mandate reduction',async()=>{
    const oraclePath=pathToFileURL(`${process.cwd()}/harness/spikes/issue-2-identity/policy.mjs`).href;
    const {createPolicyHarness}=await import(oraclePath);
    const baseline=(await pool.query('SELECT * FROM hestia_grant WHERE folder_id=$1',[folderId])).rows;
    const oracle=createPolicyHarness({members:users.map(u=>({id:u.id,active:true,role:'member'})),folders:[{id:folderId,kind:'shared',state:'active',referenceGrantId:reference}],resources:[{id:'oracle-document',folderId,content:'synthetic',title:'synthetic'}],
      grants:baseline.map(g=>({id:g.id,folderId,subject:g.user_id,capability:g.capability,kind:g.kind,parent:g.parent_id,transmit:g.transmit,lineage:g.lineage,expiresAt:null}))});
    const rootSession=oracle.sessionFor(users[0].id),delegateSession=oracle.sessionFor(users[1].id);
    const issued=oracle.execute(rootSession,{operation:'O09',action:'create',folderId,subject:users[1].id,transmit:['consulter','exporter']});
    expect(issued.allowed).toBe(true);
    const mandate=await grant(1,'administrer',['consulter','exporter']);
    for(const capability of ['consulter','exporter']) {
      expect(oracle.execute(delegateSession,{operation:'O08',folderId,authorityId:issued.grantId,subject:users[2].id,capability}).allowed).toBe(true);
      await grant(2,capability,[],mandate,1);
    }
    const beneficiary=oracle.sessionFor(users[2].id);
    expect(oracle.execute(beneficiary,{operation:'O01',resourceId:'oracle-document'}).allowed).toBe((await caps(2)).includes('consulter'));
    expect(oracle.execute(delegateSession,{operation:'O08',folderId,authorityId:issued.grantId,subject:users[2].id,capability:'supprimer'}).allowed).toBe(false);
    await expect(grant(2,'supprimer',[],mandate,1)).rejects.toMatchObject({status:404});
    expect(oracle.execute(rootSession,{operation:'O09',action:'reduce',folderId,grantId:issued.grantId,transmit:['exporter']}).allowed).toBe(true);
    await tx(c=>reduceMandate(c,users[0].id,folderId,{grantId:mandate,transmit:['exporter']}));
    const policyAfter=oracle.snapshot();
    expect(policyAfter.grants.find((g:{id:string})=>g.id===issued.grantId).transmit).toEqual(['exporter']);
    expect(await caps(2)).toEqual(['exporter']);
    expect(oracle.execute(beneficiary,{operation:'O01',resourceId:'oracle-document'}).allowed).toBe((await caps(2)).includes('consulter'));
    expect(oracle.execute(beneficiary,{operation:'O07',resourceId:'oracle-document'}).allowed).toBe(false);
  });
  it('invalidates departing mandate holder permanently while independent reference-issued rights survive author departure',async()=>{
    const mandate=await grant(1,'administrer',['consulter']);await grant(2,'consulter',[],mandate,1);await grant(3,'consulter');
    await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[users[1].id]);expect(await caps(2)).toEqual([]);
    await pool.query('UPDATE hestia_member SET active=true WHERE user_id=$1',[users[1].id]);expect(await caps(2)).toEqual([]);
    await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[users[0].id]);expect(await caps(3)).toEqual(['consulter']);
  });
  it('cuts preview and export after ancestor revocation during real S3 reads, and denies the next portion',async()=>{
    const real=createObjectStore();let onRead:(()=>Promise<void>)|undefined;
    const store:ObjectStore={put:(...args)=>real.put(...args),delete:(...args)=>real.delete(...args),async getRange(...args){const bytes=await real.getRange(...args);await onRead?.();return bytes;}};
    const instance=createApplication(pool,config,{store}),bytes=await readFile('tests/fixtures/documents/synthetic.png');
    const start=await instance.handleUploads(req('/api/hestia/uploads',{folderId,idempotencyKey:randomUUID(),fileName:'synthetic.png',title:'Synthetic',size:bytes.length,mediaType:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),source:'import'}));
    expect(start.status).toBe(201);const uploadId=(await start.json()).operation.id;
    const chunk=new Request(config.origin+'/api/hestia/uploads/'+uploadId+'/chunks/0',{method:'PUT',headers:{origin:config.origin,cookie:users[0].cookie,'content-type':'application/octet-stream'},body:new Uint8Array(bytes)});
    expect((await instance.handleUploadChunk(chunk,uploadId,'0')).status).toBe(200);
    const completed=await instance.handleUploadComplete(req('/api/hestia/uploads/'+uploadId+'/complete',{keepDuplicate:false}),uploadId);
    expect(completed.status).toBe(200);const document=(await completed.json()).document;
    for(const intent of ['preview','download']){
      const mandate=await grant(1,'administrer',['consulter','exporter']);expect((await share(2,1)).status).toBe(200);
      const contentRequest=()=>req(`/api/hestia/documents/${document.id}/content?intent=${intent}&offset=0&length=${bytes.length}`,undefined,2);
      expect((await instance.handleDocumentContent(contentRequest(),document.id)).status).toBe(206);
      onRead=async()=>{onRead=undefined;expect((await revoke(mandate)).status).toBe(200);};
      expect((await instance.handleDocumentContent(contentRequest(),document.id)).status).toBe(404);
      expect((await instance.handleDocumentContent(contentRequest(),document.id)).status).toBe(404);
    }
  });
  it('refuses document publication when the deposit mandate is revoked during original storage',async()=>{
    const mandate=await grant(1,'administrer',['consulter','déposer']);expect((await share(2,1,{export:false,deposit:true})).status).toBe(200);
    const real=createObjectStore();let committedRevocation=false;
    const store:ObjectStore={getRange:(...args)=>real.getRange(...args),delete:(...args)=>real.delete(...args),async put(key,bytes,type){await real.put(key,bytes,type);if(key.startsWith('originals/')){expect((await revoke(mandate)).status).toBe(200);committedRevocation=true;}}};
    const instance=createApplication(pool,config,{store}),bytes=await readFile('tests/fixtures/documents/synthetic.png');
    const start=await instance.handleUploads(req('/api/hestia/uploads',{folderId,idempotencyKey:randomUUID(),fileName:'synthetic.png',title:'Synthetic',size:bytes.length,mediaType:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),source:'import'},2));
    expect(start.status).toBe(201);const uploadId=(await start.json()).operation.id;
    const chunk=new Request(config.origin+'/api/hestia/uploads/'+uploadId+'/chunks/0',{method:'PUT',headers:{origin:config.origin,cookie:users[2].cookie,'content-type':'application/octet-stream'},body:new Uint8Array(bytes)});
    expect((await instance.handleUploadChunk(chunk,uploadId,'0')).status).toBe(200);
    const completed=await instance.handleUploadComplete(req('/api/hestia/uploads/'+uploadId+'/complete',{keepDuplicate:false},2),uploadId);
    expect(committedRevocation).toBe(true);expect(completed.status).toBe(404);
    expect((await pool.query('SELECT id FROM hestia_document WHERE folder_id=$1',[folderId])).rowCount).toBe(0);
  });
  it('serializes an actual SQL membership departure behind the active authorization transaction',async()=>{
    const mandate=await grant(1,'administrer',['consulter']);await grant(2,'consulter',[],mandate,1);
    const reader=await pool.connect(),writer=await pool.connect();
    try {
      await reader.query('BEGIN');expect((await getFolderAccess(reader,users[2].id,folderId)).capabilities).toEqual(['consulter']);
      const pid=Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const departure=writer.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[users[1].id]);
      let blocked=false;
      for(let i=0;i<100;i++){const row=(await pool.query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(row?.wait_event==='advisory'){blocked=true;break;}await new Promise(r=>setTimeout(r,5));}
      expect(blocked).toBe(true);await reader.query('COMMIT');await departure;
      expect(await caps(2)).toEqual([]);
    } finally {await reader.query('ROLLBACK');reader.release();writer.release();}
  });
});
