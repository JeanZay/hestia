// Explicit phases only. The coordinator owns and identifies each real HTTP runtime.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {request} from '@playwright/test';
import {S3Client, GetObjectCommand} from '@aws-sdk/client-s3';

const hash=value=>createHash('sha256').update(value).digest('hex');
const args=process.argv.slice(2), option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const phase=option('--phase'), output=path.resolve(option('--out')??''), bindingPath=option('--binding');
const evidenceRoot=path.resolve('artifacts/qualification/comment-voice/rollback');
const legacyHead='6c466c54ee3c1a42ad78e41fc328fa5b5b1015c8';
const runId=process.env.HESTIA_TEST_RUN_ID, password=process.env.HESTIA_TEST_PASSWORD;
const local=url=>['127.0.0.1','[::1]','localhost'].includes(url.hostname);
if(!['prime','legacy','return'].includes(phase)||!bindingPath||!output.startsWith(evidenceRoot+path.sep))throw Error('Explicit phase, binding and new rollback evidence path required');
if(['DEBUG','PWDEBUG','NODE_DEBUG','NODE_DEBUG_NATIVE'].some(key=>process.env[key]))throw Error('Diagnostic logging is prohibited');
if(process.env.HESTIA_ENVIRONMENT!=='local'||!/^hestia-app-[a-f0-9]{16}$/.test(runId??'')||!password)throw Error('Owned synthetic local runtime required');
const db=new URL(process.env.DATABASE_URL??''), origin=new URL(process.env.AUTH_BASE_URL??''), endpoint=new URL(process.env.AWS_ENDPOINT_URL_S3??'');
if(!local(db)||!/^\/hestia_test_[a-z0-9_]+$/.test(db.pathname)||!['postgres:','postgresql:'].includes(db.protocol)
  ||!local(origin)||origin.origin!==process.env.AUTH_BASE_URL||origin.username||origin.password||!['http:','https:'].includes(origin.protocol)
  ||!['127.0.0.1','[::1]'].includes(endpoint.hostname)||!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash
  ||process.env.HESTIA_STORAGE_MODE!=='local'||process.env.HESTIA_S3_BUCKET_ACCESS!=='private'
  ||process.env.HESTIA_S3_BUCKET!==`hestia-test-${runId.slice('hestia-app-'.length)}`)throw Error('Local synthetic DB, origin and private object store required');
try{await stat(output);throw Error('Refusing existing output before effects');}catch(error){if(error.code!=='ENOENT')throw error;}
const bindingBytes=await readFile(bindingPath), binding=JSON.parse(bindingBytes);
const bindingKeys=['schemaVersion','phase','runId','origin','processId','sourceCommit','sourceManifestSha256','buildManifestSha256','recordedAtUtc','exclusive'];
if(Object.keys(binding).some(key=>!bindingKeys.includes(key))||binding.schemaVersion!==1||binding.phase!==phase||binding.runId!==runId||binding.origin!==origin.origin
  ||!Number.isSafeInteger(binding.processId)||binding.processId<1||binding.exclusive!==true
  ||!/^\d{4}-\d\d-\d\dT/.test(binding.recordedAtUtc??'')||!Number.isFinite(Date.parse(binding.recordedAtUtc))||Math.abs(Date.now()-Date.parse(binding.recordedAtUtc))>30*60*1000
  ||![binding.sourceManifestSha256,binding.buildManifestSha256].every(value=>/^[a-f0-9]{64}$/.test(value??''))
  ||!/^[a-f0-9]{40}$/.test(binding.sourceCommit??'')||(phase==='legacy'&&binding.sourceCommit!==legacyHead))throw Error('Exact fresh runtime binding required');
