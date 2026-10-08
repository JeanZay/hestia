// Composition experiment, not a production authorization adapter or API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, evaluate, managementFrame } from './rights-model.mjs';
import { createState, preview, execute, snapshot, RETENTION_MS } from './lifecycle-model.mjs';

function fixture() {
  const folders=[['A',null],['B','A'],['C','B'],['Z',null]].map(([id,parentId])=>({id,parentId,name:id,type:'folder',rootNamespace:'alice',
    governance:{mode:'local',anchorFolderId:id,referenceId:`ref-${id}`}}));
  const grants=folders.flatMap(f=>CAPS.map(cap=>({id:cap==='administrer'?`ref-${f.id}`:`${f.id}-${cap}`,folderId:f.id,userId:'alice',cap,
    kind:cap==='administrer'?'reference':'direct',parentId:null,transmit:['partager','administrer'].includes(cap)?CAPS:[],lineage:[],
    subjectEpoch:0,expiresAt:null,revoked:false,authorId:'alice',...(cap==='administrer'?{origin:'initial'}:{})})));
  grants.push({id:'bob-B',folderId:'B',userId:'bob',cap:'consulter',kind:'direct',parentId:null,transmit:[],lineage:[],subjectEpoch:0,expiresAt:null,revoked:false});
  return createState(folders,[],{grants,restrictions:[],members:[{id:'alice',active:true,epoch:0},{id:'bob',active:true,epoch:0}]});
}
function policy(state) {return {...state.policy,folders:Object.values(state.nodes).filter(n=>n.type==='folder').map(n=>({...n,createdBy:n.rootNamespace}))};}
function access(state,id,actor,now){const node=state.nodes[id];return evaluate(policy(state),node.type==='document'?node.parentId:id,actor,now);}
function permitted(state,id,actor,caps,now){return caps.every(c=>access(state,id,actor,now).capabilities.includes(c));}
function changes(ctx){
  const effects=[];
  for(const id of ctx.affected)for(const person of ctx.before.policy.members.filter(m=>m.active)){
    const b=access(ctx.before,id,person.id,ctx.now).capabilities,a=access(ctx.after,id,person.id,ctx.now).capabilities;
    const plus=a.filter(c=>!b.includes(c)),minus=b.filter(c=>!a.includes(c));
    if(plus.length||minus.length)effects.push({id,person:person.id,plus,minus});
  }
  return effects;
}
// The same neutral denial precedes all public detailed projections, including noMgmt.
function authorize(ctx){
  const {before,after,actor,request,now,affected}=ctx;
  const lifecycleMembers=request.action==='restore'?before.groups[request.groupId].members:affected;
  if(request.action==='trash'||request.action==='restore')if(!lifecycleMembers.every(id=>permitted(before,id,actor,['consulter','supprimer'],now)))return false;
  if(request.action==='move'&&!permitted(before,request.id,actor,['consulter','modifier'],now))return false;
  if(request.action==='trash')return true;
  if(request.action!=='move'&&request.action!=='restore')return false;
  const root=request.action==='restore'?before.groups[request.groupId].rootId:request.id;
  const dest=after.nodes[root].parentId;
  if(dest&&!permitted(before,dest,actor,['consulter','modifier'],now))return false;
  if(!affected.every(id=>permitted(before,id,actor,['consulter'],now)))return false;
  const effect=changes(ctx);
  if(effect.length){
    if(dest&&!access(before,dest,actor,now).capabilities.some(c=>['partager','administrer'].includes(c)))return false;
    for(const e of effect){
      if(!access(before,e.id,actor,now).capabilities.some(c=>['partager','administrer'].includes(c)))return false;
      if(e.plus.length&&!access(after,e.id,actor,now).authorityFor(e.plus))return false;
      if(e.minus.length&&!access(before,e.id,actor,now).authorityFor(e.minus,true))return false;
    }
  }
  return affected.filter(id=>after.nodes[id].type==='folder').every(id=>managementFrame(policy(after),id,now));
}
const authority={authorize,stamp:({before})=>before.policy};
function perform(state,request,now,key){return execute(state,'alice',request,now,authority,preview(state,'alice',request,now,authority),key).state;}

