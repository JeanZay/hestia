import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { guarded, HttpError, invalid, isUuid, json, response, unavailable, type Access, type Actor } from '../access';
import type { ObjectStore } from '../storage';
import { getFolderAccess } from '../permissions/service';
import type { DocumentSummaryDto, InboxSuggestionDto } from '../../shared/inbox-contract';
import type { ClassificationConfiguration, ClassificationDependencies, ProviderOutcome, ProviderPayload } from '../classification/types';
import type { CaptureMediaType } from '../../shared/capture-contract';
import { utcMonth } from '../classification/validation';
import { typedInboxAnalysisContext, projectInboxAnalysis } from '../inbox/analysis';
import { parseSummary, type SummaryProvider } from './provider';
import { observeProviderInvocation, persistProviderObservation } from '../classification/provider-observation';

export type SummaryDependencies = Pick<ClassificationDependencies,'clock'|'credentialCipher'|'readAuthorizedFolders'|'providers'|'allowRemote'|'deploymentLimitMicros'|'requestTimeoutMs'|'monotonicNowNs'> & {store:ObjectStore;summaryProviders:readonly SummaryProvider[];monotonicNow?:()=>number};
type Config={version:string;provider:string;model:string;enabled:boolean;monthly_limit_micros:string;currency:string;credential_sealed:string|null};
type Content={id:string;object_key:string;owner_id:string;sha256:string;size:number;media_type:CaptureMediaType;epoch:number;name:string;email:string};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const configured=(r:Config):ClassificationConfiguration=>({version:Number(r.version),provider:r.provider,model:r.model,enabled:r.enabled,monthlyLimitMicros:Number(r.monthly_limit_micros),currency:r.currency});
class WorkDeferred extends Error {}
export function createSummaryService(access:Access,deps:SummaryDependencies,pool?:Pool){
 const monotonic=deps.monotonicNow??(()=>performance.now());
 const remaining=(deadline:number)=>deadline-monotonic();
 function requireTime(deadline:number,milliseconds:number){if(remaining(deadline)<milliseconds)throw new WorkDeferred();}
 async function readSummary(client:PoolClient,id:string):Promise<DocumentSummaryDto>{
  const row=(await client.query('SELECT status,text,permitted FROM hestia_content_summary WHERE content_id=$1',[id])).rows[0];
  return !row||!row.permitted?{status:'unavailable'}:{status:row.status,...(row.status==='ready'&&row.text?{text:row.text}:{})};
 }
 async function source(client:PoolClient,id:string):Promise<Content>{
  const row=(await client.query<Content>(`SELECT c.*,m.epoch,u.name,u.email FROM hestia_content c JOIN hestia_member m ON m.user_id=c.owner_id JOIN "user" u ON u.id=c.owner_id WHERE c.id=$1 AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL AND m.active AND NOT m.recovering FOR UPDATE OF c,m`,[id])).rows[0];
  if(!row)throw unavailable();
  const inbox=(await client.query(`SELECT 1 FROM hestia_inbox_attachment a JOIN hestia_member m ON m.user_id=a.actor_id WHERE a.content_id=$1 AND a.state='pending' AND a.actor_id=$2 AND a.departure_epoch=m.departure_epoch`,[id,row.owner_id])).rowCount;
  if(inbox)return row;
  const docs=(await client.query(`SELECT d.folder_id FROM hestia_document_revision r JOIN hestia_document d ON d.id=r.document_id WHERE r.content_id=$1 AND d.trashed_at IS NULL AND d.purged_at IS NULL AND (d.current_revision_id=r.id OR r.recoverable_until>$2)`,[id,await deps.clock(client)])).rows;
  for(const doc of docs)if((await getFolderAccess(client,row.owner_id,doc.folder_id)).capabilities.includes('consulter'))return row;
  throw unavailable();
 }
 async function readBytes(c:Content,deadline:number){
  if(c.size<1||c.size>20*1024*1024)throw unavailable();
  const bytes=new Uint8Array(c.size);
  let closed=false,timer:ReturnType<typeof setTimeout>|undefined;
  try{requireTime(deadline,1);const reads:Promise<void>[]=[];
   // At most ten 2MiB ranges: no unbounded concurrency or serial tenfold timeout.
   // The 20MiB output plus in-flight ranges uses at most40MiB of byte buffers.
   for(let offset=0;offset<c.size;offset+=2*1024*1024){const end=Math.min(c.size,offset+2*1024*1024);
    reads.push(deps.store.getRange(c.object_key,offset,end-1).then(chunk=>{if(closed)return;if(chunk.length!==end-offset)throw unavailable();bytes.set(chunk,offset);}));
   }
   await Promise.race([Promise.all(reads),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{closed=true;reject(new WorkDeferred());},Math.max(1,remaining(deadline)));})]);
   if(createHash('sha256').update(bytes).digest('hex')!==c.sha256)throw unavailable();return bytes;
  }catch(error){closed=true;bytes.fill(0);throw error;}finally{closed=true;clearTimeout(timer);}
 }
 async function enqueueAnalysis(client:PoolClient,input:{attachmentId:string;contentId:string;actorId:string;automaticAnalysis:boolean}){
  await client.query(`UPDATE hestia_content_summary SET permitted=$2,status=CASE WHEN $2 THEN status ELSE 'unavailable' END,text=CASE WHEN $2 THEN text ELSE NULL END WHERE content_id=$1`,[input.contentId,input.automaticAnalysis]);
  if(!input.automaticAnalysis)return;
  await enqueue(client,input.attachmentId,input.contentId,true);
 }
 async function enqueue(client:PoolClient,attachmentId:string,contentId:string,automatic=false){
  await client.query(`UPDATE hestia_content_summary SET permitted=true,auto_origin=$2,
    status=CASE WHEN NOT $2 AND status IN ('unavailable','unknown') THEN 'pending' ELSE status END,
    request_id=CASE WHEN NOT $2 AND status IN ('unavailable','unknown') THEN NULL ELSE request_id END,
    generation=generation+CASE WHEN NOT $2 AND status IN ('unavailable','unknown') THEN 1 ELSE 0 END,
    not_before=CASE WHEN NOT $2 AND status<>'running' THEN '-infinity'::timestamptz ELSE not_before END WHERE content_id=$1`,[contentId,automatic]);
  await client.query(`INSERT INTO hestia_inbox_analysis_job(attachment_id,attachment_version,comment_version,auto_origin) SELECT id,version,comment_version,$2 FROM hestia_inbox_attachment WHERE id=$1 AND state='pending' ON CONFLICT(attachment_id) DO UPDATE SET status='pending',request_id=NULL,not_before='-infinity',attachment_version=EXCLUDED.attachment_version,comment_version=EXCLUDED.comment_version,auto_origin=EXCLUDED.auto_origin,generation=hestia_inbox_analysis_job.generation+1,updated_at=clock_timestamp()`,[attachmentId,automatic]);
  await client.query(`UPDATE hestia_inbox_attachment SET analysis='{"status":"pending","suggestions":[]}' WHERE id=$1`,[attachmentId]);
 }
 async function requestAnalysis(client:PoolClient,input:{attachmentId:string;contentId:string;actorId:string;idempotencyKey:string;version:number;commentVersion:number}){
  // A retry of the same explicit command cannot resend a provider request.
  const identity=hash([input.attachmentId,input.version,input.commentVersion]);
  const old=(await client.query('SELECT identity_sha256 FROM hestia_inbox_analysis_command WHERE actor_id=$1 AND idempotency_key=$2',[input.actorId,input.idempotencyKey])).rows[0];
  if(old){if(old.identity_sha256!==identity)throw invalid();return;}
  await client.query('INSERT INTO hestia_inbox_analysis_command(actor_id,idempotency_key,identity_sha256) VALUES($1,$2,$3)',[input.actorId,input.idempotencyKey,identity]);
  await enqueue(client,input.attachmentId,input.contentId);
 }
 async function reserve(client:PoolClient,c:Content,kind:'summary'|'inbox_analysis',payload:ProviderPayload){
  const config=(await client.query<Config>('SELECT * FROM hestia_classification_config WHERE id=1 FOR UPDATE')).rows[0];
  const provider=kind==='summary'?deps.summaryProviders.find(p=>p.id===config.provider):deps.providers.find(p=>p.id===config.provider);
  if(!config.enabled||!config.credential_sealed||!provider||provider.mode==='remote'&&!deps.allowRemote)return null;
  const quote=provider.quote(configured(config),payload);if(!quote||quote.currency!=='EUR'||!Number.isSafeInteger(quote.maximumMicros)||quote.maximumMicros<1)return null;
  const now=await deps.clock(client),month=utcMonth(now).start;
  const used=(await client.query(`SELECT COALESCE(SUM(actual_micros) FILTER(WHERE month_start=$1::date),0)::text AS spent,COALESCE(SUM(reserved_micros) FILTER(WHERE actual_micros IS NULL),0)::text AS reserved FROM hestia_classification_request`,[month])).rows[0];
  const limit=Math.min(Number(config.monthly_limit_micros),deps.deploymentLimitMicros??1e12);
  if(!Number.isSafeInteger(limit)||BigInt(used.spent)+BigInt(used.reserved)+BigInt(quote.maximumMicros)>BigInt(limit))return null;
  const id=randomUUID();
  await client.query(`INSERT INTO hestia_classification_request(id,actor_id,actor_epoch,idempotency_key,kind,identity_hash,identity,config_version,month_start,reserved_micros,created_at,sent_at) VALUES($1,$2,$3,$1,$4,$5,$6,$7,$8,$9,$10,$10)`,[id,c.owner_id,c.epoch,kind,hash([c.id,c.sha256,c.epoch]),JSON.stringify({contentId:c.id}),config.version,month,quote.maximumMicros,now]);
  return {id,config,provider,maximum:quote.maximumMicros,credential:deps.credentialCipher.open(config.credential_sealed,`hestia-classification:1:${config.provider}`)};
 }
 async function settle(client:PoolClient,id:string,actual:number|null,status:'complete'|'failed'){
  await client.query(`UPDATE hestia_classification_request SET actual_micros=$2,status=$3,settled_at=$4 WHERE id=$1 AND settled_at IS NULL`,[id,actual,status,await deps.clock(client)]);
 }
 async function processSummary(id:string,deadline:number){
  const content=await access.transaction(async client=>{
   const row=(await client.query('SELECT * FROM hestia_content_summary WHERE content_id=$1 FOR UPDATE',[id])).rows[0];
   if(!row?.permitted||row.status!=='pending')return null;
   let c:Content;try{c=await source(client,id);}catch(error){
    // Revoked consultation must not monopolize the oldest limited batch. Keep
    // the unsent job for a later rights check, without reserving provider cost.
    if(!(error instanceof HttpError)||error.status!==404||error.code!=='NOT_FOUND')throw error;
    await client.query("UPDATE hestia_content_summary SET not_before=$2::timestamptz+interval '60 seconds',generation=generation+1,updated_at=$2 WHERE content_id=$1",[id,await deps.clock(client)]);
    return null;
   }
   await client.query("UPDATE hestia_content_summary SET status='running',updated_at=$2 WHERE content_id=$1",[id,await deps.clock(client)]);return {...c,generation:row.generation};
  });
  if(!content)return false;
  let bytes:Uint8Array|undefined,reservation:Awaited<ReturnType<typeof reserve>>=null,actual:number|null=null,text:string|null=null;
  let status:DocumentSummaryDto['status']='unavailable';
  let invocation:ReturnType<typeof observeProviderInvocation<ProviderOutcome>>|undefined;
  try{
   bytes=await readBytes(content,deadline-deps.requestTimeoutMs);
   reservation=await access.transaction(async client=>{const current=await source(client,id);if(current.owner_id!==content.owner_id||current.epoch!==content.epoch)throw unavailable();
    const row=(await client.query('SELECT permitted,generation,status FROM hestia_content_summary WHERE content_id=$1 FOR UPDATE',[id])).rows[0];if(!row?.permitted||row.generation!==content.generation||row.status!=='running')return null;
    requireTime(deadline,deps.requestTimeoutMs);
    const saved=await reserve(client,content,'summary',{bytes:bytes!,mediaType:content.media_type,folders:[]});if(saved)await client.query('UPDATE hestia_content_summary SET request_id=$2 WHERE content_id=$1',[id,saved.id]);return saved;});
   if(reservation){const selected=reservation.provider as SummaryProvider;
    invocation=observeProviderInvocation(signal=>selected.summarize(configured(reservation!.config),{bytes:bytes!,mediaType:content.media_type},reservation!.credential,signal),deps.requestTimeoutMs,deps.monotonicNowNs,'Analysis timeout');
    const outcome=await invocation.result;
    actual=typeof outcome.actualMicros==='number'&&Number.isSafeInteger(outcome.actualMicros)&&outcome.actualMicros>=0?outcome.actualMicros:null;
    text=parseSummary(outcome.value);status=actual===null?'unknown':actual>reservation.maximum||!text?'unavailable':'ready';
   }
  }catch(error){status=!reservation&&error instanceof WorkDeferred?'pending':reservation&&actual===null?'unknown':'unavailable';}finally{bytes?.fill(0);}
  await access.transaction(async client=>{
   if(reservation)await settle(client,reservation.id,actual,status==='ready'?'complete':'failed');
   try{const current=await source(client,id);const cfg=(await client.query('SELECT version,enabled FROM hestia_classification_config WHERE id=1 FOR UPDATE')).rows[0];if(current.owner_id!==content.owner_id||current.epoch!==content.epoch||reservation&&(cfg.version!==reservation.config.version||!cfg.enabled))status='unavailable';}catch{status='unavailable';}
   await client.query(`UPDATE hestia_content_summary SET status=CASE WHEN permitted THEN $2 ELSE 'unavailable' END,text=CASE WHEN permitted AND $2='ready' THEN $3 ELSE NULL END,generation=generation+CASE WHEN $2='pending' THEN 1 ELSE 0 END,not_before=CASE WHEN $2='pending' THEN $4::timestamptz+interval '60 seconds' ELSE not_before END,updated_at=$4 WHERE content_id=$1 AND status='running' AND generation=$5`,[id,status,status==='ready'?text:null,await deps.clock(client),content.generation]);
  });
  if(pool&&reservation)await persistProviderObservation(pool,reservation.id,'summary',invocation?.observation());
  return true;
 }
 async function processInbox(id:string,deadline:number){
  const work=await access.transaction(async client=>{
   const job=(await client.query('SELECT * FROM hestia_inbox_analysis_job WHERE attachment_id=$1 FOR UPDATE',[id])).rows[0];if(job?.status!=='pending')return null;
   const a=(await client.query(`SELECT a.*,e.subject AS mail_subject,e.context AS mail_context,e.context_partial AS mail_context_partial FROM hestia_inbox_attachment a JOIN hestia_inbox_event e ON e.id=a.event_id JOIN hestia_member m ON m.user_id=a.actor_id WHERE a.id=$1 AND a.state='pending' AND a.departure_epoch=m.departure_epoch AND m.active AND NOT m.recovering`,[id])).rows[0];
   if(!a||a.version!==job.attachment_version||a.comment_version!==job.comment_version){await client.query("UPDATE hestia_inbox_analysis_job SET status='stale' WHERE attachment_id=$1",[id]);return null;}
   const c=await source(client,a.content_id),actor:Actor={id:a.actor_id,name:c.name,email:c.email};
   const folders=await deps.readAuthorizedFolders(client,actor);
   await client.query("UPDATE hestia_inbox_analysis_job SET status='running',updated_at=$2 WHERE attachment_id=$1",[id,await deps.clock(client)]);
   return {a,c,actor,folders,generation:job.generation};
  });if(!work)return false;
  let bytes:Uint8Array|undefined,reservation:Awaited<ReturnType<typeof reserve>>=null,actual:number|null=null,suggestions:InboxSuggestionDto[]=[],contradiction:string|undefined;
  let status='unavailable';
  let invocation:ReturnType<typeof observeProviderInvocation<ProviderOutcome>>|undefined;
  async function assertCurrent(client:PoolClient){
   const job=(await client.query('SELECT generation,status FROM hestia_inbox_analysis_job WHERE attachment_id=$1 FOR UPDATE',[id])).rows[0];if(job?.generation!==work!.generation||job.status!=='running')throw unavailable();
   const a=(await client.query(`SELECT a.*,m.epoch FROM hestia_inbox_attachment a JOIN hestia_member m ON m.user_id=a.actor_id WHERE a.id=$1 AND a.state='pending' AND a.departure_epoch=m.departure_epoch AND m.active AND NOT m.recovering FOR UPDATE OF a`,[id])).rows[0];
   if(!a||a.version!==work!.a.version||a.comment_version!==work!.a.comment_version||a.epoch!==work!.c.epoch||hash(await deps.readAuthorizedFolders(client,work!.actor))!==hash(work!.folders))throw unavailable();
  }
  try{bytes=await readBytes(work.c,deadline-deps.requestTimeoutMs);
   // This private context is limited to placement suggestions. It never enters
   // the summary provider, durable financial identity or published document.
   const inboxContext=typedInboxAnalysisContext({subject:work.a.mail_subject,body:work.a.mail_context,partial:work.a.mail_context_partial,comment:work.a.comment});
   const context=inboxContext?JSON.stringify(inboxContext):'';
   const payload:ProviderPayload={bytes,mediaType:work.c.media_type,folders:work.folders,canCreateRoot:true,...(inboxContext?{inboxContext}:{})};
   reservation=await access.transaction(async client=>{await assertCurrent(client);requireTime(deadline,deps.requestTimeoutMs);const saved=await reserve(client,work.c,'inbox_analysis',payload);if(saved)await client.query('UPDATE hestia_inbox_analysis_job SET request_id=$2 WHERE attachment_id=$1',[id,saved.id]);return saved;});
   if(reservation){const provider=deps.providers.find(p=>p===reservation!.provider)!;invocation=observeProviderInvocation(signal=>provider.analyze(configured(reservation!.config),payload,reservation!.credential,signal),deps.requestTimeoutMs,deps.monotonicNowNs,'Analysis timeout');const outcome=await invocation.result;
    actual=typeof outcome.actualMicros==='number'&&Number.isSafeInteger(outcome.actualMicros)&&outcome.actualMicros>=0?outcome.actualMicros:null;
    const result=projectInboxAnalysis(outcome.value,work.folders,context);
    suggestions=result.suggestions;contradiction=result.contradiction;
    status=actual===null?'unknown':actual>reservation.maximum?'unavailable':'ready';
   }
  }catch(error){status=!reservation&&error instanceof WorkDeferred?'pending':reservation&&actual===null?'unknown':'unavailable';}finally{bytes?.fill(0);}
  await access.transaction(async client=>{if(reservation)await settle(client,reservation.id,actual,status==='ready'?'complete':'failed');try{await assertCurrent(client);const cfg=(await client.query('SELECT version,enabled FROM hestia_classification_config WHERE id=1 FOR UPDATE')).rows[0];if(reservation&&(cfg.version!==reservation.config.version||!cfg.enabled))status='stale';}catch{status='stale';}
   const updated=await client.query("UPDATE hestia_inbox_analysis_job SET status=$2,generation=generation+CASE WHEN $2='pending' THEN 1 ELSE 0 END,not_before=CASE WHEN $2='pending' THEN $3::timestamptz+interval '60 seconds' ELSE not_before END,updated_at=$3 WHERE attachment_id=$1 AND generation=$4",[id,status,await deps.clock(client),work.generation]);
   if(updated.rowCount)await client.query('UPDATE hestia_inbox_attachment SET analysis=$2 WHERE id=$1',[id,JSON.stringify({status,suggestions:status==='ready'?suggestions:[],...(status==='ready'&&contradiction?{contradiction}:{})})]);
  });
  if(pool&&reservation)await persistProviderObservation(pool,reservation.id,'inbox_analysis',invocation?.observation());
  return true;
 }
 async function runSummaryBatch(limit=2,budgetMs=35000){
  if(!Number.isInteger(limit)||limit<1||limit>10)throw invalid();
  if(!Number.isFinite(budgetMs)||budgetMs<0||budgetMs>35000)throw invalid();
  const deadline=monotonic()+budgetMs;
  if(remaining(deadline)<=deps.requestTimeoutMs)return{processed:0};
  const jobs=await access.transaction(async client=>{
   const now=await deps.clock(client);
   return {summaries:(await client.query(`SELECT s.content_id FROM hestia_content_summary s
    JOIN hestia_content c ON c.id=s.content_id JOIN hestia_member m ON m.user_id=c.owner_id
    WHERE s.permitted AND s.status='pending' AND s.not_before<=$2 AND m.active AND NOT m.recovering
      AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL
      AND (EXISTS(SELECT 1 FROM hestia_inbox_attachment a WHERE a.content_id=c.id AND a.state='pending' AND a.departure_epoch=m.departure_epoch)
        OR EXISTS(SELECT 1 FROM hestia_document_revision r JOIN hestia_document d ON d.id=r.document_id
          WHERE r.content_id=c.id AND d.trashed_at IS NULL AND d.purged_at IS NULL AND (d.current_revision_id=r.id OR r.recoverable_until>$2)))
    ORDER BY s.updated_at,s.created_at LIMIT $1`,[limit,now])).rows,
    analyses:(await client.query("SELECT attachment_id FROM hestia_inbox_analysis_job WHERE status='pending' AND not_before<=$2 ORDER BY updated_at LIMIT $1",[limit,now])).rows};
  });
  let processed=0;for(const job of jobs.summaries){if(processed>=limit||remaining(deadline)<=deps.requestTimeoutMs)break;if(await processSummary(job.content_id,deadline))processed++;}for(const job of jobs.analyses){if(processed>=limit||remaining(deadline)<=deps.requestTimeoutMs)break;if(await processInbox(job.attachment_id,deadline))processed++;}return{processed};
 }
 async function handleDocumentSummary(request:Request,documentId:string){return guarded(async()=>{
  if(!isUuid(documentId)||!['GET','POST'].includes(request.method))throw invalid();if(request.method==='POST'){access.origin(request);await json(request,[]);}
  return response(await access.withActor(request,async(client,actor)=>{const doc=(await client.query(`SELECT d.folder_id,d.current_revision_id,r.content_id FROM hestia_document d JOIN hestia_document_revision r ON r.id=d.current_revision_id WHERE d.id=$1 AND d.trashed_at IS NULL AND d.purged_at IS NULL`,[documentId])).rows[0];if(!doc||!(await getFolderAccess(client,actor.id,doc.folder_id)).capabilities.includes('consulter'))throw unavailable();return{revisionId:doc.current_revision_id,summary:await readSummary(client,doc.content_id)};},false));
 });}
 async function cleanupSummary(limit=100){return access.transaction(async client=>{
  const now=await deps.clock(client);
  const rows=(await client.query(`SELECT content_id,request_id FROM hestia_content_summary WHERE status='running' AND updated_at<$1 ORDER BY updated_at LIMIT $2 FOR UPDATE`,[new Date(now.getTime()-10*60000),limit])).rows;
  for(const row of rows){if(row.request_id)await settle(client,row.request_id,null,'failed');await client.query("UPDATE hestia_content_summary SET status=CASE WHEN request_id IS NULL THEN 'pending' ELSE 'unknown' END,generation=generation+1,text=NULL,updated_at=$2 WHERE content_id=$1",[row.content_id,now]);}
  const expired=(await client.query(`UPDATE hestia_inbox_analysis_job SET status=CASE WHEN request_id IS NULL THEN 'pending' ELSE 'unknown' END,generation=generation+1,updated_at=$1 WHERE status='running' AND updated_at<$2 RETURNING attachment_id,request_id,status`,[now,new Date(now.getTime()-10*60000)])).rows;
  for(const row of expired){if(row.request_id)await settle(client,row.request_id,null,'failed');await client.query('UPDATE hestia_inbox_attachment SET analysis=$2 WHERE id=$1',[row.attachment_id,JSON.stringify({status:row.status,suggestions:[]})]);}
  await client.query('DELETE FROM hestia_content_summary s USING hestia_content c WHERE s.content_id=c.id AND c.deleted_at IS NOT NULL');
  return {cleaned:rows.length+expired.length};
 });}
 async function settingsChanged(client:PoolClient,actorId:string,input:{enabled:boolean;automaticAnalysis:boolean}){
  if(input.automaticAnalysis)return;
  const cancelled=(await client.query(`UPDATE hestia_inbox_analysis_job j SET status='unavailable',generation=generation+1,updated_at=clock_timestamp() FROM hestia_inbox_attachment a WHERE j.attachment_id=a.id AND a.actor_id=$1 AND j.auto_origin AND j.status IN ('pending','running') RETURNING j.attachment_id`,[actorId])).rows;
  for(const row of cancelled)await client.query(`UPDATE hestia_inbox_attachment SET analysis='{"status":"unavailable","suggestions":[]}' WHERE id=$1`,[row.attachment_id]);
  await client.query(`UPDATE hestia_content_summary s SET permitted=false,status='unavailable',text=NULL,generation=generation+1 FROM hestia_inbox_attachment a WHERE a.content_id=s.content_id AND a.actor_id=$1 AND s.auto_origin AND s.status IN ('pending','running')`,[actorId]);
 }
 return{readSummary,enqueueAnalysis,requestAnalysis,settingsChanged,runSummaryBatch,handleDocumentSummary,cleanupSummary};
}
