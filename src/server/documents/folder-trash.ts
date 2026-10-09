import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {type Access,type Actor,HttpError,guarded,invalid,isUuid,json,response,textField,unavailable} from '../access';
import {folderNameKey} from '../db/folder-name';
import {loadFolderAccessGraph} from '../permissions/service';
import {evaluateTreeAccess,type AccessGraph} from '../permissions/tree';
import {currentTrashPolicy,planFolderMove,type MoveFolder,type MoveDocument,type MovePreview} from './moves';

export const TRASH_RETENTION=168*60*60*1000;
const PREVIEW_LIFETIME=15*60*1000;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stale=()=>new HttpError(409,'TRASH_STALE','La situation a changé. Vérifiez à nouveau avant de confirmer.');
const exhausted=()=>new HttpError(503,'RESOURCE_LIMIT','Cette opération est trop importante. Aucune modification appliquée.');
type Folder=MoveFolder & {trash_group_id?:string|null;purged_at?:Date|null};
type Document=MoveDocument & {trash_group_id?:string|null};
export type TrashGroup={id:string;root_folder_id:string;original_parent_id:string|null;trashed_at:Date;expires_at:Date;
  trashed_by_name:string|null;status:'trashed'|'restored'|'purged';folderIds:string[];documentIds:string[]};
export type FolderTrashPreview={previewToken:string|null;source:{id:string;name:string};allowed:boolean;
  counts?:{folders:number;documents:number};refusal?:{code:string;title:string;message:string}};
export type FolderRestorePreview=MovePreview & {groupId:string;counts?:{folders:number;documents:number}};
export type TrashGroupDto={id:string;folderId:string;name:string;trashedAt:string;restorableUntil:string;
  trashedByName:string|null;originalDestinationAvailable:boolean};
type Operation={action:'trash'|'restore';sourceId:string;destinationId?:string|null;name?:string};

/** Trash is a lifecycle state, not a revocation. This projection is used only
 * for trash authorization / placement effects, never for content or navigation.
 * Grants, restrictions, epochs, references and current time are unchanged. */
export const trashPolicyGraph=currentTrashPolicy;
function subtree(folders:Folder[],id:string,activeOnly=false){
  const children=new Map<string,Folder[]>();
  for(const f of folders)if(f.parent_folder_id)children.set(f.parent_folder_id,[...(children.get(f.parent_folder_id)??[]),f]);
  const root=folders.find(f=>f.id===id);if(!root)throw unavailable();
  const result=new Set<string>(),pending=[root];
  while(pending.length){const row=pending.pop()!;if(activeOnly&&row.trashed_at)continue;
    if(result.has(row.id)||result.size>=10000)throw exhausted();result.add(row.id);pending.push(...children.get(row.id)??[]);}
  return result;
}
function checkCapacity(graph:AccessGraph,folders:Folder[],documents:Document[]){
  if(folders.length>10000||documents.length>10000||graph.members.length>1000)throw exhausted();
  if(folders.length*(graph.folders.length+graph.grants.length+graph.restrictions.length+1)>2_000_000)throw exhausted();
}
const allowed=(graph:AccessGraph,actor:string,id:string,required=['consulter','supprimer'])=>{
  const state=evaluateTreeAccess(graph,actor,id);return required.every(c=>state.capabilities.includes(c));
};
function policyIdentity(graph:AccessGraph){const {now:_,...state}=graph;void _;return state;}
function deadline(graph:AccessGraph,extra=Infinity){
  return Math.min(graph.now+PREVIEW_LIFETIME,extra,...graph.grants.map(g=>g.expires_at?.getTime()??Infinity).filter(t=>t>graph.now));
}
const refused={code:'RIGHTS_UNAVAILABLE',title:'Suppression impossible',message:'Vous ne disposez pas des droits nécessaires pour supprimer tout ce contenu.'};

