import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { type Access, type Actor, HttpError, guarded, invalid, isUuid, json, response, textField, unavailable } from '../access';
import { folderNameKey } from '../db/folder-name';
import { CAPABILITIES } from '../permissions/capabilities';
import { loadFolderAccessGraph } from '../permissions/service';
import { evaluateTreeAccess, type AccessGraph, type TreeFolder } from '../permissions/tree';

const RETENTION = 168 * 60 * 60 * 1000;
const PREVIEW_LIFETIME = 15 * 60 * 1000;
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stale = () => new HttpError(409,'MOVE_STALE','La situation a changé. Vérifiez à nouveau les effets avant de confirmer.');
const conflict = () => new HttpError(409,'IDEMPOTENCY_CONFLICT','Cette opération correspond à une autre demande.');
const budget = () => new HttpError(503,'RESOURCE_LIMIT','Cette opération est trop importante. Aucune modification appliquée.');
export type MoveInput = {kind:'folder'|'document';sourceId:string;destinationId:string|null;name?:string};
export type MoveFolder = TreeFolder & {name:string;name_key:string;version:number;trash_group_id?:string|null};
export type MoveDocument = {id:string;folder_id:string;title:string|null;version:number;trashed_at:Date|null;purged_at:Date|null;trash_group_id?:string|null};
export type MoveImpactGroup = {icon:'user-plus'|'user-minus'|'arrow-right-left'|'folder-open';title:string;lead?:string;
  items:{name:string;text:string;details?:{text:string;folders:string[]}[]}[]};
export type MovePreview = {previewToken:string|null;source:{id:string;kind:'folder'|'document';name:string};
  destination:{id:string|null;name:string;breadcrumbs?:{id:string;name:string}[]};allowed:boolean;
  refusal?:{code:string;title:string;message:string};collision?:boolean;groups:MoveImpactGroup[];impactNote?:string};
type State = ReturnType<typeof evaluateTreeAccess>;
type Profile = {transmit:string[];end:number|null};
type Cell = {member:string;capability:string;before:Profile[];after:Profile[]};
type Element = {id:string;folderId:string;afterFolderId:string;name:string;trashed:boolean;folder:boolean;groupId?:string|null};
type Effect = {element:Element;member:string;gain:string[];loss:string[];before:string[];after:string[];description:string};
const expiry = (p:Profile) => p.end??Infinity;
const dominates = (a:Profile,b:Profile) => expiry(a)>=expiry(b) && b.transmit.every(c=>a.transmit.includes(c));

/** Current policy for one recoverable group. Only its exact folder members
 * and retained placement ancestors lose the lifecycle mask. Another deleted
 * group must never become an authority merely because this one is inspected. */
export function currentTrashPolicy(graph:AccessGraph,folderIds:ReadonlySet<string>):AccessGraph {
  const rows=new Map(graph.folders.map(f=>[f.id,f])),visible=new Set(folderIds);
  for(const id of folderIds){let cursor=rows.get(id);const seen=new Set<string>();
    while(cursor){if(seen.has(cursor.id))throw budget();seen.add(cursor.id);visible.add(cursor.id);cursor=cursor.parent_folder_id?rows.get(cursor.parent_folder_id):undefined;}
  }
  return {...graph,folders:graph.folders.map(f=>visible.has(f.id)?{...f,trashed_at:null}:f)};
}

