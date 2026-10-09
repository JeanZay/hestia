import {describe,it,expect} from 'vitest';
import {planFolderTrash,planFolderRestore,trashPolicyGraph,TRASH_RETENTION,type TrashGroup} from '../../src/server/documents/folder-trash';
import {planFolderMove,type MoveFolder,type MoveDocument} from '../../src/server/documents/moves';
import {evaluateTreeAccess,type AccessGraph} from '../../src/server/permissions/tree';
import type {Grant} from '../../src/server/permissions/service';
import {CAPABILITIES} from '../../src/server/permissions/capabilities';

type Folder=MoveFolder & {trash_group_id?:string|null;purged_at?:Date|null};
type Document=MoveDocument & {trash_group_id?:string|null};
const f=(id:string,parent_folder_id:string|null):Folder=>({id,name:id,name_key:id,created_by:'a',parent_folder_id,version:1,trashed_at:null,reference_grant_id:parent_folder_id?null:`${id}-ref`});
const grant=(id:string,folder_id:string,user_id:string,capability:string,extra:Partial<Grant>={}):Grant=>({id,folder_id,user_id,capability,kind:'direct',parent_id:null,transmit:[],lineage:[],origin:'initial',author_id:'a',subject_epoch:0,revoked_at:null,expires_at:null,batch_id:null,created_at:new Date(0),...extra});
function fixture(){
  const folders=[f('root',null),f('source','root'),f('leaf','source'),f('destination','root'),f('outside',null)];
  const graph:AccessGraph={folders,grants:[],members:['a','b','c'].map(user_id=>({user_id,name:user_id,active:true,departure_epoch:0})),restrictions:[],cuts:[],now:1000};
  for(const id of ['root','outside'])for(const cap of CAPABILITIES)graph.grants.push(grant(cap==='administrer'?`${id}-ref`:`${id}-${cap}`,id,'a',cap,cap==='administrer'?{kind:'reference',transmit:[...CAPABILITIES]}:{}));
  for(const cap of ['consulter','supprimer'])graph.grants.push(grant(`b-${cap}`,'root','b',cap));
  const documents:Document[]=[{id:'document',folder_id:'leaf',title:'Original',version:1,trashed_at:null,purged_at:null}];
  return {graph,folders,documents};
}
function deleted(s:ReturnType<typeof fixture>,id='group'):TrashGroup{
  const group:TrashGroup={id,root_folder_id:'source',original_parent_id:'root',trashed_at:new Date(500),expires_at:new Date(500+TRASH_RETENTION),trashed_by_name:'a',status:'trashed',folderIds:['source','leaf'],documentIds:['document']};
  for(const f of s.folders)if(group.folderIds.includes(f.id)){f.trashed_at=group.trashed_at;f.trash_group_id=id;}
  for(const d of s.documents)if(group.documentIds.includes(d.id)){d.trashed_at=group.trashed_at;d.trash_group_id=id;}
  return group;
}
const trash=(s:ReturnType<typeof fixture>,actor='a')=>planFolderTrash(s.graph,s.folders,s.documents,actor,'source');
const restore=(s:ReturnType<typeof fixture>,group:TrashGroup,input:{destinationId?:string|null;name?:string}={},actor='a')=>planFolderRestore(s.graph,s.folders,s.documents,actor,group,input);