export function planFolderTrash(graph:AccessGraph,folders:Folder[],documents:Document[],actorId:string,sourceId:string){
  checkCapacity(graph,folders,documents);
  const source=folders.find(f=>f.id===sourceId);
  if(!source||source.trashed_at||!allowed(graph,actorId,sourceId,['consulter']))throw unavailable();
  const dto:FolderTrashPreview={previewToken:null,source:{id:source.id,name:source.name},allowed:false};
  const ids=subtree(folders,sourceId,true),affected=folders.filter(f=>ids.has(f.id));
  const docs=documents.filter(d=>ids.has(d.folder_id)&&!d.trashed_at&&!d.purged_at);
  if(affected.some(f=>!allowed(graph,actorId,f.id))){dto.refusal=refused;return {dto,folderIds:[],documentIds:[],fingerprint:null,validUntil:deadline(graph)};}
  dto.allowed=true;dto.counts={folders:affected.length,documents:docs.length};
  return {dto,folderIds:affected.map(f=>f.id),documentIds:docs.map(d=>d.id),validUntil:deadline(graph),
    fingerprint:digest({actorId,sourceId,policy:policyIdentity(graph),folders,documents})};
}

export function planFolderRestore(graph:AccessGraph,folders:Folder[],documents:Document[],actorId:string,group:TrashGroup,input:{destinationId?:string|null;name?:string}){
  checkCapacity(graph,folders,documents);
  const source=folders.find(f=>f.id===group.root_folder_id),policy=trashPolicyGraph(graph,new Set(group.folderIds));
  if(!source||!['trashed','purged'].includes(group.status)||source.trash_group_id!==group.id
    ||!allowed(policy,actorId,source.id))throw unavailable();
  // Expiry is distinguishable only after current root rights are established.
  // This response contains no old label, path, member count or content.
  if(graph.now>=group.expires_at.getTime()||group.status==='purged')
    throw new HttpError(410,'TRASH_EXPIRED','Délai dépassé. Ce dossier ne peut plus être restauré.');
  const destinationId=input.destinationId===undefined?group.original_parent_id:input.destinationId;
  const dto:FolderRestorePreview={groupId:group.id,previewToken:null,source:{id:source.id,kind:'folder',name:source.name},
    destination:{id:destinationId,name:destinationId?'Dossier indisponible':'Mes dossiers'},allowed:false,groups:[]};
  const reject=(code:string,title:string,message:string)=>{dto.refusal={code,title,message};if(code==='NAME_UNAVAILABLE')dto.collision=true;
    return {dto,fingerprint:null,validUntil:deadline(graph,group.expires_at.getTime()),destinationId};};
  const members=new Set(group.folderIds),docs=new Set(group.documentIds);
  if(!members.has(source.id)||group.folderIds.some(id=>{const f=folders.find(f=>f.id===id);return !f||f.trash_group_id!==group.id||f.purged_at||!allowed(policy,actorId,id);})
    ||group.documentIds.some(id=>{const d=documents.find(d=>d.id===id);return !d||d.trash_group_id!==group.id||d.purged_at||!members.has(d.folder_id);}))
    return reject('RIGHTS_UNAVAILABLE','Restauration impossible','Vos accès actuels ne le permettent pas. Rien n’a été restauré ; l’élément reste à la corbeille jusqu’à son échéance, sans prolongation.');
  const destination=destinationId?folders.find(f=>f.id===destinationId):undefined;
  let moveFingerprint:string|null=null;
  const recoveryDeadlines=[...folders,...documents].map(row=>row.trashed_at?row.trashed_at.getTime()+TRASH_RETENTION:Infinity).filter(t=>t>graph.now);
  const validUntil=deadline(graph,Math.min(group.expires_at.getTime(),...recoveryDeadlines));
  if(destinationId&&(!destination||destination.trashed_at||destination.purged_at||!allowed(graph,actorId,destinationId,['consulter'])))
    return reject('DESTINATION_UNAVAILABLE','Emplacement indisponible','Choisissez un autre emplacement autorisé pour restaurer ce dossier.');
  if(destination)dto.destination={id:destination.id,name:destination.name};
  if(destinationId!==group.original_parent_id){
    // Simulate restoration only for the exact group. Older groups remain trash
    // and participate in move policy effects while keeping their own deadlines.
    const restoredFolders=folders.map(f=>members.has(f.id)?{...f,trashed_at:null}:f);
    const restoredGraph={...graph,folders:graph.folders.map(f=>members.has(f.id)?{...f,trashed_at:null}:f)};
    const restoredDocuments=documents.map(d=>docs.has(d.id)?{...d,trashed_at:null}:d);
    const move=planFolderMove(restoredGraph,restoredFolders,restoredDocuments,actorId,{kind:'folder',sourceId:source.id,destinationId,...(input.name?{name:input.name}:{})},{restoring:true});
    moveFingerprint=move.fingerprint;
    Object.assign(dto,move.dto);if(!dto.allowed)return {dto,fingerprint:null,validUntil:deadline(graph,group.expires_at.getTime()),destinationId};
  }else{
    const name=input.name??source.name;
    if(folders.some(f=>!f.trashed_at&&f.id!==source.id&&f.parent_folder_id===destinationId&&f.name_key===folderNameKey(name)
      &&(destinationId!==null||f.created_by===source.created_by)))
      return reject('NAME_UNAVAILABLE','Nom déjà utilisé','Ce nom n’est pas disponible ici. Choisissez un autre nom.');
    dto.allowed=true;dto.impactNote='Aucun changement d’accès.';
  }
  dto.counts={folders:group.folderIds.length,documents:group.documentIds.length};
  return {dto,destinationId,validUntil,
    fingerprint:digest({actorId,input,group,policy:policyIdentity(graph),folders,documents,moveFingerprint})};
}