function inputFrom(body:Record<string,unknown>):MoveInput {
  if (!['folder','document'].includes(String(body.kind)) || !isUuid(body.sourceId)
    || !(body.destinationId===null||isUuid(body.destinationId))) throw invalid();
  if (body.name!==undefined && body.kind!=='folder') throw invalid();
  return {kind:body.kind as MoveInput['kind'],sourceId:body.sourceId.toLowerCase(),
    destinationId:body.destinationId===null?null:(body.destinationId as string).toLowerCase(),
    ...(body.name!==undefined?{name:textField(body.name,120)}:{})};
}
function descendants(folders:TreeFolder[],root:string) {
  const children=new Map<string,string[]>();
  for(const f of folders)if(f.parent_folder_id)children.set(f.parent_folder_id,[...(children.get(f.parent_folder_id)??[]),f.id]);
  const result=new Set<string>(),pending=[root];
  while(pending.length){const id=pending.pop()!;if(result.has(id))throw budget();result.add(id);pending.push(...children.get(id)??[]);if(result.size>10000)throw budget();}
  return result;
}
function capabilities(cells:Cell[],side:'before'|'after') {return cells.filter(c=>c[side].length).map(c=>c.capability);}
function authority(state:State,required:string[],adminOnly:boolean,subject:string,ends:Profile[]=[],priorStates?:State[]):boolean {
  // Placement is not a new grant: self gains/losses are legitimate. Keep every
  // chain/restriction/envelope check, but do not use grant-creation anti-self rules.
  return state.held.some(g=>(g.capability==='administrer'||(!adminOnly&&g.capability==='partager'))
    && required.every(c=>state.limits(g.id)?.transmit.includes(c))
    && (!adminOnly||g.capability==='administrer')
    && (adminOnly||required.every(c=>!state.restrictedAt(subject,c)))
    && ends.every(p=>(state.limits(g.id)?.end??-Infinity)>=expiry(p))
    // A move cannot bootstrap its own authority by clearing a restriction on
    // that authority or expanding its envelope. The very same authority must
    // already cover the complete gain at source or destination before moving.
    && (!priorStates||priorStates.some(prior=>prior.held.some(held=>held.id===g.id)
      && required.every(c=>prior.limits(g.id)?.transmit.includes(c))
      && ends.every(p=>(prior.limits(g.id)?.end??-Infinity)>=expiry(p)))));
}

/** Pure policy planning, also exercised by unit tests. SQL callers must load all
 * inputs while holding the policy lock; no browser-provided graph is accepted. */