test('COMPOSE: real policy evaluator denies protected descendant before any move projection',()=>{
  const state=fixture();state.policy.restrictions.push({id:'r',folderId:'C',userId:'alice',caps:['partager','administrer'],lifted:false});
  state.policy.grants.push({id:'bob-Z',folderId:'Z',userId:'bob',cap:'exporter',kind:'direct',parentId:null,transmit:[],lineage:[],subjectEpoch:0,revoked:false});
  const before=snapshot(state);
  assert.throws(()=>preview(state,'alice',{action:'move',id:'B',parentId:'Z'},1,authority),/^Error: UNAVAILABLE$/);
  assert.equal(snapshot(state),before);
});
test('COMPOSE: noMgmt root refusal remains neutral even when access effects are not knowable',()=>{
  const state=fixture();state.nodes.B.governance={mode:'inherited',anchorFolderId:'A',referenceId:'ref-A'};
  state.policy.grants.push({id:'bob-A',folderId:'A',userId:'bob',cap:'exporter',kind:'direct',parentId:null,transmit:[],lineage:[],subjectEpoch:0,revoked:false});
  state.policy.restrictions.push({id:'r',folderId:'C',userId:'alice',caps:['partager','administrer'],lifted:false});
  const before=snapshot(state);
  assert.throws(()=>preview(state,'alice',{action:'move',id:'B',parentId:null},1,authority),/^Error: UNAVAILABLE$/);
  assert.equal(snapshot(state),before);
});

test('COMPOSE: restoring parent elsewhere checks access effects on previously trashed descendants',()=>{
  let state=perform(fixture(),{action:'trash',id:'C'},1,'trash-old-C');
  const oldGroup=state.nodes.C.groupId,deadline=state.groups[oldGroup].expiresAt;
  state=perform(state,{action:'trash',id:'B'},2,'trash-parent-B');
  const groupId=state.nodes.B.groupId;
  state=perform(state,{action:'trash',id:'A'},3,'trash-original-parent-A');
  state.policy.grants.push({id:'bob-Z-export',folderId:'Z',userId:'bob',cap:'exporter',kind:'direct',parentId:null,transmit:[],lineage:[],subjectEpoch:0,revoked:false});
  state.policy.restrictions.push({id:'private-old-C',folderId:'C',userId:'alice',caps:['partager','administrer'],lifted:false});
  const request={action:'restore',groupId,parentId:'Z'},before=snapshot(state);
  assert.throws(()=>preview(state,'alice',request,4,authority),/^Error: UNAVAILABLE$/);
  assert.equal(snapshot(state),before);
  state.policy.restrictions[0].lifted=true;
  const restored=perform(state,request,5,'restore-parent-B');
  assert.equal(restored.nodes.B.parentId,'Z');assert.equal(restored.nodes.B.status,'active');
  assert.equal(restored.nodes.C.status,'trashed');assert.equal(restored.nodes.C.groupId,oldGroup);
  assert.equal(restored.groups[oldGroup].expiresAt,deadline);
  assert.ok(access(restored,'C','bob',5).capabilities.includes('exporter'));
});
test('COMPOSE: valid move preserves policies, independent references and original group deadlines',()=>{
  const state=fixture();const trashed=perform(state,{action:'trash',id:'C'},1,'trash-C');const gid=trashed.nodes.C.groupId;
  const moved=perform(trashed,{action:'move',id:'B',parentId:'Z'},2,'move-B');
  assert.equal(moved.nodes.B.parentId,'Z');assert.deepEqual(moved.policy,trashed.policy);
  assert.equal(moved.groups[gid].expiresAt,1+RETENTION_MS);assert.equal(moved.nodes.C.status,'trashed');
});
test('COMPOSE: current revoked rights prevent restoration, independent grant can still authorize',()=>{
  const state=perform(fixture(),{action:'trash',id:'B'},1,'trash-B');const gid=state.nodes.B.groupId;
  state.policy.restrictions.push({id:'r',folderId:'C',userId:'alice',caps:['supprimer'],lifted:false});
  const before=snapshot(state);assert.throws(()=>preview(state,'alice',{action:'restore',groupId:gid},2,authority),/UNAVAILABLE/);assert.equal(snapshot(state),before);
  state.policy.restrictions[0].lifted=true;
  state.policy.grants.find(g=>g.id==='B-supprimer').revoked=true; // source A independently retains authority
  const restored=perform(state,{action:'restore',groupId:gid},3,'restore-B');assert.equal(restored.nodes.B.status,'active');
  assert.equal(restored.policy.grants.find(g=>g.id==='B-supprimer').revoked,true);
});
test('COMPOSE: expired grants invalidate confirmation despite unchanged structural revision',()=>{
  const state=fixture();for(const g of state.policy.grants.filter(g=>g.userId==='alice'))g.expiresAt=10;
  const request={action:'move',id:'B',parentId:'Z'},confirmation=preview(state,'alice',request,9,authority);
  assert.throws(()=>execute(state,'alice',request,10,authority,confirmation,'expired-move'),/UNAVAILABLE/);
  assert.equal(state.nodes.B.parentId,'A');
});
