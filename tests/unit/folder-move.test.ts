import {describe,it,expect} from 'vitest';
import {planFolderMove,type MoveFolder,type MoveDocument,type MoveInput} from '../../src/server/documents/moves';
import {CAPABILITIES} from '../../src/server/permissions/capabilities';
import type {AccessGraph} from '../../src/server/permissions/tree';
import {evaluateTreeAccess} from '../../src/server/permissions/tree';
import type {Grant} from '../../src/server/permissions/service';

const g=(id:string,user_id:string,capability:string,folder_id:string,extra:Partial<Grant>={}):Grant=>({id,user_id,capability,folder_id,kind:'direct',parent_id:null,transmit:[],lineage:[],origin:'initial',author_id:'a',subject_epoch:0,revoked_at:null,expires_at:null,batch_id:null,created_at:new Date(0),...extra});
const f=(id:string,parent_folder_id:string|null,reference_grant_id:string|null=null):MoveFolder=>({id,name:id,name_key:id,version:1,created_by:'a',parent_folder_id,reference_grant_id});
function fixture(){
  const folders=[f('root',null,'root-ref'),f('left','root'),f('right','root'),f('child','left'),f('leaf','child'),f('other',null,'other-ref')];
  const graph:AccessGraph={now:1000,folders,grants:[],members:['a','b','c'].map(user_id=>({user_id,name:user_id,active:true,departure_epoch:0})),restrictions:[],cuts:[]};
  for(const folder of ['root','other'])for(const cap of CAPABILITIES)graph.grants.push(g(`${folder}-${cap}`,'a',cap,folder,{...(cap==='administrer'?{id:`${folder}-ref`,kind:'reference',transmit:[...CAPABILITIES]}:{})}));
  graph.grants.push(g('b-read','b','consulter','root'),g('b-modify','b','modifier','root'));
  const documents:MoveDocument[]=[{id:'doc',folder_id:'leaf',title:'Document',version:1,trashed_at:null,purged_at:null}];
  return {graph,folders,documents};
}
function run(s:ReturnType<typeof fixture>,input:MoveInput={kind:'folder',sourceId:'child',destinationId:'right'},actor='a'){
  return planFolderMove(s.graph,s.folders,s.documents,actor,input);
}
function localFrame(s:ReturnType<typeof fixture>){
  s.folders.find(f=>f.id==='child')!.reference_grant_id='child-ref';
  s.graph.grants.push(g('child-ref','a','administrer','child',{kind:'reference',transmit:[...CAPABILITIES]}));
}
const external:MoveInput={kind:'folder',sourceId:'child',destinationId:'other'};