export function createFolderTrash(access:Access,dependencies?:{now?:()=>Date}){
  const {withActor,origin,transaction}=access;
  const post=(request:Request)=>{if(request.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED','Action indisponible.');origin(request);};
  const clock=async(client:PoolClient)=>dependencies?.now?.()??(await client.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now;
  const epoch=async(client:PoolClient,actor:Actor)=>Number((await client.query('SELECT epoch FROM hestia_member WHERE user_id=$1',[actor.id])).rows[0].epoch);
  async function state(client:PoolClient){
    const graph=await loadFolderAccessGraph(client);if(dependencies?.now)graph.now=dependencies.now().getTime();
    const folders=(await client.query<Folder>('SELECT * FROM hestia_folder ORDER BY id LIMIT 10001')).rows;
    const documents=(await client.query<Document>('SELECT * FROM hestia_document WHERE purged_at IS NULL ORDER BY id LIMIT 10001')).rows;
    checkCapacity(graph,folders,documents);return {graph,folders,documents};
  }
  async function groupFor(client:PoolClient,id:string):Promise<TrashGroup>{
    const group=(await client.query<TrashGroup>('SELECT * FROM hestia_trash_group WHERE id=$1',[id])).rows[0];if(!group)throw unavailable();
    group.folderIds=(await client.query('SELECT folder_id FROM hestia_trash_folder_member WHERE group_id=$1 ORDER BY folder_id LIMIT 10001',[id])).rows.map(r=>r.folder_id);
    group.documentIds=(await client.query('SELECT document_id FROM hestia_trash_document_member WHERE group_id=$1 ORDER BY document_id LIMIT 10001',[id])).rows.map(r=>r.document_id);
    if(group.folderIds.length>10000||group.documentIds.length>10000)throw exhausted();return group;
  }
  function operation(action:'trash'|'restore',sourceId:string,body:Record<string,unknown>):Operation {
    if(!isUuid(sourceId))throw unavailable();
    if(action==='trash'&&(body.destinationId!==undefined||body.name!==undefined))throw invalid();
    if(body.destinationId!==undefined&&body.destinationId!==null&&!isUuid(body.destinationId))throw invalid();
    return {action,sourceId:sourceId.toLowerCase(),...(body.destinationId!==undefined?{destinationId:body.destinationId===null?null:(body.destinationId as string).toLowerCase()}:{}),
      ...(body.name!==undefined?{name:textField(body.name,120)}:{})};
  }
  async function receipt(client:PoolClient,actor:Actor,key:string,hash:string){
    const r=(await client.query('SELECT * FROM hestia_trash_receipt WHERE actor_id=$1 AND idempotency_key=$2',[actor.id,key])).rows[0];
    if(!r)return false;if(Number(r.actor_epoch)!==await epoch(client,actor))throw unavailable();
    if(r.request_sha256!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Cette opération correspond à une autre demande.');return true;
  }
  async function plan(client:PoolClient,actor:Actor,input:Operation){
    const s=await state(client);
    if(input.action==='trash')return {...planFolderTrash(s.graph,s.folders,s.documents,actor.id,input.sourceId),state:s,group:null};
    const group=await groupFor(client,input.sourceId);
    return {...planFolderRestore(s.graph,s.folders,s.documents,actor.id,group,input),state:s,group};
  }
  function preview(request:Request,id:string,action:'trash'|'restore'){return guarded(async()=>{
    post(request);const body=await json(request,action==='trash'?[]:['destinationId','name']),input=operation(action,id,body);
    return response(await withActor(request,async(client,actor)=>{
      const p=await plan(client,actor,input);if(!p.dto.allowed)return p.dto;
      await client.query('DELETE FROM hestia_trash_preview WHERE actor_id=$1 AND expires_at<=$2',[actor.id,new Date(p.state.graph.now)]);
      if(Number((await client.query('SELECT count(*) FROM hestia_trash_preview WHERE actor_id=$1',[actor.id])).rows[0].count)>=100)throw exhausted();
      const token=randomUUID();await client.query('INSERT INTO hestia_trash_preview VALUES($1,$2,$3,$4,$5,$6)',[token,actor.id,await epoch(client,actor),digest(input),p.fingerprint,new Date(p.validUntil)]);
      return {...p.dto,previewToken:token};
    }));
  });}
  function commit(request:Request,id:string,action:'trash'|'restore'){return guarded(async()=>{
    post(request);const body=await json(request,['destinationId','name','previewToken','idempotencyKey']),input=operation(action,id,body);
    if(!isUuid(body.previewToken)||!isUuid(body.idempotencyKey))throw invalid();
    const token=body.previewToken.toLowerCase(),key=body.idempotencyKey.toLowerCase(),hash=digest([input,token]);
    return response(await withActor(request,async(client,actor)=>{
      if(await receipt(client,actor,key,hash))return {status:'committed'};
      const prior=(await client.query('SELECT * FROM hestia_trash_preview WHERE token=$1 AND actor_id=$2',[token,actor.id])).rows[0];
      if(!prior||Number(prior.actor_epoch)!==await epoch(client,actor)||prior.request_sha256!==digest(input))throw stale();
      const p=await plan(client,actor,input),until=Math.min(prior.expires_at.getTime(),p.validUntil);
      if(!p.dto.allowed||p.fingerprint!==prior.state_sha256||(await clock(client)).getTime()>=until)throw stale();
      if(action==='trash'){
        const selected=planFolderTrash(p.state.graph,p.state.folders,p.state.documents,actor.id,input.sourceId);
        const groupId=randomUUID(),now=await clock(client),source=p.state.folders.find(f=>f.id===input.sourceId)!;
        await client.query(`INSERT INTO hestia_trash_group(id,root_folder_id,original_parent_id,trashed_at,expires_at,trashed_by_name,status) VALUES($1,$2,$3,$4,$5,$6,'trashed')`,
          [groupId,source.id,source.parent_folder_id,now,new Date(now.getTime()+TRASH_RETENTION),actor.name]);
        await client.query('INSERT INTO hestia_trash_folder_member SELECT $1,unnest($2::uuid[])',[groupId,selected.folderIds]);
        await client.query('INSERT INTO hestia_trash_document_member SELECT $1,unnest($2::uuid[])',[groupId,selected.documentIds]);
        await client.query('UPDATE hestia_folder SET trashed_at=$2,trash_group_id=$3,version=version+1,updated_at=$2 WHERE id=ANY($1::uuid[])',[selected.folderIds,now,groupId]);
        await client.query('UPDATE hestia_document SET trashed_at=$2,trashed_by_name=$3,trash_group_id=$4,version=version+1 WHERE id=ANY($1::uuid[])',[selected.documentIds,now,actor.name,groupId]);
      }else{
        const group=p.group!;
        await client.query('UPDATE hestia_folder SET parent_folder_id=$2,name=COALESCE($3,name),name_key=COALESCE($4,name_key) WHERE id=$1',
          [group.root_folder_id,input.destinationId===undefined?group.original_parent_id:input.destinationId,input.name??null,input.name?folderNameKey(input.name):null]);
        await client.query('UPDATE hestia_folder SET trashed_at=NULL,trash_group_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=ANY($1::uuid[])',[group.folderIds]);
        await client.query('UPDATE hestia_document SET trashed_at=NULL,trashed_by_name=NULL,trash_group_id=NULL,version=version+1,last_lifecycle_action=NULL,last_lifecycle_version=NULL WHERE id=ANY($1::uuid[])',[group.documentIds]);
        await client.query("UPDATE hestia_trash_group SET status='restored',trashed_by_name=NULL WHERE id=$1",[group.id]);
      }
      // A policy/deadline boundary crossed during SQL must roll back all effects.
      if((await clock(client)).getTime()>=until)throw stale();
      await client.query('INSERT INTO hestia_trash_receipt(actor_id,idempotency_key,actor_epoch,request_sha256) VALUES($1,$2,$3,$4)',[actor.id,key,await epoch(client,actor),hash]);
      await client.query('DELETE FROM hestia_trash_preview WHERE token=$1',[token]);return {status:'committed'};
    }));
  });}
  function handleTrashOperation(request:Request,key:string){return guarded(async()=>{
    post(request);if(!isUuid(key))throw invalid();const body=await json(request,['action','sourceId','destinationId','name','previewToken']);
    if(!['trash','restore'].includes(String(body.action))||!isUuid(body.sourceId)||!isUuid(body.previewToken))throw invalid();
    const input=operation(body.action as 'trash'|'restore',body.sourceId,body),hash=digest([input,body.previewToken.toLowerCase()]);
    return response(await withActor(request,async(client,actor)=>({status:await receipt(client,actor,key.toLowerCase(),hash)?'committed':'not-recorded'})));
  });}
  function handleTrashGroups(request:Request){return guarded(async()=>{
    if(request.method!=='GET')throw new HttpError(405,'METHOD_NOT_ALLOWED','Action indisponible.');
    return response(await withActor(request,async(client,actor)=>{
      const s=await state(client),rows=(await client.query<TrashGroup>(`SELECT g.*,ARRAY(SELECT m.folder_id FROM hestia_trash_folder_member m WHERE m.group_id=g.id ORDER BY folder_id) AS "folderIds"
        FROM hestia_trash_group g WHERE status='trashed' AND expires_at>$1 ORDER BY trashed_at,id LIMIT 10001`,[new Date(s.graph.now)])).rows;
      if(rows.length>10000)throw exhausted();const groups:TrashGroupDto[]=[];
      for(const g of rows){const policy=trashPolicyGraph(s.graph,new Set(g.folderIds)),root=s.folders.find(f=>f.id===g.root_folder_id);if(!root||root.trash_group_id!==g.id||!allowed(policy,actor.id,root.id))continue;
        const parent=g.original_parent_id?s.folders.find(f=>f.id===g.original_parent_id):undefined;
        groups.push({id:g.id,folderId:root.id,name:root.name,trashedAt:g.trashed_at.toISOString(),restorableUntil:g.expires_at.toISOString(),trashedByName:g.trashed_by_name,
          originalDestinationAvailable:!g.original_parent_id||Boolean(parent&&!parent.trashed_at&&allowed(s.graph,actor.id,parent.id,['consulter']))});
      }
      return {groups,now:new Date(s.graph.now).toISOString()};
    },false));
  });}
  async function cleanupFolderTrash(limit=20){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid trash batch');
    return transaction(async client=>{
      const now=await clock(client),rows=(await client.query("SELECT id FROM hestia_trash_group WHERE status='trashed' AND expires_at<=$1 ORDER BY expires_at,id LIMIT $2 FOR UPDATE",[now,limit])).rows;
      for(const {id} of rows){
        // Keep only opaque placement/policy anchors: other independent groups,
        // receipts and immutable delegation chains can still refer to them.
        await client.query('UPDATE hestia_folder SET name=NULL,name_key=NULL,purged_at=$2 WHERE trash_group_id=$1',[id,now]);
        await client.query("UPDATE hestia_trash_group SET status='purged',trashed_by_name=NULL WHERE id=$1",[id]);
      }
      return {purged:rows.length};
    });
  }
  return {handleTrashGroups,handleFolderTrashPreview:(request:Request,id:string)=>preview(request,id,'trash'),
    handleFolderTrash:(request:Request,id:string)=>commit(request,id,'trash'),
    handleFolderRestorePreview:(request:Request,id:string)=>preview(request,id,'restore'),
    handleFolderRestore:(request:Request,id:string)=>commit(request,id,'restore'),handleTrashOperation,cleanupFolderTrash};
}