export function planFolderMove(graph:AccessGraph,folders:MoveFolder[],documents:MoveDocument[],actorId:string,input:MoveInput,options?:{restoring?:boolean}) {
  if(folders.length>10000||documents.length>10000||graph.members.length>1000)throw budget();
  const rows=new Map(folders.map(f=>[f.id,f])),sourceDocument=input.kind==='document'?documents.find(d=>d.id===input.sourceId):undefined;
  const source=rows.get(input.kind==='folder'?input.sourceId:sourceDocument?.folder_id??'');
  if(!source||source.trashed_at||(input.kind==='document'&&(!sourceDocument||sourceDocument.trashed_at||sourceDocument.purged_at)))throw unavailable();
  // Lifecycle masking remains mandatory for source/destination navigation.
  // The placement policy projection also covers recoverable older trash groups.
  // A restore's initial placement policy needs its own retained ancestors,
  // never an unrelated deleted authority. Its exact group is already active
  // in the supplied simulation; older groups remain masked in this baseline.
  const restoreAncestors=new Set<string>();
  if(options?.restoring){let cursor:MoveFolder|undefined=source;while(cursor){
    if(restoreAncestors.has(cursor.id))throw budget();restoreAncestors.add(cursor.id);
    cursor=cursor.parent_folder_id?rows.get(cursor.parent_folder_id):undefined;
  }}
  const restoreBeforeGraph=options?.restoring?{...graph,folders:graph.folders.map(f=>restoreAncestors.has(f.id)?{...f,trashed_at:null}:f)}:graph;
  const restoreBeforeCache=new Map<string,State>();
  const breadcrumbCache=new Map<string,State>();let evaluationWork=0;
  let profileWork=0;
  const profileTick=()=>{if(++profileWork>2_000_000)throw budget();};
  const profileCache=new Map<State,Map<string,Profile[]>>();
  function profiles(state:State,member:string,capability:string):Profile[]{
    profileTick();
    if(!profileCache.has(state)){
      const entries=new Map<string,Map<string,Profile>>();
      for(const grant of state.sources){
        profileTick();const key=JSON.stringify([grant.user_id,grant.capability]),bound=state.limits(grant.id)!;
        const profile={transmit:['partager','administrer'].includes(grant.capability)?[...bound.transmit].sort():[],end:Number.isFinite(bound.end)?bound.end:null};
        const alternatives=entries.get(key)??new Map<string,Profile>(),envelope=JSON.stringify(profile.transmit),prior=alternatives.get(envelope);
        if(!prior||expiry(profile)>expiry(prior))alternatives.set(envelope,profile);
        entries.set(key,alternatives);
      }
      const canonical=new Map<string,Profile[]>();
      for(const [key,alternatives] of entries){
        const values=[...alternatives.values()];
        canonical.set(key,values.filter((p,i)=>!values.some((q,j)=>{profileTick();return i!==j&&dominates(q,p);})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
      }
      profileCache.set(state,canonical);
    }
    return profileCache.get(state)!.get(JSON.stringify([member,capability]))??[];
  }
  const evaluate=(g:AccessGraph,id:string,cache:Map<string,State>)=>{
    if(!cache.has(id)){
      evaluationWork+=g.folders.length+g.grants.length+g.restrictions.length+(g.cuts?.length??0)+1;
      if(evaluationWork>2_000_000)throw budget();
      cache.set(id,evaluateTreeAccess(g,actorId,id));
    }
    return cache.get(id)!;
  };
  const initialCache=new Map<string,State>();
  const before=(id:string)=>evaluate(graph,id,initialCache),sourceRights=options?.restoring?evaluate(restoreBeforeGraph,source.id,restoreBeforeCache):before(source.id);
  const liveSourceRights=options?.restoring?sourceRights:evaluateTreeAccess(graph,actorId,source.id);
  if(!liveSourceRights.capabilities.includes('consulter'))throw unavailable();
  if(!sourceRights.capabilities.includes('consulter'))throw unavailable();
  const dto:MovePreview={previewToken:null,source:{id:input.sourceId,kind:input.kind,name:input.kind==='folder'?source.name:sourceDocument!.title!},
    destination:{id:input.destinationId,name:input.destinationId?'Dossier indisponible':'Mes dossiers'},allowed:false,groups:[]};
  const refuse=(code='RIGHTS_UNAVAILABLE')=>{
    dto.refusal=code==='NO_MANAGEMENT'?{code,title:'Gestion à transmettre',message:'Transmettez la gestion de ce dossier avant de le déplacer.'}
      :code==='NAME_UNAVAILABLE'?{code,title:'Nom déjà utilisé',message:'Ce nom n’est pas disponible ici. Choisissez un autre nom.'}
      :code==='INVALID_DESTINATION'?{code,title:'Déplacement impossible',message:'Choisissez une autre destination.'}
      :{code,title:'Déplacement impossible',message:'Vous ne disposez pas des droits nécessaires pour connaître ou autoriser tous les effets de ce déplacement.'};
    if(code==='NAME_UNAVAILABLE')dto.collision=true;
    return {dto,fingerprint:null as string|null};
  };
  if(!liveSourceRights.capabilities.includes('modifier'))return refuse();
  const destination=input.destinationId?rows.get(input.destinationId):undefined;
  if(input.destinationId&&(!destination||destination.trashed_at))return refuse();
  if(destination){
    const liveDestinationRights=evaluateTreeAccess(graph,actorId,destination.id);
    if(!liveDestinationRights.capabilities.includes('consulter'))return refuse();
    const rights=before(destination.id);
    if(!rights.capabilities.includes('consulter'))return refuse();
    dto.destination={id:destination.id,name:destination.name,breadcrumbs:[]};
    let cursor:MoveFolder|undefined=destination;const seen=new Set<string>();
    while(cursor&&evaluate(graph,cursor.id,breadcrumbCache).capabilities.includes('consulter')){
      if(seen.has(cursor.id))throw budget();seen.add(cursor.id);
      dto.destination.breadcrumbs!.unshift({id:cursor.id,name:cursor.name});cursor=cursor.parent_folder_id?rows.get(cursor.parent_folder_id):undefined;
    }
    if(!liveDestinationRights.capabilities.includes('modifier')||(input.kind==='document'&&!liveDestinationRights.capabilities.includes('déposer')))return refuse();
  }else if(input.kind==='document')return refuse('INVALID_DESTINATION');
  if((input.kind==='folder'?source.parent_folder_id:source.id)===input.destinationId)return refuse('INVALID_DESTINATION');
  const affected=input.kind==='folder'?descendants(folders,source.id):new Set<string>();
  if(input.kind==='folder'&&input.destinationId&&affected.has(input.destinationId))return refuse('INVALID_DESTINATION');
  const liveBeforeCache=new Map<string,State>(),liveAfterCache=new Map<string,State>();
  const liveAfterGraph=input.kind==='folder'?{...graph,folders:graph.folders.map(f=>f.id===source.id?{...f,parent_folder_id:input.destinationId}:f)}:graph;
  const trashBeforeCache=new Map<string,State>(),trashAfterCache=new Map<string,State>();
  const trashBeforeGraphs=new Map<string,AccessGraph>(),trashAfterGraphs=new Map<string,AccessGraph>();
  function trashState(id:string,groupId:string|null|undefined,afterMove:boolean){
    const cache=afterMove?trashAfterCache:trashBeforeCache,graphs=afterMove?trashAfterGraphs:trashBeforeGraphs;
    const key=JSON.stringify([id,groupId??null]),scope=groupId??`folder:${id}`;
    if(!graphs.has(scope))graphs.set(scope,currentTrashPolicy(afterMove?liveAfterGraph:graph,new Set(groupId?folders.filter(f=>f.trash_group_id===groupId).map(f=>f.id):[id])));
    if(!cache.has(key)){const g=graphs.get(scope)!;evaluationWork+=g.folders.length+g.grants.length+g.restrictions.length+(g.cuts?.length??0)+1;
      if(evaluationWork>2_000_000)throw budget();cache.set(key,evaluateTreeAccess(g,actorId,id));}
    return cache.get(key)!;
  }
  const elements:Element[]=[];
  if(input.kind==='folder')for(const f of folders)if(affected.has(f.id)&&(!f.trashed_at||graph.now<f.trashed_at.getTime()+RETENTION))elements.push({id:f.id,folderId:f.id,afterFolderId:f.id,name:f.name,trashed:Boolean(f.trashed_at),folder:true,groupId:f.trash_group_id});
  for(const d of documents)if((input.kind==='folder'?affected.has(d.folder_id):d.id===input.sourceId)&&!d.purged_at
    &&(!d.trashed_at||graph.now<d.trashed_at.getTime()+RETENTION))elements.push({id:d.id,folderId:d.folder_id,
      afterFolderId:input.kind==='document'?input.destinationId!:d.folder_id,name:d.title!,trashed:Boolean(d.trashed_at),folder:false,groupId:d.trash_group_id});
  if((elements.length+folders.length)*graph.members.length*CAPABILITIES.length>1_000_000)throw budget();
  const effects:Effect[]=[],matrix:{element:string;cells:Cell[]}[]=[];
  let unauthorized=false,noManagement=false;
  for(const element of elements){
    // Compare actual active rights, and current recoverable-trash policy only
    // for trash elements. Restore starts from current group policy (not an
    // artificial empty state) and ends with the exact restored live graph.
    const old=element.trashed?trashState(element.folderId,element.groupId,false):options?.restoring?evaluate(restoreBeforeGraph,element.folderId,restoreBeforeCache):evaluate(graph,element.folderId,liveBeforeCache);
    const next=element.trashed?trashState(element.afterFolderId,element.groupId,true):evaluate(liveAfterGraph,element.afterFolderId,liveAfterCache);
    const authorityOld=old,authorityNext=next;
    if(!authorityOld.capabilities.includes('consulter')||(element.trashed&&!old.capabilities.includes('supprimer')))unauthorized=true;
    if(element.folder){
      // The nearest original management reference must survive. A destination
      // reference cannot silently replace an inherited source reference.
      let f:MoveFolder|undefined=rows.get(element.id);const seen=new Set<string>();
      while(f&&!f.reference_grant_id){if(seen.has(f.id))throw budget();seen.add(f.id);f=f.parent_folder_id?rows.get(f.parent_folder_id):undefined;}
      const reference=f?.reference_grant_id;
      if(!reference||!old.valid(reference)||!next.valid(reference))noManagement=true;
    }
    const cells:Cell[]=[];
    for(const member of graph.members){
      const memberCells=CAPABILITIES.map(capability=>({member:member.user_id,capability,before:profiles(old,member.user_id,capability),after:profiles(next,member.user_id,capability)}));
      cells.push(...memberCells);
      const gains=memberCells.filter(c=>c.after.some(p=>!c.before.some(q=>dominates(q,p))));
      const losses=memberCells.filter(c=>c.before.some(p=>!c.after.some(q=>dominates(q,p))));
      if(!gains.length&&!losses.length)continue;
      // Knowledge and power are checked on every element before exposing even
      // one person's name. A refused plan always has an empty impact projection.
      if(!authorityOld.canShare&&!authorityOld.canAdminister)unauthorized=true;
      if(gains.length){
        const gainedProfiles=gains.flatMap(c=>c.after.filter(p=>!c.before.some(q=>dominates(q,p))));
        const required=[...new Set([...gains.map(c=>c.capability),...gainedProfiles.flatMap(p=>p.transmit)])];
        const destinationAuthority=destination?evaluate(graph,destination.id,liveBeforeCache):undefined;
        if(!authority(authorityNext,required,false,member.user_id,gainedProfiles,[authorityOld,...(destinationAuthority?[destinationAuthority]:[])]))unauthorized=true;
      }
      if(losses.length&&!authority(authorityOld,losses.map(c=>c.capability),true,member.user_id))unauthorized=true;
      const descriptions:string[]=[];
      for(const c of gains)descriptions.push(!c.before.length?`Gagne : ${c.capability}`
        :c.after.some(p=>!c.before.some(q=>p.transmit.every(cap=>q.transmit.includes(cap))))?`Capacités transmissibles étendues : ${c.capability}`:`Durée étendue : ${c.capability}`);
      for(const c of losses)descriptions.push(!c.after.length?`Perd : ${c.capability}`
        :c.before.some(p=>!c.after.some(q=>p.transmit.every(cap=>q.transmit.includes(cap))))?`Capacités transmissibles réduites : ${c.capability}`:`Durée réduite : ${c.capability}`);
      effects.push({element,member:member.user_id,gain:gains.map(c=>c.capability),loss:losses.map(c=>c.capability),before:capabilities(memberCells,'before'),after:capabilities(memberCells,'after'),description:descriptions.join(' · ')});
    }
    matrix.push({element:element.id,cells});
  }
  // Immutable delegation edges can reach outside the placement subtree. Such
  // collateral effects are not an implicit authorization to alter another tree.
  if(input.kind==='folder')for(const folder of folders){
    if(affected.has(folder.id)||(folder.trashed_at&&graph.now>=folder.trashed_at.getTime()+RETENTION))continue;
    const old=folder.trashed_at?trashState(folder.id,folder.trash_group_id,false):evaluate(graph,folder.id,liveBeforeCache);
    const next=folder.trashed_at?trashState(folder.id,folder.trash_group_id,true):evaluate(liveAfterGraph,folder.id,liveAfterCache);
    for(const member of graph.members)for(const cap of CAPABILITIES)
      if(JSON.stringify(profiles(old,member.user_id,cap))!==JSON.stringify(profiles(next,member.user_id,cap)))unauthorized=true;
  }
  if(unauthorized)return refuse();
  if(noManagement)return refuse('NO_MANAGEMENT');
  if(input.kind==='folder'){
    const name=input.name??source.name;
    if(folders.some(f=>f.id!==source.id&&!f.trashed_at&&f.parent_folder_id===input.destinationId&&f.name_key===folderNameKey(name)
      &&(input.destinationId!==null||f.created_by===source.created_by)))return refuse('NAME_UNAVAILABLE');
  }
  const groupMap=new Map<string,MoveImpactGroup>();
  const members=new Map(graph.members.map(m=>[m.user_id,m.name]));
  const relative=(element:Element)=>{
    if(input.kind==='document')return element.name;
    const names:string[]=element.folder?[]:[element.name];let f=rows.get(element.folderId);const seen=new Set<string>();
    while(f&&f.id!==source.id){if(seen.has(f.id))throw budget();seen.add(f.id);
      if(!f.trashed_at||graph.now<f.trashed_at.getTime()+RETENTION)names.unshift(f.name);
      f=f.parent_folder_id?rows.get(f.parent_folder_id):undefined;}
    return names.join(' / ')||source.name;
  };
  for(const member of graph.members){
    const changed=effects.filter(e=>e.member===member.user_id);if(!changed.length)continue;
    const all=changed.length===elements.length;
    const gained=changed.every(e=>!e.before.includes('consulter')&&e.after.includes('consulter'));
    const lost=changed.every(e=>e.before.includes('consulter')&&!e.after.includes('consulter'));
    const title=!all?'Changements dans une partie du contenu seulement':gained?'Gagnent un accès':lost?'Perdent leur accès':'Droits modifiés';
    const icon=!all?'folder-open':gained?'user-plus':lost?'user-minus':'arrow-right-left';
    const group=groupMap.get(title)??{icon,title,items:[]};
    const detailMap=new Map<string,string[]>();
    for(const effect of changed){const text=effect.description;
      detailMap.set(text,[...(detailMap.get(text)??[]),relative(effect.element)]);}
    group.items.push({name:members.get(member.user_id)!,text:gained?'Pourra consulter le contenu.':lost?'Ne pourra plus consulter le contenu.':'Les droits seront modifiés.',
      // Names are labels, not identities: distinct documents may legitimately
      // have the same title in the same folder. Preserve their multiplicity.
      details:[...detailMap].map(([text,paths])=>({text,folders:paths}))});
    groupMap.set(title,group);
  }
  dto.allowed=true;dto.groups=[...groupMap.values()];if(!effects.length)dto.impactNote='Aucun changement d’accès.';
  // The clock itself is excluded: elapsed time only invalidates a preview when
  // eligibility, effective rights or recoverable membership actually changes.
  const {now:_,...policy}=graph;void _;
  return {dto,fingerprint:hash({actorId,input,policy,folders,documents:documents.filter(d=>!d.purged_at&&(!d.trashed_at||graph.now<d.trashed_at.getTime()+RETENTION)),matrix})};
}

export function createFolderMoves(access:Access,dependencies?:{now?:()=>Date}) {
  const {origin,withActor}=access;
  const post=(request:Request)=>{if(request.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED','Action indisponible.');origin(request);};
  async function epoch(client:PoolClient,actor:Actor){return Number((await client.query('SELECT epoch FROM hestia_member WHERE user_id=$1',[actor.id])).rows[0].epoch);}
  async function load(client:PoolClient,actor:Actor,input:MoveInput){
    const graph=await loadFolderAccessGraph(client);if(dependencies?.now)graph.now=dependencies.now().getTime();
    const folders=(await client.query<MoveFolder>('SELECT * FROM hestia_folder ORDER BY id LIMIT 10001')).rows;
    if(folders.length>10000)throw budget();
    const ids=input.kind==='folder'?[...descendants(folders,input.sourceId)]:[];
    const documents=(await client.query<MoveDocument>(`SELECT * FROM hestia_document WHERE ${input.kind==='folder'?'folder_id=ANY($1::uuid[])':'id=$1::uuid'} ORDER BY id LIMIT 10001`,[input.kind==='folder'?ids:input.sourceId])).rows;
    const plan=planFolderMove(graph,folders,documents,actor.id,input);
    const deadlines=[...graph.grants.map(g=>g.expires_at?.getTime()),...folders.map(f=>f.trashed_at?f.trashed_at.getTime()+RETENTION:undefined),...documents.map(d=>d.trashed_at?d.trashed_at.getTime()+RETENTION:undefined)]
      .filter((value):value is number=>value!==undefined&&value>graph.now);
    return {...plan,now:graph.now,validUntil:Math.min(graph.now+PREVIEW_LIFETIME,...deadlines)};
  }
  async function existing(client:PoolClient,actor:Actor,key:string,requestHash:string){
    const row=(await client.query('SELECT actor_epoch,request_sha256 FROM hestia_move_receipt WHERE actor_id=$1 AND idempotency_key=$2',[actor.id,key])).rows[0];
    if(!row)return false;
    if(Number(row.actor_epoch)!==await epoch(client,actor))throw unavailable();
    if(row.request_sha256!==requestHash)throw conflict();
    // Admission/session/epoch have just been checked under the same lock. This
    // receipt is historical evidence only, even after an intentional loss or a
    // later revocation. It exposes no target metadata and performs no mutation.
    return true;
  }
  function handleMovePreview(request:Request){return guarded(async()=>{
    post(request);const body=await json(request,['kind','sourceId','destinationId','name']),input=inputFrom(body);
    return response(await withActor(request,async(client,actor)=>{
      const plan=await load(client,actor,input);if(!plan.dto.allowed)return plan.dto;
      await client.query('DELETE FROM hestia_move_preview WHERE actor_id=$1 AND expires_at<=$2',[actor.id,new Date(plan.now)]);
      const count=Number((await client.query('SELECT count(*) FROM hestia_move_preview WHERE actor_id=$1',[actor.id])).rows[0].count);
      if(count>=100)throw budget();
      const token=randomUUID();
      await client.query('INSERT INTO hestia_move_preview(token,actor_id,actor_epoch,request_sha256,state_sha256,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
        [token,actor.id,await epoch(client,actor),hash(input),plan.fingerprint,new Date(plan.now+PREVIEW_LIFETIME)]);
      return {...plan.dto,previewToken:token};
    }));
  });}
  function handleMove(request:Request){return guarded(async()=>{
    post(request);const body=await json(request,['kind','sourceId','destinationId','name','previewToken','idempotencyKey']),input=inputFrom(body);
    if(!isUuid(body.previewToken)||!isUuid(body.idempotencyKey))throw invalid();
    const token=body.previewToken.toLowerCase(),key=body.idempotencyKey.toLowerCase(),requestHash=hash([input,token]);
    return response(await withActor(request,async(client,actor)=>{
      if(await existing(client,actor,key,requestHash))return {status:'committed'};
      const preview=(await client.query('SELECT * FROM hestia_move_preview WHERE token=$1 AND actor_id=$2',[token,actor.id])).rows[0];
      if(!preview||Number(preview.actor_epoch)!==await epoch(client,actor)||preview.request_sha256!==hash(input))throw stale();
      const plan=await load(client,actor,input);
      if(!plan.dto.allowed||plan.now>=preview.expires_at.getTime()||plan.fingerprint!==preview.state_sha256)throw stale();
      const deadline=Math.min(plan.validUntil,preview.expires_at.getTime());
      // A clock boundary crossed during a large policy calculation must refuse
      // at the SQL effect too. The optional injected clock is for synthetic tests.
      const injected=dependencies?.now?.();if(injected&&injected.getTime()>=deadline)throw stale();
      const changed=input.kind==='folder'
        ?await client.query('UPDATE hestia_folder SET parent_folder_id=$2,name=COALESCE($3,name),name_key=COALESCE($4,name_key),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND COALESCE($6::timestamptz,clock_timestamp())<$5',
          [input.sourceId,input.destinationId,input.name??null,input.name?folderNameKey(input.name):null,new Date(deadline),injected??null])
        :await client.query('UPDATE hestia_document SET folder_id=$2,version=version+1 WHERE id=$1 AND COALESCE($4::timestamptz,clock_timestamp())<$3',
          [input.sourceId,input.destinationId,new Date(deadline),injected??null]);
      if(changed.rowCount!==1)throw stale();
      await client.query('INSERT INTO hestia_move_receipt(actor_id,idempotency_key,actor_epoch,request_sha256) VALUES($1,$2,$3,$4)',[actor.id,key,await epoch(client,actor),requestHash]);
      await client.query('DELETE FROM hestia_move_preview WHERE token=$1',[token]);
      return {status:'committed'};
    }));
  });}
  function handleMoveOperation(request:Request,key:string){return guarded(async()=>{
    post(request);if(!isUuid(key))throw invalid();
    const body=await json(request,['kind','sourceId','destinationId','name','previewToken']),input=inputFrom(body);if(!isUuid(body.previewToken))throw invalid();
    const requestHash=hash([input,body.previewToken.toLowerCase()]);
    return response(await withActor(request,async(client,actor)=>({status:await existing(client,actor,key.toLowerCase(),requestHash)?'committed':'not-recorded'})));
  });}
  return {handleMovePreview,handleMove,handleMoveOperation};
}
