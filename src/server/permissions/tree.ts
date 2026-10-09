import { HttpError, unavailable } from '../access';
import { CAPABILITIES } from './capabilities';
import type { Grant, Member } from './service';

export type TreeFolder = {id:string;created_by:string;parent_folder_id:string|null;trashed_at?:Date|null;reference_grant_id?:string|null};
export type Restriction = {id:string;folder_id:string;user_id:string;capability:string;authority_grant_id:string;author_id:string};
export type ManagementCut = {folder_id:string;source_reference_id:string;new_reference_id:string};
export type AccessGraph = {folders:TreeFolder[];grants:Grant[];members:Member[];restrictions:Restriction[];cuts?:ManagementCut[];now:number};
const known = (v:string[]) => Array.isArray(v) && new Set(v).size===v.length && v.every(c=>(CAPABILITIES as readonly string[]).includes(c));
const end = (g:Grant) => g.expires_at?.getTime()??Infinity;

// Work bounds protect the server, not a business limit on nesting. Failure is
// closed and atomic; no truncated ancestry or partial union is returned.
export function evaluateTreeAccess(graph:AccessGraph,actorId:string,folderId:string,revoked:ReadonlySet<string>=new Set()) {
  const exhausted=()=>new HttpError(503,'RESOURCE_LIMIT','Le dossier est trop volumineux pour cette opération. Réessayez plus tard.');
  if(graph.folders.length>10000 || graph.grants.length>50000 || graph.restrictions.length>50000) throw exhausted();
  const folders=new Map(graph.folders.map(f=>[f.id,f])),grants=new Map(graph.grants.map(g=>[g.id,g])),members=new Map(graph.members.map(m=>[m.user_id,m]));
  const restrictionIndex=new Map<string,Set<string>>();
  for(const restriction of graph.restrictions){const key=JSON.stringify([restriction.user_id,restriction.capability]),anchors=restrictionIndex.get(key)??new Set<string>();anchors.add(restriction.folder_id);restrictionIndex.set(key,anchors);}
  const folder=folders.get(folderId);if(!folder)throw unavailable();
  let work=0;
  const tick=()=>{if(++work>1000000)throw exhausted();};
  const ancestryCache=new Map<string,string[]|null>();
  function ancestry(id:string):string[]|null {
    if(ancestryCache.has(id))return ancestryCache.get(id)!;
    const result:string[]=[],seen=new Set<string>();let next:string|null=id;
    while(next){tick();const row=folders.get(next);if(!row||row.trashed_at||seen.has(next)){ancestryCache.set(id,null);return null;}seen.add(next);result.push(next);next=row.parent_folder_id;}
    ancestryCache.set(id,result);return result;
  }
  function blocked(user:string,capability:string,target:string) {
    const path=ancestry(target);if(!path)return true;
    const anchors=restrictionIndex.get(JSON.stringify([user,capability]));
    return Boolean(anchors&&path.some(folder=>{tick();return anchors.has(folder);}));
  }
  function rawLimits(id:string):{transmit:string[];end:number}|null {
    const seen=new Set<string>(),contexts:string[]=[];let g=grants.get(id),transmit:string[]|null=null,until=Infinity;
    while(g){tick();if(seen.has(g.id)||!known(g.transmit)||Number.isNaN(end(g)))return null;seen.add(g.id);contexts.push(g.folder_id);const holder=g.user_id;const envelope:string[]=g.transmit.filter(c=>contexts.every(context=>!blocked(holder,c,context)));transmit=transmit===null?[...envelope]:transmit.filter(c=>envelope.includes(c));until=Math.min(until,end(g));if(!g.parent_id)return {transmit,end:until};g=grants.get(g.parent_id);}
    return null;
  }
  const validity=new Map<string,boolean>();
  function dependencyAt(id:string,target:string,seen=new Set<string>(),requested:readonly string[]=[]):boolean {
    tick();const g=grants.get(id),path=ancestry(target);
    if(!g||seen.has(id)||!path||[g.capability,...requested].some(c=>blocked(g.user_id,c,target)))return false;
    for(const cut of graph.cuts??[]){
      if(!path.includes(cut.folder_id))continue;
      const chain=new Set<string>();let dependency:Grant|undefined=g;
      while(dependency){
        tick();if(chain.has(dependency.id))return false;chain.add(dependency.id);
        // Replacements keep the same frame. A newly anchored frame is local
        // and independent at its own root, but cannot cross an older cut in a
        // strict descendant. This preserves nested autonomous management when
        // the surrounding inherited frame is itself transferred later.
        let reference:Grant|undefined=dependency;const predecessors=new Set<string>();
        while(reference){tick();if(predecessors.has(reference.id))return false;predecessors.add(reference.id);if(reference.id===cut.source_reference_id)return false;
          if(reference.kind!=='reference'){reference=undefined;continue;}
          if(reference.replaces_reference_id){reference=grants.get(reference.replaces_reference_id);continue;}
          const inheritedAcrossCut=reference.folder_id!==cut.folder_id&&ancestry(cut.folder_id)?.includes(reference.folder_id);
          reference=inheritedAcrossCut&&reference.anchor_reference_id?grants.get(reference.anchor_reference_id):undefined;
        }
        dependency=dependency.parent_id?grants.get(dependency.parent_id):undefined;
      }
    }
    if(!validGrant(id,seen))return false;
    if(!g.parent_id)return true;
    const parent=grants.get(g.parent_id);
    return Boolean(parent&&dependencyAt(parent.id,target,new Set([...seen,id]),[...new Set([...requested,g.capability])]));
  }
  function applicableAt(id:string,target:string):boolean {
    const g=grants.get(id);return Boolean(g&&ancestry(target)?.includes(g.folder_id)&&dependencyAt(id,target));
  }
  function validGrant(id:string,seen:Set<string>):boolean {
    tick();if(validity.has(id))return validity.get(id)!;
    const g=grants.get(id),member=g&&members.get(g.user_id);
    if(seen.size>512)throw exhausted();
    if(!g||seen.has(id)||g.revoked_at||revoked.has(id)||!member?.active||member.departure_epoch!==g.subject_epoch
      ||!(CAPABILITIES as readonly string[]).includes(g.capability)||!known(g.transmit)||!(graph.now<end(g))
      ||!['direct','reference','delegated'].includes(g.kind)||(g.kind==='delegated')!==Boolean(g.parent_id)
      ||(g.kind==='reference'&&(g.capability!=='administrer'||g.parent_id)))return false;
    if(!ancestry(g.folder_id)||blocked(g.user_id,g.capability,g.folder_id))return false;
    if(!g.parent_id){validity.set(id,true);return true;}
    const parent=grants.get(g.parent_id),bound=rawLimits(g.parent_id);
    const result=Boolean(parent&&['partager','administrer'].includes(parent.capability)&&bound?.transmit.includes(g.capability)
      &&!blocked(parent.user_id,g.capability,g.folder_id)
      &&dependencyAt(parent.id,g.folder_id,new Set([...seen,id]),[g.capability]));
    validity.set(id,result);return result;
  }
  function limits(id:string) {
    const g=grants.get(id),bound=rawLimits(id);
    if(!g||!bound)return null;
    return {...bound,transmit:bound.transmit.filter(capability=>{
      const seen=new Set<string>();let authority:Grant|undefined=g;
      while(authority){tick();if(seen.has(authority.id)||blocked(authority.user_id,capability,folderId))return false;seen.add(authority.id);authority=authority.parent_id?grants.get(authority.parent_id):undefined;}
      return true;
    })};
  }
  const valid=(id:string)=>applicableAt(id,folderId);
  const rows=graph.grants.filter(g=>g.folder_id===folderId);
  const sources=graph.grants.filter(g=>valid(g.id)),held=sources.filter(g=>g.user_id===actorId);
  const authorities=held.filter(g=>['partager','administrer'].includes(g.capability)).sort((a,b)=>Number(b.kind==='reference'&&b.folder_id===folderId)-Number(a.kind==='reference'&&a.folder_id===folderId));
  const admins=authorities.filter(g=>g.capability==='administrer');
  function authorityFor(required:string[],subject?:string) {
    return authorities.find(g=>required.every(c=>limits(g.id)?.transmit.includes(c))&&(!subject||(subject!==actorId&&!g.lineage.includes(subject)&&members.get(subject)?.active&&required.every(c=>!blocked(subject,c,folderId)))));
  }
  function canRevoke(g:Grant) {
    if(g.folder_id!==folderId||g.kind==='reference')return false;
    if(g.capability==='administrer')return admins.some(a=>a.kind==='reference'&&a.folder_id===folderId);
    return admins.some(a=>limits(a.id)?.transmit.includes(g.capability));
  }
  function restrictionAuthority(subject:string,capabilities:string[]) {
    if(!members.get(subject)?.active||!known(capabilities)||!capabilities.length)return undefined;
    return admins.find(a=>capabilities.every(c=>limits(a.id)?.transmit.includes(c)));
  }
  const capabilities=[...new Set(held.map(g=>g.capability))];
  const restrictions=graph.restrictions.filter(r=>ancestry(folderId)?.includes(r.folder_id));
  return {capabilities,ownerId:folder.created_by,canShare:Boolean(authorityFor(['consulter'])),canAdminister:admins.length>0,
    rows,sources,held,graphRows:graph.grants,members,valid,limits,authorityFor,canRevoke,restrictionAuthority,restrictions,now:graph.now,
    applicableAt,graph,restrictedAt:(memberId:string,capability:string,target=folderId)=>blocked(memberId,capability,target),
    effectiveFor:(memberId:string,revokedIds:ReadonlySet<string>=revoked)=>evaluateTreeAccess(graph,memberId,folderId,revokedIds)};
}
