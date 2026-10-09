import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { type Access, guarded, invalid, isUuid, json, response, unavailable, HttpError } from "../access";
import { CAPABILITIES } from "./capabilities";
import { evaluateTreeAccess, type TreeFolder, type Restriction, type ManagementCut } from './tree';

export const POLICY_LOCK_KEY = 480519001;
export function assertPolicyCapacity(current:number,additional:number,maximum=50000) {
  if(current+additional>maximum)throw new HttpError(503,'RESOURCE_LIMIT','La capacité de gestion des accès est atteinte. Aucune modification appliquée.');
}
export type Grant = { id:string; folder_id:string; user_id:string; capability:string; kind:string; parent_id:string|null;
  transmit:string[]; lineage:string[]; origin:string; author_id:string|null; subject_epoch:number;
  revoked_at:Date|null; expires_at:Date|null; batch_id:string|null; created_at:Date; replaces_reference_id?:string|null;anchor_reference_id?:string|null };
export type Member = { user_id:string; active:boolean; departure_epoch:number; name:string };
type Limit = { transmit:string[]; end:number };
const known = (values: string[]) => Array.isArray(values) && new Set(values).size===values.length && values.every(c => (CAPABILITIES as readonly string[]).includes(c));
const end = (g:Grant) => g.expires_at?.getTime() ?? Infinity;

