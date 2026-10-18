import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import type {Access} from '../../src/server/access';
import {createSummaryService} from '../../src/server/summary/service';
import type {ProviderPayload} from '../../src/server/classification/types';
import type {SummaryPayload} from '../../src/server/summary/provider';
import {normalizeClassificationSuggestions} from '../../src/server/classification/reference-tree';
import type {InboxAnalysisDto} from '../../src/shared/inbox-contract';

const divergence='Le document dit eau; le mail indique assurance, sans certitude sur le lien. À vous de choisir.';
const contentId='11111111-1111-4111-8111-111111111111',attachmentId='22222222-2222-4222-8222-222222222222',actorId='33333333-3333-4333-8333-333333333333';
const bytes=Buffer.from('Document synthétique sans contexte privé.'),digest=createHash('sha256').update(bytes).digest('hex');
type Options={subject?:string;body?:string;partial?:boolean;comment?:string;raw?:unknown;actual?:number|null;stale?:'comment'|'generation'|'epoch'|'rights';summary?:boolean};
async function run(options:Options={}){
 let jobStatus='pending',summaryStatus='pending',summaryRequestId:string|null=null,generation=1,commentVersion=1,epoch=0,rightsChanged=false;
 let published:InboxAnalysisDto|undefined,publishedSummary:unknown,analysisPayload:ProviderPayload|undefined,summaryPayload:SummaryPayload|undefined,calls=0,settlement:unknown;
 const queries:string[]=[],reservationIdentities:unknown[]=[];
 const config={version:'7',provider:'synthetic-context',model:'fixture',enabled:true,monthly_limit_micros:'50000000',currency:'EUR',credential_sealed:'SYNTHETIC_NOT_REAL'};
 const attachment=()=>({id:attachmentId,content_id:contentId,actor_id:actorId,version:1,comment_version:commentVersion,comment:options.comment??'',epoch,mail_subject:options.subject??'',mail_context:options.body??'Assurance logement',mail_context_partial:options.partial===true});
 const source={id:contentId,owner_id:actorId,object_key:'synthetic-only-object',size:bytes.length,sha256:digest,media_type:'application/pdf',epoch:0,name:'Membre synthétique',email:'synthetic@example.invalid'};
 const answer=(rows:unknown[]=[],rowCount=rows.length)=>({rows,rowCount});
 const client={query:async(sql:string,args:unknown[]=[])=>{
  queries.push(sql);
  // These fixtures already own their summary row; no historical content is
  // missing. The batch still executes its admission and lane SQL normally.
  if(sql.startsWith('INSERT INTO hestia_content_summary(content_id,backfill)'))return answer([],0);
  if(sql.startsWith('UPDATE hestia_summary_scheduler SET next_lane='))return answer([{first_lane:0}]);
  if(sql.startsWith('SELECT content_id,backfill FROM ('))return answer(options.summary?[{content_id:contentId,backfill:false}]:[]);
  if(sql.startsWith('SELECT attachment_id FROM hestia_inbox_analysis_job'))return answer(options.summary?[]:[{attachment_id:attachmentId}]);
  if(sql.startsWith('SELECT * FROM hestia_inbox_analysis_job'))return answer([{status:jobStatus,generation,attachment_version:1,comment_version:1}]);
  if(sql.startsWith('SELECT a.*,e.subject AS mail_subject'))return answer([attachment()]);
  if(sql.startsWith('SELECT c.*,m.epoch,u.name,u.email'))return answer([source]);
  if(sql.startsWith('SELECT 1 FROM hestia_inbox_attachment'))return answer([{}]);
  if(sql.startsWith("UPDATE hestia_inbox_analysis_job SET status='running'")){jobStatus='running';return answer([],1);}
  if(sql.startsWith('SELECT generation,status FROM hestia_inbox_analysis_job'))return answer([{status:jobStatus,generation}]);
  if(sql.startsWith('SELECT a.*,m.epoch FROM hestia_inbox_attachment'))return answer([attachment()]);
  if(sql==='SELECT * FROM hestia_classification_config WHERE id=1 FOR UPDATE')return answer([config]);
  if(sql.startsWith('SELECT COALESCE(SUM(actual_micros)'))return answer([{spent:'60780',reserved:'606144'}]);
  if(sql.startsWith('INSERT INTO hestia_classification_request')){reservationIdentities.push(JSON.parse(args[5] as string));return answer([],1);}
  if(sql.startsWith('UPDATE hestia_inbox_analysis_job SET request_id'))return answer([],1);
  if(sql.startsWith('UPDATE hestia_content_summary SET request_id')){summaryRequestId=args[1] as string;return answer([],1);}
  if(sql.startsWith('UPDATE hestia_classification_request SET actual_micros')){settlement={actual:args[1],status:args[2]};return answer([],1);}
  if(sql==='SELECT version,enabled FROM hestia_classification_config WHERE id=1 FOR UPDATE')return answer([{version:'7',enabled:true}]);
  if(sql.startsWith('UPDATE hestia_inbox_analysis_job SET status=$2')){if(args[3]!==generation)return answer([],0);jobStatus=args[1] as string;return answer([],1);}
  if(sql==='UPDATE hestia_inbox_attachment SET analysis=$2 WHERE id=$1'){published=JSON.parse(args[1] as string);return answer([],1);}
  if(sql.startsWith('SELECT * FROM hestia_content_summary WHERE content_id'))return answer([{permitted:true,status:summaryStatus,generation:1,request_id:summaryRequestId,not_before:new Date('2000-01-01T00:00:00Z')}]);
  if(sql.startsWith("UPDATE hestia_content_summary SET status='running'")){summaryStatus='running';return answer([],1);}
  if(sql.startsWith('SELECT permitted,generation,status FROM hestia_content_summary'))return answer([{permitted:true,generation:1,status:summaryStatus}]);
  if(sql.startsWith('SELECT status,generation,request_id FROM hestia_content_summary'))return answer([{status:summaryStatus,generation:1,request_id:summaryRequestId}]);
  if(sql.startsWith('UPDATE hestia_content_summary SET status=CASE')){summaryStatus=args[1] as string;publishedSummary={status:args[1],text:args[2]};return answer([],1);}
  throw Error('Unexpected synthetic SQL');
 }};
 const raw=options.raw??{existingFolderSuggestions:[],newFolderPathSuggestions:[{parentId:null,levels:['Eau'],reason:'Le document est une facture d’eau.',relevance:'relevant'}],contradiction:divergence};
 const provider={id:'synthetic-context',mode:'synthetic' as const,quote:()=>({maximumMicros:100,currency:'EUR' as const}),quoteCheck:()=>({maximumMicros:100,currency:'EUR' as const}),check:async()=>({status:'accepted' as const,actualMicros:20}),analyze:async(_config:unknown,payload:ProviderPayload)=>{calls++;analysisPayload={...payload,bytes:new Uint8Array(payload.bytes)};
  if(options.stale==='comment')commentVersion++;if(options.stale==='generation')generation++;if(options.stale==='epoch')epoch++;if(options.stale==='rights')rightsChanged=true;
  return{value:normalizeClassificationSuggestions(JSON.stringify(raw),'existingFolderSuggestions','newFolderPathSuggestions'),actualMicros:options.actual===undefined?20:options.actual};}};
 const summary={id:'synthetic-context',mode:'synthetic' as const,quote:()=>({maximumMicros:100,currency:'EUR' as const}),summarize:async(_config:unknown,payload:SummaryPayload)=>{calls++;summaryPayload={...payload,bytes:new Uint8Array(payload.bytes)};return{value:{summary:'Document synthétique.'},actualMicros:20};}};
 const service=createSummaryService({transaction:async(action:(value:unknown)=>Promise<unknown>)=>action(client)} as unknown as Access,{clock:async()=>new Date('2026-10-16T00:00:00.000Z'),monotonicNow:()=>0,store:{getRange:async(_key,from,to)=>new Uint8Array(bytes.subarray(from,to+1)),put:async()=>{throw Error('No storage write');},delete:async()=>{throw Error('No storage delete');}},credentialCipher:{open:()=> 'SYNTHETIC_NOT_REAL',seal:()=> 'SYNTHETIC_NOT_REAL'},readAuthorizedFolders:async()=>rightsChanged?[{id:actorId,name:'Changement',path:[{id:actorId,name:'Changement'}],canCreate:true}]:[],providers:[provider],summaryProviders:[summary],allowRemote:false,requestTimeoutMs:1000,deploymentLimitMicros:50000000});
 const batch=await service.runSummaryBatch(1,35000);
 return{batch,published,publishedSummary,calls,analysisPayload,summaryPayload,settlement,queries,reservationIdentities};
}
describe('Inbox divergence through the real worker and persistence, synthetic SQL/store/provider',()=>{
 it.each([{body:'Assurance logement',comment:''},{subject:'Assurance logement',body:'',comment:''},{body:'',comment:'Assurance logement'},{body:'Contexte disponible assurance',partial:true},{body:'Assurance',comment:'Correction humaine : eau.'}])('publishes full private divergence for genuine context %j',async options=>{
  const r=await run(options);expect(r.batch).toEqual({processed:1});expect(r.calls).toBe(1);expect(r.published).toEqual({status:'ready',contradiction:divergence,suggestions:[{destination:{kind:'create',parentId:null,levels:['Eau']},label:'Eau',reason:'Le document est une facture d’eau. '+divergence}]});
  expect(r.analysisPayload!.comment).toBeUndefined();expect(r.analysisPayload!.inboxContext?.comment).toBe(options.comment??'');expect(r.analysisPayload!.inboxContext?.mail).toEqual({subject:options.subject??'',body:options.body??'Assurance logement',partial:options.partial===true});expect(r.settlement).toEqual({actual:20,status:'complete'});expect(r.reservationIdentities).toEqual([{contentId}]);
  expect(r.queries.some(q=>/UPDATE hestia_classification_config|DELETE|hestia_folder/.test(q))).toBe(false);
 });
 it('does not keep a contradiction from an empty envelope or partial flag only',async()=>{
  const r=await run({body:'',subject:' ',comment:' ',partial:true});expect(r.analysisPayload!.comment).toBeUndefined();expect(r.analysisPayload!.inboxContext).toBeUndefined();expect(r.published).not.toHaveProperty('contradiction');expect(r.published!.suggestions[0].reason).toBe('Le document est une facture d’eau.');
 });
 it('settles known cost but refuses ready when a divergence has no admitted suggestion',async()=>{
  const r=await run({raw:{existingFolderSuggestions:[],newFolderPathSuggestions:[],contradiction:divergence}});expect(r.calls).toBe(1);expect(r.published).toEqual({status:'unavailable',suggestions:[]});expect(r.settlement).toEqual({actual:20,status:'failed'});
 });
 it.each(['comment','epoch','rights','generation'] as const)('never republishes private contradiction after %s drift',async stale=>{
  const r=await run({stale});expect(r.calls).toBe(1);expect(r.published?.status).not.toBe('ready');expect(r.published?.contradiction).toBeUndefined();expect(r.settlement).toEqual({actual:20,status:'complete'});
 });
 it.each([null,101])('does not publish contradiction for unknown or over-quote cost %j',async actual=>{
  const r=await run({actual});expect(r.calls).toBe(1);expect(r.published).toEqual({status:actual===null?'unknown':'unavailable',suggestions:[]});expect(r.settlement).toEqual({actual,status:'failed'});
 });
 it('still gives the document summary only bytes/mediaType and excludes private context from financial identity',async()=>{
  const r=await run({summary:true,subject:'PRIVATE_MAIL',body:'PRIVATE_BODY',comment:'PRIVATE_COMMENT'});expect(r.calls).toBe(1);expect(Object.keys(r.summaryPayload!).sort()).toEqual(['bytes','mediaType']);expect(Buffer.from(r.summaryPayload!.bytes)).toEqual(bytes);expect(r.publishedSummary).toEqual({status:'ready',text:'Document synthétique.'});expect(r.published).toBeUndefined();expect(r.reservationIdentities).toEqual([{contentId}]);expect(JSON.stringify(r.reservationIdentities)).not.toMatch(/PRIVATE_|assurance|contradiction/);
 });
});