describe('folder trash policy and exact groups',()=>{
  it('requires consultation and deletion, without requiring modification',()=>{
    const s=fixture(),before=JSON.stringify(s),p=trash(s,'b');
    expect(p.dto).toMatchObject({allowed:true,counts:{folders:2,documents:1}});
    expect(p.folderIds).toEqual(['source','leaf']);expect(p.documentIds).toEqual(['document']);expect(JSON.stringify(s)).toBe(before);
  });
  it('refuses the whole deletion without counts or protected descendant labels',()=>{
    const s=fixture();s.graph.restrictions.push({id:'restriction',folder_id:'leaf',user_id:'a',capability:'supprimer',authority_grant_id:'root-ref',author_id:'a'});
    const p=trash(s);expect(p.dto).toMatchObject({allowed:false});expect(p.dto.counts).toBeUndefined();expect(p.folderIds).toEqual([]);expect(JSON.stringify(p.dto)).not.toContain('leaf');
  });
  it('does not reveal an inaccessible source',()=>{
    const s=fixture();expect(()=>trash(s,'c')).toThrow(expect.objectContaining({status:404}));
  });
  it('excludes a previously deleted branch and independent deleted documents',()=>{
    const s=fixture();s.folders.find(f=>f.id==='leaf')!.trashed_at=new Date(1);
    s.documents.push({...s.documents[0],id:'old-document',folder_id:'source',trashed_at:new Date(2)});
    const p=trash(s);expect(p.dto.counts).toEqual({folders:1,documents:0});expect(p.folderIds).toEqual(['source']);
  });
  it('binds exact contents, policy and versions while ignoring mere elapsed time',()=>{
    const s=fixture(),first=trash(s);s.graph.now++;expect(trash(s).fingerprint).toBe(first.fingerprint);
    s.documents[0].version++;expect(trash(s).fingerprint).not.toBe(first.fingerprint);
    const second=trash(s);s.graph.grants.find(g=>g.id==='root-exporter')!.revoked_at=new Date(1);expect(trash(s).fingerprint).not.toBe(second.fingerprint);
  });
  it('limits preview validity to a rights expiry even without any row change',()=>{
    const s=fixture();s.graph.grants.find(g=>g.id==='b-supprimer')!.expires_at=new Date(1500);
    expect(trash(s,'b').validUntil).toBe(1500);s.graph.now=1500;expect(trash(s,'b').dto.allowed).toBe(false);
  });
  it('trash rights projection never alters grants or makes normal content readable',()=>{
    const s=fixture();deleted(s);const before=JSON.stringify(s);
    expect(evaluateTreeAccess(s.graph,'a','leaf').capabilities).toEqual([]);
    expect(evaluateTreeAccess(trashPolicyGraph(s.graph,new Set(['source','leaf'])),'a','leaf').capabilities).toContain('supprimer');
    expect(JSON.stringify(s)).toBe(before);
    s.graph.grants.find(g=>g.id==='root-consulter')!.revoked_at=new Date(1);
    expect(evaluateTreeAccess(trashPolicyGraph(s.graph,new Set(['source','leaf'])),'a','leaf').capabilities).not.toContain('consulter');
  });
  it('restores only the exact group under current rights without needing modification at original placement',()=>{
    const s=fixture(),group=deleted(s),before=JSON.stringify(s);
    expect(restore(s,group,{},'b').dto).toMatchObject({allowed:true,counts:{folders:2,documents:1},groups:[]});expect(JSON.stringify(s)).toBe(before);
  });
  it('refuses the entire restore when only a descendant loses deletion rights',()=>{
    const s=fixture(),group=deleted(s);s.graph.restrictions.push({id:'restriction',folder_id:'leaf',user_id:'b',capability:'supprimer',authority_grant_id:'root-ref',author_id:'a'});
    expect(restore(s,group,{},'b').dto).toMatchObject({allowed:false,groups:[]});expect(restore(s,group,{},'b').dto.counts).toBeUndefined();
  });
  it('refuses stale membership rather than partially restoring the remaining rows',()=>{
    const s=fixture(),group=deleted(s);s.documents[0].trash_group_id='different-group';
    expect(restore(s,group).dto.allowed).toBe(false);
  });
  it('refuses at exactly 168 hours without waiting for physical cleanup',()=>{
    const s=fixture(),group=deleted(s);s.graph.now=group.expires_at.getTime()-1;expect(restore(s,group).dto.allowed).toBe(true);
    s.graph.now++;expect(()=>restore(s,group)).toThrow(expect.objectContaining({status:410,code:'TRASH_EXPIRED'}));
    expect(()=>restore(s,group,{},'c')).toThrow(expect.objectContaining({status:404}));
  });
  it('requests another destination for a deleted parent and preserves the deadline',()=>{
    const s=fixture(),group=deleted(s),end=group.expires_at.getTime();s.folders[0].trashed_at=new Date(100);
    expect(restore(s,group).dto).toMatchObject({allowed:false,refusal:{code:'DESTINATION_UNAVAILABLE'}});expect(group.expires_at.getTime()).toBe(end);
  });
  it('handles normalized name collision without disclosing the conflicting row',()=>{
    const s=fixture(),group=deleted(s);s.folders.push({...f('secret-sibling','root'),name:'Source',name_key:'source'});
    const p=restore(s,group);expect(p.dto).toMatchObject({allowed:false,collision:true});expect(JSON.stringify(p.dto)).not.toContain('secret-sibling');
    expect(restore(s,group,{name:'Autre nom'}).dto.allowed).toBe(true);
  });
  it('applies move rights to an alternative destination, refusing a deleter without modification',()=>{
    const s=fixture(),group=deleted(s);expect(restore(s,group,{destinationId:'destination'},'b').dto.allowed).toBe(false);
    expect(restore(s,group,{destinationId:'destination'}).dto.allowed).toBe(true);
  });
  it('requires a surviving management frame at the root',()=>{
    const s=fixture(),group=deleted(s);expect(restore(s,group,{destinationId:null}).dto).toMatchObject({allowed:false,refusal:{code:'NO_MANAGEMENT'}});
    s.folders.find(f=>f.id==='source')!.reference_grant_id='local-ref';s.graph.grants.push(grant('local-ref','source','a','administrer',{kind:'reference',transmit:[...CAPABILITIES]}));
    expect(restore(s,group,{destinationId:null}).dto.allowed).toBe(true);
  });
  it('refuses alternative destination cycles',()=>{
    const s=fixture(),group=deleted(s);expect(restore(s,group,{destinationId:'leaf'}).dto.allowed).toBe(false);
  });
  it('a parent move includes older recoverable groups without reactivating them',()=>{
    const s=fixture(),leaf=s.folders.find(f=>f.id==='leaf')!;leaf.trashed_at=new Date(0);s.documents[0].trashed_at=new Date(0);
    const before=JSON.stringify(s),p=planFolderMove(s.graph,s.folders,s.documents,'a',{kind:'folder',sourceId:'source',destinationId:'destination'});
    expect(p.dto.allowed).toBe(true);expect(JSON.stringify(s)).toBe(before);
    s.graph.restrictions.push({id:'restriction',folder_id:'leaf',user_id:'a',capability:'supprimer',authority_grant_id:'root-ref',author_id:'a'});
    expect(planFolderMove(s.graph,s.folders,s.documents,'a',{kind:'folder',sourceId:'source',destinationId:'destination'}).dto.allowed).toBe(false);
  });
  it('older group effects participate in alternative restore while its members stay outside the restored group',()=>{
    const s=fixture();s.folders.push({...f('older','source'),trashed_at:new Date(0),trash_group_id:'old'});
    const group=deleted(s),old=s.folders.find(f=>f.id==='older')!,before=JSON.stringify(old);
    s.graph.grants.push(grant('c-new','destination','c','consulter'));
    const p=restore(s,group,{destinationId:'destination'});expect(p.dto.allowed).toBe(true);expect(p.dto.counts).toEqual({folders:2,documents:1});
    expect(JSON.stringify(p.dto.groups)).toContain('older');expect(JSON.stringify(old)).toBe(before);
  });
  it('expired older groups do not expose labels or demand rights to their expired contents',()=>{
    const s=fixture();s.folders.push({...f('expired-private','source'),trashed_at:new Date(-TRASH_RETENTION),trash_group_id:'old'});
    s.graph.restrictions.push({id:'restriction',folder_id:'expired-private',user_id:'a',capability:'consulter',authority_grant_id:'root-ref',author_id:'a'});
    const group=deleted(s);s.graph.grants.push(grant('c-new','destination','c','consulter'));
    const p=restore(s,group,{destinationId:'destination'});expect(p.dto.allowed).toBe(true);expect(JSON.stringify(p.dto)).not.toContain('expired-private');
  });
  it('invalidates an alternative restore when an older group expires without a SQL row change',()=>{
    const s=fixture();s.folders.push({...f('older','source'),trashed_at:new Date(1100-TRASH_RETENTION),trash_group_id:'old'});
    const group=deleted(s);s.graph.grants.push(grant('c-new','destination','c','consulter'));
    const p=restore(s,group,{destinationId:'destination'});expect(p.dto.allowed).toBe(true);expect(p.validUntil).toBe(1100);
    s.graph.now=1100;const next=restore(s,group,{destinationId:'destination'});
    expect(next.dto.allowed).toBe(true);expect(next.fingerprint).not.toBe(p.fingerprint);expect(JSON.stringify(next.dto.groups)).not.toContain('"older"');
  });
  it('restores elsewhere from a deleted parent under current retained policy',()=>{
    const s=fixture(),group=deleted(s);s.folders[0].trashed_at=new Date(100);
    s.folders.find(f=>f.id==='source')!.reference_grant_id='local-ref';s.graph.grants.push(grant('local-ref','source','a','administrer',{kind:'reference',transmit:[...CAPABILITIES]}));
    expect(restore(s,group,{destinationId:'outside'}).dto.allowed).toBe(true);
  });
  it('does not use a grant suppressed by a trashed external ancestor as live move modification',()=>{
    const s=fixture();s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants.push(grant('trash-authority','outside','a','partager',{transmit:['modifier']}),
      grant('suppressed-modifier','source','b','modifier',{kind:'delegated',parent_id:'trash-authority'}));
    expect(planFolderMove(s.graph,s.folders,s.documents,'b',{kind:'folder',sourceId:'source',destinationId:'destination'}).dto.allowed).toBe(false);
  });
  it('does not borrow a sharing authority masked by trash for gains on active content',()=>{
    const s=fixture();s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants.push(grant('b-modifier','root','b','modifier'),grant('trash-authority','outside','a','partager',{transmit:['partager','consulter']}),
      grant('suppressed-share','source','b','partager',{kind:'delegated',parent_id:'trash-authority',transmit:['consulter']}),
      grant('new-reader','destination','c','consulter'));
    expect(planFolderMove(s.graph,s.folders,s.documents,'b',{kind:'folder',sourceId:'source',destinationId:'destination'}).dto.allowed).toBe(false);
  });
  it('does not expose a destination ancestor through a grant masked by an external trash folder',()=>{
    const s=fixture();s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants=s.graph.grants.filter(g=>!g.id.startsWith('b-'));
    for(const folder of ['source','destination'])for(const cap of ['consulter','modifier'])s.graph.grants.push(grant(`b-${folder}-${cap}`,folder,'b',cap));
    s.graph.grants.push(grant('trash-authority','outside','a','partager',{transmit:['consulter']}),
      grant('suppressed-ancestor-read','root','b','consulter',{kind:'delegated',parent_id:'trash-authority'}));
    const p=planFolderMove(s.graph,s.folders,s.documents,'b',{kind:'folder',sourceId:'source',destinationId:'destination'});
    expect(p.dto.destination.breadcrumbs).toEqual([{id:'destination',name:'destination'}]);
  });
  it('does not expose an active descendant whose consultation only exists in the trash projection',()=>{
    const s=fixture();s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants=s.graph.grants.filter(g=>!g.id.startsWith('b-'));
    // Independent root access is cut at leaf by placing only the selected
    // document there; the source document move still needs live source rights.
    s.graph.grants.push(grant('trash-authority','outside','a','partager',{transmit:['consulter']}),
      grant('suppressed-leaf-read','leaf','b','consulter',{kind:'delegated',parent_id:'trash-authority'}),
      grant('b-leaf-modifier','leaf','b','modifier'),grant('b-destination-read','destination','b','consulter'),
      grant('b-destination-modifier','destination','b','modifier'),grant('b-destination-deposit','destination','b','déposer'));
    expect(()=>planFolderMove(s.graph,s.folders,s.documents,'b',{kind:'document',sourceId:'document',destinationId:'destination'})).toThrow(expect.objectContaining({status:404}));
  });
  it('does not announce a fictitious active gain backed by another deleted folder',()=>{
    const s=fixture();s.folders.push(f('left','root'));s.folders.find(f=>f.id==='source')!.parent_folder_id='left';
    s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants.push(grant('trash-authority','outside','a','partager',{transmit:['consulter']}),
      grant('suppressed-reader','source','c','consulter',{kind:'delegated',parent_id:'trash-authority'}));
    s.graph.restrictions.push({id:'old-denial',folder_id:'left',user_id:'c',capability:'consulter',authority_grant_id:'root-ref',author_id:'a'});
    const move=planFolderMove(s.graph,s.folders,s.documents,'a',{kind:'folder',sourceId:'source',destinationId:'destination'});
    expect(move.dto.allowed).toBe(true);expect(move.dto.groups).toEqual([]);
    const group=deleted(s);group.original_parent_id='left';const restored=restore(s,group,{destinationId:'destination'});
    expect(restored.dto.allowed).toBe(true);expect(restored.dto.groups).toEqual([]);
  });
  it('does not announce a fictitious restore loss from an unrelated deleted authority',()=>{
    const s=fixture();s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants.push(grant('trash-authority','outside','a','partager',{transmit:['consulter']}),
      grant('suppressed-reader','source','c','consulter',{kind:'delegated',parent_id:'trash-authority'}));
    const group=deleted(s),p=restore(s,group,{destinationId:'destination'});
    expect(p.dto.allowed).toBe(true);expect(p.dto.groups).toEqual([]);
  });
  it('does not borrow consultation or deletion from another deleted group for trash access',()=>{
    const s=fixture(),group=deleted(s);s.folders.find(f=>f.id==='outside')!.trashed_at=new Date(10);
    s.graph.grants.push(grant('outside-share','outside','a','partager',{transmit:['consulter','supprimer']}));
    for(const cap of ['consulter','supprimer'])s.graph.grants.push(grant(`c-${cap}`,'source','c',cap,{kind:'delegated',parent_id:'outside-share'}));
    const policy=trashPolicyGraph(s.graph,new Set(group.folderIds));
    expect(evaluateTreeAccess(policy,'c','source').capabilities).toEqual([]);
    expect(()=>restore(s,group,{},'c')).toThrow(expect.objectContaining({status:404}));
  });
  it('retains policy dependencies inside the exact same deleted group',()=>{
    const s=fixture(),group=deleted(s);
    s.graph.grants.push(grant('c-parent-read','root','c','consulter'));
    s.graph.grants.push(grant('group-share','leaf','a','partager',{transmit:['consulter','supprimer']}));
    for(const cap of ['consulter','supprimer'])s.graph.grants.push(grant(`c-${cap}`,'source','c',cap,{kind:'delegated',parent_id:'group-share'}));
    expect(restore(s,group,{},'c').dto.allowed).toBe(true);
  });
  it('fails closed at the operation work bound',()=>{
    const s=fixture();for(let i=0;i<10001;i++)s.folders.push(f(`extra-${i}`,null));expect(()=>trash(s)).toThrow(expect.objectContaining({code:'RESOURCE_LIMIT'}));
  });
});