// Caller owns a policy-locked transaction. Nothing from this state is a browser
// authority; all mutations reload it inside the transaction that commits them.
export async function loadFolderAccessGraph(client:PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)",[POLICY_LOCK_KEY]);
  const folders = (await client.query<TreeFolder>('SELECT id,created_by,parent_folder_id,trashed_at,reference_grant_id FROM hestia_folder ORDER BY id LIMIT 10001')).rows;
  const rows = (await client.query<Grant>("SELECT * FROM hestia_grant ORDER BY created_at,id LIMIT 50001")).rows;
  const restrictions=(await client.query<Restriction>('SELECT * FROM hestia_folder_restriction ORDER BY id LIMIT 50001')).rows;
  const cuts=(await client.query<ManagementCut>('SELECT * FROM hestia_management_cut ORDER BY folder_id,source_reference_id LIMIT 10001')).rows;
  if(cuts.length>10000)throw new HttpError(503,'RESOURCE_LIMIT','Trop de références pour cette opération.');
  const people = (await client.query<Member>('SELECT m.user_id,m.active,m.departure_epoch,u.name FROM hestia_member m JOIN "user" u ON u.id=m.user_id ORDER BY m.user_id')).rows;
  const now = Number((await client.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now")).rows[0].now);
  return {folders,grants:rows,members:people,restrictions,cuts,now};
}
export async function getFolderAccessEvaluator(client:PoolClient,actorId:string) {
  const graph=await loadFolderAccessGraph(client);
  return (folderId:string)=>evaluateTreeAccess(graph,actorId,folderId);
}
export async function getFolderAccess(client:PoolClient, actorId:string, folderId:string) {
  return (await getFolderAccessEvaluator(client,actorId))(folderId);
}

// The same evaluator serves live access and hypothetical revocation previews.
// A historical author is deliberately not a validity dependency.
export function evaluateFolderAccess(actorId:string,folderId:string,folder:{created_by:string},rows:Grant[],people:Member[],now:number,revokedRoots:ReadonlySet<string>=new Set()) {
  const members = new Map(people.map(m => [m.user_id,m]));
  const grants = new Map(rows.map(g => [g.id,g]));
  function limits(id:string, seen=new Set<string>()):Limit|null {
    const g=grants.get(id);
    if (!g || seen.has(id) || seen.size>=64 || !known(g.transmit) || !Number.isFinite(end(g)) && end(g)!==Infinity) return null;
    if (!g.parent_id) return {transmit:g.transmit,end:end(g)};
    const parent=limits(g.parent_id,new Set([...seen,id]));
    return parent ? {transmit:g.transmit.filter(c=>parent.transmit.includes(c)),end:Math.min(end(g),parent.end)} : null;
  }
  function valid(id:string, seen=new Set<string>()):boolean {
    const g=grants.get(id), member=g && members.get(g.user_id);
    if (!g || seen.has(id) || seen.size>=64 || g.revoked_at || revokedRoots.has(id) || !member?.active || member.departure_epoch!==g.subject_epoch
      || !(CAPABILITIES as readonly string[]).includes(g.capability) || !known(g.transmit) || now>=end(g)) return false;
    if (g.kind==='reference' && (g.capability!=='administrer' || g.parent_id)) return false;
    if (!['direct','reference','delegated'].includes(g.kind) || (g.kind==='delegated')!==Boolean(g.parent_id)) return false;
    if (!g.parent_id) return true;
    const p=grants.get(g.parent_id), bound=limits(g.parent_id);
    return Boolean(p && p.folder_id===folderId && ['partager','administrer'].includes(p.capability)
      && bound?.transmit.includes(g.capability) && valid(p.id,new Set([...seen,id])));
  }
  const held=rows.filter(g=>g.user_id===actorId && valid(g.id));
  const authorities=held.filter(g=>['partager','administrer'].includes(g.capability)).sort((a,b)=>Number(b.kind==='reference')-Number(a.kind==='reference'));
  const admins=authorities.filter(g=>g.capability==='administrer');
  const capabilities=[...new Set(held.map(g=>g.capability))];
  function authorityFor(required:string[],subject?:string) {
    return authorities.find(g=>required.every(c=>limits(g.id)?.transmit.includes(c))
      && (!subject || (subject!==actorId && !g.lineage.includes(subject) && members.get(subject)?.active)));
  }
  function canRevoke(g:Grant) {
    if (g.kind==='reference') return false;
    if (g.capability==='administrer') return admins.some(a=>a.kind==='reference');
    return admins.some(a=>limits(a.id)?.transmit.includes(g.capability));
  }
  return {capabilities,ownerId:String(folder.created_by),canShare:Boolean(authorityFor(['consulter'])),canAdminister:admins.length>0,
    rows,members,valid,limits,authorityFor,canRevoke,now};
}

// Internal domain operations support existing mandates without exposing a new
// administration UI or accepting client provenance fields.
export async function issueGrant(client:PoolClient,actorId:string,folderId:string,input:{authorityId:string;subject:string;capability:string;transmit?:string[];expiresAt?:Date|null}) {
  const state=await getFolderAccess(client,actorId,folderId), authority=state.held.find(g=>g.id===input.authorityId);
  const transmit=input.transmit??[], expiry=input.expiresAt??null, until=expiry?.getTime()??Infinity;
  const bound=authority && state.limits(authority.id), member=state.members.get(input.subject);
  if (!authority || !['partager','administrer'].includes(authority.capability) || !bound || !member?.active || input.subject===actorId || authority.lineage.includes(input.subject)
    || !known([input.capability]) || !known(transmit) || !bound.transmit.includes(input.capability) || !transmit.every(c=>bound.transmit.includes(c))
    || transmit.includes('administrer') || (!['partager','administrer'].includes(input.capability) && transmit.length)
    || (input.capability==='administrer' && (authority.kind!=='reference'||authority.folder_id!==folderId)) || !(until>state.now) || until>bound.end
    || !state.authorityFor([input.capability],input.subject)) throw unavailable();
  const id=randomUUID(),direct=authority.kind==='reference'&&authority.folder_id===folderId;
  assertPolicyCapacity(state.graphRows.length,1);
  await client.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,parent_id,transmit,lineage,origin,author_id,subject_epoch,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,folderId,input.subject,input.capability,direct?'direct':'delegated',direct?null:authority.id,transmit,
    [...new Set([...authority.lineage,authority.user_id])],direct?'reference-command':'delegation-command',actorId,member.departure_epoch,expiry]);
  return id;
}
export async function reduceMandate(client:PoolClient,actorId:string,folderId:string,input:{grantId:string;transmit?:string[];expiresAt?:Date|null}) {
  const state=await getFolderAccess(client,actorId,folderId), target=state.rows.find(g=>g.id===input.grantId);
  if (!state.rows.some(g=>g.kind==='reference' && g.user_id===actorId && state.valid(g.id)) || !target || target.kind==='reference' || target.capability!=='administrer' || target.revoked_at) throw unavailable();
  const transmit=input.transmit??target.transmit, expiry=input.expiresAt===undefined ? target.expires_at : input.expiresAt;
  if (!known(transmit) || !transmit.every(c=>target.transmit.includes(c)) || Number.isNaN(expiry?.getTime()) || (expiry?.getTime()??Infinity)>end(target)) throw invalid();
  await client.query('UPDATE hestia_grant SET transmit=$2,expires_at=$3 WHERE id=$1',[target.id,transmit,expiry]);
}

