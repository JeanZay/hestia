import { describe,it,expect } from 'vitest';
import { evaluateFolderAccess,type Grant } from '../../src/server/permissions/service';
import { mayRemove } from '../../src/server/membership/service';
const now=Date.parse('2026-10-04T10:00:00Z');
function grant(id:string,user:string,capability:string,kind='direct',parent:string|null=null,transmit:string[]=[]):Grant{return {id,folder_id:'f',user_id:user,capability,kind,parent_id:parent,transmit,lineage:[],origin:'synthetic',author_id:'a',subject_epoch:0,revoked_at:null,expires_at:null,batch_id:null,created_at:new Date(now-1000)};}
const people=['a','b','c','d'].map(user_id=>({user_id,active:true,departure_epoch:0,name:user_id}));
describe('shared access evaluator for membership consequences',()=>{
 it('revokes only true dependency descendants while preserving direct grants and their descendants',()=>{
  const rows=[grant('r','a','administrer','reference',null,['consulter','partager']),grant('b','b','partager','direct',null,['consulter']),grant('c','c','consulter','delegated','b'),grant('d','d','consulter','delegated','r')];
  const s=evaluateFolderAccess('c','f',{created_by:'a'},rows,people,now,new Set(['r']));
  expect(s.capabilities).toEqual(['consulter']);expect(s.valid('d')).toBe(false);expect(s.valid('b')).toBe(true);
  const removed=evaluateFolderAccess('c','f',{created_by:'a'},rows,people.map(m=>({...m,active:m.user_id!=='b'})),now);
  expect(removed.capabilities).toEqual([]);
 });
 it('rejects a parent from another folder without mutating database provenance',()=>{
  const parent=grant('p','b','partager','direct',null,['consulter']);parent.folder_id='other';
  const child=grant('c','c','consulter','delegated','p');
  const state=evaluateFolderAccess('c','f',{created_by:'a'},[parent,child],people,now);
  expect(state.valid('c')).toBe(false);expect(state.capabilities).toEqual([]);
 });
 it('uses exact absolute expiry and epoch and excludes cycles',()=>{
  const r=grant('r','b','partager','direct',null,['consulter']);r.expires_at=new Date(now);
  const rows=[r,grant('c','c','consulter','delegated','r'),grant('loop','a','partager','delegated','loop',['consulter'])];
  const s=evaluateFolderAccess('c','f',{created_by:'a'},rows,people,now);expect(s.capabilities).toEqual([]);expect(s.valid('loop')).toBe(false);
  r.expires_at=null;r.subject_epoch=1;expect(evaluateFolderAccess('b','f',{created_by:'a'},rows,people,now).capabilities).toEqual([]);
 });
});

describe('removal role boundary',()=>{
 it('protects the owner and self while reserving admin removal to owner',()=>{
  const owner={user_id:'o',role:'owner',active:true},admin={user_id:'a',role:'admin',active:true},peer={user_id:'p',role:'admin',active:true},member={user_id:'m',role:'member',active:true};
  expect(mayRemove(owner,admin)).toBe(true);expect(mayRemove(admin,member)).toBe(true);expect(mayRemove(admin,peer)).toBe(false);
  expect(mayRemove(owner,owner)).toBe(false);expect(mayRemove(admin,owner)).toBe(false);expect(mayRemove(member,admin)).toBe(false);expect(mayRemove(admin,admin)).toBe(false);
 });
});
