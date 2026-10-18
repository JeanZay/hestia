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
import { createInboxService } from '../../src/server/inbox';
import { RELAY_CHUNK, signEnvelope, type RelayEnvelope } from '../../src/server/inbox/transport';

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
 const parent=readServerConfig(),url=new URL(parent.databaseUrl),runId=process.env.HESTIA_TEST_RUN_ID??'';
 if(parent.environment!=='local'||!['127.0.0.1','localhost'].includes(url.hostname)||!/^hestia-app-[a-f0-9]{16}$/.test(runId)||url.pathname!==`/hestia_test_${runId.slice('hestia-app-'.length)}`)throw new Error('Owned synthetic integration bench required');
 // Summary batches deliberately inspect the whole household queue. Keep this
 // suite's clocks and job limits independent of other suites' synthetic jobs,
 // while all three summary/analysis classes still compete inside this database.
 const database=url.pathname.slice(1)+'_summary';url.pathname='/'+database;
 const config={...parent,databaseUrl:url.toString()},admin=new Pool({connectionString:parent.databaseUrl,max:1});
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
 const summaries=createSummaryService(access,deps,pool);
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
 async function receivedMail(){
  const secret='synthetic-summary-relay-secret-only-123456',relayActor='summary-relay',address='synthetic-summary@gmail.com',gmailId=randomUUID().replaceAll('-','');
  const inbox=createInboxService(pool,access,{store,budget,environment:'dev',address,relayActor,relayEpoch:1,relaySecret:secret,authenticate:async()=>({sender:email,recipient:address}),enqueueAnalysis:summaries.enqueueAnalysis});
  await pool.query('INSERT INTO hestia_inbox_settings(actor_id,enabled,automatic_analysis) VALUES($1,true,true) ON CONFLICT(actor_id) DO UPDATE SET enabled=true,automatic_analysis=true',[actorId]);
  const bytes=Buffer.from(`From: ${email}\r\nTo: ${address}\r\nSubject: PRIVATE_MAIL_SUBJECT\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sun, 18 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=summary\r\n\r\n--summary\r\nContent-Type: text/plain\r\n\r\nPRIVATE_MAIL_BODY\r\n--summary\r\nContent-Type: image/png\r\nContent-Disposition: attachment; filename="PRIVATE_MAIL_FILENAME.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${image.toString('base64')}\r\n--summary--\r\n`);
  const send=async(operation:'chunk'|'process',index=0)=>{const chunk=bytes.subarray(index*RELAY_CHUNK,(index+1)*RELAY_CHUNK),value:RelayEnvelope={environment:'dev',actor:relayActor,epoch:1,gmailId,rawSha256:digest(bytes),rawSize:bytes.length,chunks:Math.ceil(bytes.length/RELAY_CHUNK),operation,index,chunkSha256:digest(operation==='chunk'?chunk:Buffer.alloc(0)),timestamp:Date.now(),nonce:randomUUID().replaceAll('-',''),payload:operation==='chunk'?chunk.toString('base64'):''};return data(await inbox.handleInboxRelay(new Request(config.origin+'/api/hestia/inbox/relay',{method:'POST',headers:{'content-type':'application/json','x-hestia-signature':signEnvelope(value,secret)},body:JSON.stringify(value)})));};
  for(let index=0;index<Math.ceil(bytes.length/RELAY_CHUNK);index++)await send('chunk',index);const result=await send('process');expect(result.result.outcome).toBe('accepted');
  const attachment=(await pool.query('SELECT id,content_id FROM hestia_inbox_attachment WHERE event_id=$1',[result.result.eventId])).rows[0];
  // The private classification remains covered separately; this assertion owns
  // the new document summary, including the actual MIME admission boundary.
  await pool.query("UPDATE hestia_inbox_analysis_job SET status='unavailable' WHERE attachment_id=$1",[attachment.id]);
  await priority(attachment.content_id);return attachment.content_id as string;
 }
 async function manual(){const created=await data(await app.handleUploads(req({folderId,idempotencyKey:randomUUID(),fileName:'SECRET_FILENAME.png',title:'Titre manuel',size:image.length,mediaType:'image/png',sha256:digest(image),source:'import'})),201);const id=created.operation.id;
  await data(await app.handleUploadChunk(req(image,'PUT'),id,'0'));const completed=await data(await app.handleUploadComplete(req({keepDuplicate:true}),id));return completed.document.id as string;}
 async function capture(){let c=(await data(await app.handleCaptures(req({kind:'camera',idempotencyKey:randomUUID(),currentFolderId:folderId})),201)).capture;
  const upload=await data(await app.handleCapturePages(req({version:c.version,idempotencyKey:randomUUID(),fileName:'SECRET_CAPTURE.png',mediaType:'image/png',size:image.length,sha256:digest(image)}),c.id));
  await data(await app.handleCapturePageChunk(req(image,'PUT'),c.id,upload.upload.id,'0'));c=(await data(await app.handleCapturePageComplete(req({version:upload.captureVersion}),c.id,upload.upload.id))).capture;
  const prepared=await data(await app.handleCapturePrepare(req({version:c.version}),c.id));c=prepared.capture;
  const input={version:c.version,artifactId:prepared.artifact.id,destination:{kind:'existing',folderId},keepDuplicate:true};
  const preview=(await data(await app.handleCapturePreview(req(input),c.id))).preview;
  const document=(await data(await app.handleCaptureFinalize(req({...input,previewToken:preview.previewToken,idempotencyKey:randomUUID()}),c.id))).document;
  ownedHashes.add(document.sha256);return document.id as string;
 }
 beforeAll(async()=>{
  expect((await admin.query('SELECT run_id FROM hestia_bench_marker')).rows).toEqual([{run_id:runId}]);
  await admin.query(`CREATE DATABASE "${database}"`);await migrateDatabase(pool,config);
  await pool.query('CREATE TABLE hestia_bench_marker(run_id text PRIMARY KEY)');await pool.query('INSERT INTO hestia_bench_marker VALUES($1)',[runId]);
  expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
  expect((await pool.query('SELECT run_id FROM hestia_bench_marker')).rows).toEqual([{run_id:runId}]);
  const previous=process.env.DATABASE_URL;
  try{process.env.DATABASE_URL=config.databaseUrl;actorId=await provisionSyntheticMember(pool,{email,name:'Auteur résumé synthétique',password});}
  finally{if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
  console.log(JSON.stringify({summaryDatabase:database,parentRunId:runId,scope:'owned-run-summary-suite'}));
 });
 beforeEach(async()=>{
  await pool.query('UPDATE hestia_summary_scheduler SET next_lane=0');
  await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const login=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email,password})}));expect(login.status).toBe(200);cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  await pool.query("UPDATE hestia_content_summary s SET permitted=false,status='unavailable',text=NULL,request_id=NULL FROM hestia_content c WHERE c.id=s.content_id AND c.owner_id=$1",[actorId]);
  await pool.query("UPDATE hestia_inbox_analysis_job j SET status='unavailable',request_id=NULL,generation=j.generation+1 FROM hestia_inbox_attachment a WHERE a.id=j.attachment_id AND a.actor_id=$1",[actorId]);
  await pool.query("DELETE FROM hestia_classification_request WHERE actor_id=$1 AND kind IN ('summary','inbox_analysis')",[actorId]);
  await pool.query("UPDATE hestia_classification_config SET version=version+1,provider='synthetic-summary',model='fixture',enabled=true,monthly_limit_micros=1000000000,credential_sealed=$1 WHERE id=1",[cipher.seal('synthetic-summary-provider-key','hestia-classification:1:synthetic-summary')]);
  folderId=(await data(await app.handleFolders(req({name:`Résumé ${randomUUID()}`})),201)).folder.id;
  image=await sharp({create:{width:8,height:8,channels:3,background:'#'+randomUUID().replaceAll('-','').slice(0,6)}}).png().toBuffer();ownedHashes=new Set([digest(image)]);calls=[];getHook=undefined;effect=async()=>({value:{summary:'Facture synthétique de démonstration.'},actualMicros:20});
 });
 afterAll(async()=>{await pool.end();await admin.end();});
 it('admits at most one hundred current historical contents per pass in stable order and never duplicates admissions',async()=>{
  const ids:string[]=[];
  for(let index=0;index<102;index++){const content=await original();await mail(content.id);ids.push(content.id);}
  await pool.query('DELETE FROM hestia_content_summary WHERE content_id=ANY($1::uuid[])',[ids]);
  const expected=(await pool.query('SELECT id FROM hestia_content WHERE id=ANY($1::uuid[]) ORDER BY created_at,id LIMIT 100',[ids])).rows.map(r=>r.id);
  await summaries.runSummaryBatch(1);
  const admitted=(await pool.query('SELECT content_id,backfill FROM hestia_content_summary WHERE content_id=ANY($1::uuid[])',[ids])).rows;
  expect(admitted).toHaveLength(100);expect(admitted.every(r=>r.backfill)).toBe(true);expect(admitted.map(r=>r.content_id).sort()).toEqual(expected.sort());expect(calls).toHaveLength(1);
  await summaries.runSummaryBatch(1);await summaries.runSummaryBatch(1);
  expect((await pool.query('SELECT count(*)::int AS n FROM hestia_content_summary WHERE content_id=ANY($1::uuid[])',[ids])).rows[0].n).toBe(102);
  expect(new Set((await ledger()).map(r=>r.identity.contentId)).size).toBe(3);
 });
 it('does not reinterpret a missing summary with an old paid receipt as an unsent historical original',async()=>{
  const content=await original();await mail(content.id);const requestId=await paidReceipt(content.id,'summary');
  await pool.query('DELETE FROM hestia_content_summary WHERE content_id=$1',[content.id]);const receipt=(await ledger())[0];
  await summaries.runSummaryBatch(10);await summaries.runSummaryBatch(10);
  expect(await row(content.id)).toBeUndefined();expect(calls).toHaveLength(0);expect(await ledger()).toEqual([receipt]);expect(receipt.id).toBe(requestId);
  // Preserve a terminal sentinel so following tests cannot turn this fixture
  // into an apparently unsent source after their isolated ledger reset.
  await pool.query("INSERT INTO hestia_content_summary(content_id,status,permitted) VALUES($1,'unknown',false)",[content.id]);
 });
 it('backfills only the current historical revision and admits its missing predecessor after restoration',async()=>{
  const previous=await original(),document=await mail(previous.id),current=await original();const replacement=await mail(current.id,document.documentId,document.version);
  await pool.query('DELETE FROM hestia_content_summary WHERE content_id=ANY($1::uuid[])',[[previous.id,current.id]]);
  await summaries.runSummaryBatch(1);expect(await row(previous.id)).toBeUndefined();expect(await row(current.id)).toMatchObject({status:'ready',backfill:true});expect(calls).toHaveLength(1);
  await data(await revisions.handleDocumentRevisionRestore(req({version:replacement.version,idempotencyKey:randomUUID()}),document.documentId,document.revisionId));
  expect((await data(await summaries.handleDocumentSummary(req(),document.documentId))).summary).toEqual({status:'none'});
  await summaries.runSummaryBatch(1);expect(await row(previous.id)).toMatchObject({status:'ready',backfill:true});expect(calls).toHaveLength(2);
 });
 it.each(['disabled','missing-provider'] as const)('resumes only proven unsent %s admission after the durable sixty-second gate',async mode=>{
  const content=await original(),document=await mail(content.id),wall=new Date();let now=wall;
  if(mode==='disabled')await pool.query('UPDATE hestia_classification_config SET enabled=false WHERE id=1');
  const waiting=createSummaryService(access,{...deps,clock:async()=>now,...(mode==='missing-provider'?{summaryProviders:[]}: {})});
  await waiting.runSummaryBatch(1);const deferred=await row(content.id);
  expect(deferred).toMatchObject({status:'pending',deferred:true,request_id:null});expect(deferred.not_before.toISOString()).toBe(new Date(wall.getTime()+60000).toISOString());
  expect((await data(await waiting.handleDocumentSummary(req(),document.documentId))).summary).toEqual({status:'unavailable',...(mode==='disabled'?{cause:'ai-off'}:{})});
  expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  await pool.query('UPDATE hestia_classification_config SET enabled=true,version=version+1 WHERE id=1');
  const resumed=createSummaryService(access,{...deps,clock:async()=>now});now=new Date(wall.getTime()+59999);
  await resumed.runSummaryBatch(1);expect(await row(content.id)).toEqual(deferred);expect(calls).toHaveLength(0);
  now=new Date(wall.getTime()+60001);await resumed.runSummaryBatch(1);
  expect(await row(content.id)).toMatchObject({status:'ready',deferred:false,cause:null});expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it('resumes budget admission in a new month while retaining an unknown charge from the previous month',async()=>{
  const content=await original(),document=await mail(content.id),oldId=await paidReceipt(content.id,'summary');let now=new Date('2030-01-31T23:59:00Z');
  await pool.query("UPDATE hestia_classification_request SET month_start='2030-01-01',reserved_micros=100,actual_micros=NULL,status='failed' WHERE id=$1",[oldId]);
  const spentId=await paidReceipt(content.id,'summary');await pool.query("UPDATE hestia_classification_request SET month_start='2030-01-01',actual_micros=20,status='complete',settled_at=clock_timestamp() WHERE id=$1",[spentId]);
  await pool.query('UPDATE hestia_classification_config SET monthly_limit_micros=200 WHERE id=1');const debt=(await ledger()).find(r=>r.id===oldId);
  const worker=createSummaryService(access,{...deps,clock:async()=>now});await worker.runSummaryBatch(1);
  expect(await row(content.id)).toMatchObject({status:'pending',deferred:true,cause:'budget',request_id:null});expect(calls).toHaveLength(0);
  expect((await data(await worker.handleDocumentSummary(req(),document.documentId))).summary).toEqual({status:'unavailable',cause:'budget'});
  now=new Date('2030-02-01T00:00:01Z');await pool.query('UPDATE hestia_classification_config SET monthly_limit_micros=199 WHERE id=1');await worker.runSummaryBatch(1);
  expect(await row(content.id)).toMatchObject({status:'pending',deferred:true,cause:'budget'});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(2);
  await pool.query('UPDATE hestia_classification_config SET monthly_limit_micros=200 WHERE id=1');now=new Date('2030-02-01T00:01:02Z');await worker.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'ready'});expect(calls).toHaveLength(1);
  expect((await ledger()).find(r=>r.id===oldId)).toEqual(debt);expect(await ledger()).toHaveLength(3);
 });
 it('does not expose a household budget cause when only the deployment ceiling prevented reservation',async()=>{
  const content=await original(),document=await mail(content.id);const worker=createSummaryService(access,{...deps,deploymentLimitMicros:1});
  await worker.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'pending',deferred:true,request_id:null,cause:null});
  expect((await data(await worker.handleDocumentSummary(req(),document.documentId))).summary).toEqual({status:'unavailable'});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
 });
 it.each(['unknown','unavailable','opt-out'] as const)('never automatically rearms a pre-existing %s result during backfill or configuration changes',async state=>{
  const content=await original();await mail(content.id);
  await pool.query("UPDATE hestia_content_summary SET status=$2,permitted=$3,not_before='-infinity' WHERE content_id=$1",[content.id,state==='opt-out'?'unavailable':state,state!=='opt-out']);const before=await row(content.id);
  await pool.query('UPDATE hestia_classification_config SET version=version+1 WHERE id=1');await summaries.runSummaryBatch(10);await summaries.runSummaryBatch(10);
  expect(await row(content.id)).toEqual(before);expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
 });
 it.each([{value:{summary:null},actualMicros:20,cause:'unreadable'},{value:{summary:'invalid',extra:'PRIVATE_DIAGNOSTIC'},actualMicros:20,cause:null},{value:{summary:null},actualMicros:null,cause:null}])('publishes only a proven unreadable cause for outcome %j',async outcome=>{
  const content=await original(),attachmentId=await pendingArrival(content.id),document=await mail(content.id);effect=async()=>({value:outcome.value,actualMicros:outcome.actualMicros});
  await pool.query("UPDATE hestia_inbox_analysis_job SET status='unavailable' WHERE attachment_id=$1",[attachmentId]);
  await summaries.runSummaryBatch(1);const expected={status:outcome.actualMicros===null?'unknown':'unavailable',...(outcome.cause?{cause:outcome.cause}:{})};
  const results=[(await data(await summaries.handleDocumentSummary(req(),document.documentId))).summary,(await data(await app.handleDocument(req(),document.documentId))).document.summary,
   (await data(await app.handleDocuments(req(undefined,'GET',`/api/hestia/documents?folderId=${folderId}`)))).documents.find((d:{id:string})=>d.id===document.documentId).summary,
   (await data(await app.handleWorkspace(req(undefined,'GET',`/api/hestia/workspace?folderId=${folderId}`)))).documents.find((d:{id:string})=>d.id===document.documentId).summary,
   (await data(await app.handleInboxAttachment(req(),attachmentId))).attachment.summary,
   (await data(await revisions.handleDocumentVersions(req(),document.documentId))).versions.find((v:{id:string})=>v.id===document.revisionId).summary];
  for(const result of results)expect(result).toEqual(expected);
  expect(JSON.stringify(results)).not.toContain('PRIVATE_DIAGNOSTIC');expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
 });
 it.each(['limit-one','deadline'] as const)('lets fresh summaries, historical summaries and private analyses all progress across %s passes',async bound=>{
  const history=await original();await mail(history.id);await pool.query('DELETE FROM hestia_content_summary WHERE content_id=$1',[history.id]);
  const fresh=await original();await mail(fresh.id);const arrival=await original(),attachmentId=await pendingArrival(arrival.id);
  await pool.query("UPDATE hestia_content_summary SET permitted=false,status='unavailable' WHERE content_id=$1",[arrival.id]);let analyses=0,elapsed=0;
  const classifier:ClassificationProvider={id:provider.id,mode:'synthetic',quote:()=>({maximumMicros:100,currency:'EUR'}),quoteCheck:()=>null,check:async()=>({status:'unreachable',actualMicros:0}),analyze:async()=>{analyses++;elapsed=175;return{value:{existing:[],created:[]},actualMicros:30};}};
  effect=async()=>{elapsed=175;return{value:{summary:'Résumé synthétique dans la fenêtre.'},actualMicros:20};};
  const worker=createSummaryService(access,{...deps,providers:[classifier],requestTimeoutMs:50,monotonicNow:()=>elapsed});
  for(let pass=0;pass<3;pass++){elapsed=0;expect(await worker.runSummaryBatch(bound==='limit-one'?1:10,bound==='limit-one'?35000:200)).toEqual({processed:1});}
  expect(await row(history.id)).toMatchObject({status:'ready',backfill:true});expect(await row(fresh.id)).toMatchObject({status:'ready',backfill:false});expect(await analysisRow(attachmentId)).toMatchObject({status:'ready'});
  expect(calls).toHaveLength(2);expect(analyses).toBe(1);expect((await pool.query('SELECT count(*)::int AS n FROM hestia_classification_request WHERE actor_id=$1',[actorId])).rows[0].n).toBe(3);
 });
 it.each([0,11,1.5])('rejects invalid total work limit %s before admission or paid work',async limit=>{
  await expect(summaries.runSummaryBatch(limit)).rejects.toThrow();expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
 });
 it('rejects a work deadline above thirty-five seconds before admission or paid work',async()=>{
  await expect(summaries.runSummaryBatch(10,35001)).rejects.toThrow();expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
 });
 it('keeps summary cost and ready state after an observation-only failure',async()=>{
  const content=await original();await mail(content.id);
  const brokenPool={connect:async()=>{throw Error('Synthetic observation unavailable');}} as unknown as Pool;
  const isolated=createSummaryService(access,deps,brokenPool);
  await isolated.runSummaryBatch(1);
  const state=await row(content.id);expect(state.status).toBe('ready');
  expect((await ledger())[0]).toMatchObject({actual_micros:'20',status:'complete'});
  expect((await pool.query('SELECT * FROM hestia_provider_invocation_observation WHERE request_id=$1',[state.request_id])).rows).toEqual([]);
 });
 it('records summary duration before business settlement and emits no observation on cache reuse',async()=>{
  const content=await original();await mail(content.id);
  let tick=0n;
  const measured=createSummaryService(access,{...deps,monotonicNowNs:()=>{tick+=1000001n;return tick;}},pool);
  await measured.runSummaryBatch(1);await measured.runSummaryBatch(1);
  const state=await row(content.id);
  expect((await pool.query('SELECT operation,outcome,elapsed_us FROM hestia_provider_invocation_observation WHERE request_id=$1',[state.request_id])).rows).toEqual([{operation:'summary',outcome:'resolved',elapsed_us:'1001'}]);
  expect(calls).toHaveLength(1);
 });
 it('excludes gated reservation and settlement waits from the adapter observation on real PostgreSQL',async()=>{
  const content=await original();await mail(content.id);
  let wallMs=Date.now(),monotonicNs=0n,transactions=0;
  let reservationEntered!:()=>void,releaseReservation!:()=>void,settlementEntered!:()=>void,releaseSettlement!:()=>void;
  const atReservation=new Promise<void>(resolve=>{reservationEntered=resolve;});
  const reservationGate=new Promise<void>(resolve=>{releaseReservation=resolve;});
  const atSettlement=new Promise<void>(resolve=>{settlementEntered=resolve;});
  const settlementGate=new Promise<void>(resolve=>{releaseSettlement=resolve;});
  // These gates execute inside genuine Access transactions, not replacement SQL.
  // Logical clocks simulate 15s at each gate; this is not 30s of real wall latency.
  const gatedAccess:typeof access={...access,transaction:action=>{
   const position=++transactions;
   return access.transaction(async client=>{
    if(position===4){settlementEntered();await settlementGate;}
    const result=await action(client);
    if(position===3){reservationEntered();await reservationGate;}
    return result;
   });
  }};
  effect=async()=>{wallMs+=1;monotonicNs+=1000000n;return{value:{summary:'Résumé synthétique mesuré.'},actualMicros:20};};
  const measured=createSummaryService(gatedAccess,{...deps,requestTimeoutMs:25000,clock:async()=>new Date(wallMs),monotonicNowNs:()=>monotonicNs},pool);
  const running=measured.runSummaryBatch(1);
  try{
   await atReservation;expect(calls).toHaveLength(0);
   expect((await row(content.id)).request_id).toBeNull(); // Reservation not committed yet.
   wallMs+=15000;monotonicNs+=15000000000n;releaseReservation();
   await atSettlement;expect(calls).toHaveLength(1);
   const pending=await row(content.id);
   expect((await pool.query('SELECT actual_micros,settled_at FROM hestia_classification_request WHERE id=$1',[pending.request_id])).rows).toEqual([{actual_micros:null,settled_at:null}]);
   expect((await pool.query('SELECT * FROM hestia_provider_invocation_observation WHERE request_id=$1',[pending.request_id])).rows).toEqual([]);
   wallMs+=15000;monotonicNs+=15000000000n;releaseSettlement();
   expect(await running).toEqual({processed:1});
  }finally{releaseReservation();releaseSettlement();await running;}
  expect(transactions).toBe(4);
  const state=await row(content.id);expect(state).toMatchObject({status:'ready',text:'Résumé synthétique mesuré.'});
  const request=(await pool.query('SELECT actual_micros,status,EXTRACT(EPOCH FROM (settled_at-sent_at))*1000 AS db_ms FROM hestia_classification_request WHERE id=$1',[state.request_id])).rows[0];
  expect(request).toMatchObject({actual_micros:'20',status:'complete'});expect(Number(request.db_ms)).toBe(30001);
  expect((await pool.query('SELECT elapsed_us,timeout_ms,measurement_status,outcome FROM hestia_provider_invocation_observation WHERE request_id=$1',[state.request_id])).rows).toEqual([{elapsed_us:'1000',timeout_ms:25000,measurement_status:'OBSERVED',outcome:'resolved'}]);
 });
 it('keeps Inbox analysis ready and its charge durable when only the observation writer fails',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);
  await pool.query("UPDATE hestia_content_summary SET permitted=false,status='unavailable' WHERE content_id=$1",[content.id]);
  const classifier:ClassificationProvider={id:provider.id,mode:'synthetic',quote:()=>({maximumMicros:100,currency:'EUR'}),quoteCheck:()=>null,check:async()=>({status:'unreachable',actualMicros:0}),analyze:async()=>({value:{existing:[],created:[]},actualMicros:30})};
  const brokenPool={connect:async()=>{throw Error('Synthetic observation unavailable');}} as unknown as Pool;
  const isolated=createSummaryService(access,{...deps,providers:[classifier]},brokenPool);
  for(let batch=0;batch<20&&(await analysisRow(attachmentId)).status==='pending';batch++)await isolated.runSummaryBatch(10);
  const job=await analysisRow(attachmentId);expect(job.status).toBe('ready');
  expect((await pool.query('SELECT actual_micros,status FROM hestia_classification_request WHERE id=$1',[job.request_id])).rows).toEqual([{actual_micros:'30',status:'complete'}]);
  expect((await pool.query('SELECT * FROM hestia_provider_invocation_observation WHERE request_id=$1',[job.request_id])).rows).toEqual([]);
 });
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
 it('queues and summarizes real manual upload, camera capture and mail placement originals',async()=>{
  const manualId=await manual(),captureId=await capture(),mailContentId=await receivedMail(),mailDoc=await mail(mailContentId);
  const queued=(await pool.query(`SELECT d.source,s.status FROM hestia_document d JOIN hestia_document_revision r ON r.id=d.current_revision_id JOIN hestia_content_summary s ON s.content_id=r.content_id WHERE d.id=ANY($1::uuid[])`,[[manualId,captureId,mailDoc.documentId]])).rows;
  expect(queued.map(r=>r.source).sort()).toEqual(['camera','import','mail']);expect(queued.every(r=>r.status==='pending')).toBe(true);expect(calls).toHaveLength(0);
  for(const id of [manualId,captureId,mailDoc.documentId])await pool.query("UPDATE hestia_content_summary SET updated_at='2000-01-01T00:00:00Z' WHERE content_id=(SELECT r.content_id FROM hestia_document d JOIN hestia_document_revision r ON r.id=d.current_revision_id WHERE d.id=$1)",[id]);
  expect(await summaries.runSummaryBatch(3)).toEqual({processed:3});expect(calls).toHaveLength(3);expect(await ledger()).toHaveLength(3);
  for(const id of [manualId,captureId,mailDoc.documentId])expect((await data(await summaries.handleDocumentSummary(req(),id))).summary).toEqual({status:'ready',text:'Facture synthétique de démonstration.'});
 });
 it('does not spend or enqueue work by reading a historical document with no summary row',async()=>{
  const content=await original(),document=await mail(content.id);await pool.query('DELETE FROM hestia_content_summary WHERE content_id=$1',[content.id]);
  for(const method of ['GET','POST'])expect(await data(await summaries.handleDocumentSummary(req(method==='POST'?{}:undefined,method),document.documentId))).toMatchObject({summary:{status:'none'}});
  await app.handleDocuments(req());expect(await row(content.id)).toBeUndefined();expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'ready',backfill:true});expect(calls).toHaveLength(1);
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
  await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'pending',deferred:true,cause:'budget',text:null});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);
  expect((await app.handleDocument(req(),document.documentId)).status).toBe(200);
 });
 it('rechecks admission after reading objects and before reserving a paid call',async()=>{
  const content=await original();await mail(content.id);getHook=async()=>{getHook=undefined;await pool.query('UPDATE hestia_member SET recovering=true WHERE user_id=$1',[actorId]);};
  try{await summaries.runSummaryBatch(1);expect(await row(content.id)).toMatchObject({status:'pending',deferred:true,cause:null,request_id:null,text:null});expect(calls).toHaveLength(0);expect(await ledger()).toHaveLength(0);}finally{await pool.query('UPDATE hestia_member SET recovering=false WHERE user_id=$1',[actorId]);}
 });
 it('serializes concurrent workers per content without holding SQL locks over provider I/O',async()=>{
  const content=await original();const document=await mail(content.id);let release!:()=>void,entered!:()=>void;
  await pool.query('DELETE FROM hestia_content_summary WHERE content_id=$1',[content.id]);
  const sent=new Promise<void>(resolve=>{entered=resolve;});effect=async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return{value:{summary:'Document traité une fois.'},actualMicros:20};};
  const first=summaries.runSummaryBatch(1);await sent;
  try{expect((await app.handleDocument(req(),document.documentId)).status).toBe(200);await summaries.runSummaryBatch(1);expect(calls).toHaveLength(1);}finally{release();await first;}
  expect(await row(content.id)).toMatchObject({status:'ready',text:'Document traité une fois.'});expect(await ledger()).toHaveLength(1);
 });
 it('retains unknown debt when reservation COMMIT succeeds but its transaction response is lost',async()=>{
  const content=await original();await mail(content.id);let transactions=0,now=new Date();
  const ambiguousAccess:typeof access={...access,transaction:async action=>{
   const position=++transactions,result=await access.transaction(action);
   // PostgreSQL has committed the genuine reservation before the caller loses
   // its reply. A thrown promise cannot prove that no durable charge exists.
   if(position===3)throw new Error('Synthetic reply lost after reservation COMMIT');
   return result;
  }};
  const worker=createSummaryService(ambiguousAccess,{...deps,clock:async()=>now});
  expect(await worker.runSummaryBatch(1)).toEqual({processed:1});
  const checkpoint=await row(content.id),requests=await ledger();
  expect(checkpoint).toMatchObject({status:'unknown',text:null,cause:null,deferred:false});expect(checkpoint.request_id).toBeTruthy();
  expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({id:checkpoint.request_id,reserved_micros:'100',actual_micros:null,status:'failed'});expect(calls).toHaveLength(0);
  now=new Date(now.getTime()+60001);await worker.runSummaryBatch(1);await summaries.runSummaryBatch(1);
  expect(await row(content.id)).toEqual(checkpoint);expect(await ledger()).toEqual(requests);expect(calls).toHaveLength(0);
 });
 it('rechecks durable deferral after a competing batch selected the original before an unsent storage failure',async()=>{
  const content=await original();await mail(content.id);let selected!:()=>void,release!:()=>void,transactions=0,reads=0,fail=true,now=new Date();
  const selectionCommitted=new Promise<void>(resolve=>{selected=resolve;}),selectionGate=new Promise<void>(resolve=>{release=resolve;});
  const pausedAccess:typeof access={...access,transaction:async action=>{
   const position=++transactions,result=await access.transaction(action);
   if(position===1){selected();await selectionGate;}
   return result;
  }};
  const timed:SummaryDependencies={...deps,clock:async()=>now,store:{...store,async getRange(...args){reads++;if(fail)throw new Error('Synthetic unavailable original before reservation');return store.getRange(...args);}}};
  const staleWorker=createSummaryService(pausedAccess,timed),activeWorker=createSummaryService(access,timed),staleBatch=staleWorker.runSummaryBatch(1);
  await selectionCommitted;
  try{
   expect(await activeWorker.runSummaryBatch(1)).toEqual({processed:1});const deferred=await row(content.id);
   expect(deferred).toMatchObject({status:'pending',deferred:true,request_id:null,cause:null});expect(deferred.not_before.toISOString()).toBe(new Date(now.getTime()+60000).toISOString());
   expect(reads).toBe(1);expect(await ledger()).toHaveLength(0);fail=false;release();
   expect(await staleBatch).toEqual({processed:0});expect(await row(content.id)).toEqual(deferred);expect(reads).toBe(1);expect(calls).toHaveLength(0);
   now=new Date(now.getTime()+59999);await activeWorker.runSummaryBatch(1);expect(await row(content.id)).toEqual(deferred);expect(reads).toBe(1);
   now=new Date(now.getTime()+2);expect(await activeWorker.runSummaryBatch(1)).toEqual({processed:1});expect(await row(content.id)).toMatchObject({status:'ready'});expect(reads).toBe(2);expect(calls).toHaveLength(1);expect(await ledger()).toHaveLength(1);
  }finally{release();await staleBatch;}
 });
 it('fences a pending original that already carries a durable paid request before any object read or retry',async()=>{
  const content=await original();await mail(content.id);const requestId=await paidReceipt(content.id,'summary');let reads=0;
  await pool.query("UPDATE hestia_content_summary SET request_id=$2,status='pending',not_before='-infinity' WHERE content_id=$1",[content.id,requestId]);
  const receipts=await ledger(),worker=createSummaryService(access,{...deps,store:{...store,async getRange(...args){reads++;return store.getRange(...args);}}});
  expect(await worker.runSummaryBatch(1)).toEqual({processed:0});const checkpoint=await row(content.id);
  expect(checkpoint).toMatchObject({status:'unknown',request_id:requestId,text:null,cause:null,deferred:false});expect(reads).toBe(0);expect(calls).toHaveLength(0);
  const settled=await ledger();expect(settled).toHaveLength(1);expect(settled[0]).toMatchObject({...receipts[0],status:'failed',settled_at:expect.any(Date)});expect(settled[0].actual_micros).toBeNull();expect(settled[0].reserved_micros).toBe('100');
  await worker.runSummaryBatch(1);expect(await row(content.id)).toEqual(checkpoint);expect(await ledger()).toEqual(settled);expect(reads).toBe(0);expect(calls).toHaveLength(0);
 });
 it('cancels pending automatic jobs on opt-out while an explicit manual request remains available',async()=>{
  const content=await original(),attachmentId=await pendingArrival(content.id);await optOut();
  expect(await row(content.id)).toMatchObject({permitted:false,status:'unavailable',auto_origin:true});
  expect((await pool.query('SELECT status,auto_origin FROM hestia_inbox_analysis_job WHERE attachment_id=$1',[attachmentId])).rows[0]).toEqual({status:'unavailable',auto_origin:true});
  await summaries.runSummaryBatch(1);expect(calls).toHaveLength(0);
  await access.transaction(client=>summaries.requestAnalysis(client,{attachmentId,contentId:content.id,actorId,idempotencyKey:randomUUID(),version:1,commentVersion:1}));
  expect(await row(content.id)).toMatchObject({permitted:true,status:'pending',auto_origin:false});
  await priority(content.id);
  for(let pass=0;pass<3&&(await row(content.id)).status==='pending';pass++)await summaries.runSummaryBatch(1);
  expect(await row(content.id)).toMatchObject({status:'ready',auto_origin:false});expect(calls).toHaveLength(1);
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
  const contextual=createSummaryService(access,{...deps,providers:[classifier],readAuthorizedFolders:async(_client,actor)=>actor.id===actorId?[{id:folderId,name:'Dossier autorisé',path:[{id:folderId,name:'Dossier autorisé'}],canCreate:true}]:[]},pool);
  effect=async payload=>{summaryKeys=Object.keys(payload).sort();return{value:{summary:'Résumé issu des seuls octets.'},actualMicros:20};};
  // Other suites may also have queued synthetic originals in this shared bench.
  // Drain a bounded number while identifying only this arrival's own provider call.
  for(let batch=0;batch<20&&captured.length===0;batch++)await contextual.runSummaryBatch(10);
  expect(captured).toHaveLength(1);expect(captured[0].comment).toBeUndefined();expect(captured[0].inboxContext).toEqual({mail:{subject:'Sujet privé synthétique',body:'Corps privé synthétique',partial:true},comment:'Commentaire privé synthétique'});
  expect(summaryKeys).toEqual(['bytes','mediaType']);expect(calls).toHaveLength(1);expect(await row(content.id)).toMatchObject({status:'ready',text:'Résumé issu des seuls octets.'});
  const receipts=(await pool.query('SELECT * FROM hestia_classification_request WHERE actor_id=$1',[actorId])).rows;expect(receipts).toHaveLength(2);expect(JSON.stringify(receipts)).not.toMatch(/Sujet privé|Corps privé|Commentaire privé|NOM_PRIVE/);
  const observations=(await pool.query('SELECT operation,outcome FROM hestia_provider_invocation_observation WHERE request_id=ANY($1::uuid[]) ORDER BY operation',[receipts.map(r=>r.id)])).rows;
  expect(observations).toEqual([{operation:'inbox_analysis',outcome:'resolved'},{operation:'summary',outcome:'resolved'}]);
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
   for(const id of ['016-content-revisions','017-inbox','018-content-summary','019-provider-invocation-observation'])await client.query(await readFile(new URL(`../../src/server/db/migrations/${id}.sql`,import.meta.url),'utf8'));
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_content')).rows[0].n).toBe(1);
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_document_revision')).rows[0].n).toBe(1);
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_content_summary')).rows[0].n).toBe(0);
   const historicalId=(await client.query('SELECT id FROM hestia_content')).rows[0].id,legacyIds=[randomUUID(),randomUUID(),randomUUID()];
   await client.query(`INSERT INTO hestia_content(id,object_key,owner_id,size,sha256,media_type,file_name,preview_supported)
    SELECT id,'synthetic-migration/'||id::text,$2,1,repeat('a',64),'image/png','Fixture.png',true FROM unnest($1::uuid[]) AS id`,[legacyIds,actorId]);
   await client.query("UPDATE hestia_content_summary SET status='ready',text='Phrase existante.' WHERE content_id=$1",[legacyIds[0]]);
   await client.query("UPDATE hestia_content_summary SET status='unknown' WHERE content_id=$1",[legacyIds[1]]);
   await client.query("UPDATE hestia_content_summary SET status='unavailable',permitted=false WHERE content_id=$1",[legacyIds[2]]);
   const before=(await client.query('SELECT content_id,status,text,permitted,generation,request_id FROM hestia_content_summary ORDER BY content_id')).rows;
   await client.query(await readFile(new URL('../../src/server/db/migrations/020-systematic-summaries.sql',import.meta.url),'utf8'));
   expect((await client.query('SELECT content_id,status,text,permitted,generation,request_id FROM hestia_content_summary ORDER BY content_id')).rows).toEqual(before);
   expect((await client.query('SELECT * FROM hestia_summary_scheduler')).rows).toEqual([{id:true,next_lane:0}]);
   expect((await client.query('SELECT count(*)::int AS n FROM hestia_content_summary WHERE content_id=$1',[historicalId])).rows[0].n).toBe(0);
   // Prior application SQL remains executable on the additive schema; this
   // proves these readers/writers, without claiming a full binary rollback.
   expect((await client.query('SELECT status,text,permitted FROM hestia_content_summary WHERE content_id=$1',[legacyIds[0]])).rows).toEqual([{status:'ready',text:'Phrase existante.',permitted:true}]);
   await client.query("INSERT INTO hestia_content_summary(content_id,status,permitted) VALUES($1,'pending',true)",[historicalId]);
   await client.query("UPDATE hestia_content_summary SET status='ready',text='Ancienne écriture compatible.' WHERE content_id=$1",[historicalId]);
   expect((await client.query('SELECT status,text,permitted,cause,deferred,backfill FROM hestia_content_summary WHERE content_id=$1',[historicalId])).rows).toEqual([{status:'ready',text:'Ancienne écriture compatible.',permitted:true,cause:null,deferred:false,backfill:false}]);
  }finally{await client.query('ROLLBACK');client.release();}
 });
});