export function createSharing(access:Access) {
  const {withActor,origin}=access;
  function handleSharing(request:Request,folderId:string) {
    return guarded(async()=>{
      if (!isUuid(folderId)) throw unavailable();
      if (request.method==='GET') return response(await withActor(request,async(client,actor)=>{
        const state=await getFolderAccess(client,actor.id,folderId);
        if (!state.canShare) throw unavailable();
        return {members:[...state.members.values()].filter(m=>state.authorityFor(['consulter'],m.user_id)).map(m=>({
          id:m.user_id,name:m.name,
          canExport:Boolean(state.authorityFor(['consulter','exporter'],m.user_id)),
          canDeposit:Boolean(state.authorityFor(['consulter','déposer'],m.user_id)),
          canExportAndDeposit:Boolean(state.authorityFor(['consulter','exporter','déposer'],m.user_id)),
          canModify:Boolean(state.authorityFor(['consulter','modifier'],m.user_id)),
          canDelete:Boolean(state.authorityFor(['consulter','supprimer'],m.user_id)),
          allowedCapabilitySets:Array.from({length:16},(_,mask)=>['consulter',...['déposer','modifier','supprimer','exporter'].filter((_,index)=>mask&(1<<index))]).filter(caps=>state.authorityFor(caps,m.user_id)),
        }))};
      }));
      if (request.method!=='POST') throw invalid();
      origin(request);
      const input=await json(request,['memberId','export','deposit','modify','delete','idempotencyKey']);
      if (typeof input.memberId!=='string' || input.memberId.length>128 || typeof input.export!=='boolean' || typeof input.deposit!=='boolean' || !isUuid(input.idempotencyKey)) throw invalid();
      if ((input.modify!==undefined&&typeof input.modify!=='boolean')||(input.delete!==undefined&&typeof input.delete!=='boolean'))throw invalid();
      const required=['consulter',...(input.export?['exporter']:[]),...(input.deposit?['déposer']:[]),...(input.modify?['modifier']:[]),...(input.delete?['supprimer']:[])];
      await withActor(request,async(client,actor)=>{
        const state=await getFolderAccess(client,actor.id,folderId), authority=state.authorityFor(required,input.memberId as string);
        if (!authority) throw unavailable();
        const identity=createHash('sha256').update(JSON.stringify(input.modify||input.delete?[input.memberId,input.export,input.deposit,Boolean(input.modify),Boolean(input.delete)]:[input.memberId,input.export,input.deposit])).digest('hex');
        const previous=(await client.query('SELECT identity_sha FROM hestia_share_receipt WHERE actor_id=$1 AND folder_id=$2 AND idempotency_key=$3',[actor.id,folderId,input.idempotencyKey])).rows[0];
        if (previous) {
          if (previous.identity_sha!==identity) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Cette opération correspond à un autre partage.');
          return;
        }
        assertPolicyCapacity(state.graphRows.length,required.length);
        const batch=randomUUID(), direct=authority.kind==='reference'&&authority.folder_id===folderId, bound=state.limits(authority.id)!;
        for (const capability of required) await client.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,parent_id,lineage,origin,author_id,subject_epoch,batch_id,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[randomUUID(),folderId,input.memberId,capability,direct?'direct':'delegated',direct?null:authority.id,
          [...new Set([...authority.lineage,authority.user_id])],direct?'reference-command':'delegation-command',actor.id,state.members.get(input.memberId as string)!.departure_epoch,batch,Number.isFinite(bound.end)?new Date(bound.end):null]);
        await client.query('INSERT INTO hestia_share_receipt(actor_id,folder_id,idempotency_key,identity_sha,batch_id) VALUES($1,$2,$3,$4,$5)',[actor.id,folderId,input.idempotencyKey,identity,batch]);
      });
      return response({success:true});
    });
  }
  function handleFolderAccess(request:Request,folderId:string) {
    return guarded(async()=>{
      if (!isUuid(folderId)) throw unavailable();
      return response(await withActor(request,async(client,actor)=>{
        const state=await getFolderAccess(client,actor.id,folderId);
        if (!state.canAdminister&&!state.canShare) throw unavailable();
        const groups=new Map<string,Grant[]>();
        for (const g of state.sources) if (g.user_id===actor.id || state.canRevoke(g) || state.authorityFor([g.capability],g.user_id)) {
          if(g.folder_id!==folderId){const id=`inherited:${g.user_id}`;groups.set(id,[...(groups.get(id)??[]),g]);continue;}
          const completeBatch=g.batch_id && state.rows.filter(other=>other.batch_id===g.batch_id && state.valid(other.id));
          const id=completeBatch && (completeBatch.every(state.canRevoke) || completeBatch.every(other=>other.user_id===actor.id)) ? g.batch_id! : g.id;
          groups.set(id,[...(groups.get(id)??[]),g]);
        }
        const restrictions=new Map<string,Restriction[]>();
        for(const restriction of state.restrictions){
          if(!state.restrictionAuthority(restriction.user_id,[restriction.capability]))continue;
          const key=`${restriction.folder_id===folderId?'local':'inherited'}:${restriction.user_id}`;
          restrictions.set(key,[...(restrictions.get(key)??[]),restriction]);
        }
        return {grants:[...groups.entries()].map(([id,rows])=>({id,memberId:rows[0].user_id,memberName:state.members.get(rows[0].user_id)!.name,
          capabilities:[...new Set(rows.map(g=>g.capability))],createdAt:rows[0].created_at.toISOString(),kind:rows.some(g=>g.kind==='reference')?'reference':rows[0].kind,
          inherited:rows[0].folder_id!==folderId,provenanceLabel:rows[0].folder_id!==folderId?'Accès hérité':'Accès local',
          canRevoke:rows.every(state.canRevoke)})),
          restrictions:[...restrictions.values()].map(rows=>({memberId:rows[0].user_id,memberName:state.members.get(rows[0].user_id)!.name,
            capabilities:[...new Set(rows.map(r=>r.capability))],inherited:rows[0].folder_id!==folderId,
            canLift:rows[0].folder_id===folderId&&Boolean(state.restrictionAuthority(rows[0].user_id,rows.map(r=>r.capability)))})),
          members:[...state.members.values()].filter(m=>m.active).map(m=>({id:m.user_id,name:m.name,
            capabilities:state.effectiveFor(m.user_id).capabilities.filter(c=>m.user_id===actor.id||Boolean(state.authorityFor([c],m.user_id))),
            restrictableCapabilities:CAPABILITIES.filter(c=>state.restrictionAuthority(m.user_id,[c]))}))};
      }));
    });
  }
  function handleRevokeAccess(request:Request,folderId:string,grantId:string) {
    return guarded(async()=>{
      origin(request); if (!isUuid(folderId)||!isUuid(grantId)) throw unavailable();
      return response(await withActor(request,async(client,actor)=>{
        const state=await getFolderAccess(client,actor.id,folderId);
        if (!state.canAdminister) throw unavailable();
        const single=state.rows.some(g=>g.id===grantId);
        const targets=state.rows.filter(g=>(single ? g.id===grantId : g.batch_id===grantId) && !g.revoked_at);
        if (!targets.length || targets.some(g=>!state.canRevoke(g))) throw unavailable();
        await client.query('UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',[targets.map(g=>g.id)]);
        const after=await getFolderAccess(client,targets[0].user_id,folderId);
        return {success:true,remainingAccess:after.capabilities.length>0};
      }));
    });
  }
  function handleFolderRestriction(request:Request,folderId:string) {
    return guarded(async()=>{
      if(request.method!=='POST')throw invalid();origin(request);if(!isUuid(folderId))throw unavailable();
      const input=await json(request,['memberId','capabilities','restricted']);
      if(typeof input.memberId!=='string'||!Array.isArray(input.capabilities)||!known(input.capabilities)||!input.capabilities.length||typeof input.restricted!=='boolean')throw invalid();
      const subject=input.memberId,capabilities=input.capabilities as string[];
      return response(await withActor(request,async(client,actor)=>{
        const state=await getFolderAccess(client,actor.id,folderId),authority=state.restrictionAuthority(subject,capabilities);
        if(!authority||!state.capabilities.includes('consulter'))throw unavailable();
        if(!input.restricted&&capabilities.some(capability=>
          state.restrictions.some(r=>r.user_id===subject&&r.capability===capability&&r.folder_id!==folderId)
          &&!state.restrictions.some(r=>r.user_id===subject&&r.capability===capability&&r.folder_id===folderId)))throw unavailable();
        // A subtree restriction is one atomic policy change. Do not authorize
        // effects in a private descendant merely from the visible root.
        for(const folder of state.graph.folders){
          let current:TreeFolder|undefined=folder;const seen=new Set<string>();let descendant=false;
          while(current){if(seen.has(current.id))throw unavailable();seen.add(current.id);if(current.id===folderId){descendant=true;break;}current=state.graph.folders.find(f=>f.id===current!.parent_folder_id);}
          if(!descendant||folder.trashed_at)continue;
          const before=evaluateTreeAccess(state.graph,actor.id,folder.id);
          if(!before.capabilities.includes('consulter')||!before.restrictionAuthority(subject,capabilities))throw unavailable();
        }
        if(input.restricted){
          const added=capabilities.filter(capability=>!state.restrictions.some(r=>r.folder_id===folderId&&r.user_id===subject&&r.capability===capability)).length;
          assertPolicyCapacity(state.graph.restrictions.length,added);
          for(const capability of capabilities)await client.query(`INSERT INTO hestia_folder_restriction(id,folder_id,user_id,capability,authority_grant_id,author_id)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(folder_id,user_id,capability) DO NOTHING`,[randomUUID(),folderId,subject,capability,authority.id,actor.id]);}
        else await client.query('DELETE FROM hestia_folder_restriction WHERE folder_id=$1 AND user_id=$2 AND capability=ANY($3::text[])',[folderId,subject,capabilities]);
        return {success:true};
      }));
    });
  }
  return {handleSharing,handleFolderAccess,handleRevokeAccess,handleFolderRestriction};
}