process.kill(binding.processId,0); // Presence only: the coordinator must verify PID/build provenance.
const previousBytes=phase==='prime'?null:await readFile(option('--previous')??'');
const previous=previousBytes?JSON.parse(previousBytes):null;
if(previous&&(previous.protocolRevision!==1||previous.phase!==(phase==='legacy'?'prime':'legacy')||previous.status!=='PASS'||previous.runId!==runId))throw Error('Wrong predecessor or runtime');
if(previous&&previous.primeBinding.origin!==origin.origin)throw Error('Runtime origin changed');
if(phase==='return'&&(binding.sourceManifestSha256!==previous.primeBinding.sourceManifestSha256||binding.buildManifestSha256!==previous.primeBinding.buildManifestSha256))throw Error('Return must use identical N source and build');
const receipt={kind:'comment-voice-real-http-rollback',protocolRevision:1,phase,runId,recordedAtUtc:new Date().toISOString(),status:'RUNNING',stage:'initialization',
  binding,bindingSha256:hash(bindingBytes),primeBinding:previous?.primeBinding??binding,previousSha256:previousBytes?hash(previousBytes):null,
  scenarios:previous?.scenarios??{},migrations:previous?.migrations??null,stt:previous?.stt??null,checks:[],
  limits:['Only coordinator-bound HTTP runtimes count as N / exact N-1 / N; process presence does not authenticate build provenance.',
    'Classification and STT accounting rows are explicit synthetic fixtures, not real paid-provider calls.',
    'No global maintenance or physical purge requested; retained originals are hashed from the owned local S3 store.',
    'A phase PASS is not a complete rollback or delivery PASS. No UI, provider quality or distant qualification.']};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const persist=()=>writeFile(output,JSON.stringify(receipt,null,2)+'\n');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
const s3=new S3Client({endpoint:endpoint.origin,region:process.env.AWS_REGION,forcePathStyle:true,maxAttempts:1,followRegionRedirects:false,
  credentials:{accessKeyId:process.env.AWS_ACCESS_KEY_ID,secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY},requestHandler:{connectionTimeout:3000,requestTimeout:10000}});
