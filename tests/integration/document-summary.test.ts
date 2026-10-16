import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { createApplication } from '../../src/server/application';
import { createAccess } from '../../src/server/access';
import { createAuth } from '../../src/server/auth/options';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { createClassificationCredentialCipher } from '../../src/server/classification/cipher';
import { createStorageBudget } from '../../src/server/storage/quota';
import { createObjectStore, type ObjectStore } from '../../src/server/storage';
import { createSummaryService, type SummaryDependencies } from '../../src/server/summary/service';
import type { SummaryPayload, SummaryProvider } from '../../src/server/summary/provider';
import { promoteInboxContent, createRevisionsService } from '../../src/server/documents/revisions';
import type { ClassificationProvider, ProviderOutcome, ProviderPayload } from '../../src/server/classification/types';

// A valid ancillary PNG chunk reaches the exact byte boundary without adding
// pixels. The source remains synthetic; storage-latency simulations below do
// not substitute for the separately qualified format decoder or remote S3.
function paddedPng(image:Buffer,size=20*1024*1024){
 const padding=Buffer.alloc(size-image.length-12,97);padding.write('padding\0',0,'binary');
 const type=Buffer.from('tEXt'),table=Array.from({length:256},(_,i)=>{let n=i;for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 let crc=0xffffffff;for(const byte of type)crc=table[(crc^byte)&255]^(crc>>>8);for(const byte of padding)crc=table[(crc^byte)&255]^(crc>>>8);
 const prefix=Buffer.alloc(4),suffix=Buffer.alloc(4);prefix.writeUInt32BE(padding.length);suffix.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([image.subarray(0,image.length-12),prefix,type,padding,suffix,image.subarray(image.length-12)]);
}

describe('document-only summaries over real PostgreSQL, objects and durable budget',()=>{
 const config=readServerConfig();
 if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw new Error('Owned synthetic integration bench required');
 const pool=new Pool({connectionString:config.databaseUrl,max:8}),real=createObjectStore(),access=createAccess(pool,config,createAuth(pool,config));
 const cipher=createClassificationCredentialCipher('synthetic-summary-credential-key-123456789');
 const budget=createStorageBudget();let getHook:(()=>Promise<void>)|undefined;
 const store:ObjectStore={put:(...args)=>real.put(...args),delete:key=>real.delete(key),async getRange(...args){const bytes=await real.getRange(...args);await getHook?.();return bytes;}};
 const app=createApplication(pool,config,{store}),revisions=createRevisionsService(pool,access,{store,budget});
 const email=`summary-${randomUUID()}@example.invalid`,password='Synthetic summary password only!';
 let actorId:string,cookie:string,folderId:string,image:Buffer,ownedHashes:Set<string>,calls:SummaryPayload[];
 let effect:(payload:SummaryPayload)=>Promise<ProviderOutcome>;
 const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
 const provider:SummaryProvider={id:'synthetic-summary',mode:'synthetic',quote:()=>({maximumMicros:100,currency:'EUR'}),
  async summarize(_config,payload){const own=ownedHashes.has(digest(payload.bytes));if(own){calls.push({bytes:new Uint8Array(payload.bytes),mediaType:payload.mediaType});return effect(payload);}return{value:{summary:'Document synthétique.'},actualMicros:20};}};
 const deps:SummaryDependencies={clock:async()=>new Date(),store,credentialCipher:cipher,readAuthorizedFolders:async()=>[],providers:[],summaryProviders:[provider],allowRemote:false,requestTimeoutMs:2000,deploymentLimitMicros:1e9};
 const summaries=createSummaryService(access,deps);
 function req(body?:unknown,method=body===undefined?'GET':'POST',query='/api/hestia/documents'){
  return new Request(config.origin+query,{method,headers:{origin:config.origin,cookie,...(body===undefined?{}:{'content-type':body instanceof Uint8Array?'application/octet-stream':'application/json'})},...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});
 }
 async function data(result:Response,status=200){const body=await result.json();expect(result.status,JSON.stringify(body)).toBe(status);return body;}
 async function priority(contentId:string){await pool.query("UPDATE hestia_content_summary SET created_at='2000-01-01T00:00:00Z',updated_at='2000-01-01T00:00:00Z' WHERE content_id=$1",[contentId]);}
 async function row(contentId:string){return(await pool.query('SELECT * FROM hestia_content_summary WHERE content_id=$1',[contentId])).rows[0];}
 async function ledger(){return(await pool.query("SELECT * FROM hestia_classification_request WHERE actor_id=$1 AND kind='summary' ORDER BY created_at,id",[actorId])).rows;}
 async function analysisRow(attachmentId:string){return(await pool.query('SELECT * FROM hestia_inbox_analysis_job WHERE attachment_id=$1',[attachmentId])).rows[0];}
 async function paidReceipt(contentId:string,kind:'summary'|'inbox_analysis'){
  const id=randomUUID();
  await pool.query(`INSERT INTO hestia_classification_request(id,actor_id,actor_epoch,idempotency_key,kind,identity_hash,identity,config_version,month_start,reserved_micros,created_at,sent_at)
    SELECT $1,$2,m.epoch,$1,$3,repeat('c',64),$4::jsonb,c.version,date_trunc('month',clock_timestamp())::date,100,clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '11 minutes'
    FROM hestia_member m CROSS JOIN hestia_classification_config c WHERE m.user_id=$2 AND c.id=1`,[id,actorId,kind,JSON.stringify({contentId})]);return id;
 }
 async function original(bytes:Uint8Array=image){
  const id=randomUUID(),key=`originals/${randomUUID()}`;ownedHashes.add(digest(bytes));
  await access.transaction(async client=>{await budget.assertAdditional(client,[{ownerId:actorId,bytes:bytes.length}]);await client.query(`INSERT INTO hestia_content(id,object_key,owner_id,size,sha256,media_type,file_name,preview_supported) VALUES($1,$2,$3,$4,$5,'image/png','NOM_PRIVE_A_NE_PAS_ANALYSER.png',true)`,[id,key,actorId,bytes.length,digest(bytes)]);});
  await store.put(key,bytes,'image/png');await priority(id);return{id,key};
 }
 async function mail(contentId:string,documentId?:string,documentVersion?:number){return access.withActor(req(),(client,actor)=>promoteInboxContent(client,actor,{contentId,folderId,title:'TITRE_PRIVE_DU_RANGEMENT',documentId,documentVersion},budget));}
 async function pendingArrival(contentId:string){
  const eventId=randomUUID(),attachmentId=randomUUID(),member=(await pool.query('SELECT epoch,departure_epoch FROM hestia_member WHERE user_id=$1',[actorId])).rows[0];
  await pool.query(`INSERT INTO hestia_inbox_event(id,environment,relay_actor,gmail_id_sha256,raw_sha256,raw_size,chunk_count,configuration_epoch,state,staging_until,owner_id,owner_epoch,departure_epoch)
    VALUES($1,'local','synthetic-summary',$2,repeat('b',64),1,1,1,'accepted',clock_timestamp()+interval '24 hours',$3,$4,$5)`,[eventId,digest(Buffer.from(eventId)),actorId,member.epoch,member.departure_epoch]);
  await pool.query(`INSERT INTO hestia_inbox_attachment(id,event_id,position,actor_id,departure_epoch,content_id,state,comment)
    VALUES($1,$2,'1',$3,$4,$5,'pending','Commentaire privé synthétique')`,[attachmentId,eventId,actorId,member.departure_epoch,contentId]);
  await pool.query('INSERT INTO hestia_inbox_settings(actor_id,enabled,automatic_analysis) VALUES($1,true,true) ON CONFLICT(actor_id) DO UPDATE SET enabled=true,automatic_analysis=true,version=hestia_inbox_settings.version+1',[actorId]);
  await access.transaction(client=>summaries.enqueueAnalysis(client,{attachmentId,contentId,actorId,automaticAnalysis:true}));return attachmentId;
 }
 async function optOut(){const settings=await data(await app.handleInboxSettings(req()));await data(await app.handleInboxSettings(req({version:settings.version,automaticAnalysis:false},'PATCH')));}
 async function manual(){const created=await data(await app.handleUploads(req({folderId,idempotencyKey:randomUUID(),fileName:'SECRET_FILENAME.png',title:'Titre manuel',size:image.length,mediaType:'image/png',sha256:digest(image),source:'import'})),201);const id=created.operation.id;
  await data(await app.handleUploadChunk(req(image,'PUT'),id,'0'));const completed=await data(await app.handleUploadComplete(req({keepDuplicate:true}),id));return completed.document.id as string;}
 async function capture(){let c=(await data(await app.handleCaptures(req({kind:'import',idempotencyKey:randomUUID(),currentFolderId:folderId})),201)).capture;
  const upload=await data(await app.handleCapturePages(req({version:c.version,idempotencyKey:randomUUID(),fileName:'SECRET_CAPTURE.png',mediaType:'image/png',size:image.length,sha256:digest(image)}),c.id));
  await data(await app.handleCapturePageChunk(req(image,'PUT'),c.id,upload.upload.id,'0'));c=(await data(await app.handleCapturePageComplete(req({version:upload.captureVersion}),c.id,upload.upload.id))).capture;
  const prepared=await data(await app.handleCapturePrepare(req({version:c.version}),c.id));c=prepared.capture;
  const input={version:c.version,artifactId:prepared.artifact.id,destination:{kind:'existing',folderId},keepDuplicate:true};
  const preview=(await data(await app.handleCapturePreview(req(input),c.id))).preview;
  return(await data(await app.handleCaptureFinalize(req({...input,previewToken:preview.previewToken,idempotencyKey:randomUUID()}),c.id))).document.id as string;
 }
 beforeAll(async()=>{expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);actorId=await provisionSyntheticMember(pool,{email,name:'Auteur résumé synthétique',password});});
 beforeEach(async()=>{
  await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const login=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email,password})}));expect(login.status).toBe(200);cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  await pool.query("UPDATE hestia_content_summary s SET permitted=false,status='unavailable',text=NULL,request_id=NULL FROM hestia_content c WHERE c.id=s.content_id AND c.owner_id=$1",[actorId]);
  await pool.query("UPDATE hestia_inbox_analysis_job j SET status='unavailable',request_id=NULL,generation=j.generation+1 FROM hestia_inbox_attachment a WHERE a.id=j.attachment_id AND a.actor_id=$1",[actorId]);
  await pool.query("DELETE FROM hestia_classification_request WHERE actor_id=$1 AND kind IN ('summary','inbox_analysis')",[actorId]);
  await pool.query("UPDATE hestia_classification_config SET version=version+1,provider='synthetic-summary',model='fixture',enabled=true,monthly_limit_micros=1000000000,credential_sealed=$1 WHERE id=1",[cipher.seal('synthetic-summary-provider-key','hestia-classification:1:synthetic-summary')]);
  folderId=(await data(await app.handleFolders(req({name:`Résumé ${randomUUID()}`})),201)).folder.id;
  image=await sharp({create:{width:8,height:8,channels:3,background:'#'+randomUUID().replaceAll('-','').slice(0,6)}}).png().toBuffer();ownedHashes=new Set([digest(image)]);calls=[];getHook=undefined;effect=async()=>({value:{summary:'Facture synthétique de démonstration.'},actualMicros:20});
 });
 afterAll(()=>pool.end());
 it('sends only original bytes and media type, then publishes the exact content summary under current document rights',async()=>{
  const content=await original(),eventId=randomUUID(),attachmentId=randomUUID();
  const member=(await pool.query('SELECT epoch,departure_epoch FROM hestia_member WHERE user_id=$1',[actorId])).rows[0];
  await pool.query(`INSERT INTO hestia_inbox_event(id,environment,relay_actor,gmail_id_sha256,raw_sha256,raw_size,chunk_count,configuration_epoch,state,staging_until,owner_id,owner_epoch,departure_epoch,sender,subject,context)
    VALUES($1,'local','synthetic-summary',repeat('a',64),repeat('b',64),1,1,1,'accepted',clock_timestamp()+interval '24 hours',$2,$3,$4,$5,'MAIL_SUBJECT_PRIVATE','MAIL_BODY_PRIVATE')`,[eventId,actorId,member.epoch,member.departure_epoch,email]);
  await pool.query(`INSERT INTO hestia_inbox_attachment(id,event_id,position,actor_id,departure_epoch,content_id,state,comment)
    VALUES($1,$2,'1',$3,$4,$5,'pending','COMMENT_PRIVATE')`,[attachmentId,eventId,actorId,member.departure_epoch,content.id]);
  const document=await mail(content.id);await pool.query("UPDATE hestia_inbox_attachment SET state='placed',document_id=$2 WHERE id=$1",[attachmentId,document.documentId]);let keys:string[]=[];
  effect=async payload=>{keys=Object.keys(payload).sort();expect(digest(payload.bytes)).toBe(digest(image));return{value:{summary:'Facture synthétique de démonstration.'},actualMicros:20};};
  await summaries.runSummaryBatch(1);expect(keys).toEqual(['bytes','mediaType']);expect(calls).toHaveLength(1);
  expect(await data(await summaries.handleDocumentSummary(req(),document.documentId))).toMatchObject({revisionId:document.revisionId,summary:{status:'ready',text:'Facture synthétique de démonstration.'}});
  expect(JSON.stringify((await ledger())[0])).not.toMatch(/NOM_PRIVE|TITRE_PRIVE|MAIL_SUBJECT_PRIVATE|MAIL_BODY_PRIVATE|COMMENT_PRIVATE|Facture synthétique/);
 });
 it('queues new originals from manual upload, Capture and mail in the same transaction',async()=>{
  const manualId=await manual(),captureId=await capture(),mailContent=await original(),mailDoc=await mail(mailContent.id);
  const queued=(await pool.query(`SELECT d.source,s.status FROM hestia_document d JOIN hestia_document_revision r ON r.id=d.current_revision_id JOIN hestia_content_summary s ON s.content_id=r.content_id WHERE d.id=ANY($1::uuid[])`,[[manualId,captureId,mailDoc.documentId]])).rows;
  expect(queued.map(r=>r.source).sort()).toEqual(['import','import','mail']);expect(queued.every(r=>r.status==='pending')).toBe(true);expect(calls).toHaveLength(0);
 });
 it('does not spend or enqueue work by reading a historical document with no summary row',async()=>{
  const content=await original(),document=await mail(content.id);await pool.query('DELETE FROM hestia_content_summary WHERE content_id=$1',[content.id]);
  for(const method of ['GET','POST'])expect(await data(await summaries.handleDocumentSummary(req(method==='POST'?{}:undefined,method),document.documentId))).toMatchObject({summary:{status:'unavailable'}});
  await app.handleDocuments(req());expect(await row(content.id)).toBeUndefined();expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
 });
 it('keeps a late result on the displaced original and restores that original with its own summary and no extra call',async()=>{
  const first=await original(),document=await mail(first.id);let replacement:{revisionId:string;version:number}|undefined;
  effect=async()=>{const nextBytes=await sharp({create:{width:9,height:9,channels:3,background:'#f12233'}}).png().toBuffer();const second=await original(nextBytes);replacement=await mail(second.id,document.documentId,document.version);return{value:{summary:'Résumé du premier original.'},actualMicros:20};};
  await summaries.runSummaryBatch(1);expect((await row(first.id)).text).toBe('Résumé du premier original.');
  expect(await data(await summaries.handleDocumentSummary(req(),document.documentId))).toMatchObject({revisionId:replacement!.revisionId,summary:{status:'pending'}});
  const result=await revisions.handleDocumentRevisionRestore(req({version:replacement!.version,idempotencyKey:randomUUID()}),document.documentId,document.revisionId);expect(result.status).toBe(200);
  expect(await data(await summaries.handleDocumentSummary(req(),document.documentId))).toMatchObject({revisionId:document.revisionId,summary:{text:'Résumé du premier original.'}});expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it('settles incurred cost but discards publication when configuration changes during provider I/O',async()=>{
  const content=await original();await mail(content.id);effect=async()=>{await pool.query('UPDATE hestia_classification_config SET version=version+1,enabled=false WHERE id=1');return{value:{summary:'Résultat devenu indisponible.'},actualMicros:30};};
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'unavailable',text:null});expect(Number((await ledger())[0].actual_micros)).toBe(30);
 });
 it('retains unknown cost reservations after provider failure and never automatically retries the same original',async()=>{
  const content=await original();await mail(content.id);effect=async()=>{throw new Error('Synthetic ambiguous network outcome');};
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'unknown',text:null});
  const request=(await ledger())[0];expect(request.actual_micros).toBeNull();expect(Number(request.reserved_micros)).toBe(100);
  await summaries.runSummaryBatch(1);expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it('reserves against the existing shared budget and keeps classification/manual placement usable when unavailable',async()=>{
  const content=await original();const document=await mail(content.id);await pool.query('UPDATE hestia_classification_config SET monthly_limit_micros=1 WHERE id=1');
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'unavailable',text:null});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  expect((await app.handleDocument(req(),document.documentId)).status).toBe(200);
 });
 it('rechecks admission after reading objects and before reserving a paid call',async()=>{
  const content=await original();await mail(content.id);getHook=async()=>{getHook=undefined;await pool.query('UPDATE hestia_member SET recovering=true WHERE user_id=$1',[actorId]);};
  try{await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'unavailable',text:null});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);}finally{await pool.query('UPDATE hestia_member SET recovering=false WHERE user_id=$1',[actorId]);}
 });
 it('serializes concurrent workers per content without holding SQL locks over provider I/O',async()=>{
  const content=await original();const document=await mail(content.id);let release!:()=>void,entered!:()=>void;
  const sent=new Promise<void>(resolve=>{entered=resolve;});effect=async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return{value:{summary:'Document traité une fois.'},actualMicros:20};};
  const first=summaries.runSummaryBatch(1);await sent;
  try{expect((await app.handleDocument(req(),document.documentId)).status).toBe(200);await summaries.runSummaryBatch(1);expect(calls).toHaveLength(1);}finally{release();await first;}
  expect(await row(content.id)).toMatchObject({status:'ready',text:'Document traité une fois.'});expect(await ledger()).toHaveLength(1);
 });
 it('cancels pending automatic jobs on opt-out while an explicit manual request remains available',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);await optOut();
  expect(await row(content.id)).toMatchObject({permitted:false,status:'unavailable',auto_origin:true});
  expect((await pool.query('SELECT status,auto_origin FROM hestia_inbox_analysis_job WHERE attachment_id=$1',[attachmentId])).rows[0]).toEqual({status:'unavailable',auto_origin:true});
  await summaries.runSummaryBatch(1);expect(calls).toHaveLength(0);
  await access.transaction(client=>summaries.requestAnalysis(client,{attachmentId,contentId:content.id,actorId,idempotencyKey:randomUUID(),version:1,commentVersion:1}));
  expect(await row(content.id)).toMatchObject({permitted:true,status:'pending',auto_origin:false});
  await priority(content.id);
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'ready',auto_origin:false});expect(calls).toHaveLength(1);
  expect((await pool.query('SELECT automatic_analysis FROM hestia_inbox_settings WHERE actor_id=$1',[actorId])).rows[0].automatic_analysis).toBe(false);
 });
 it('discards an in-flight automatic result after opt-out and keeps its incurred charge without retry',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);
  effect=async()=>{await optOut();return{value:{summary:'Résultat automatique désormais interdit.'},actualMicros:20};};
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({permitted:false,status:'unavailable',text:null});
  expect((await pool.query('SELECT status FROM hestia_inbox_analysis_job WHERE attachment_id=$1',[attachmentId])).rows[0].status).toBe('unavailable');
  expect(Number((await ledger())[0].actual_micros)).toBe(20);await summaries.runSummaryBatch(1);expect(calls).toHaveLength(1);
 });
 it('requeues interrupted unsent summary and inbox work with a fresh generation, then resumes the summary once',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);
  await pool.query("UPDATE hestia_content_summary SET status='running',request_id=NULL,updated_at=clock_timestamp()-interval '11 minutes' WHERE content_id=$1",[content.id]);
  await pool.query("UPDATE hestia_inbox_analysis_job SET status='running',request_id=NULL,updated_at=clock_timestamp()-interval '11 minutes' WHERE attachment_id=$1",[attachmentId]);
  const before=await row(content.id),analysisBefore=await analysisRow(attachmentId);await summaries.cleanupSummary();
  expect(await row(content.id)).toMatchObject({status:'pending',request_id:null,generation:before.generation+1});
  expect(await analysisRow(attachmentId)).toMatchObject({status:'pending',request_id:null,generation:analysisBefore.generation+1});
  expect((await pool.query('SELECT analysis FROM hestia_inbox_attachment WHERE id=$1',[attachmentId])).rows[0].analysis).toEqual({status:'pending',suggestions:[]});
  await priority(content.id);await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'ready'});expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it('preserves unknown debt and refuses automatic retries once interrupted work has a durable paid reservation',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id),summaryRequest=await paidReceipt(content.id,'summary'),analysisRequest=await paidReceipt(content.id,'inbox_analysis');
  await pool.query("UPDATE hestia_content_summary SET status='running',request_id=$2,updated_at=clock_timestamp()-interval '11 minutes' WHERE content_id=$1",[content.id,summaryRequest]);
  await pool.query("UPDATE hestia_inbox_analysis_job SET status='running',request_id=$2,updated_at=clock_timestamp()-interval '11 minutes' WHERE attachment_id=$1",[attachmentId,analysisRequest]);
  const before=await row(content.id),analysisBefore=await analysisRow(attachmentId);await summaries.cleanupSummary();
  expect(await row(content.id)).toMatchObject({status:'unknown',text:null,generation:before.generation+1});
  expect(await analysisRow(attachmentId)).toMatchObject({status:'unknown',generation:analysisBefore.generation+1});
  const debts=(await pool.query('SELECT actual_micros,reserved_micros,settled_at FROM hestia_classification_request WHERE id=ANY($1::uuid[])',[[summaryRequest,analysisRequest]])).rows;
  expect(debts).toHaveLength(2);expect(debts.every(r=>r.actual_micros===null&&Number(r.reserved_micros)===100&&r.settled_at!==null)).toBe(true);
  await summaries.runSummaryBatch(1);expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(1);
 });
 it('fences a worker suspended before payment when cleanup has already requeued its generation',async()=>{
  const content=await original();await mail(content.id);let release!:()=>void,entered!:()=>void;
  const read=new Promise<void>(resolve=>{entered=resolve;});getHook=async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});};
  const originalWorker=summaries.runSummaryBatch(1);await read;
  try{await pool.query("UPDATE hestia_content_summary SET updated_at=clock_timestamp()-interval '11 minutes' WHERE content_id=$1",[content.id]);const prior=await row(content.id);expect(prior.request_id).toBeNull();await summaries.cleanupSummary();
    expect(await row(content.id)).toMatchObject({status:'pending',generation:prior.generation+1});
  }finally{getHook=undefined;release();await originalWorker;}
  expect(await row(content.id)).toMatchObject({status:'pending',request_id:null});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  await priority(content.id);await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'ready'});expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it('cannot publish a late paid worker result after cleanup has made that generation unknown',async()=>{
  const content=await original();await mail(content.id);let release!:()=>void,entered!:()=>void;
  const sent=new Promise<void>(resolve=>{entered=resolve;});effect=async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return{value:{summary:'Réponse arrivée trop tard.'},actualMicros:20};};
  const originalWorker=summaries.runSummaryBatch(1);await sent;
  try{await pool.query("UPDATE hestia_content_summary SET updated_at=clock_timestamp()-interval '11 minutes' WHERE content_id=$1",[content.id]);const prior=await row(content.id);expect(prior.request_id).not.toBeNull();await summaries.cleanupSummary();
    expect(await row(content.id)).toMatchObject({status:'unknown',generation:prior.generation+1});
  }finally{release();await originalWorker;}
  expect(await row(content.id)).toMatchObject({status:'unknown',text:null});expect((await ledger())[0].actual_micros).toBeNull();await summaries.runSummaryBatch(1);expect(calls).toHaveLength(1);
 });
 it('applies one total job limit across summaries and private suggestions',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);
  const result=await summaries.runSummaryBatch(1);expect(result.processed).toBe(1);expect(await row(content.id)).toMatchObject({status:'ready'});
  expect(await analysisRow(attachmentId)).toMatchObject({status:'pending',request_id:null});expect(calls).toHaveLength(1);
 });
 it('starts no storage or provider work when the caller has already spent the provider headroom',async()=>{
  const content=await original();await mail(content.id);let reads=0;
  const limited=createSummaryService(access,{...deps,monotonicNow:()=>1000,store:{...store,async getRange(...args){reads++;return store.getRange(...args);}}});
  const before=await row(content.id);expect(await limited.runSummaryBatch(2,2000)).toEqual({processed:0});
  expect(await row(content.id)).toEqual(before);expect(reads).toBe(0);expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
 });
 it('stops scheduling further jobs after the shared monotonic budget is consumed by the first one',async()=>{
  const first=await original(),second=await original();await mail(first.id);await mail(second.id);let elapsed=0;
  const limited=createSummaryService(access,{...deps,requestTimeoutMs:50,monotonicNow:()=>elapsed});
  effect=async()=>{elapsed=175;return{value:{summary:'Premier document dans le budget.'},actualMicros:20};};
  expect(await limited.runSummaryBatch(2,200)).toEqual({processed:1});
  expect([(await row(first.id)).status,(await row(second.id)).status].sort()).toEqual(['pending','ready']);expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it('returns an unsent job to pending when a slow object range exhausts the deadline and ignores its late bytes',async()=>{
  const content=await original();await mail(content.id);let elapsed=0,reads=0,release!:(bytes:Uint8Array)=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});const delayed=new Promise<Uint8Array>(resolve=>{release=resolve;});
  const limited=createSummaryService(access,{...deps,requestTimeoutMs:10,monotonicNow:()=>elapsed,store:{...store,getRange(){reads++;entered();return delayed;}}});
  const before=await row(content.id);vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{const work=limited.runSummaryBatch(2,50);await started;elapsed=41;await vi.advanceTimersByTimeAsync(41);await work;
    const checkpoint=await row(content.id);expect(checkpoint).toMatchObject({status:'pending',request_id:null,generation:before.generation+1});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);expect(reads).toBe(1);
    release(new Uint8Array(image));await new Promise<void>(resolve=>setImmediate(resolve));expect(await row(content.id)).toEqual(checkpoint);expect(calls).toHaveLength(0);
  }finally{release(new Uint8Array(image));vi.useRealTimers();}
 });
 it('reads the exact 20 MiB original as ten parallel 2 MiB ranges in six simulated seconds',async()=>{
  const bytes=paddedPng(image);expect(bytes.length).toBe(20*1024*1024);const content=await original(bytes);await mail(content.id);
  let elapsed=0,active=0,maximumActive=0,started!:()=>void;const ranges:{start:number;end:number}[]=[];
  const allStarted=new Promise<void>(resolve=>{started=resolve;});
  const parallel=createSummaryService(access,{...deps,requestTimeoutMs:5000,monotonicNow:()=>elapsed,store:{...store,getRange(key,start,end){
   expect(key).toBe(content.key);ranges.push({start,end});active++;maximumActive=Math.max(maximumActive,active);if(ranges.length===10)started();
   return new Promise<Uint8Array>(resolve=>{setTimeout(()=>{active--;resolve(bytes.subarray(start,end+1));},6000);});
  }}});
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{const work=parallel.runSummaryBatch(1,30000);await allStarted;expect(ranges).toHaveLength(10);expect(maximumActive).toBe(10);expect(active).toBe(10);expect(calls).toHaveLength(0);
   elapsed=6000;await vi.advanceTimersByTimeAsync(6000);expect(await work).toEqual({processed:1});
   expect(ranges).toEqual(Array.from({length:10},(_,index)=>({start:index*2*1024*1024,end:(index+1)*2*1024*1024-1})));
   expect(active).toBe(0);expect(elapsed).toBe(6000);expect(calls).toHaveLength(1);expect(digest(calls[0].bytes)).toBe(digest(bytes));
   expect(await row(content.id)).toMatchObject({status:'ready'});expect(await ledger()).toHaveLength(1);
  }finally{vi.useRealTimers();}
 });
 it('closes all ten range publications when the read budget expires and ignores every late reply',async()=>{
  const bytes=paddedPng(image),content=await original(bytes);await mail(content.id);let elapsed=0,started!:()=>void;
  const replies:{resolve:(bytes:Uint8Array)=>void;start:number;end:number}[]=[],allStarted=new Promise<void>(resolve=>{started=resolve;});
  const limited=createSummaryService(access,{...deps,requestTimeoutMs:10,monotonicNow:()=>elapsed,store:{...store,getRange(_key,start,end){
   return new Promise<Uint8Array>(resolve=>{replies.push({resolve,start,end});if(replies.length===10)started();});
  }}});
  const before=await row(content.id);vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{const work=limited.runSummaryBatch(1,50);await allStarted;elapsed=41;await vi.advanceTimersByTimeAsync(41);await work;
   const checkpoint=await row(content.id);expect(checkpoint).toMatchObject({status:'pending',request_id:null,generation:before.generation+1});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
   for(const reply of replies)reply.resolve(bytes.subarray(reply.start,reply.end+1));await new Promise<void>(resolve=>setImmediate(resolve));
   expect(await row(content.id)).toEqual(checkpoint);expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  }finally{for(const reply of replies)reply.resolve(bytes.subarray(reply.start,reply.end+1));vi.useRealTimers();}
 });
 it('defers a slow large original durably for sixty seconds so a fresh immediate tick processes the next small one',async()=>{
  const bytes=paddedPng(image),large=await original(bytes),small=await original();await mail(large.id);await mail(small.id);
  await pool.query("UPDATE hestia_content_summary SET updated_at='2000-01-02T00:00:00Z' WHERE content_id=$1",[small.id]);
  let elapsed=0,started!:()=>void;const wall=new Date(),replies:{resolve:(bytes:Uint8Array)=>void;start:number;end:number}[]=[];
  const allStarted=new Promise<void>(resolve=>{started=resolve;});
  const timedDeps:SummaryDependencies={...deps,clock:async()=>wall,requestTimeoutMs:10,monotonicNow:()=>elapsed,store:{...store,getRange(key,start,end){
   if(key===small.key)return real.getRange(key,start,end);
   expect(key).toBe(large.key);return new Promise<Uint8Array>(resolve=>{replies.push({resolve,start,end});if(replies.length===10)started();});
  }}};
  const first=createSummaryService(access,timedDeps);vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{const work=first.runSummaryBatch(1,50);await allStarted;elapsed=41;await vi.advanceTimersByTimeAsync(41);await work;
   const deferred=await row(large.id);expect(deferred).toMatchObject({status:'pending',request_id:null});expect(deferred.not_before.toISOString()).toBe(new Date(wall.getTime()+60000).toISOString());
   // A new service instance proves this eligibility gate lives in PostgreSQL.
   const immediateTick=createSummaryService(access,timedDeps);expect(await immediateTick.runSummaryBatch(1,1000)).toEqual({processed:1});
   expect(await row(small.id)).toMatchObject({status:'ready'});expect(await row(large.id)).toEqual(deferred);expect(replies).toHaveLength(10);expect(calls).toHaveLength(1);expect(digest(calls[0].bytes)).toBe(digest(image));
   for(const reply of replies)reply.resolve(bytes.subarray(reply.start,reply.end+1));await new Promise<void>(resolve=>setImmediate(resolve));expect(await row(large.id)).toEqual(deferred);
  }finally{for(const reply of replies)reply.resolve(bytes.subarray(reply.start,reply.end+1));vi.useRealTimers();}
 });
 it.each(['unavailable','unknown'] as const)('rearms %s explicitly without forgiving old debt, then safely resumes a crash before the new reservation',async previousStatus=>{
  const content=await original(),attachmentId=await pendingArrival(content.id),oldId=await paidReceipt(content.id,'summary');
  await pool.query("UPDATE hestia_classification_request SET status='failed',actual_micros=$2,settled_at=clock_timestamp() WHERE id=$1",[oldId,previousStatus==='unknown'?null:20]);
  await pool.query("UPDATE hestia_content_summary SET status=$2,request_id=$3,not_before=clock_timestamp()+interval '1 hour' WHERE content_id=$1",[content.id,previousStatus,oldId]);
  const before=await row(content.id),debt=(await ledger())[0],idempotencyKey=randomUUID();
  const command={attachmentId,contentId:content.id,actorId,idempotencyKey,version:1,commentVersion:1};
  await access.transaction(client=>summaries.requestAnalysis(client,command));
  expect(await row(content.id)).toMatchObject({status:'pending',request_id:null,generation:before.generation+1});expect((await pool.query('SELECT not_before<=clock_timestamp() AS eligible FROM hestia_content_summary WHERE content_id=$1',[content.id])).rows[0].eligible).toBe(true);
  expect(await ledger()).toEqual([debt]);expect(calls).toHaveLength(0);
  const rearmed=await row(content.id);await access.transaction(client=>summaries.requestAnalysis(client,command));expect(await row(content.id)).toEqual(rearmed);
  // This is the persisted phase after admission but before a new paid request.
  await pool.query("UPDATE hestia_content_summary SET status='running',updated_at=clock_timestamp()-interval '11 minutes' WHERE content_id=$1",[content.id]);await summaries.cleanupSummary();
  expect(await row(content.id)).toMatchObject({status:'pending',request_id:null,generation:rearmed.generation+1});expect(await ledger()).toEqual([debt]);
  await priority(content.id);await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'ready'});expect(calls).toHaveLength(1);
  const final=await ledger();expect(final).toHaveLength(2);expect(final.find(r=>r.id===oldId)).toEqual(debt);expect(final.filter(r=>r.id!==oldId).map(r=>Number(r.actual_micros))).toEqual([20]);
 });
 it('provides bounded private mail context only to placement analysis while the document summary still receives two keys',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);
  await pool.query("UPDATE hestia_inbox_event SET subject='Sujet privé synthétique',context='Corps privé synthétique',context_partial=true WHERE id=(SELECT event_id FROM hestia_inbox_attachment WHERE id=$1)",[attachmentId]);
  await pool.query("UPDATE hestia_inbox_analysis_job SET updated_at='2000-01-01T00:00:00Z' WHERE attachment_id=$1",[attachmentId]);
  const captured:ProviderPayload[]=[];let summaryKeys:string[]=[];
  const classifier:ClassificationProvider={id:provider.id,mode:'synthetic',models:[{id:'fixture',label:'Fixture'}],quote:()=>({maximumMicros:100,currency:'EUR'}),quoteCheck:()=>null,check:async()=>({status:'unreachable',actualMicros:0}),
    async analyze(_configuration,payload){if(ownedHashes.has(digest(payload.bytes)))captured.push({...payload,bytes:new Uint8Array(payload.bytes)});return{value:{existing:payload.folders.some(f=>f.id===folderId)?[{folderId,reason:'Suggestion synthétique.'}]:[],created:[]},actualMicros:30};}};
  const contextual=createSummaryService(access,{...deps,providers:[classifier],readAuthorizedFolders:async(_client,actor)=>actor.id===actorId?[{id:folderId,name:'Dossier autorisé',path:[{id:folderId,name:'Dossier autorisé'}],canCreate:true}]:[]});
  effect=async payload=>{summaryKeys=Object.keys(payload).sort();return{value:{summary:'Résumé issu des seuls octets.'},actualMicros:20};};
  // Other suites may also have queued synthetic originals in this shared bench.
  // Drain a bounded number while identifying only this arrival's own provider call.
  for(let batch=0;batch<20&&captured.length===0;batch++)await contextual.runSummaryBatch(10);
  expect(captured).toHaveLength(1);expect(captured[0].comment).toBeUndefined();expect(captured[0].inboxContext).toEqual({mail:{subject:'Sujet privé synthétique',body:'Corps privé synthétique',partial:true},comment:'Commentaire privé synthétique'});
  expect(summaryKeys).toEqual(['bytes','mediaType']);expect(calls).toHaveLength(1);expect(await row(content.id)).toMatchObject({status:'ready',text:'Résumé issu des seuls octets.'});
  const receipts=(await pool.query('SELECT * FROM hestia_classification_request WHERE actor_id=$1',[actorId])).rows;expect(receipts).toHaveLength(2);expect(JSON.stringify(receipts)).not.toMatch(/Sujet privé|Corps privé|Commentaire privé|NOM_PRIVE/);
  const document=await mail(content.id);await pool.query("UPDATE hestia_inbox_attachment SET state='placed',document_id=$2 WHERE id=$1",[attachmentId,document.documentId]);
  const publicDocument=await data(await app.handleDocument(req(),document.documentId));expect(JSON.stringify(publicDocument)).not.toMatch(/Sujet privé|Corps privé|Commentaire privé|Suggestion synthétique/);
 });
 it('lets a valid summary pass four older jobs whose consultation rights were revoked, and resumes them only after rights return',async()=>{
  const deniedFolder=folderId,denied:Awaited<ReturnType<typeof original>>[]=[];
  for(let index=0;index<4;index++){const content=await original();await mail(content.id);denied.push(content);}
  folderId=(await data(await app.handleFolders(req({name:`Résumé autorisé ${randomUUID()}`})),201)).folder.id;
  const valid=await original();await mail(valid.id);
  await pool.query("UPDATE hestia_content_summary SET updated_at='2000-01-02T00:00:00Z' WHERE content_id=$1",[valid.id]);
  const revoked=await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2 AND capability='consulter' AND revoked_at IS NULL RETURNING id",[deniedFolder,actorId]);expect(revoked.rowCount).toBeGreaterThan(0);
  const wall=new Date(),timed=createSummaryService(access,{...deps,clock:async()=>wall});
  expect(await timed.runSummaryBatch(4)).toEqual({processed:0});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  for(const content of denied){const deferred=await row(content.id);expect(deferred).toMatchObject({status:'pending',request_id:null});expect(deferred.not_before.toISOString()).toBe(new Date(wall.getTime()+60000).toISOString());}
  const nextBatch=await timed.runSummaryBatch(4);expect(nextBatch.processed).toBeGreaterThanOrEqual(1);expect(nextBatch.processed).toBeLessThanOrEqual(4);
  expect(await row(valid.id)).toMatchObject({status:'ready'});expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
  // Eligibility survives worker recreation; a restored right alone does not
  // bypass the durable deferral or cause a provider call for a denied source.
  // A revoked grant stays immutable: restoration issues a distinct grant.
  await pool.query(`INSERT INTO hestia_grant SELECT (jsonb_populate_record(NULL::hestia_grant,to_jsonb(g)||jsonb_build_object('id',gen_random_uuid(),'revoked_at',NULL,'created_at',clock_timestamp()))).* FROM hestia_grant g WHERE id=ANY($1::uuid[])`,[revoked.rows.map(r=>r.id)]);
  // Keep the restored-source assertion independent of other suites' queued
  // originals. The durable not_before gate remains intact.
  for(const content of denied)await priority(content.id);
  const next=createSummaryService(access,{...deps,clock:async()=>new Date(wall.getTime()+60001)});
  expect(await next.runSummaryBatch(4)).toEqual({processed:4});expect(calls).toHaveLength(5);expect(await ledger()).toHaveLength(5);
  for(const content of denied)expect(await row(content.id)).toMatchObject({status:'ready'});
 });
 it('persists mail-only divergence through private GET and seven-day discard/restore, then clears it at placement',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id),contradiction='Le document concerne l’eau; le mail demande une assurance. Choisissez la piste adaptée.',reason='Le document est une facture d’eau.';
  await pool.query("UPDATE hestia_inbox_event SET subject='Assurance logement',context='Contexte privé du mail',context_partial=true WHERE id=(SELECT event_id FROM hestia_inbox_attachment WHERE id=$1)",[attachmentId]);
  await pool.query("UPDATE hestia_inbox_attachment SET comment='' WHERE id=$1",[attachmentId]);
  await pool.query("UPDATE hestia_inbox_analysis_job SET updated_at='2000-01-01T00:00:00Z' WHERE attachment_id=$1",[attachmentId]);let analyses=0;
  const classifier:ClassificationProvider={id:provider.id,mode:'synthetic',quote:()=>({maximumMicros:100,currency:'EUR'}),quoteCheck:()=>null,check:async()=>({status:'unreachable',actualMicros:0}),async analyze(_config,payload){if(!ownedHashes.has(digest(payload.bytes)))return{value:{existing:[],created:[]},actualMicros:1};analyses++;expect(payload.comment).toBeUndefined();expect(payload.inboxContext).toEqual({mail:{subject:'Assurance logement',body:'Contexte privé du mail',partial:true},comment:''});return{value:{existing:[{folderId,reason}],created:[],contradiction},actualMicros:30};}};
  const contextual=createSummaryService(access,{...deps,providers:[classifier],readAuthorizedFolders:async()=>[{id:folderId,name:'Dossier',path:[{id:folderId,name:'Dossier'}],canCreate:true}]});
  for(let batch=0;batch<20&&analyses===0;batch++)await contextual.runSummaryBatch(10);expect(analyses).toBe(1);
  const load=async()=>((await data(await app.handleInboxAttachment(req(),attachmentId))).attachment);
  const ready=await load();expect(ready.analysis).toMatchObject({status:'ready',contradiction,suggestions:[{reason:reason+' '+contradiction}]});
  await data(await app.handleInboxDiscard(req({version:ready.version,idempotencyKey:randomUUID()}),attachmentId));const discarded=await load();expect(discarded.state).toBe('discarded');expect(discarded.analysis).toEqual(ready.analysis);
  await data(await app.handleInboxRestore(req({version:discarded.version,idempotencyKey:randomUUID()}),attachmentId));const restored=await load();expect(restored.state).toBe('pending');expect(restored.analysis).toEqual(ready.analysis);expect(analyses).toBe(1);
  const body={version:restored.version,title:'Facture synthétique classée',mode:'add',destination:{kind:'existing',folderId}},preview=await data(await app.handleInboxPreview(req(body),attachmentId));
  const placed=await data(await app.handleInboxPlace(req({...body,previewToken:preview.previewToken,idempotencyKey:randomUUID()}),attachmentId));
  expect((await pool.query('SELECT comment,analysis FROM hestia_inbox_attachment WHERE id=$1',[attachmentId])).rows[0]).toEqual({comment:'',analysis:{status:'unavailable',suggestions:[]}});
  expect((await app.handleInboxAttachment(req(),attachmentId)).status).toBe(404);expect(JSON.stringify(await data(await app.handleDocument(req(),placed.documentId)))).not.toMatch(/Contexte privé|Assurance logement|Choisissez la piste|contradiction/);
 });
 it('clears divergence on comment edit and never exposes a nonready private contradiction through GET',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id),analysis={status:'ready',contradiction:'Ancienne divergence privée.',suggestions:[{label:'Eau',reason:'Raison. Ancienne divergence privée.',destination:{kind:'existing',folderId}}]};
  await pool.query('UPDATE hestia_inbox_attachment SET analysis=$2 WHERE id=$1',[attachmentId,JSON.stringify(analysis)]);
  await data(await app.handleInboxComment(req({version:1,commentVersion:1,comment:'Correction humaine.'},'PUT'),attachmentId));
  expect((await pool.query('SELECT analysis FROM hestia_inbox_attachment WHERE id=$1',[attachmentId])).rows[0].analysis).toEqual({status:'stale',suggestions:[]});
  for(const status of ['pending','running','stale','unavailable','unknown']){await pool.query('UPDATE hestia_inbox_attachment SET analysis=$2 WHERE id=$1',[attachmentId,JSON.stringify({...analysis,status})]);expect((await data(await app.handleInboxAttachment(req(),attachmentId))).attachment.analysis).toEqual({status,suggestions:[]});}
 });
 it('retains recoverable divergence until actual purge, then removes private analysis and denies departed epochs',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id),analysis={status:'ready',contradiction:'Divergence privée synthétique.',suggestions:[{label:'Eau',reason:'Facture. Divergence privée synthétique.',destination:{kind:'existing',folderId}}]};
  await pool.query('UPDATE hestia_inbox_attachment SET analysis=$2 WHERE id=$1',[attachmentId,JSON.stringify(analysis)]);
  await pool.query('UPDATE hestia_member SET departure_epoch=departure_epoch+1 WHERE user_id=$1',[actorId]);try{expect((await app.handleInboxAttachment(req(),attachmentId)).status).toBe(404);}finally{await pool.query('UPDATE hestia_member SET departure_epoch=departure_epoch-1 WHERE user_id=$1',[actorId]);}
  await data(await app.handleInboxDiscard(req({version:1,idempotencyKey:randomUUID()}),attachmentId));expect((await data(await app.handleInboxAttachment(req(),attachmentId))).attachment.analysis).toEqual(analysis);
  await pool.query("UPDATE hestia_inbox_attachment SET discarded_until=clock_timestamp()-interval '1 second' WHERE id=$1",[attachmentId]);await app.cleanup();
  expect((await pool.query('SELECT state,comment,analysis FROM hestia_inbox_attachment WHERE id=$1',[attachmentId])).rows[0]).toEqual({state:'purged',comment:'',analysis:{status:'unavailable',suggestions:[]}});expect((await app.handleInboxAttachment(req(),attachmentId)).status).toBe(404);
 });
 it('applies migration metadata backfill without retrospectively enqueueing historical AI jobs',async()=>{
  const documentId=await manual();const document=(await pool.query('SELECT * FROM hestia_document WHERE id=$1',[documentId])).rows[0];
  const upload=(await pool.query('SELECT u.* FROM hestia_upload u JOIN hestia_upload_object o ON o.upload_id=u.id WHERE o.object_key=$1',[document.object_key])).rows[0];
  const object=(await pool.query('SELECT * FROM hestia_upload_object WHERE object_key=$1',[document.object_key])).rows[0];
  const member=(await pool.query('SELECT * FROM hestia_member WHERE user_id=$1',[actorId])).rows[0],folder=(await pool.query('SELECT * FROM hestia_folder WHERE id=$1',[folderId])).rows[0];
  const grants=(await pool.query('SELECT * FROM hestia_grant WHERE folder_id=$1',[folderId])).rows;
  const schema='summary_migration_'+randomUUID().replaceAll('-',''),client=await pool.connect();
  try{await client.query('BEGIN');await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET LOCAL search_path TO ${schema}`);
   await client.query('CREATE TABLE "user"(id text PRIMARY KEY,name text NOT NULL);CREATE TABLE session(id text PRIMARY KEY)');
   for(const id of ['001-folders','002-documents','003-access','004-trash','005-family-members','006-family-identity','007-mail-delivery','008-folder-tree','009-folder-move','010-folder-trash','011-capture','012-classification','013-capture-derivatives','014-comment','015-transcription'])await client.query(await readFile(new URL(`../../src/server/db/migrations/${id}.sql`,import.meta.url),'utf8'));
   await client.query('INSERT INTO "user" VALUES($1,$2)',[actorId,'Auteur synthétique restauré']);
   for(const [table,rows] of [['hestia_member',[member]],['hestia_folder',[folder]],['hestia_grant',grants],['hestia_upload',[{...upload,document_id:null}]],['hestia_upload_object',[object]],['hestia_document',[document]]] as const)
    for(const item of rows)await client.query(`INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_record(NULL::${table},$1::json)`,[JSON.stringify(item)]);
   for(const id of ['016-content-revisions','017-inbox','018-content-summary'])await client.query(await readFile(new URL(`../../src/server/db/migrations/${id}.sql`,import.meta.url),'utf8'));
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_content')).rows[0].n).toBe(1);
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_document_revision')).rows[0].n).toBe(1);
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_content_summary')).rows[0].n).toBe(0);
  }finally{await client.query('ROLLBACK');client.release();}
 });
});