describe('server move policy planner',()=>{
  it('permits unchanged rights with only Consulter + Modifier and leaves its inputs intact',()=>{
    const s=fixture(),original=JSON.stringify(s),plan=run(s,undefined,'b');
    expect(plan.dto.allowed).toBe(true);expect(plan.dto.groups).toEqual([]);expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(s)).toBe(original);
  });
  it('binds versions and contents but not mere elapsed time',()=>{
    const s=fixture(),first=run(s).fingerprint;s.graph.now++;expect(run(s).fingerprint).toBe(first);
    s.documents[0].version++;expect(run(s).fingerprint).not.toBe(first);
    const second=run(s).fingerprint;s.folders[0].version++;expect(run(s).fingerprint).not.toBe(second);
  });
  it('refuses moving into itself, descendants, or its current parent',()=>{
    const s=fixture();for(const destinationId of ['child','leaf','left'])expect(run(s,{kind:'folder',sourceId:'child',destinationId}).dto).toMatchObject({allowed:false,groups:[],refusal:{code:'INVALID_DESTINATION'}});
  });
  it('requires source modification and refuses unavailable source without metadata',()=>{
    const s=fixture();s.graph.grants.find(g=>g.id==='b-modify')!.revoked_at=new Date(1);expect(run(s,undefined,'b').dto.allowed).toBe(false);
    s.graph.grants.find(g=>g.id==='b-read')!.revoked_at=new Date(1);expect(()=>run(s,undefined,'b')).toThrow(expect.objectContaining({status:404}));
  });
  it('keeps an inaccessible destination name opaque',()=>{
    const s=fixture();const p=run(s,external,'b');expect(p.dto).toMatchObject({allowed:false,destination:{name:'Dossier indisponible'},groups:[]});
  });
  it('requires an inherited management anchor to remain even when destination has an administrator',()=>{
    const s=fixture();expect(run(s,external).dto).toMatchObject({allowed:false,groups:[],refusal:{code:'NO_MANAGEMENT'}});
  });
  it('preserves a preexisting local and nested frame while authorizing losses',()=>{
    const s=fixture();localFrame(s);s.folders.find(f=>f.id==='leaf')!.reference_grant_id='leaf-ref';s.graph.grants.push(g('leaf-ref','a','administrer','leaf',{kind:'reference',transmit:['consulter']}));
    const p=run(s,external);expect(p.dto.allowed).toBe(true);expect(p.dto.groups.some(g=>g.title==='Perdent leur accès'&&g.items.some(i=>i.name==='b'))).toBe(true);
  });
  it('does not reveal protected effects on a no-management root refusal (T1)',()=>{
    const s=fixture();s.graph.restrictions.push({id:'hidden',folder_id:'leaf',user_id:'a',capability:'administrer',authority_grant_id:'root-ref',author_id:'a'});
    s.graph.grants.push(g('private-member-export','c','exporter','root'));
    const p=run(s,{kind:'folder',sourceId:'child',destinationId:null});expect(p.dto).toMatchObject({allowed:false,groups:[],refusal:{code:'RIGHTS_UNAVAILABLE'}});expect(JSON.stringify(p.dto)).not.toContain('private-member');
  });
  it('allows legitimate self loss without using the grant revocation helper',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('b-other-read','b','consulter','other'),g('b-other-modify','b','modifier','other'),g('b-admin','b','administrer','child',{transmit:[...CAPABILITIES]}));
    s.graph.grants.push(g('b-export','b','exporter','left'));
    expect(run(s,external,'b').dto.allowed).toBe(true);
  });
  it('allows legitimate self gain from placement, keeping subject restrictions',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('c-read','c','consulter','child'),g('c-modify','c','modifier','child'),g('c-share','c','partager','child',{transmit:[...CAPABILITIES]}),g('c-other-read','c','consulter','other'),g('c-other-modify','c','modifier','other'),g('c-other-export','c','exporter','other'));
    // Keep other people's rights unchanged so c need not administer losses.
    s.graph.grants.push(g('b-child-read','b','consulter','child'),g('b-child-modify','b','modifier','child'));
    expect(run(s,external,'c').dto.allowed).toBe(true);
    s.graph.restrictions.push({id:'c-export-denied',folder_id:'child',user_id:'c',capability:'exporter',authority_grant_id:'child-ref',author_id:'a'});
    const p=run(s,external,'c');expect(p.dto.allowed).toBe(true);expect(JSON.stringify(p.dto.groups)).not.toContain('exporter');
  });
  it('never unions two partial transmission envelopes to authorize one gain',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('c-source-read','c','consulter','child'),g('c-source-modify','c','modifier','child'),g('c-source-share','c','partager','child',{transmit:['consulter']}));
    for(const cap of ['consulter','modifier'])s.graph.grants.push(g(`c-dest-${cap}`,'c',cap,'other'));
    s.graph.grants.push(g('partial-1','c','partager','other',{transmit:['consulter','déposer']}),g('partial-2','c','partager','other',{transmit:['consulter','exporter']}));
    for(const cap of ['consulter','déposer','exporter'])s.graph.grants.push(g(`b-new-${cap}`,'b',cap,'other'));
    expect(run(s,external,'c').dto).toMatchObject({allowed:false,groups:[]});
  });
  it('includes recoverable trashed documents, requires their visibility, and excludes exact expiry',()=>{
    const s=fixture();s.documents[0].trashed_at=new Date(0);s.graph.now=168*60*60*1000-1;
    expect(run(s,undefined,'b').dto.allowed).toBe(false);s.graph.now++;
    expect(run(s,undefined,'b').dto.allowed).toBe(true);
  });
  it('rechecks expiration without a row change and invalidates a preview when effective profiles change',()=>{
    const s=fixture();s.graph.grants.push(g('temporary','c','consulter','child',{expires_at:new Date(1001)}));const first=run(s).fingerprint;
    s.graph.now=1001;expect(run(s).fingerprint).not.toBe(first);
  });
  it('requires deposit for documents and rejects root/trash/current-folder destinations',()=>{
    const s=fixture(),input:MoveInput={kind:'document',sourceId:'doc',destinationId:'right'};
    expect(run(s,input,'b').dto.allowed).toBe(false);s.graph.grants.push(g('deposit','b','déposer','root'));expect(run(s,input,'b').dto.allowed).toBe(true);
    expect(run(s,{...input,destinationId:null}).dto.allowed).toBe(false);expect(run(s,{...input,destinationId:'leaf'}).dto.allowed).toBe(false);
    s.documents[0].trashed_at=new Date(1);expect(()=>run(s,input)).toThrow(expect.objectContaining({status:404}));
  });
  it('never introduces document title collisions',()=>{
    const s=fixture();s.documents.push({...s.documents[0],id:'another-doc',folder_id:'right'});
    expect(run(s,{kind:'document',sourceId:'doc',destinationId:'right'}).dto.allowed).toBe(true);
  });
  it('normalizes sibling collisions without exposing sibling metadata, then permits explicit rename',()=>{
    const s=fixture();s.folders.push({...f('secret','right'),name:' CHILD ',name_key:'child'});
    const p=run(s);expect(p.dto).toMatchObject({allowed:false,collision:true,groups:[],refusal:{code:'NAME_UNAVAILABLE'}});expect(JSON.stringify(p.dto)).not.toContain('secret');
    expect(run(s,{kind:'folder',sourceId:'child',destinationId:'right',name:'Different'}).dto.allowed).toBe(true);
  });
  it('checks root collisions in the original creator namespace, not the actor namespace',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('b-child-admin','b','administrer','child',{transmit:[...CAPABILITIES]}),g('b-child-read','b','consulter','child'),g('b-child-modify','b','modifier','child'));
    s.folders.push({...f('collision',null),name:'child',name_key:'child',created_by:'a'});
    expect(run(s,{kind:'folder',sourceId:'child',destinationId:null},'b').dto).toMatchObject({allowed:false,collision:true});
    s.folders.find(f=>f.id==='collision')!.created_by='c';expect(run(s,{kind:'folder',sourceId:'child',destinationId:null},'b').dto.allowed).toBe(true);
  });
  it('refuses all effects when a descendant is protected and does not enumerate names',()=>{
    const s=fixture();s.graph.restrictions.push({id:'private',folder_id:'leaf',user_id:'a',capability:'consulter',authority_grant_id:'root-ref',author_id:'a'});
    const p=run(s);expect(p.dto).toMatchObject({allowed:false,groups:[]});expect(JSON.stringify(p.dto)).not.toContain('Document');
  });
  it('preserves independent grants and fingerprints exact dependency rows',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('c-dependent','c','consulter','child',{kind:'delegated',parent_id:'root-ref'}),g('c-independent','c','consulter','child'));
    const first=run(s,external);expect(first.dto.allowed).toBe(true);s.graph.grants.find(g=>g.id==='c-dependent')!.revoked_at=new Date(1);
    const second=run(s,external);expect(second.dto.allowed).toBe(true);expect(second.fingerprint).not.toBe(first.fingerprint);expect(second.dto.groups).toEqual(first.dto.groups);
  });
  it('describes duration changes as duration changes rather than a newly granted capability',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('c-old','c','consulter','left',{expires_at:new Date(5000)}),g('c-new','c','consulter','other'));
    const p=run(s,external);expect(p.dto.allowed).toBe(true);expect(JSON.stringify(p.dto.groups)).toContain('Durée étendue : consulter');
  });
  it('enforces a whole-operation resource bound',()=>{
    const s=fixture();for(let i=0;i<10001;i++)s.folders.push(f(`overflow-${i}`,null));expect(()=>run(s)).toThrow(expect.objectContaining({code:'RESOURCE_LIMIT'}));
  });
  it('M04 keeps gains and losses in separate descendants when the moved root is unchanged',()=>{
    const s=fixture();s.folders.push(f('second-leaf','child'));
    for(const cap of ['consulter','exporter']){
      s.graph.grants.push(g(`c-leaf-${cap}`,'c',cap,'leaf'));
      s.graph.restrictions.push({id:`old-${cap}`,folder_id:'left',user_id:'c',capability:cap,authority_grant_id:'root-ref',author_id:'a'});
    }
    s.graph.grants.push(g('b-delete-leaf','b','supprimer','second-leaf'));
    s.graph.restrictions.push({id:'new-delete',folder_id:'right',user_id:'b',capability:'supprimer',authority_grant_id:'root-ref',author_id:'a'});
    const p=run(s);expect(p.dto.allowed).toBe(true);expect(p.dto.groups.map(g=>g.title)).toEqual(['Changements dans une partie du contenu seulement']);
    expect(p.dto.groups[0].items).toEqual(expect.arrayContaining([expect.objectContaining({name:'b',details:[{text:'Perd : supprimer',folders:['second-leaf']}]}),expect.objectContaining({name:'c'})]));
    expect(JSON.stringify(p.dto.groups)).toContain('Gagne : exporter');
  });
  it('M06 refuses a descendant loss that the actor cannot administer there',()=>{
    const s=fixture();s.graph.grants.push(g('b-delete','b','supprimer','left'));
    s.graph.restrictions.push({id:'no-leaf-admin',folder_id:'leaf',user_id:'a',capability:'administrer',authority_grant_id:'root-ref',author_id:'a'});
    expect(run(s).dto).toMatchObject({allowed:false,groups:[],refusal:{code:'RIGHTS_UNAVAILABLE'}});
  });
  it('M09 keeps an immutable two-link delegation dependent on the original authority',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('b-share','b','partager','child',{kind:'delegated',parent_id:'root-ref',transmit:['consulter'],expires_at:new Date(5000)}),g('c-delegated','c','consulter','leaf',{kind:'delegated',parent_id:'b-share',expires_at:new Date(4000)}));
    expect(run(s,external).dto.allowed).toBe(true);s.folders.find(f=>f.id==='child')!.parent_folder_id='other';
    expect(evaluateTreeAccess(s.graph,'c','leaf').capabilities).toContain('consulter');
    s.graph.grants.find(g=>g.id==='root-ref')!.revoked_at=new Date(1);expect(evaluateTreeAccess(s.graph,'c','leaf').capabilities).not.toContain('consulter');
  });
  it('M10 checks intermediary restrictions at issuance and preserves only an independent surviving path',()=>{
    const s=fixture();localFrame(s);s.graph.grants.push(g('b-share','b','partager','child',{kind:'delegated',parent_id:'root-ref',transmit:['consulter']}),g('c-chain','c','consulter','leaf',{kind:'delegated',parent_id:'b-share'}),g('c-independent','c','consulter','leaf'));
    s.graph.restrictions.push({id:'no-source-read',folder_id:'child',user_id:'b',capability:'consulter',authority_grant_id:'child-ref',author_id:'a'});
    expect(run(s,external).dto.allowed).toBe(true);s.folders.find(f=>f.id==='child')!.parent_folder_id='other';
    const state=evaluateTreeAccess(s.graph,'c','leaf');expect(state.held.map(g=>g.id)).toEqual(['c-independent']);
  });
  it('M11 treats leaving and entering ancestor restrictions as real rights effects',()=>{
    const s=fixture();s.graph.grants.push(g('c-local-read','c','consulter','child'),g('c-local-export','c','exporter','child'));
    s.graph.restrictions.push({id:'old-read',folder_id:'left',user_id:'c',capability:'consulter',authority_grant_id:'root-ref',author_id:'a'},
      {id:'new-export',folder_id:'right',user_id:'c',capability:'exporter',authority_grant_id:'root-ref',author_id:'a'});
    const p=run(s);expect(p.dto.allowed).toBe(true);expect(JSON.stringify(p.dto.groups)).toContain('Gagne : consulter');expect(JSON.stringify(p.dto.groups)).toContain('Perd : exporter');
  });
  it('M14 preserves nested cuts when the original reference is replaced after moving',()=>{
    const s=fixture();localFrame(s);s.folders.find(f=>f.id==='leaf')!.reference_grant_id='leaf-ref';
    s.graph.grants.push(g('leaf-ref','c','administrer','leaf',{kind:'reference',transmit:[...CAPABILITIES],anchor_reference_id:'root-ref'}));
    s.graph.cuts=[{folder_id:'leaf',source_reference_id:'root-ref',new_reference_id:'leaf-ref'}];
    expect(run(s,external).dto.allowed).toBe(true);s.folders.find(f=>f.id==='child')!.parent_folder_id='other';
    s.graph.grants.find(g=>g.id==='root-ref')!.revoked_at=new Date(1);
    s.graph.grants.push(g('root-successor','b','administrer','root',{kind:'reference',transmit:[...CAPABILITIES],replaces_reference_id:'root-ref'}));
    expect(evaluateTreeAccess(s.graph,'c','leaf').held.map(g=>g.id)).toContain('leaf-ref');expect(evaluateTreeAccess(s.graph,'b','leaf').held.map(g=>g.id)).not.toContain('root-successor');
  });
  it('M19 changes the fingerprint when equal-count effects switch descendants',()=>{
    const s=fixture();s.folders.push(f('second-leaf','child'));
    s.graph.grants.push(g('c-new','c','consulter','right'));
    s.graph.restrictions.push({id:'exception',folder_id:'leaf',user_id:'c',capability:'consulter',authority_grant_id:'root-ref',author_id:'a'});
    const before=run(s);s.graph.restrictions[0].folder_id='second-leaf';const after=run(s);
    expect(before.dto.allowed&&after.dto.allowed).toBe(true);expect(before.dto.groups.length).toBe(after.dto.groups.length);expect(before.fingerprint).not.toBe(after.fingerprint);
  });
  it('M29 measures a deep placement plan and refuses member overflow before evaluation',()=>{
    const s=fixture();for(let i=0;i<120;i++)s.folders.push(f(`level-${i}`,i?`level-${i-1}`:'leaf'));
    const started=performance.now();expect(run(s).dto.allowed).toBe(true);expect(performance.now()-started).toBeLessThan(2000);
    for(let i=0;i<1000;i++)s.graph.members.push({user_id:`member-${i}`,name:'Synthetic',active:true,departure_epoch:0});
    expect(()=>run(s)).toThrow(expect.objectContaining({code:'RESOURCE_LIMIT'}));
  });
  it('M32 detects collateral external effects without revealing their names, but permits unchanged crossing chains',()=>{
    const s=fixture();s.graph.grants.push(g('c-share','c','partager','child',{transmit:['consulter']}),g('b-outside','b','consulter','other',{kind:'delegated',parent_id:'c-share'}));
    expect(run(s).dto.allowed).toBe(true);
    s.graph.restrictions.push({id:'old-c-read',folder_id:'left',user_id:'c',capability:'consulter',authority_grant_id:'root-ref',author_id:'a'});
    const p=run(s);expect(p.dto).toMatchObject({allowed:false,groups:[]});expect(JSON.stringify(p.dto)).not.toContain('other');
  });
  it('cannot authorize a move using the local administration that this very move would reactivate',()=>{
    const s=fixture();localFrame(s);
    s.graph.grants.push(g('limited-share','b','partager','child',{transmit:['consulter']}),g('restricted-admin','b','administrer','child',{transmit:[...CAPABILITIES]}));
    s.graph.restrictions.push({id:'old-admin-denial',folder_id:'left',user_id:'b',capability:'administrer',authority_grant_id:'root-ref',author_id:'a'});
    expect(evaluateTreeAccess(s.graph,'b','child').capabilities).not.toContain('administrer');
    expect(run(s,undefined,'b').dto).toMatchObject({allowed:false,groups:[],refusal:{code:'RIGHTS_UNAVAILABLE'}});
    s.graph.grants.push(g('independent-dest-admin','b','administrer','right',{transmit:[...CAPABILITIES]}));
    expect(run(s,undefined,'b').dto.allowed).toBe(true);
  });
  it('cannot authorize an envelope extension with the previously restricted part of that envelope',()=>{
    const s=fixture();s.graph.grants.push(g('restricted-share','b','partager','child',{transmit:['consulter','partager','exporter']}));
    s.graph.restrictions.push({id:'old-export-denial',folder_id:'left',user_id:'b',capability:'exporter',authority_grant_id:'root-ref',author_id:'a'});
    expect(evaluateTreeAccess(s.graph,'b','child').canShare).toBe(true);
    expect(run(s,undefined,'b').dto).toMatchObject({allowed:false,groups:[]});
    s.graph.grants.push(g('independent-dest-share','b','partager','right',{transmit:['consulter','partager','exporter']}));
    expect(run(s,undefined,'b').dto.allowed).toBe(true);
  });
  it('retains both affected documents when duplicate titles have the same display path',()=>{
    const s=fixture();s.documents.push({...s.documents[0],id:'duplicate-document'});s.graph.grants.push(g('c-new-read','c','consulter','right'));
    const p=run(s),details=p.dto.groups.flatMap(g=>g.items.flatMap(i=>i.details??[]));
    expect(p.dto.allowed).toBe(true);expect(details.flatMap(d=>d.folders).filter(path=>path==='leaf / Document')).toHaveLength(2);
  });
});
