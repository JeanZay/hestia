import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { type Access, type Actor, guarded, HttpError, invalid, isUuid, readActivity, response, unavailable, unauthenticated } from '../access';
import type { ServerConfig } from '../config';
import type { ObjectStore } from '../storage';
import { getFolderAccessEvaluator, type FolderAccessEvaluator } from '../permissions/service';
import { OUTGOING_LIMITS as L, type OutgoingAttachmentDto, type OutgoingAvailableDocument, type OutgoingDraftDto,
  type OutgoingFailureCode, type OutgoingOperationDto, type OutgoingOperationState, type OutgoingRecapDto, type OutgoingSelection,
  type OutgoingServiceDto } from '../../shared/outgoing-contract';
import { outgoingCrypto } from './crypto';
import { composition, outgoingId, outgoingJson, outgoingRevision, validateEnvelope, normalizeAddress, type Composition } from './validation';
import type { OutgoingPayload, OutgoingTransport, OutgoingTransportResult } from './transport';

export type OutgoingDependencies = { store: ObjectStore; now?: () => Date; monotonic?: () => number;
  /** Explicit local synthetic injection, ignored by hosted deployments. */
  simulation?: { enabled: true; sender: string; transport: OutgoingTransport };
  deployment?: { enabled: true; sender: string; transport: OutgoingTransport; qualificationId: string;
    actorHour: number; actorDay: number; globalHour: number; globalDay: number; recipientHour: number; recipientDay: number };
  barrier?: (stage: 'after-read' | 'before-mark' | 'after-mark', operationId: string) => Promise<void> };
type Member = { epoch: number; departure_epoch: number; name: string; email: string; emailVerified: boolean; active: boolean; recovering: boolean };
type Draft = { id: string; actor_id: string; actor_epoch: number; departure_epoch: number; revision: number; ciphertext: string; lock_operation_id: string | null; consumed_revision:number|null };
type Selection = { id: string; document_id: string; revision_id: string; document_version: number; title_digest: string; position: number };
type Operation = { id: string; actor_id: string; actor_epoch: number; departure_epoch: number; draft_id: string; draft_revision: number;
  request_id: string; state: OutgoingOperationState; code: OutgoingFailureCode; owner_token: string | null; generation: string | null;
  payload_digest: string | null; provider_id: string | null; marker_at: Date | null; lease_until: Date | null; quiescent_at: Date | null };
type Slot = { generation: string; operation_id: string | null; owner_token: string | null; lease_until: Date | null; phase: 'free' | 'assembling' | 'dispatched' };
type Original = { id: string; folder_id: string; title: string; version: number; current_revision_id: string; trashed_at: Date | null; purged_at: Date | null;
  content_id: string; file_name: string; media_type: string; size: number; sha256: string; object_key: string; deleted_at: Date | null; purge_pending_at: Date | null };
type Snapshot = { dto: OutgoingAvailableDocument; objectKey: string; sha256: string; contentId: string };
const conflict = () => new HttpError(409,'VERSION_CONFLICT','La préparation ou les documents ont changé. Actualisez puis confirmez.');
const method = (request: Request, ...allowed: string[]) => {if(!allowed.includes(request.method))throw new HttpError(405,'METHOD_NOT_ALLOWED','Action indisponible.');};
const operationDto = (o: Operation): OutgoingOperationDto => ({id:o.id,state:o.state,code:o.code});
const sameEpoch = (o: {actor_epoch:number;departure_epoch:number}, m: Member) => Number(o.actor_epoch)===Number(m.epoch)&&Number(o.departure_epoch)===Number(m.departure_epoch);
const aad = (id: string, actor: string, revision: number) => `${actor}|${id}|${revision}|1`;

