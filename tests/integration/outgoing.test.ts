import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { createApplication } from '../../src/server/application';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { createObjectStore, type ObjectStore } from '../../src/server/storage';
import { outgoingCrypto } from '../../src/server/outgoing/crypto';
import type { OutgoingDependencies } from '../../src/server/outgoing/service';
import type { OutgoingPayload, OutgoingTransportResult } from '../../src/server/outgoing/transport';
import { OUTGOING_LIMITS as L, type OutgoingDraftDto, type OutgoingAvailableDocument } from '../../src/shared/outgoing-contract';
describe('private documentary sending on owned SQL and real local S3',()=>{
  const config=readServerConfig();
  if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic bench required');
  const pool=new Pool({connectionString:config.databaseUrl,max:8}),realStore=createObjectStore();
  let stamp=Date.now(),ticks:number|undefined,getHook:(()=>Promise<void>)|undefined,barrier:OutgoingDependencies['barrier'];
  const store:ObjectStore={put:(...args)=>realStore.put(...args),delete:key=>realStore.delete(key),async getRange(...args){const value=await realStore.getRange(...args);await getHook?.();return value;}};
  const sent:{id:string;payload:string;signal:AbortSignal}[]=[],send=vi.fn(async(input:{id:string;payload:string;signal:AbortSignal}):Promise<OutgoingTransportResult>=>{sent.push(input);return {status:'accepted',providerId:randomUUID()};});
  const make=(enabled=true,syntheticFormat=false)=>createApplication(pool,config,{store,now:()=>new Date(stamp),...(syntheticFormat?{validateOriginal:async()=>({mediaType:'image/png',previewSupported:true})}:{}),outgoing:{monotonic:()=>ticks??performance.now(),barrier:(stage,id)=>barrier?.(stage,id)??Promise.resolve(),...(enabled?{simulation:{enabled:true,sender:'envois@example.invalid',transport:{kind:'simulated',send}}}:{})}});
  let app=make(),actorId:string,cookie:string,otherCookie:string,folderId:string,image:Buffer;
  const email=`outgoing-${randomUUID()}@example.invalid`,otherEmail=`outgoing-admin-${randomUUID()}@example.invalid`,password='Synthetic outgoing phrase only!';
  const req=(body?:unknown,selected=cookie,method=body===undefined?'GET':'POST')=>new Request(config.origin+'/api/hestia/outgoing',{method,headers:{origin:config.origin,cookie:selected,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function login(address:string){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email:address,password})}));expect(r.status).toBe(200);return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
  async function folder(selected=cookie){const r=await app.handleFolders(req({name:'Dossier synthétique '+randomUUID()},selected));expect(r.status).toBe(201);return (await r.json()).folder.id as string;}
  async function upload(name='original.png',title='Document synthétique',bytes=image,target=folderId,selected=cookie):Promise<OutgoingAvailableDocument>{
    const init=await app.handleUploads(req({folderId:target,idempotencyKey:randomUUID(),fileName:name,title,size:bytes.length,mediaType:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),source:'import'},selected));expect(init.status).toBe(201);const id=(await init.json()).operation.id;
    for(let offset=0,index=0;offset<bytes.length;offset+=L.rangeBytes,index++){const r=await app.handleUploadChunk(new Request(config.origin+'/api/hestia/uploads/'+id,{method:'PUT',headers:{origin:config.origin,cookie:selected,'content-type':'application/octet-stream'},body:new Uint8Array(bytes.subarray(offset,offset+L.rangeBytes))}),id,String(index));expect(r.status).toBe(200);}
    const done=await app.handleUploadComplete(req({keepDuplicate:true},selected),id);expect(done.status).toBe(200);const d=(await done.json()).document;
    return {documentId:d.id,documentVersion:d.version,revisionId:d.revisionId,title:d.title,fileName:d.fileName,size:d.size,mediaType:d.mediaType,path:''};
  }
  async function create(selected=cookie){const r=await app.handleOutgoing(req({},selected));expect(r.status).toBe(200);return (await r.json()).draft as OutgoingDraftDto;}
  async function save(d:OutgoingDraftDto,extra:Record<string,unknown>={},selected=cookie){const r=await app.handleOutgoingDraft(req({revision:d.revision,to:['recipient@example.invalid'],subject:'Sujet conservé',message:'Texte\nExact',attachmentIds:d.attachments.map(x=>x.id),...extra},selected,'PATCH'),d.id);expect(r.status).toBe(200);return (await r.json()).draft as OutgoingDraftDto;}
  async function add(d:OutgoingDraftDto,docs:OutgoingAvailableDocument[],selected=cookie){const r=await app.handleOutgoingAttachments(req({revision:d.revision,selections:docs.map(({documentId,documentVersion,revisionId})=>({documentId,documentVersion,revisionId}))},selected),d.id);expect(r.status).toBe(200);return (await r.json()).draft as OutgoingDraftDto;}
  async function prepare(docs:OutgoingAvailableDocument[],selected=cookie){return save(await add(await create(selected),docs,selected),{},selected);}
  async function check(d:OutgoingDraftDto,selected=cookie){const r=await app.handleOutgoingCheck(req({revision:d.revision},selected),d.id);expect(r.status).toBe(200);return (await r.json()).recap;}
  const sendDraft=(d:OutgoingDraftDto,token:string,id=randomUUID(),selected=cookie,instance=app)=>instance.handleOutgoingSend(req({revision:d.revision,requestId:id,confirmationToken:token},selected),d.id);
  beforeAll(async()=>{expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);await migrateDatabase(pool,config);actorId=await provisionSyntheticMember(pool,{email,name:'Camille Synthétique',password});await provisionSyntheticMember(pool,{email:otherEmail,name:'Alex Synthétique',password,role:'admin'});image=await sharp({create:{width:4,height:4,channels:3,background:'#123456'}}).png().toBuffer();});
  beforeEach(async()=>{stamp=Date.now();ticks=undefined;getHook=undefined;barrier=undefined;sent.length=0;send.mockClear();send.mockImplementation(async input=>{sent.push(input);return {status:'accepted',providerId:randomUUID()};});app=make();
    await pool.query('DELETE FROM hestia_outgoing_draft');await pool.query('DELETE FROM hestia_outgoing_operation');await pool.query('DELETE FROM hestia_outgoing_admission');await pool.query("UPDATE hestia_outgoing_slot SET operation_id=NULL,owner_token=NULL,lease_until=NULL,phase='free'");
    await pool.query('UPDATE "user" SET email=$2,"emailVerified"=true,name=$3 WHERE id=$1',[actorId,email,'Camille Synthétique']);cookie=await login(email);otherCookie=await login(otherEmail);folderId=await folder();});
  afterAll(async()=>pool.end());
  it('keeps one encrypted private draft, preserves additions, same-name documents and CAS conflicts',async()=>{
    const first=await upload('même.png'),second=await upload('même.png','Autre document',image,await folder());let d=await save(await create());
    d=await add(d,[first,second]);d=await add(d,[first]);expect(d.attachments).toHaveLength(2);expect(d.subject).toBe('Sujet conservé');expect((await create()).id).toBe(d.id);
    const raw=(await pool.query('SELECT ciphertext FROM hestia_outgoing_draft WHERE id=$1',[d.id])).rows[0].ciphertext;expect(raw).not.toContain('recipient');
    expect((await app.handleOutgoingDraft(req({revision:1,to:[],subject:'',message:'',attachmentIds:[]},cookie,'PATCH'),d.id)).status).toBe(409);
    expect((await app.handleOutgoingDraft(req({revision:d.revision},otherCookie,'DELETE'),d.id)).status).toBe(404);
    const recap=await check(d);expect(recap.attachments.map((x:OutgoingAvailableDocument)=>x.fileName)).toEqual(['même.png','même.png']);
    expect((await (await sendDraft(d,recap.token)).json()).operation.state).toBe('accepted');const payload=JSON.parse(sent[0].payload) as OutgoingPayload;
    expect(payload.attachments).toHaveLength(2);expect(payload.attachments.map(x=>x.filename)).toEqual(['même.png','même.png']);expect(Buffer.from(payload.attachments[0].content,'base64')).toEqual(image);
    expect(payload.from).toBe('Hestia au nom de Camille <envois@example.invalid>');expect(payload.reply_to).toBe(email);expect(payload.text).toBe('Texte\nExact');
  });
  it('requires new CAS revision after certain failure and never upserts a destroyed draft',async()=>{
    const doc=await upload(),d=await prepare([doc]),disabled=make(false),checked=await disabled.handleOutgoingCheck(req({revision:d.revision}),d.id),token=(await checked.json()).recap.token;
    const requestId=randomUUID();const failed=await (await sendDraft(d,token,requestId,cookie,disabled)).json();expect(failed.operation).toMatchObject({state:'failed',code:'not-configured'});expect(sent).toHaveLength(0);
    expect((await app.handleOutgoingCheck(req({revision:d.revision}),d.id)).status).toBe(409);
    const next=await save(failed.draft);const accepted=await (await sendDraft(next,(await check(next)).token)).json();expect(accepted.operation.state).toBe('accepted');
    const fresh=await create();expect(fresh.id).not.toBe(d.id);expect((await (await sendDraft(d,token,requestId)).json()).operation.state).toBe('failed');expect((await create()).id).toBe(fresh.id);
    stamp+=7*86400000;await app.cleanupOutgoing();expect((await app.handleOutgoingDraft(req({revision:d.revision},cookie,'DELETE'),d.id)).status).toBe(404);expect((await sendDraft(d,token,requestId)).status).toBe(404);
  });
  it('rechecks permissions after S3 and returns opaque unavailable projections',async()=>{
    const d=await prepare([await upload()]),recap=await check(d);getHook=async()=>{getHook=undefined;await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND capability='exporter'",[folderId]);};
    const result=await (await sendDraft(d,recap.token)).json();expect(result.operation.state).toBe('failed');expect(sent).toHaveLength(0);expect(result.draft.attachments).toEqual([{id:d.attachments[0].id,state:'unavailable'}]);
  });
  it('does not send an envelope after SQL reply address or display name changes',async()=>{
    const d=await prepare([await upload()]),recap=await check(d);await pool.query('UPDATE "user" SET name=$2 WHERE id=$1',[actorId,'Élodie <forged>']);
    expect((await sendDraft(d,recap.token)).status).toBe(409);expect(sent).toHaveLength(0);
    const current=await check(d);expect(current.sender.name).toBe('Hestia au nom de Élodie');await pool.query('UPDATE "user" SET email=$2 WHERE id=$1',[actorId,'changed-'+email]);expect((await sendDraft(d,current.token)).status).toBe(409);expect(sent).toHaveLength(0);
  });
  it('confirms changed titles separately while preserving the original filename',async()=>{
    const doc=await upload('nom-original.png'),d=await prepare([doc]);await pool.query('UPDATE hestia_document SET title=$2,version=version+1 WHERE id=$1',[doc.documentId,'Titre courant']);
    const read=await (await app.handleOutgoing(req())).json(),row=read.draft.attachments[0];expect(row).toMatchObject({state:'renamed',title:'Titre courant',fileName:'nom-original.png'});expect((await app.handleOutgoingCheck(req({revision:d.revision}),d.id)).status).toBe(409);
    const r=await app.handleOutgoingAttachments(req({revision:d.revision,documentVersion:row.current.documentVersion,revisionId:row.current.revisionId}),d.id,row.id);expect(r.status).toBe(200);const fixed=(await r.json()).draft;
    expect((await (await sendDraft(fixed,(await check(fixed)).token)).json()).operation.state).toBe('accepted');expect(JSON.parse(sent[0].payload).attachments[0].filename).toBe('nom-original.png');
  });
  it('keeps selected size on a replaced line and blocks check until explicit adoption',async()=>{
    const doc=await upload('ancien.png'),d=await prepare([doc]),id=randomUUID(),key='outgoing-synthetic/'+id,bytes=Buffer.concat([image,Buffer.from('synthetic-extra')]);await realStore.put(key,bytes,'image/png');
    const old=(await pool.query('SELECT * FROM hestia_upload WHERE document_id=$1',[doc.documentId])).rows[0];
    await pool.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,final_key,reservation_released)
      VALUES($1,$2,$3,$2,$1,$4,'Synthetic','nouveau.png','image/png',$5,$4,'import','completed',$6,true)`,[id,actorId,folderId,createHash('sha256').update(bytes).digest('hex'),bytes.length,key]);
    await pool.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready) VALUES($1,$2,'original',$3,$4,true)",[key,id,bytes.length,createHash('sha256').update(bytes).digest('hex')]);
    await pool.query('UPDATE hestia_document SET object_key=$2,file_name=$3,size=$4,sha256=$5,version=version+1 WHERE id=$1',[doc.documentId,key,'nouveau.png',bytes.length,createHash('sha256').update(bytes).digest('hex')]);expect(old).toBeTruthy();
    const row=(await (await app.handleOutgoing(req())).json()).draft.attachments[0];expect(row).toMatchObject({state:'replaced',size:image.length,fileName:'ancien.png',current:{size:bytes.length,fileName:'nouveau.png'}});expect((await app.handleOutgoingCheck(req({revision:d.revision}),d.id)).status).toBe(409);
    const result=await app.handleOutgoingAttachments(req({revision:d.revision,documentVersion:row.current.documentVersion,revisionId:row.current.revisionId}),d.id,row.id);const next=(await result.json()).draft;expect((await check(next)).totalBytes).toBe(bytes.length);
  });
  it('does not retry an uncertain intention and reconciles only bound internal evidence',async()=>{
    send.mockImplementation(async input=>{sent.push(input);return {status:'uncertain'};});const d=await prepare([await upload()]),token=(await check(d)).token,key=randomUUID();
    const first=await (await sendDraft(d,token,key)).json();expect(first.operation.state).toBe('uncertain');expect(first.draft.state).toBe('uncertain');expect((await (await sendDraft(d,token,key)).json()).operation.state).toBe('uncertain');expect(sent).toHaveLength(1);
    expect((await app.handleOutgoingDraft(req({revision:d.revision},cookie,'DELETE'),d.id)).status).toBe(409);
    stamp+=10*86400000;await app.cleanupOutgoing();const op=(await pool.query('SELECT * FROM hestia_outgoing_operation WHERE id=$1',[first.operation.id])).rows[0];expect(op.state).toBe('uncertain');
    const evidence={payloadDigest:op.payload_digest,status:'accepted' as const,providerId:randomUUID(),quiescent:true,signature:'bad'};expect(await app.reconcileOutgoing(op.id,evidence)).toBe(false);
    evidence.signature=outgoingCrypto(config.secret).mac('provider-evidence',op.id,evidence.payloadDigest,evidence.status,evidence.providerId,true);expect(await app.reconcileOutgoing(op.id,evidence)).toBe(true);
    expect((await pool.query('SELECT id FROM hestia_outgoing_draft WHERE id=$1',[d.id])).rowCount).toBe(0);expect(sent).toHaveLength(1);
  });
  it('fences suspended A before marker while B reclaims with a new generation',async()=>{
    const a=await prepare([await upload()]),b=await prepare([await upload('b.png','Autre',image,await folder(otherCookie),otherCookie)],otherCookie),at=(await check(a)).token,bt=(await check(b,otherCookie)).token;
    let reached!:()=>void,resume!:()=>void,opA:string|undefined;const entered=new Promise<void>(r=>reached=r),hold=new Promise<void>(r=>resume=r);
    barrier=async(stage,id)=>{if(stage==='before-mark'&&!opA){opA=id;reached();await hold;}};
    const pending=sendDraft(a,at);await entered;stamp+=46000;const bResult=await (await sendDraft(b,bt,randomUUID(),otherCookie)).json();expect(bResult.operation.state).toBe('accepted');resume();
    expect((await (await pending).json()).operation.state).toBe('failed');expect(sent).toHaveLength(1);expect(sent[0].id).toBe(bResult.operation.id);
    expect((await pool.query('SELECT phase,operation_id FROM hestia_outgoing_slot')).rows[0]).toMatchObject({phase:'free',operation_id:null});
  });
  it('does not reclaim a post-marker slot by date alone or let late A mutate another draft',async()=>{
    const a=await prepare([await upload()]),b=await prepare([await upload('b.png','Autre',image,await folder(otherCookie),otherCookie)],otherCookie),at=(await check(a)).token,bt=(await check(b,otherCookie)).token;
    let reached!:()=>void,resume!:()=>void,opA:string|undefined;const entered=new Promise<void>(r=>reached=r),hold=new Promise<void>(r=>resume=r);
    barrier=async(stage,id)=>{if(stage==='after-mark'&&!opA){opA=id;reached();await hold;}};
    const pending=sendDraft(a,at);await entered;stamp+=46000;const refused=await (await sendDraft(b,bt,randomUUID(),otherCookie)).json();expect(refused.operation).toMatchObject({state:'failed',code:'busy'});resume();
    const result=await (await pending).json();expect(result.operation.state).toBe('uncertain');expect(sent).toHaveLength(0);expect((await pool.query('SELECT operation_id,phase FROM hestia_outgoing_slot')).rows[0]).toEqual({operation_id:opA,phase:'dispatched'});expect((await create(otherCookie)).id).toBe(b.id);
  });
  it('rejects a changed email during byte I/O and never calls the provider',async()=>{
    const d=await prepare([await upload()]),token=(await check(d)).token;getHook=async()=>{getHook=undefined;await pool.query('UPDATE "user" SET email=$2 WHERE id=$1',[actorId,'new-'+email]);};
    const result=await (await sendDraft(d,token)).json();expect(result.operation.state).toBe('failed');expect(sent).toHaveLength(0);
  });
  it('stops before the marker when the total deadline is consumed',async()=>{
    ticks=0;const d=await prepare([await upload()]),token=(await check(d)).token;barrier=async stage=>{if(stage==='before-mark')ticks=45001;};
    const result=await (await sendDraft(d,token)).json();expect(result.operation.state).toBe('failed');expect(sent).toHaveLength(0);
    expect((await pool.query('SELECT marker_at FROM hestia_outgoing_operation WHERE id=$1',[result.operation.id])).rows[0].marker_at).toBeNull();
  });
  it('keeps exact20MiB raw bytes over bounded S3 ranges and refuses20MiB+1 without I/O',async()=>{
    app=make(true,true);const bytes=Buffer.alloc(L.rawBytes,0x61),large=await upload('twenty.png','Twenty synthetic',bytes),one=await upload('one.png','One synthetic',Buffer.from([0x62]));let d=await prepare([large,one]);let reads=0;
    getHook=async()=>{reads++;expect((await pool.query('SELECT pg_try_advisory_xact_lock(480519001) AS free')).rows[0].free).toBe(true);};
    expect((await app.handleOutgoingCheck(req({revision:d.revision}),d.id)).status).toBe(413);expect(reads).toBe(0);expect(sent).toHaveLength(0);
    d=await save(d,{attachmentIds:[d.attachments[0].id]});const recap=await check(d);expect(recap.totalBytes).toBe(L.rawBytes);const before=process.memoryUsage().rss,began=performance.now();
    const result=await (await sendDraft(d,recap.token)).json(),elapsedMs=performance.now()-began,deltaRss=process.memoryUsage().rss-before;expect(result.operation.state).toBe('accepted');expect(reads).toBe(10);expect(sent).toHaveLength(1);
    const payload=JSON.parse(sent[0].payload) as OutgoingPayload;expect(Buffer.byteLength(sent[0].payload)).toBeLessThanOrEqual(L.encodedBytes);expect(createHash('sha256').update(Buffer.from(payload.attachments[0].content,'base64')).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));expect(deltaRss).toBeLessThanOrEqual(192*1024*1024);expect(elapsedMs).toBeLessThan(45000);
    const evidence='artifacts/qualification/outgoing-email-20261018/backend';mkdirSync(evidence,{recursive:true});writeFileSync(evidence+'/memory-local.actual.json',JSON.stringify({scope:'owned local SQL/S3; synthetic format seam, simulated transport; isolated operation delta only, NOT absolute/global RSS or hosted qualification',rawBytes:L.rawBytes,encodedBytes:Buffer.byteLength(sent[0].payload),ranges:reads,deltaRss,elapsedMs,networkProviderCalls:0},null,2));
  },60000);
  it('blocks corrupted SHA and short S3 objects before the supplier',async()=>{
    const doc=await upload(),row=(await pool.query('SELECT object_key FROM hestia_document WHERE id=$1',[doc.documentId])).rows[0];let d=await prepare([doc]);
    await realStore.put(row.object_key,Buffer.alloc(image.length,0x61),'image/png');let result=await (await sendDraft(d,(await check(d)).token)).json();expect(result.operation).toMatchObject({state:'failed',code:'integrity'});expect(sent).toHaveLength(0);
    d=await save(result.draft);await realStore.put(row.object_key,Buffer.from([1]),'image/png');result=await (await sendDraft(d,(await check(d)).token)).json();expect(result.operation.state).toBe('failed');expect(sent).toHaveLength(0);
  });
  it('blocks lost sessions during I/O and records certain non-transmission',async()=>{
    const d=await prepare([await upload()]),token=(await check(d)).token;getHook=async()=>{getHook=undefined;await pool.query('UPDATE hestia_session_policy p SET member_epoch=p.member_epoch+1 FROM session s WHERE s.id=p.session_id AND s."userId"=$1',[actorId]);};
    expect((await sendDraft(d,token)).status).toBe(401);expect(sent).toHaveLength(0);expect((await pool.query('SELECT state,marker_at FROM hestia_outgoing_operation WHERE draft_id=$1',[d.id])).rows[0]).toMatchObject({state:'failed',marker_at:null});
  });
  it('blocks member recovery during I/O without exposing the private draft',async()=>{
    const d=await prepare([await upload()]),token=(await check(d)).token;getHook=async()=>{getHook=undefined;await pool.query('UPDATE hestia_member SET recovering=true WHERE user_id=$1',[actorId]);};
    try{expect((await sendDraft(d,token)).status).toBe(401);expect(sent).toHaveLength(0);}finally{await pool.query('UPDATE hestia_member SET recovering=false WHERE user_id=$1',[actorId]);}
  });
  it('locks edits and abandon during transport and repeats an intention without another call',async()=>{
    const d=await prepare([await upload()]),token=(await check(d)).token,key=randomUUID();let reached!:()=>void,resume!:()=>void;const entered=new Promise<void>(r=>reached=r),hold=new Promise<void>(r=>resume=r);
    send.mockImplementation(async input=>{sent.push(input);reached();await hold;return {status:'accepted',providerId:randomUUID()};});
    const pending=sendDraft(d,token,key);await entered;expect((await (await sendDraft(d,token,key)).json()).operation.state).toBe('sending');expect((await (await sendDraft(d,token,randomUUID())).json()).operation.state).toBe('sending');
    expect((await app.handleOutgoingDraft(req({revision:d.revision},cookie,'DELETE'),d.id)).status).toBe(409);expect((await app.handleOutgoingDraft(req({revision:d.revision,to:[],subject:'x',message:'',attachmentIds:[]},cookie,'PATCH'),d.id)).status).toBe(409);resume();const accepted=await (await pending).json();expect(accepted.operation.state).toBe('accepted');expect(sent).toHaveLength(1);
    const receipt=JSON.stringify((await pool.query('SELECT row_to_json(o) AS data FROM hestia_outgoing_operation o WHERE id=$1',[accepted.operation.id])).rows[0].data);for(const field of ['recipient@example.invalid','Sujet conservé','Texte','original.png'])expect(receipt).not.toContain(field);
  });
  it('does not treat missing quiescence or forged proof as a reconciliation',async()=>{
    send.mockImplementation(async()=>({status:'uncertain'}));const d=await prepare([await upload()]),result=await (await sendDraft(d,(await check(d)).token)).json(),op=(await pool.query('SELECT * FROM hestia_outgoing_operation WHERE id=$1',[result.operation.id])).rows[0],crypto=outgoingCrypto(config.secret);
    const evidence={payloadDigest:op.payload_digest,status:'rejected' as const,quiescent:false,signature:crypto.mac('provider-evidence',op.id,op.payload_digest,'rejected',null,false)};
    expect(await app.reconcileOutgoing(op.id,evidence)).toBe(false);expect(await app.reconcileOutgoing(randomUUID(),{...evidence,quiescent:true})).toBe(false);expect((await pool.query('SELECT state FROM hestia_outgoing_operation WHERE id=$1',[op.id])).rows[0].state).toBe('uncertain');
  });
  it('enforces SQL actor admission limits and leaves quota refusals correctable',async()=>{
    const doc=await upload();let reads=0;getHook=async()=>{reads++;};
    for(let n=0;n<5;n++){const d=await prepare([doc]);expect((await (await sendDraft(d,(await check(d)).token)).json()).operation.state).toBe('accepted');}
    const d=await prepare([doc]),result=await (await sendDraft(d,(await check(d)).token)).json();expect(result.operation).toMatchObject({state:'failed',code:'quota'});expect(reads).toBe(5);expect(sent).toHaveLength(5);expect(result.draft.state).toBe('editable');
    stamp+=3600001;const next=await save(result.draft);expect((await (await sendDraft(next,(await check(next)).token)).json()).operation.state).toBe('accepted');expect(sent).toHaveLength(6);
  });
  it('keeps a failed revision consumed after its minimal receipt is purged',async()=>{
    app=make(false);const d=await prepare([await upload()]),token=(await check(d)).token;expect((await (await sendDraft(d,token)).json()).operation.state).toBe('failed');
    stamp+=7*86400000;await app.cleanupOutgoing();expect((await pool.query('SELECT id FROM hestia_outgoing_operation WHERE draft_id=$1',[d.id])).rowCount).toBe(0);
    expect((await app.handleOutgoingCheck(req({revision:d.revision}),d.id)).status).toBe(409);const next=await save(d);expect((await check(next)).token).toBeTruthy();expect(next.revision).toBe(d.revision+1);
  });
  it('does not keep an idle browser signed in through outgoing state polling',async()=>{
    await create();await pool.query('UPDATE hestia_session_policy p SET touched_at=clock_timestamp()-interval \'5 minutes\' FROM session s WHERE s.id=p.session_id AND s."userId"=$1',[actorId]);
    const before=(await pool.query('SELECT max(p.touched_at) AS touched FROM hestia_session_policy p JOIN session s ON s.id=p.session_id WHERE s."userId"=$1',[actorId])).rows[0].touched;
    expect((await app.handleOutgoing(req())).status).toBe(200);const after=(await pool.query('SELECT max(p.touched_at) AS touched FROM hestia_session_policy p JOIN session s ON s.id=p.session_id WHERE s."userId"=$1',[actorId])).rows[0].touched;expect(after).toEqual(before);
  });
  it('starts a private empty draft after recovery or readmission without reviving old mutations',async()=>{
    const doc=await upload(),old=await prepare([doc]),oldCookie=cookie;
    await pool.query('UPDATE hestia_member SET epoch=epoch+1,departure_epoch=departure_epoch+1 WHERE user_id=$1',[actorId]);cookie=await login(email);
    expect((await app.handleOutgoing(req(undefined,oldCookie))).status).toBe(401);
    expect((await (await app.handleOutgoing(req())).json()).draft).toBeNull();const fresh=await create();expect(fresh.id).not.toBe(old.id);expect(fresh).toMatchObject({to:[],subject:'',message:'',attachments:[]});
    expect((await app.handleOutgoingDraft(req({revision:old.revision},cookie,'DELETE'),old.id)).status).toBe(404);
    expect((await app.handleOutgoingDraft(req({revision:old.revision,to:[],subject:'stale',message:'',attachmentIds:[]},cookie,'PATCH'),old.id)).status).toBe(404);
    expect((await pool.query('SELECT id FROM hestia_outgoing_draft WHERE id=$1',[old.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT id FROM hestia_document WHERE id=$1 AND purged_at IS NULL',[doc.documentId])).rowCount).toBe(1);expect((await create()).id).toBe(fresh.id);
  });
  it('preserves an old uncertain admission and reconciles only its draft while a new admission composes',async()=>{
    send.mockImplementation(async input=>{sent.push(input);return {status:'uncertain'};});const old=await prepare([await upload()]),first=await (await sendDraft(old,(await check(old)).token)).json();
    const op=(await pool.query('SELECT * FROM hestia_outgoing_operation WHERE id=$1',[first.operation.id])).rows[0],slot=(await pool.query('SELECT * FROM hestia_outgoing_slot')).rows[0];
    await pool.query('UPDATE hestia_member SET epoch=epoch+1 WHERE user_id=$1',[actorId]);cookie=await login(email);const fresh=await save(await create(),{subject:'Nouvelle admission'});
    expect(fresh.id).not.toBe(old.id);expect(fresh.operation).toBeUndefined();expect((await app.handleOutgoingOperation(req(),op.id)).status).toBe(404);
    expect((await app.handleOutgoingDraft(req({revision:old.revision},cookie,'DELETE'),old.id)).status).toBe(404);await app.cleanupOutgoing();
    expect((await pool.query('SELECT lock_operation_id FROM hestia_outgoing_draft WHERE id=$1',[old.id])).rows[0].lock_operation_id).toBe(op.id);expect((await pool.query('SELECT id FROM hestia_outgoing_selection WHERE draft_id=$1',[old.id])).rowCount).toBe(1);
    expect((await pool.query('SELECT * FROM hestia_outgoing_slot')).rows[0]).toEqual(slot);
    const evidence={payloadDigest:op.payload_digest,status:'accepted' as const,providerId:randomUUID(),quiescent:true,signature:''};evidence.signature=outgoingCrypto(config.secret).mac('provider-evidence',op.id,evidence.payloadDigest,evidence.status,evidence.providerId,true);
    expect(await app.reconcileOutgoing(op.id,evidence)).toBe(true);expect((await pool.query('SELECT id FROM hestia_outgoing_draft WHERE id=$1',[old.id])).rowCount).toBe(0);
    const read=(await (await app.handleOutgoing(req())).json()).draft;expect(read.id).toBe(fresh.id);expect(read.subject).toBe('Nouvelle admission');expect((await pool.query('SELECT phase FROM hestia_outgoing_slot')).rows[0].phase).toBe('free');expect(sent).toHaveLength(1);
  });
  it('measures three retained pre-marker assemblies and fences resumed expired owners',async()=>{
    app=make(true,true);const bytes=Buffer.alloc(L.rawBytes,0x63),doc=await upload('suspended.png','Synthetic suspension',bytes);let d=await prepare([doc]),reads=0;
    getHook=async()=>{reads++;};const baseline=process.memoryUsage().rss,samples:{operationId:string;rss:number;deltaRss:number}[]=[],resumes:(()=>void)[]=[],pending:Promise<Response>[]=[];
    let entered!:()=>void;barrier=async(stage,id)=>{if(stage==='before-mark'){const rss=process.memoryUsage().rss;samples.push({operationId:id,rss,deltaRss:rss-baseline});const hold=new Promise<void>(resolve=>resumes.push(resolve));entered();await hold;}};
    for(let n=0;n<3;n++){
      const token=(await check(d)).token,reached=new Promise<void>(resolve=>entered=resolve);pending.push(sendDraft(d,token));await reached;
      if(n<2){stamp+=46000;const read=(await (await app.handleOutgoing(req())).json()).draft;expect(read.operation.state).toBe('failed');d=await save(read);}
    }
    const active=(await pool.query('SELECT operation_id,generation FROM hestia_outgoing_slot')).rows[0];expect(active.operation_id).toBe(samples[2].operationId);expect(reads).toBe(30);expect(sent).toHaveLength(0);
    resumes[0]();resumes[1]();for(const p of pending.slice(0,2))expect((await (await p).json()).operation.state).toBe('failed');
    expect((await pool.query('SELECT operation_id,generation FROM hestia_outgoing_slot')).rows[0]).toEqual(active);resumes[2]();expect((await (await pending[2]).json()).operation.state).toBe('accepted');expect(sent).toHaveLength(1);expect(sent[0].id).toBe(samples[2].operationId);
    const evidence='artifacts/qualification/outgoing-email-20261018/backend';mkdirSync(evidence,{recursive:true});writeFileSync(evidence+'/memory-suspended-local.actual.json',JSON.stringify({scope:'three sequential readmissions retaining pre-marker 20MiB assemblies on owned local SQL/S3; synthetic format seam; simulated supplier; one process; no absolute/global or hosted RSS guarantee',assemblies:3,rawBytesEach:L.rawBytes,ranges:reads,baselineRss:baseline,samples,peakSampledDeltaRss:Math.max(...samples.map(x=>x.deltaRss)),resumedExpiredOwners:2,providerNetworkCalls:0,simulatedSupplierCalls:sent.length},null,2));
  },60000);
});
