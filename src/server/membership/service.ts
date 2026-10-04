import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { type Access, type Actor, guarded, HttpError, invalid, isUuid, json, response, unavailable } from '../access';
import { evaluateFolderAccess, getFolderAccess, type Grant } from '../permissions/service';
import { CAPABILITIES } from '../permissions/capabilities';

type Member = {user_id:string;name:string;email:string;role:string;active:boolean;epoch:number;departure_epoch:number;membership_version:string;removed_at:Date|null};
type Folder = {id:string;name:string;created_by:string;created_at:Date;governance_kind:string;admin_reference:string;reference_grant_id:string|null};
type Receipt = {operationId:string;kind:string;targetId:string;status:'committed';committedAt:string};
type RevokeIdentity = (client:PoolClient,memberId:string,departureEpoch:number)=>Promise<void>;
const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = (code='REVIEW_CHANGED') => new HttpError(409,code,'La situation a changé. Vérifiez à nouveau avant de confirmer.');
const memberId = (id:unknown):id is string => typeof id==='string' && id.length>0 && id.length<=128 && !/[\u0000-\u001f]/.test(id);
const version = (v:unknown):v is string => typeof v==='string' && /^[1-9][0-9]{0,18}$/.test(v);
const review = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const canonicalCaps = (caps:string[]) => CAPABILITIES.filter(c=>caps.includes(c));
function getOnly(request:Request) { if(request.method!=='GET') throw invalid(); }
function page(request:Request,allowStatus=false) {
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(k=>!['offset','limit',...(allowStatus?['status']:[])].includes(k)) || [...params.keys()].some(k=>params.getAll(k).length!==1)) throw invalid();
  const integer=(key:string,fallback:number,max:number)=>{const raw=params.get(key);if(raw!==null&&!/^\d{1,9}$/.test(raw))throw invalid();const n=raw===null?fallback:Number(raw);if(n>max)throw invalid();return n;};
  const offset=integer('offset',0,1000000),limit=integer('limit',50,100),status=params.get('status')??'active';
  if(limit<1 || !['active','removed'].includes(status))throw invalid();
  return {offset,limit,status};
}
async function loadMember(client:PoolClient,id:string) {
  return (await client.query<Member>('SELECT m.*,u.name,u.email FROM hestia_member m JOIN "user" u ON u.id=m.user_id WHERE m.user_id=$1 FOR UPDATE OF m',[id])).rows[0];
}
async function administrator(client:PoolClient,actor:Actor) {
  const member=await loadMember(client,actor.id);
  if(!member?.active || !['owner','admin'].includes(member.role)) throw unavailable();
  return member;
}
export function mayRemove(actor:Pick<Member,'active'|'user_id'|'role'>,target:Pick<Member,'active'|'user_id'|'role'>) {
  return actor.active && target.active && actor.user_id!==target.user_id && target.role!=='owner' && (actor.role==='owner' || actor.role==='admin'&&target.role==='member');
}
async function loadFolder(client:PoolClient,id:string) {
  const folder=(await client.query<Folder>('SELECT * FROM hestia_folder WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!folder || folder.governance_kind!=='shared')throw unavailable();return folder;
}

// Succession history attests where the envelope came from; it is not an
// authorization dependency on former holders or authors remaining active.
function attestedReference(folder:Folder, reference:Grant, rows:Grant[]) {
  const byId=new Map(rows.map(g=>[g.id,g])),seen=new Set<string>();
  let current:Grant|undefined=reference;
  while(current) {
    if(seen.has(current.id)||current.folder_id!==folder.id||current.kind!=='reference'
      ||current.capability!=='administrer'||current.parent_id||current.lineage.length||!current.author_id)return false;
    seen.add(current.id);
    if(current.origin==='initial')return !current.replaces_reference_id&&current.user_id===folder.created_by
      &&current.author_id===folder.created_by&&current.batch_id===folder.id;
    if(!['reference-transfer','reference-succession'].includes(current.origin)||!current.replaces_reference_id)return false;
    const previous=byId.get(current.replaces_reference_id);
    if(!previous?.revoked_at||!current.transmit.every(c=>previous.transmit.includes(c))
      ||(current.expires_at?.getTime()??Infinity)>(previous.expires_at?.getTime()??Infinity))return false;
    current=previous;
  }
  return false;
}

export function createMembership(access:Access,dependencies:{revokeIdentityArtifacts:RevokeIdentity}) {
  const {withActor,origin}=access;
  async function existing(client:PoolClient,actor:Member,key:string,hash:string):Promise<Receipt|null> {
    const row=(await client.query('SELECT request_sha256,actor_epoch,result FROM hestia_membership_receipt WHERE actor_id=$1 AND idempotency_key=$2',[actor.user_id,key])).rows[0];
    if(!row)return null;
    if(row.actor_epoch!==actor.epoch || row.request_sha256!==hash)throw conflict('IDEMPOTENCY_CONFLICT');
    return row.result;
  }
  async function record(client:PoolClient,actor:Member,key:string,kind:string,targetId:string,hash:string) {
    const committedAt=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
    const result:Receipt={operationId:key,kind,targetId,status:'committed',committedAt};
    await client.query('INSERT INTO hestia_membership_receipt(actor_id,idempotency_key,kind,request_sha256,actor_epoch,result,committed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.user_id,key,kind,hash,actor.epoch,JSON.stringify(result),committedAt]);
    return result;
  }
  async function removal(client:PoolClient,actor:Member,id:string) {
    const target=await loadMember(client,id);if(!target || !mayRemove(actor,target))throw unavailable();
    const folders=(await client.query<{id:string}>(`SELECT f.id FROM hestia_folder f JOIN hestia_grant g ON g.id=f.reference_grant_id WHERE f.governance_kind='shared' AND g.user_id=$1 ORDER BY f.id`,[id])).rows;
    const managed:string[]=[];
    for(const folder of folders){const state=await getFolderAccess(client,id,folder.id);if(state.rows.some(g=>g.kind==='reference' && g.user_id===id && state.valid(g.id)))managed.push(folder.id);}
    const targetView={id:target.user_id,name:target.name,role:target.role,membershipVersion:String(target.membership_version)};
    return {target,projection:{target:targetView,reviewVersion:digest(['remove',actor.user_id,actor.epoch,actor.role,actor.membership_version,target.user_id,target.epoch,target.role,target.membership_version,managed]),managedFolderCount:managed.length,allowed:true}};
  }
  function handleMembers(request:Request) {return guarded(async()=>{getOnly(request);const paging=page(request,true);return response(await withActor(request,async(client,actor)=>{
    const admin=await administrator(client,actor);
    const rows=(await client.query<Member>('SELECT m.*,u.name,u.email FROM hestia_member m JOIN "user" u ON u.id=m.user_id WHERE m.active=$1 ORDER BY m.user_id OFFSET $2 LIMIT $3',[paging.status==='active',paging.offset,paging.limit+1])).rows;
    return {members:rows.slice(0,paging.limit).map(m=>({id:m.user_id,name:m.name,email:m.email,role:m.role,status:m.active?'active':'removed',membershipVersion:String(m.membership_version),removedAt:m.removed_at?.toISOString()??null,allowedActions:{remove:mayRemove(admin,m),readmit:!m.active && m.role!=='owner' && (admin.role==='owner'||m.role==='member')}})),nextOffset:rows.length>paging.limit?paging.offset+paging.limit:null};
  }));});}
  function handleRemovalPreview(request:Request,id:string) {return guarded(async()=>{getOnly(request);if(!memberId(id))throw unavailable();return response(await withActor(request,async(client,actor)=>(await removal(client,await administrator(client,actor),id)).projection));});}
  function handleRemoveMember(request:Request,id:string) {return guarded(async()=>{
    if(request.method!=='POST')throw invalid();origin(request);if(!memberId(id))throw unavailable();
    const input=await json(request,['idempotencyKey','expectedMembershipVersion','reviewVersion']);
    if(!isUuid(input.idempotencyKey)||!version(input.expectedMembershipVersion)||!review(input.reviewVersion))throw invalid();
    return response(await withActor(request,async(client,actor)=>{
      const admin=await administrator(client,actor),hash=digest(['remove',id,input.expectedMembershipVersion,input.reviewVersion]);
      const prior=await existing(client,admin,input.idempotencyKey as string,hash);if(prior)return prior;
      const state=await removal(client,admin,id);
      if(state.projection.target.membershipVersion!==input.expectedMembershipVersion||state.projection.reviewVersion!==input.reviewVersion)throw conflict();
      const removed=(await client.query('UPDATE hestia_member SET active=false,removed_at=clock_timestamp(),removed_by=$2 WHERE user_id=$1 RETURNING departure_epoch',[id,actor.id])).rows[0];
      await dependencies.revokeIdentityArtifacts(client,id,removed.departure_epoch);
      return record(client,admin,input.idempotencyKey as string,'remove',id,hash);
    }));
  });}
  async function succession(client:PoolClient,actor:Member,id:string,mode:'transfer'|'nominate') {
    const folder=await loadFolder(client,id),state=await getFolderAccess(client,actor.user_id,id);
    const reference=state.rows.find(g=>g.id===folder.reference_grant_id);
    if(!reference || !attestedReference(folder,reference,state.rows))throw unavailable();
    const bound=state.limits(reference.id),holder=await loadMember(client,reference.user_id);
    if(!bound || !(bound.end>state.now) || !holder)throw unavailable();
    if(mode==='transfer') {
      if(reference.user_id!==actor.user_id || !state.valid(reference.id))throw unavailable();
    } else {
      if(!['owner','admin'].includes(actor.role) || !reference.revoked_at || holder.departure_epoch<=reference.subject_epoch || state.rows.some(g=>g.kind==='reference'&&state.valid(g.id)))throw unavailable();
    }
    const after=evaluateFolderAccess(actor.user_id,id,folder,state.rows,[...state.members.values()],state.now,new Set([reference.id]));
    const lostReaders=[...state.members.values()].filter(m=>state.rows.some(g=>g.user_id===m.user_id&&g.capability==='consulter'&&state.valid(g.id))&&!state.rows.some(g=>g.user_id===m.user_id&&g.capability==='consulter'&&after.valid(g.id))).map(m=>({id:m.user_id,name:m.name}));
    const revokedDependentAccessCount=state.rows.filter(g=>g.id!==reference.id&&state.valid(g.id)&&!after.valid(g.id)).length;
    const eligible=[...state.members.values()].filter(m=>m.active && (mode!=='transfer'||m.user_id!==actor.user_id)).map(m=>{
      const capabilities=canonicalCaps(state.rows.filter(g=>g.user_id===m.user_id&&after.valid(g.id)).map(g=>g.capability));
      return {id:m.user_id,name:m.name,capabilities};
    }).filter(m=>m.capabilities.includes('consulter'));
    // Fingerprint grants and membership, not wall clock. Eligibility/expiry is
    // nevertheless recalculated at commit using database time.
    const reviewVersion=digest([mode,actor.user_id,actor.epoch,actor.role,actor.membership_version,folder.reference_grant_id,
      state.rows.map(g=>[g.id,g.user_id,g.kind,g.capability,g.parent_id,g.transmit,g.subject_epoch,g.revoked_at,g.expires_at]),
      [...state.members.values()].map(m=>[m.user_id,m.active,m.departure_epoch]),eligible.map(m=>[m.id,m.capabilities])]);
    const envelope={transmitCapabilities:canonicalCaps(bound.transmit),expiresAt:Number.isFinite(bound.end)?new Date(bound.end).toISOString():null};
    const folderView={id,adminReference:`D-${folder.admin_reference}`,...(mode==='transfer'&&state.capabilities.includes('consulter')?{title:folder.name}:{})};
    return {folder,state,reference,eligible,envelope,reviewVersion,projection:{folder:folderView,...(mode==='transfer'?{referenceId:reference.id,actorAfterCapabilities:canonicalCaps(after.capabilities),lostReaders,hasDependentRevocations:revokedDependentAccessCount>0,revokedDependentAccessCount}:{previousReferenceId:reference.id}),reviewVersion,eligible,envelope}};
  }
  function handleUnmanagedFolders(request:Request) {return guarded(async()=>{getOnly(request);const paging=page(request);return response(await withActor(request,async(client,actor)=>{
    await administrator(client,actor);
    const folders=(await client.query<Folder & {creator_name:string;vacant_since:Date}>(`SELECT f.*,u.name AS creator_name,g.revoked_at AS vacant_since FROM hestia_folder f JOIN "user" u ON u.id=f.created_by JOIN hestia_grant g ON g.id=f.reference_grant_id JOIN hestia_member m ON m.user_id=g.user_id WHERE f.governance_kind='shared' AND g.kind='reference' AND g.revoked_at IS NOT NULL AND m.departure_epoch>g.subject_epoch ORDER BY f.admin_reference OFFSET $1 LIMIT $2`,[paging.offset,paging.limit+1])).rows;
    const results=[];
    for(const f of folders.slice(0,paging.limit)){
      const state=await getFolderAccess(client,actor.id,f.id);
      if(state.rows.some(g=>g.kind==='reference'&&state.valid(g.id)))continue;
      const readers=new Set(state.rows.filter(g=>g.capability==='consulter'&&state.valid(g.id)).map(g=>g.user_id));
      const ref=state.rows.find(g=>g.id===f.reference_grant_id),bound=ref&&state.limits(ref.id);
      results.push({id:f.id,adminReference:`D-${f.admin_reference}`,creator:{id:f.created_by,name:f.creator_name},createdAt:f.created_at.toISOString(),vacantSince:f.vacant_since.toISOString(),readerCount:readers.size,canNominate:readers.size>0&&Boolean(ref&&attestedReference(f,ref,state.rows)&&bound&&bound.end>state.now)});
    }
    return {folders:results,nextOffset:folders.length>paging.limit?paging.offset+paging.limit:null};
  }));});}
  function handleSuccessionPreview(request:Request,id:string) {return guarded(async()=>{getOnly(request);if(!isUuid(id))throw unavailable();return response(await withActor(request,async(client,actor)=>(await succession(client,await administrator(client,actor),id,'nominate')).projection));});}
  function changeReference(request:Request,id:string,mode:'transfer'|'nominate') {return guarded(async()=>{
    if(request.method!=='POST')throw invalid();origin(request);if(!isUuid(id))throw unavailable();
    const referenceKey=mode==='transfer'?'referenceId':'previousReferenceId';
    const input=await json(request,['idempotencyKey',referenceKey,'nomineeId','reviewVersion']);
    if(!isUuid(input.idempotencyKey)||!isUuid(input[referenceKey])||!memberId(input.nomineeId)||!review(input.reviewVersion))throw invalid();
    return response(await withActor(request,async(client,actor)=>{
      const member=mode==='nominate'?await administrator(client,actor):await loadMember(client,actor.id);
      if(!member?.active)throw unavailable();
      const hash=digest([mode,id,input[referenceKey],input.nomineeId,input.reviewVersion]);
      const prior=await existing(client,member,input.idempotencyKey as string,hash);if(prior)return prior;
      const folder=await loadFolder(client,id);
      if(folder.reference_grant_id!==input[referenceKey]) {
        if(mode==='nominate')throw conflict('REFERENCE_CHANGED');
        const priorReference=(await client.query("SELECT id FROM hestia_grant WHERE id=$1 AND folder_id=$2 AND kind='reference' AND user_id=$3",[input[referenceKey],id,actor.id])).rows[0];
        if(priorReference)throw conflict('REFERENCE_CHANGED');
        throw unavailable();
      }
      const state=await succession(client,member,id,mode);
      if(state.reference.id!==input[referenceKey])throw conflict('REFERENCE_CHANGED');
      if(state.reviewVersion!==input.reviewVersion)throw conflict();
      if(!state.eligible.some(m=>m.id===input.nomineeId))throw conflict('NO_ELIGIBLE_READER');
      const nominee=state.state.members.get(input.nomineeId as string)!;
      await client.query('UPDATE hestia_grant SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',[state.reference.id]);
      const newId=randomUUID();
      await client.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,parent_id,transmit,lineage,origin,author_id,subject_epoch,expires_at,replaces_reference_id) VALUES($1,$2,$3,'administrer','reference',NULL,$4,$5,$6,$7,$8,$9,$10)`,[newId,id,nominee.user_id,state.reference.transmit,[],mode==='transfer'?'reference-transfer':'reference-succession',actor.id,nominee.departure_epoch,state.reference.expires_at,state.reference.id]);
      await client.query('UPDATE hestia_folder SET reference_grant_id=$2 WHERE id=$1',[id,newId]);
      return record(client,member,input.idempotencyKey as string,mode,id,hash);
    }));
  });}
  function handleNominateSuccessor(request:Request,id:string){return changeReference(request,id,'nominate');}
  function handleManagementTransfer(request:Request,id:string){
    if(request.method==='POST')return changeReference(request,id,'transfer');
    return guarded(async()=>{getOnly(request);if(!isUuid(id))throw unavailable();return response(await withActor(request,async(client,actor)=>{
      const member=await loadMember(client,actor.id);if(!member?.active)throw unavailable();return (await succession(client,member,id,'transfer')).projection;
    }));});
  }
  function handleMembershipOperation(request:Request,key:string){return guarded(async()=>{getOnly(request);if(!isUuid(key))throw unavailable();return response(await withActor(request,async(client,actor)=>{
    const member=await loadMember(client,actor.id);
    const row=(await client.query('SELECT actor_epoch,result FROM hestia_membership_receipt WHERE actor_id=$1 AND idempotency_key=$2',[actor.id,key])).rows[0];
    if(!row || row.actor_epoch!==member.epoch)return {status:'not-recorded'};
    return {status:'committed',receipt:row.result};
  }));});}
  return {handleMembers,handleRemovalPreview,handleRemoveMember,handleUnmanagedFolders,handleSuccessionPreview,handleNominateSuccessor,handleManagementTransfer,handleMembershipOperation};
}