export function createOutgoingService(pool: Pool, access: Access, config: ServerConfig, deps: OutgoingDependencies) {
  const crypto=outgoingCrypto(config.secret), clock=()=>deps.now?.()??new Date(), mono=deps.monotonic??(()=>performance.now());
  // Simulations are explicit dependency injection on local benches, never environment switches.
  const simulation=config.environment==='local'&&deps.simulation?.enabled&&deps.simulation.transport.kind==='simulated'?deps.simulation:undefined;
  const deployment=config.environment!=='local'&&deps.deployment?.enabled&&deps.deployment.transport.kind==='resend'&&deps.deployment.qualificationId?deps.deployment:undefined;
  const profile=simulation??deployment,transport=profile?.transport;
  let sender: string | null=null;try{if(profile)sender=normalizeAddress(profile.sender);}catch{ /* Closed configuration. */ }
  const configured=Boolean(profile&&sender);
  async function member(client: PoolClient, actor: Actor) {
    const m=(await client.query<Member>('SELECT m.*,u.name,u.email,u."emailVerified" FROM hestia_member m JOIN "user" u ON u.id=m.user_id WHERE m.user_id=$1 FOR UPDATE OF m',[actor.id])).rows[0];
    if(!m?.active||m.recovering||!m.emailVerified)throw unauthenticated();return m;
  }
  function currentSender(m:Member) {
    const first=[...(m.name.trim().split(/\s+/)[0]??'').replace(/[^\p{L}\p{M}'’-]/gu,'')].slice(0,80).join('')||'membre';
    return {name:'Hestia au nom de '+first,email:sender};
  }
  function service(m: Member): OutgoingServiceDto {return {configured,reason:configured?null:'not-configured',sender:currentSender(m),replyTo:m.email,limits:L};}
  async function owned(client: PoolClient, actor: Actor, id?: string, revision?: number, editable=false) {
    if(id&&!isUuid(id))throw unavailable();
    const m=await member(client,actor),d=(await client.query<Draft>('SELECT * FROM hestia_outgoing_draft WHERE actor_id=$1 AND actor_epoch=$3 AND departure_epoch=$4 AND ($2::uuid IS NULL OR id=$2) FOR UPDATE',[actor.id,id??null,m.epoch,m.departure_epoch])).rows[0];
    if(!d||!sameEpoch(d,m))throw unavailable();if(revision!==undefined&&d.revision!==revision)throw conflict();
    if(editable&&d.lock_operation_id)throw new HttpError(409,'OUTGOING_LOCKED','Le résultat de cet envoi doit être vérifié.');return {d,m};
  }
  const contents=(d: Draft)=>crypto.open<Composition>(d.ciphertext,aad(d.id,d.actor_id,d.revision));
  async function paths(client: PoolClient,evaluate: FolderAccessEvaluator) {
    const rows=(await client.query<{id:string;name:string;parent_folder_id:string|null}>('SELECT id,name,parent_folder_id FROM hestia_folder WHERE trashed_at IS NULL ORDER BY id LIMIT 10001')).rows;
    if(rows.length>10000)throw new HttpError(503,'RESOURCE_LIMIT','Trop de dossiers.');
    const visible=new Map(rows.filter(r=>evaluate(r.id).capabilities.includes('consulter')).map(r=>[r.id,r]));
    return (folderId:string)=>{const chain:string[]=[],seen=new Set<string>();let row=visible.get(folderId);while(row){if(seen.has(row.id)||seen.size>10000)throw unavailable();seen.add(row.id);chain.push(row.name);row=row.parent_folder_id?visible.get(row.parent_folder_id):undefined;}return chain.reverse().join(' / ');};
  }
  async function original(client: PoolClient, id: string, evaluate: FolderAccessEvaluator): Promise<Original | null> {
    const row=(await client.query<Original>(`SELECT d.id,d.folder_id,d.title,d.version,d.current_revision_id,d.trashed_at,d.purged_at,
      c.id AS content_id,c.file_name,c.media_type,c.size,c.sha256,c.object_key,c.deleted_at,c.purge_pending_at
      FROM hestia_document d JOIN hestia_document_revision r ON r.id=d.current_revision_id JOIN hestia_content c ON c.id=r.content_id WHERE d.id=$1`,[id])).rows[0];
    if(!row||row.trashed_at||row.purged_at||row.deleted_at||row.purge_pending_at)return null;
    const rights=evaluate(row.folder_id).capabilities;return rights.includes('consulter')&&rights.includes('exporter')?row:null;
  }
  const availableDto=(d:Original,path:string): OutgoingAvailableDocument=>({documentId:d.id,documentVersion:d.version,revisionId:d.current_revision_id,title:d.title,fileName:d.file_name,size:d.size,path,mediaType:d.media_type});
  async function project(client:PoolClient,actor:Actor,d:Draft) {
    const evaluate=await getFolderAccessEvaluator(client,actor.id),path=await paths(client,evaluate);
    const rows=(await client.query<Selection>('SELECT * FROM hestia_outgoing_selection WHERE draft_id=$1 ORDER BY position',[d.id])).rows;
    const attachments:OutgoingAttachmentDto[]=[],snapshots:Snapshot[]=[];
    for(const selection of rows){
      const current=await original(client,selection.document_id,evaluate);
      if(!current){attachments.push({id:selection.id,state:'unavailable'});continue;}
      const chosen=(await client.query<{id:string;content_id:string;file_name:string;media_type:string;size:number;sha256:string;object_key:string;recoverable_until:Date|null}>(`SELECT r.id,r.content_id,r.recoverable_until,c.file_name,c.media_type,c.size,c.sha256,c.object_key
        FROM hestia_document_revision r JOIN hestia_content c ON c.id=r.content_id WHERE r.id=$1 AND r.document_id=$2 AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL`,[selection.revision_id,current.id])).rows[0];
      if(!chosen||chosen.id!==current.current_revision_id&&(!chosen.recoverable_until||chosen.recoverable_until<=clock())){attachments.push({id:selection.id,state:'unavailable'});continue;}
      const state=chosen.id!==current.current_revision_id?'replaced':!crypto.matches(selection.title_digest,crypto.mac('title',current.id,current.title))?'renamed':'ok';
      const dto={...availableDto(current,path(current.folder_id)),documentVersion:selection.document_version,revisionId:chosen.id,fileName:chosen.file_name,size:chosen.size,mediaType:chosen.media_type};
      attachments.push({...dto,id:selection.id,state,...(state!=='ok'?{current:{documentVersion:current.version,revisionId:current.current_revision_id,title:current.title,fileName:current.file_name,size:current.size}}:{})});
      if(state==='ok')snapshots.push({dto:{...dto,documentVersion:current.version},objectKey:chosen.object_key,sha256:chosen.sha256,contentId:chosen.content_id});
    }
    return {attachments,snapshots};
  }
  async function draftDto(client:PoolClient,actor:Actor,d:Draft):Promise<OutgoingDraftDto> {
    const op=d.lock_operation_id?(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE id=$1',[d.lock_operation_id])).rows[0]:undefined;
    const prior=op??(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE actor_id=$1 AND draft_id=$2 AND draft_revision=$3',[actor.id,d.id,d.revision])).rows[0];
    return {id:d.id,revision:d.revision,state:op?.state==='uncertain'?'uncertain':op?'sending':'editable',...contents(d),attachments:(await project(client,actor,d)).attachments,...(prior?{operation:operationDto(prior)}:{})};
  }
  async function mutate(client:PoolClient,d:Draft,value:Composition) {
    if(d.revision>=2147483646)throw conflict();const revision=d.revision+1;
    const updated=(await client.query<Draft>('UPDATE hestia_outgoing_draft SET revision=$3,ciphertext=$4 WHERE id=$1 AND revision=$2 AND lock_operation_id IS NULL RETURNING *',[d.id,d.revision,revision,crypto.seal(value,aad(d.id,d.actor_id,revision))])).rows[0];if(!updated)throw conflict();return updated;
  }
  async function knownOperation(client:PoolClient,actor:Actor,id:string) {
    const m=await member(client,actor),op=(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE id=$1 AND actor_id=$2',[id,actor.id])).rows[0];
    if(!op||!sameEpoch(op,m))throw unavailable();return op;
  }
  async function currentResponse(client:PoolClient,actor:Actor,op:Operation) {
    const d=(await client.query<Draft>('SELECT * FROM hestia_outgoing_draft WHERE id=$1 AND actor_id=$2',[op.draft_id,actor.id])).rows[0];
    return {operation:operationDto(op),draft:d?await draftDto(client,actor,d):null};
  }
  async function confirmation(client:PoolClient,actor:Actor,d:Draft,m:Member,token?:string) {
    const value=validateEnvelope(contents(d)),p=await project(client,actor,d);
    if(!p.attachments.length||p.snapshots.length!==p.attachments.length)throw new HttpError(409,'ATTACHMENTS_CHANGED','Des pièces jointes sont à corriger.');
    const total=p.snapshots.reduce((n,x)=>n+x.dto.size,0);if(total>L.rawBytes)throw new HttpError(413,'SIZE_LIMIT','La préparation dépasse vingt Mio.');
    const binding=[actor.id,m.epoch,m.departure_epoch,m.email,currentSender(m),d.id,d.revision,value,p.snapshots.map(x=>[x.dto,x.sha256,x.contentId])];
    if(token){const [expires,mac]=token.split('.');if(!/^\d+$/.test(expires??'')||Number(expires)<=clock().getTime()||Number(expires)>clock().getTime()+300000||!crypto.matches(mac??'',crypto.mac('confirmation',expires,binding)))throw conflict();}
    const expires=String(clock().getTime()+300000);
    const recap:OutgoingRecapDto={token:expires+'.'+crypto.mac('confirmation',expires,binding),expiresAt:new Date(Number(expires)).toISOString(),sender:currentSender(m),replyTo:m.email,...value,attachments:p.snapshots.map(x=>x.dto),totalBytes:total};
    return {recap,snapshots:p.snapshots};
  }
  function handleOutgoing(request:Request) {return guarded(async()=>{
    method(request,'GET','POST');if(request.method==='POST'){access.origin(request);await outgoingJson(request,[]);}
    return response(await access.withActor(request,async(client,actor)=>{
      const m=await member(client,actor),slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton FOR UPDATE')).rows[0];await expire(client,slot);
      // Old admissions never recover private composition. Frozen originals stay for reconciliation;
      // only an unlocked obsolete preparation may be discarded, without touching its source documents.
      await client.query('DELETE FROM hestia_outgoing_draft WHERE id IN (SELECT id FROM hestia_outgoing_draft WHERE actor_id=$1 AND (actor_epoch<>$2 OR departure_epoch<>$3) AND lock_operation_id IS NULL LIMIT 100)',[actor.id,m.epoch,m.departure_epoch]);
      let d=(await client.query<Draft>('SELECT * FROM hestia_outgoing_draft WHERE actor_id=$1 AND actor_epoch=$2 AND departure_epoch=$3 FOR UPDATE',[actor.id,m.epoch,m.departure_epoch])).rows[0];
      if(!d&&request.method==='POST'){const id=randomUUID();d=(await client.query<Draft>('INSERT INTO hestia_outgoing_draft(id,actor_id,actor_epoch,departure_epoch,ciphertext) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.id,m.epoch,m.departure_epoch,crypto.seal({to:[],subject:'',message:''},aad(id,actor.id,1))])).rows[0];}
      return {draft:d?await draftDto(client,actor,d):null,service:service(m)};
    },readActivity(request,request.method==='POST')));
  });}
  function handleOutgoingDraft(request:Request,id:string) {return guarded(async()=>{
    method(request,'PATCH','DELETE');access.origin(request);const input=await outgoingJson(request,request.method==='PATCH'?['revision','to','subject','message','attachmentIds']:['revision']);
    return response(await access.withActor(request,async(client,actor)=>{
      const {d}=await owned(client,actor,id,outgoingRevision(input.revision),true);
      if(request.method==='DELETE'){await client.query('DELETE FROM hestia_outgoing_draft WHERE id=$1 AND revision=$2 AND lock_operation_id IS NULL',[d.id,d.revision]);return {draft:null};}
      if(!Array.isArray(input.attachmentIds)||input.attachmentIds.length>L.attachments)throw invalid();const ids=input.attachmentIds.map(outgoingId);if(new Set(ids).size!==ids.length)throw invalid();
      const existing=(await client.query<{id:string}>('SELECT id FROM hestia_outgoing_selection WHERE draft_id=$1',[d.id])).rows.map(x=>x.id);if(ids.some(x=>!existing.includes(x)))throw invalid();
      await client.query('DELETE FROM hestia_outgoing_selection WHERE draft_id=$1 AND NOT(id=ANY($2::uuid[]))',[d.id,ids]);
      const next=await mutate(client,d,composition(input));return {draft:await draftDto(client,actor,next)};
    }));
  });}
  function handleOutgoingAvailable(request:Request) {return guarded(async()=>{
    method(request,'GET');const q=new URL(request.url).searchParams.get('q')??'';if([...q].length>200)throw invalid();
    return response(await access.withActor(request,async(client,actor)=>{
      await member(client,actor);const evaluate=await getFolderAccessEvaluator(client,actor.id),path=await paths(client,evaluate);
      const rows=(await client.query<Original>(`SELECT d.id,d.folder_id,d.title,d.version,d.current_revision_id,d.trashed_at,d.purged_at,
        c.id AS content_id,c.file_name,c.media_type,c.size,c.sha256,c.object_key,c.deleted_at,c.purge_pending_at
        FROM hestia_document d JOIN hestia_document_revision r ON r.id=d.current_revision_id JOIN hestia_content c ON c.id=r.content_id
        WHERE d.trashed_at IS NULL AND d.purged_at IS NULL AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL ORDER BY d.id LIMIT 10001`)).rows;
      if(rows.length>10000)throw new HttpError(503,'RESOURCE_LIMIT','Précisez votre sélection.');const documents:OutgoingAvailableDocument[]=[];
      for(const d of rows){const rights=evaluate(d.folder_id).capabilities;if(rights.includes('consulter')&&rights.includes('exporter')){const dto=availableDto(d,path(d.folder_id));if((dto.title+' '+dto.fileName+' '+dto.path).toLocaleLowerCase('fr').includes(q.toLocaleLowerCase('fr')))documents.push(dto);}}
      return {documents};
    },readActivity(request)));
  });}
  function handleOutgoingAttachments(request:Request,id:string,rowId?:string) {return guarded(async()=>{
    method(request,'POST');access.origin(request);const input=await outgoingJson(request,rowId?['revision','documentVersion','revisionId']:['revision','selections']);
    return response(await access.withActor(request,async(client,actor)=>{
      const {d}=await owned(client,actor,id,outgoingRevision(input.revision),true),evaluate=await getFolderAccessEvaluator(client,actor.id);
      const rows=(await client.query<Selection>('SELECT * FROM hestia_outgoing_selection WHERE draft_id=$1 ORDER BY position',[d.id])).rows;
      let selections:OutgoingSelection[];
      if(rowId){const row=rows.find(x=>x.id===rowId);if(!row)throw unavailable();selections=[{documentId:row.document_id,documentVersion:outgoingRevision(input.documentVersion),revisionId:outgoingId(input.revisionId)}];}
      else {if(!Array.isArray(input.selections)||!input.selections.length||input.selections.length>L.attachments)throw invalid();selections=input.selections.map((x:Record<string,unknown>)=>{if(!x||typeof x!=='object'||Object.keys(x).some(k=>!['documentId','documentVersion','revisionId'].includes(k)))throw invalid();return {documentId:outgoingId(x.documentId),documentVersion:outgoingRevision(x.documentVersion),revisionId:outgoingId(x.revisionId)};});}
      for(const selected of selections){const current=await original(client,selected.documentId,evaluate);if(!current)throw unavailable();if(current.version!==selected.documentVersion||current.current_revision_id!==selected.revisionId)throw conflict();
        const existing=rows.find(x=>x.document_id===selected.documentId);if(existing){if(rowId)await client.query('UPDATE hestia_outgoing_selection SET revision_id=$2,document_version=$3,title_digest=$4 WHERE id=$1 AND draft_id=$5',[existing.id,current.current_revision_id,current.version,crypto.mac('title',current.id,current.title),d.id]);continue;}
        if(rows.length>=L.attachments)throw invalid();const position=Array.from({length:20},(_,i)=>i).find(n=>!rows.some(r=>r.position===n))!;
        const created=(await client.query<Selection>('INSERT INTO hestia_outgoing_selection(id,draft_id,document_id,revision_id,document_version,title_digest,position) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),d.id,current.id,current.current_revision_id,current.version,crypto.mac('title',current.id,current.title),position])).rows[0];rows.push(created);
      }
      const next=await mutate(client,d,contents(d));return {draft:await draftDto(client,actor,next)};
    }));
  });}
  function handleOutgoingCheck(request:Request,id:string) {return guarded(async()=>{
    method(request,'POST');access.origin(request);const input=await outgoingJson(request,['revision']);
    return response(await access.withActor(request,async(client,actor)=>{const {d,m}=await owned(client,actor,id,outgoingRevision(input.revision),true);
      if(d.consumed_revision===d.revision||(await client.query('SELECT id FROM hestia_outgoing_operation WHERE actor_id=$1 AND draft_id=$2 AND draft_revision=$3',[actor.id,d.id,d.revision])).rowCount)throw conflict();
      const {recap}=await confirmation(client,actor,d,m);return {draft:await draftDto(client,actor,d),recap};}));
  });}
  async function release(client:PoolClient,op:Operation) {
    return client.query(`UPDATE hestia_outgoing_slot SET operation_id=NULL,owner_token=NULL,lease_until=NULL,phase='free'
      WHERE singleton AND operation_id=$1 AND owner_token=$2 AND generation=$3`,[op.id,op.owner_token,op.generation]);
  }
  async function settle(client:PoolClient,op:Operation,state:'accepted'|'failed'|'uncertain',code:OutgoingFailureCode,providerId?:string) {
    await client.query('UPDATE hestia_outgoing_operation SET state=$2,code=$3,provider_id=$4,terminal_at=$5 WHERE id=$1',[op.id,state,code,providerId??null,state==='uncertain'?null:clock()]);
    if(state==='accepted')await client.query('DELETE FROM hestia_outgoing_draft WHERE id=$1 AND actor_id=$2 AND revision=$3 AND lock_operation_id=$4',[op.draft_id,op.actor_id,op.draft_revision,op.id]);
    else if(state==='failed')await client.query('UPDATE hestia_outgoing_draft SET lock_operation_id=NULL WHERE id=$1 AND actor_id=$2 AND revision=$3 AND lock_operation_id=$4',[op.draft_id,op.actor_id,op.draft_revision,op.id]);
  }
  async function expire(client:PoolClient,slot:Slot) {
    if(slot.phase==='free'||!slot.lease_until||slot.lease_until>clock())return;
    const op=(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE id=$1 FOR UPDATE',[slot.operation_id])).rows[0];
    if(!op||op.owner_token!==slot.owner_token||op.generation!==slot.generation)return;
    if(slot.phase==='assembling'&&!op.marker_at){await settle(client,op,'failed','unavailable');await release(client,op);}
    else await settle(client,op,'uncertain','unavailable');
  }
  async function acquire(client:PoolClient,op:Operation,recipients:number) {
    let slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton FOR UPDATE')).rows[0];await expire(client,slot);
    slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton')).rows[0];
    if(slot.phase!=='free')return 'busy' as const;
    const limits=deployment??{actorHour:5,actorDay:20,globalHour:20,globalDay:100,recipientHour:400,recipientDay:2000};
    const counts=(await client.query<{ah:string;ad:string;gh:string;gd:string;rh:string;rd:string}>(`SELECT
      count(*) FILTER(WHERE actor_id=$1 AND created_at>$2::timestamptz-interval '1 hour') AS ah,
      count(*) FILTER(WHERE actor_id=$1) AS ad,
      count(*) FILTER(WHERE created_at>$2::timestamptz-interval '1 hour') AS gh,count(*) AS gd,
      COALESCE(sum(recipients) FILTER(WHERE created_at>$2::timestamptz-interval '1 hour'),0) AS rh,COALESCE(sum(recipients),0) AS rd
      FROM hestia_outgoing_admission WHERE created_at>$2::timestamptz-interval '24 hours'`,[op.actor_id,clock()])).rows[0];
    if(Number(counts.ah)>=limits.actorHour||Number(counts.ad)>=limits.actorDay||Number(counts.gh)>=limits.globalHour||Number(counts.gd)>=limits.globalDay||Number(counts.rh)+recipients>limits.recipientHour||Number(counts.rd)+recipients>limits.recipientDay)return 'quota' as const;
    const token=randomUUID(),until=new Date(clock().getTime()+45000);
    const claimed=(await client.query<Slot>(`UPDATE hestia_outgoing_slot SET generation=generation+1,operation_id=$1,owner_token=$2,lease_until=$3,phase='assembling'
      WHERE singleton AND phase='free' AND generation<9223372036854775807 RETURNING *`,[op.id,token,until])).rows[0];if(!claimed)return 'busy' as const;
    await client.query('UPDATE hestia_outgoing_operation SET owner_token=$2,generation=$3,lease_until=$4 WHERE id=$1',[op.id,token,claimed.generation,until]);
    await client.query('INSERT INTO hestia_outgoing_admission(operation_id,actor_id,recipients,created_at) VALUES($1,$2,$3,$4)',[op.id,op.actor_id,recipients,clock()]);
    return {...op,owner_token:token,generation:claimed.generation,lease_until:until};
  }
  /** Same token/generation required by every transition; a stale worker never releases B. */
  async function owner(client:PoolClient,op:Operation,phase:'assembling'|'dispatched',live=true) {
    const slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton FOR UPDATE')).rows[0];
    const current=(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE id=$1 FOR UPDATE',[op.id])).rows[0];
    const draft=(await client.query<Draft>('SELECT * FROM hestia_outgoing_draft WHERE id=$1 FOR UPDATE',[op.draft_id])).rows[0];
    return Boolean(slot.operation_id===op.id&&slot.owner_token===op.owner_token&&slot.generation===op.generation&&slot.phase===phase
      &&current?.owner_token===op.owner_token&&current.generation===op.generation&&current.state===(phase==='assembling'?'preparing':'sending')
      &&draft?.lock_operation_id===op.id&&draft.revision===op.draft_revision&&(!live||slot.lease_until&&slot.lease_until>clock()));
  }
  async function fence(request:Request,op:Operation,token:string,phase:'assembling'|'dispatched'='assembling') {
    return access.withActor(request,async(client,actor)=>{
      if(actor.id!==op.actor_id||!await owner(client,op,phase))throw conflict();
      const {d,m}=await owned(client,actor,op.draft_id,op.draft_revision);if(!sameEpoch(op,m))throw conflict();
      return confirmation(client,actor,d,m,token);
    },false);
  }
  async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,milliseconds:number) {
    if(milliseconds<=0)throw new Error('OUTGOING_DEADLINE');const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    try{return await Promise.race([work(controller.signal),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('OUTGOING_DEADLINE'));},milliseconds);})]);}
    finally{clearTimeout(timer!);controller.abort();}
  }
  async function finishBeforeCall(op:Operation,code:OutgoingFailureCode) {
    await access.transaction(async client=>{if(await owner(client,op,'assembling',false)){await settle(client,op,'failed',code);await release(client,op);}});
  }
  /** Internal verified evidence. No HTTP route can sign or submit this attestation. */
  async function reconcileOutgoing(operationId:string,evidence:{payloadDigest:string;status:'accepted'|'rejected';providerId?:string;quiescent:boolean;signature:string}) {
    if(!isUuid(operationId)||!evidence.quiescent||!crypto.matches(evidence.signature,crypto.mac('provider-evidence',operationId,evidence.payloadDigest,evidence.status,evidence.providerId??null,true)))return false;
    return access.transaction(async client=>{
      const op=(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE id=$1 FOR UPDATE',[operationId])).rows[0];
      if(!op||op.state!=='uncertain'||op.payload_digest!==evidence.payloadDigest)return false;
      const slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton FOR UPDATE')).rows[0];
      if(slot.operation_id!==op.id||slot.owner_token!==op.owner_token||slot.generation!==op.generation)return false;
      if(evidence.status==='accepted'&&(!evidence.providerId||!isUuid(evidence.providerId)))return false;
      await settle(client,op,evidence.status==='accepted'?'accepted':'failed',evidence.status==='accepted'?null:'unavailable',evidence.providerId);
      await client.query('UPDATE hestia_outgoing_operation SET quiescent_at=$2 WHERE id=$1',[op.id,clock()]);await release(client,op);return true;
    });
  }
  async function execute(request:Request,op:Operation,confirmationToken:string) {
    const began=mono(),remaining=()=>45000-(mono()-began);let marked=false,attempted=false;
    try{
      const initial=await fence(request,op,confirmationToken),attachments:OutgoingPayload['attachments']=[];
      for(const file of initial.snapshots){
        const bytes=Buffer.alloc(file.dto.size),digest=createHash('sha256');
        for(let offset=0;offset<file.dto.size;offset+=L.rangeBytes){
          await fence(request,op,confirmationToken);const length=Math.min(L.rangeBytes,file.dto.size-offset);
          const part=await bounded(signal=>deps.store.getRange(file.objectKey,offset,offset+length-1,{signal}),Math.min(15000,remaining()-10000));
          await deps.barrier?.('after-read',op.id);await fence(request,op,confirmationToken);
          if(part.length!==length)throw new HttpError(422,'INTEGRITY','Fichier indisponible.');digest.update(part);bytes.set(part,offset);
        }
        if(digest.digest('hex')!==file.sha256)throw new HttpError(422,'INTEGRITY','Fichier indisponible.');
        attachments.push({filename:file.dto.fileName,content:bytes.toString('base64'),content_type:file.dto.mediaType});
      }
      const latest=await fence(request,op,confirmationToken),payload=JSON.stringify({from:latest.recap.sender.name+' <'+sender!+'>',to:latest.recap.to,reply_to:latest.recap.replyTo,subject:latest.recap.subject,text:latest.recap.message,attachments} satisfies OutgoingPayload);
      if(Buffer.byteLength(payload)>L.encodedBytes)throw new HttpError(413,'SIZE_LIMIT','La préparation est trop volumineuse.');
      if(remaining()<10000)throw new Error('OUTGOING_DEADLINE');await deps.barrier?.('before-mark',op.id);
      if(remaining()<10000)throw new Error('OUTGOING_DEADLINE');
      const binding=crypto.mac('payload',op.id,payload);
      const didMark=await access.withActor(request,async(client,actor)=>{
        if(!await owner(client,op,'assembling'))return false;const {d,m}=await owned(client,actor,op.draft_id,op.draft_revision);await confirmation(client,actor,d,m,confirmationToken);
        if(!sameEpoch(op,m))return false;
        await client.query(`UPDATE hestia_outgoing_operation SET state='sending',marker_at=$2,payload_digest=$3 WHERE id=$1 AND owner_token=$4 AND generation=$5 AND state='preparing'`,[op.id,clock(),binding,op.owner_token,op.generation]);
        await client.query("UPDATE hestia_outgoing_slot SET phase='dispatched' WHERE singleton AND operation_id=$1 AND owner_token=$2 AND generation=$3 AND phase='assembling'",[op.id,op.owner_token,op.generation]);return true;
      },false);
      if(!didMark)return;marked=true;await deps.barrier?.('after-mark',op.id);await fence(request,op,confirmationToken,'dispatched');
      if(remaining()<5000)throw new Error('OUTGOING_DEADLINE');attempted=true;
      const result=await bounded(signal=>transport!.send({id:op.id,payload,signal}),Math.min(5000,remaining()-5000));
      await recordResult(op,binding,result,true);
    }catch(error){
      if(marked)await recordResult(op,null,{status:'uncertain'},!attempted);
      else await finishBeforeCall(op,error instanceof HttpError?error.code==='SIZE_LIMIT'?'size':error.code==='INTEGRITY'?'integrity':'rights-or-version':'unavailable');
    }
  }
  async function recordResult(op:Operation,binding:string|null,result:OutgoingTransportResult,quiescent:boolean) {
    await access.transaction(async client=>{
      const valid=await owner(client,op,'dispatched');
      const row=(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE id=$1',[op.id])).rows[0];
      // A late result is only an opaque proof for its old operation. No draft/slot B effects.
      if(!row||row.owner_token!==op.owner_token||row.generation!==op.generation)return;
      if(!valid||result.status==='uncertain'){
        if(row.state==='sending')await settle(client,row,'uncertain','unavailable');
        if(quiescent)await client.query('UPDATE hestia_outgoing_operation SET quiescent_at=$2 WHERE id=$1 AND owner_token=$3 AND generation=$4',[op.id,clock(),op.owner_token,op.generation]);return;
      }
      if(binding!==row.payload_digest)return;
      await settle(client,row,result.status==='accepted'?'accepted':'failed',result.status==='accepted'?null:result.code,result.status==='accepted'?result.providerId:undefined);
      await client.query('UPDATE hestia_outgoing_operation SET quiescent_at=$2 WHERE id=$1',[op.id,clock()]);await release(client,op);
    });
    // When its transport has really returned, a late worker can hand over verifiable evidence.
    if(quiescent&&binding&&result.status!=='uncertain')await reconcileOutgoing(op.id,{payloadDigest:binding,status:result.status,providerId:result.status==='accepted'?result.providerId:undefined,quiescent:true,
      signature:crypto.mac('provider-evidence',op.id,binding,result.status,result.status==='accepted'?result.providerId:null,true)});
  }
  function handleOutgoingSend(request:Request,id:string) {return guarded(async()=>{
    method(request,'POST');access.origin(request);const input=await outgoingJson(request,['revision','requestId','confirmationToken']),revision=outgoingRevision(input.revision),requestId=outgoingId(input.requestId);
    if(typeof input.confirmationToken!=='string'||input.confirmationToken.length>128)throw invalid();
    const claimed=await access.withActor(request,async(client,actor)=>{
      const m=await member(client,actor);
      const previous=(await client.query<Operation>('SELECT * FROM hestia_outgoing_operation WHERE actor_id=$1 AND (request_id=$2 OR (draft_id=$3 AND draft_revision=$4)) FOR UPDATE',[actor.id,requestId,outgoingId(id),revision])).rows;
      if(previous.length){const op=previous[0];if(previous.length>1||op.draft_id!==id||op.draft_revision!==revision||!sameEpoch(op,m))throw conflict();return {op,execute:false};}
      const {d}=await owned(client,actor,id,revision,true),{recap}=await confirmation(client,actor,d,m,input.confirmationToken as string);
      if(d.consumed_revision===revision)throw conflict();
      // Bound even certain failures while configuration/quotas are closed. A replay costs no new row.
      const attempts=(await client.query<{actor:string;all:string}>(`SELECT count(*) FILTER(WHERE actor_id=$1) AS actor,count(*) AS all
        FROM hestia_outgoing_operation WHERE created_at>$2::timestamptz-interval '1 hour'`,[actor.id,clock()])).rows[0];
      if(Number(attempts.actor)>=20||Number(attempts.all)>=100)throw new HttpError(429,'RESOURCE_LIMIT','Trop de demandes. La préparation est conservée.');
      let op=(await client.query<Operation>(`INSERT INTO hestia_outgoing_operation(id,actor_id,actor_epoch,departure_epoch,draft_id,draft_revision,request_id,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,'preparing') RETURNING *`,[randomUUID(),actor.id,m.epoch,m.departure_epoch,d.id,d.revision,requestId])).rows[0];
      await client.query('UPDATE hestia_outgoing_draft SET lock_operation_id=$2,consumed_revision=revision WHERE id=$1 AND revision=$3',[d.id,op.id,d.revision]);
      const acquired=configured?await acquire(client,op,recap.to.length):'not-configured';
      if(typeof acquired==='string'){await settle(client,op,'failed',acquired);op={...op,state:'failed',code:acquired};return {op,execute:false};}
      op=acquired;return {op,execute:true};
    });
    if(claimed.execute)await execute(request,claimed.op,input.confirmationToken);
    return response(await access.withActor(request,async(client,actor)=>currentResponse(client,actor,await knownOperation(client,actor,claimed.op.id)),false));
  });}
  function handleOutgoingOperation(request:Request,id:string) {return guarded(async()=>{
    method(request,'GET');if(!isUuid(id))throw unavailable();return response(await access.withActor(request,async(client,actor)=>{
      const slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton FOR UPDATE')).rows[0];await expire(client,slot);
      return currentResponse(client,actor,await knownOperation(client,actor,id));
    },readActivity(request,false)));
  });}
  async function cleanupOutgoing(limit=100) {
    if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('OUTGOING_CLEANUP_LIMIT');
    return access.transaction(async client=>{
      const slot=(await client.query<Slot>('SELECT * FROM hestia_outgoing_slot WHERE singleton FOR UPDATE')).rows[0];await expire(client,slot);
      const result=await client.query(`DELETE FROM hestia_outgoing_operation WHERE id IN (SELECT id FROM hestia_outgoing_operation
        WHERE state IN ('accepted','failed') AND terminal_at<=$1::timestamptz-interval '7 days' ORDER BY terminal_at LIMIT $2)`,[clock(),limit]);
      await client.query("DELETE FROM hestia_outgoing_admission WHERE operation_id IN(SELECT operation_id FROM hestia_outgoing_admission WHERE created_at<=$1::timestamptz-interval '48 hours' LIMIT $2)",[clock(),limit]);
      await client.query(`DELETE FROM hestia_outgoing_draft WHERE id IN (SELECT d.id FROM hestia_outgoing_draft d JOIN hestia_member m ON m.user_id=d.actor_id
        WHERE d.lock_operation_id IS NULL AND (d.actor_epoch<>m.epoch OR d.departure_epoch<>m.departure_epoch) LIMIT $1)`,[limit]);
      return {cleaned:result.rowCount??0};
    });
  }
  return {handleOutgoing,handleOutgoingDraft,handleOutgoingAvailable,handleOutgoingAttachments,handleOutgoingCheck,handleOutgoingSend,handleOutgoingOperation,reconcileOutgoing,cleanupOutgoing};
}