let api;
async function json(method,url,data,status=200){const r=await api.fetch(url,{method,data,timeout:30000});assert.equal(r.status(),status,'Unexpected HTTP status');return r.json();}
async function capture(id){return(await json('GET',`/api/hestia/capture/${id}`)).capture;}
async function physical(key,size,expected){
  assert.ok(Number.isSafeInteger(size)&&size>0&&size<=20*1024*1024);const r=await s3.send(new GetObjectCommand({Bucket:process.env.HESTIA_S3_BUCKET,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
  assert.equal(r.ContentLength,size);const chunks=[];let total=0;
  try{for await(const chunk of r.Body){total+=chunk.length;assert.ok(total<=size);chunks.push(chunk);}}finally{r.Body?.destroy?.();}
  assert.equal(total,size);assert.equal(hash(Buffer.concat(chunks)),expected);
}
async function sources(s){
  const rows=(await pool.query('SELECT p.id,p.object_key,p.size,p.sha256 FROM hestia_capture_page p WHERE p.capture_id=$1 ORDER BY p.id',[s.id])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].id,s.pageId);assert.equal(rows[0].sha256,s.sourceSha256);await physical(rows[0].object_key,rows[0].size,rows[0].sha256);
}
async function ledger(s,closed){
  const c=(await pool.query('SELECT comment,comment_version,state,version,expires_at FROM hestia_capture WHERE id=$1',[s.id])).rows[0];assert.ok(c);
  assert.equal(c.comment,closed?'':s.expectedComment);assert.equal(c.expires_at.toISOString(),s.expiresAt);
  const row=(await pool.query('SELECT identity,folders,result,status,reserved_micros,actual_micros,settled_at FROM hestia_classification_request WHERE id=$1',[s.analysisId])).rows[0];assert.ok(row);
  assert.equal(row.reserved_micros,'100');assert.equal(row.actual_micros,s.expectedCost);
  if(closed){assert.equal(row.identity,null);assert.equal(row.folders,null);assert.equal(row.result,null);assert.equal(row.status,'stale');}
  else{assert.equal(row.identity.comment,s.expectedComment);assert.equal(row.status,'complete');}
  return c;
}
async function checkStt(){
  const row=(await pool.query('SELECT * FROM hestia_transcription_request WHERE id=$1',[receipt.stt.id])).rows[0];assert.ok(row);
  assert.equal(hash(JSON.stringify(row)),receipt.stt.rowSha256);assert.equal(row.actual_micros,null);assert.equal(row.reserved_micros,'150');
}
try{
  assert.deepEqual((await pool.query('SELECT run_id FROM hestia_bench_marker')).rows,[{run_id:runId}]);
  const migrations=(await pool.query("SELECT id,checksum FROM hestia_migration WHERE id IN ('014-comment','015-transcription') ORDER BY id")).rows;
  assert.deepEqual(migrations.map(r=>r.id),['014-comment','015-transcription']);
  if(receipt.migrations)assert.deepEqual(migrations,receipt.migrations);else receipt.migrations=migrations;
  await persist();api=await request.newContext({baseURL:origin.origin,extraHTTPHeaders:{origin:origin.origin},timeout:30000});
  receipt.stage='login';await persist();await json('POST','/api/auth/sign-in/email',{email:'camille@hestia.invalid',password});
  if(phase==='prime'){
    const fixture=await readFile('tests/fixtures/documents/synthetic.png');
    const folder=(await json('POST','/api/hestia/folders',{name:`Rollback ${randomUUID().slice(0,8)}`},201)).folder;
    for(const name of ['keep','abandon','finalize']){
      const s={name,id:null,creationKey:randomUUID(),pageId:null,sourceSha256:hash(fixture),expectedComment:`Contexte synthétique ${name}`,expectedCost:name==='finalize'?null:'20',analysisId:randomUUID(),folderId:folder.id};
      receipt.scenarios[name]=s;receipt.stage=`${name}:create`;await persist();
      const c=(await json('POST','/api/hestia/capture',{kind:'import',idempotencyKey:s.creationKey,currentFolderId:null},201)).capture;
      s.id=c.id;s.expiresAt=c.expiresAt;assert.equal(c.comment,'');await persist();
      const upload=await json('POST',`/api/hestia/capture/${s.id}/pages`,{version:c.version,idempotencyKey:randomUUID(),fileName:'synthetic.png',mediaType:'image/png',size:fixture.length,sha256:s.sourceSha256});
      s.pageId=upload.upload.id;await persist();
      await json('PUT',`/api/hestia/capture/${s.id}/pages/${s.pageId}/chunks/0`,fixture);
      const complete=(await json('POST',`/api/hestia/capture/${s.id}/pages/${s.pageId}/complete`,{version:upload.captureVersion})).capture;
      s.version=complete.version;const prepared=await json('POST',`/api/hestia/capture/${s.id}/prepare`,{version:s.version});s.artifact=prepared.artifact;await persist();
      await json('PATCH',`/api/hestia/capture/${s.id}/comment`,{commentVersion:0,comment:s.expectedComment});
      // Fixture-only SQL insert; close/purge operations below must go through real N-1 HTTP.
      const owner=(await pool.query('SELECT actor_id,actor_epoch FROM hestia_capture WHERE id=$1',[s.id])).rows[0];
      await pool.query(`INSERT INTO hestia_classification_request(id,actor_id,actor_epoch,idempotency_key,kind,identity_hash,identity,folders,config_version,month_start,reserved_micros,actual_micros,status,result,created_at,settled_at)
        VALUES($1,$2,$3,$4,'analysis',$5,$6,$7,1,date_trunc('month',now())::date,100,$8,'complete',$9,now(),now())`,
      [s.analysisId,owner.actor_id,owner.actor_epoch,randomUUID(),hash(s.id),JSON.stringify({captureId:s.id,comment:s.expectedComment,expiresAt:s.expiresAt}),JSON.stringify([{id:folder.id,name:'Synthétique',path:[]}]),s.expectedCost,JSON.stringify({existing:[],created:[],summary:'Résultat synthétique'})]);
      if(!receipt.stt){
        const id=randomUUID();receipt.stt={id,rowSha256:null};await persist();
        await pool.query(`INSERT INTO hestia_transcription_request(id,actor_id,actor_epoch,idempotency_key,identity_hash,config_version,month_start,reserved_micros,status,created_at,sent_at)
          VALUES($1,$2,$3,$4,$5,1,date_trunc('month',now())::date,150,'pending',now(),now())`,[id,owner.actor_id,owner.actor_epoch,randomUUID(),hash(s.id)]);
        receipt.stt.rowSha256=hash(JSON.stringify((await pool.query('SELECT * FROM hestia_transcription_request WHERE id=$1',[id])).rows[0]));
      }
      await sources(s);await ledger(s,false);await persist();
    }
    await checkStt();receipt.checks.push('N: additive migrations014/015 present; three actual uploads/preparations/comments; original S3 bytes match; synthetic known/unknown accounting fixtures installed');
  }else if(phase==='legacy'){
    for(const s of Object.values(receipt.scenarios)){const c=await capture(s.id);assert.equal(Object.hasOwn(c,'comment'),false);assert.equal(c.version,s.version);await sources(s);}
    const a=receipt.scenarios.abandon;receipt.stage='legacy:abandon';await persist();await json('DELETE',`/api/hestia/capture/${a.id}`,{version:a.version});
    assert.equal((await ledger(a,true)).state,'abandoned');
    const f=receipt.scenarios.finalize;receipt.stage='legacy:finalize';await persist();
    const input={version:f.version,artifactId:f.artifact.id,destination:{kind:'existing',folderId:f.folderId},keepDuplicate:true};
    const preview=await json('POST',`/api/hestia/capture/${f.id}/preview`,input);
    f.finalizationKey=randomUUID();await persist();
    const finalized=await json('POST',`/api/hestia/capture/${f.id}/finalize`,{...input,previewToken:preview.preview.previewToken,idempotencyKey:f.finalizationKey});
    f.documentId=finalized.document.id;assert.equal(finalized.document.sha256,f.sourceSha256);await persist();
    assert.equal((await ledger(f,true)).state,'finalized');await ledger(receipt.scenarios.keep,false);await checkStt();
    for(const s of Object.values(receipt.scenarios))await sources(s);
    receipt.checks.push('N-1: old DTO and real HTTP abandonment/finalization succeed on new schema; trigger purges comment and classification content synchronously; known/unknown costs and original S3 bytes preserved');
  }else{
    const s=receipt.scenarios.keep;const c=await capture(s.id);assert.equal(c.comment,s.expectedComment);assert.equal(c.commentVersion,1);assert.equal(c.version,s.version);
    await ledger(s,false);await checkStt();for(const name of ['abandon','finalize'])await ledger(receipt.scenarios[name],true);
    receipt.stage='return:comment-save';await persist();const saved=await json('PATCH',`/api/hestia/capture/${s.id}/comment`,{commentVersion:c.commentVersion,comment:'N revenu, contexte synthétique'});
    assert.equal(saved.commentVersion,2);const current=await capture(s.id);assert.equal(current.version,c.version);assert.deepEqual(current.pages,c.pages);assert.equal(current.expiresAt,c.expiresAt);
    const purged=(await pool.query('SELECT identity,folders,result,actual_micros FROM hestia_classification_request WHERE id=$1',[s.analysisId])).rows[0];assert.deepEqual(purged,{identity:null,folders:null,result:null,actual_micros:'20'});
    for(const item of Object.values(receipt.scenarios))await sources(item);
    const f=receipt.scenarios.finalize, document=(await pool.query('SELECT sha256,size,object_key,purged_at FROM hestia_document WHERE id=$1',[f.documentId])).rows[0];assert.ok(document);assert.equal(document.purged_at,null);assert.equal(document.sha256,f.sourceSha256);await physical(document.object_key,document.size,document.sha256);
    const available=await json('GET',`/api/hestia/transcriptions?captureId=${s.id}`);assert.equal(available.available,false);await checkStt();
    receipt.checks.push('N return: retained draft/comment readable and editable with unchanged pixel versions/expiry; closed content stays purged; STT unavailable; unknown debt and finalized original remain unchanged');
  }
  receipt.status='PASS';receipt.stage='complete';
}catch(error){receipt.status='FAIL';receipt.failure=error instanceof assert.AssertionError?'ASSERTION_FAILED':error?.name==='TimeoutError'?'TIMEOUT':'OPERATION_FAILED';}
finally{
  try{await api?.dispose();await pool.end();s3.destroy();}catch{receipt.status='FAIL';receipt.cleanupFailure='RESOURCE_DISPOSAL_FAILED';}
  await persist();
}
if(receipt.status!=='PASS')throw Error('Synthetic rollback failed; see bounded receipt. Raw errors suppressed.');
console.log(JSON.stringify({phase,status:receipt.status,evidence:path.relative(process.cwd(),output)}));
