import {describe,it,expect} from 'vitest';
import {inboxAnalysisContext,projectInboxAnalysis,validateInboxAnalysisProjection,INBOX_REASON_MAX_CODE_POINTS} from '../../src/server/inbox/analysis';
import {parseClassificationResult} from '../../src/server/classification/validation';
import {normalizeClassificationSuggestions} from '../../src/server/classification/reference-tree';

const folder={id:'11111111-1111-4111-8111-111111111111',name:'Eau',path:[{id:'11111111-1111-4111-8111-111111111111',name:'Eau'}],canCreate:true};
const other='22222222-2222-4222-8222-222222222222';
const divergence='Le document concerne l’eau, le mail parle d’assurance; choisissez la piste adaptée.';
const result={existing:[{folderId:folder.id,reason:'Le document concerne l’eau.'}],created:[{parentId:null,levels:['Assurances'],reason:'Le mail demande les assurances.'}],contradiction:divergence};
describe('private Inbox analysis context and complete existing presentation reasons',()=>{
 it.each([{subject:'Objet privé'},{body:'Mail privé'},{comment:'Commentaire humain'},{body:'Mail disponible',partial:true}])('admits genuine subject/body/comment context %j',input=>{
  const context=inboxAnalysisContext(input),projected=projectInboxAnalysis(result,[folder],context);
  expect(JSON.parse(context)).toEqual({mail:{subject:input.subject??'',body:input.body??'',partial:input.partial===true},comment:input.comment??''});
  expect(projected.contradiction).toBe(divergence);expect(projected.suggestions).toHaveLength(2);
  expect(projected.suggestions.map(s=>s.reason)).toEqual([result.existing[0].reason+' '+divergence,result.created[0].reason+' '+divergence]);
 });
 it('keeps the full human comment alongside partial mail rather than overriding either source',()=>{
  const context=inboxAnalysisContext({subject:'Assurances',body:'Texte incomplet',partial:true,comment:'Correction humaine : eau, pas assurance.'});
  expect(JSON.parse(context)).toEqual({mail:{subject:'Assurances',body:'Texte incomplet',partial:true},comment:'Correction humaine : eau, pas assurance.'});
 });
 it.each([{}, {partial:true}, {subject:' ',body:'\t',comment:' '}])('does not turn an empty JSON envelope or partial flag into context %j',input=>{
  const context=inboxAnalysisContext(input);expect(context).toBe('');const projection=projectInboxAnalysis(result,[folder],context);
  expect(projection).not.toHaveProperty('contradiction');expect(projection.suggestions.map(s=>s.reason)).toEqual(['Le document concerne l’eau.','Le mail demande les assurances.']);
  expect(parseClassificationResult(result,[folder],16384,8,true,'')).not.toHaveProperty('contradiction');
 });
 it('normalizes provider contradiction but never invents one when absent',()=>{
  const normalized=normalizeClassificationSuggestions(JSON.stringify({existingFolderSuggestions:[],newFolderPathSuggestions:[{parentId:null,levels:['Eau'],reason:'Le document est une facture.',relevance:'relevant'}],contradiction:divergence}),'existingFolderSuggestions','newFolderPathSuggestions');
  expect(projectInboxAnalysis(normalized,[],inboxAnalysisContext({body:'Assurances'}))).toMatchObject({contradiction:divergence});
  expect(projectInboxAnalysis({existing:[],created:result.created},[],'Contexte')).not.toHaveProperty('contradiction');
 });
 it('keeps all500+one-space+1000 Unicode code points in both destination types',()=>{
  const reason='😀'.repeat(500),contradiction='🧭'.repeat(1000),projection=projectInboxAnalysis({existing:[{folderId:folder.id,reason}],created:[{parentId:null,levels:['Eau'],reason}],contradiction},[folder],'Contexte');
  expect(INBOX_REASON_MAX_CODE_POINTS).toBe(1501);expect(projection.contradiction).toBe(contradiction);
  for(const row of projection.suggestions){expect([...row.reason]).toHaveLength(1501);expect(row.reason).toBe(reason+' '+contradiction);}
  expect(()=>projectInboxAnalysis({...result,created:[{...result.created[0],reason:'😀'.repeat(501)}]},[folder],'Contexte')).toThrow();
  expect(()=>projectInboxAnalysis({...result,contradiction:'🧭'.repeat(1001)},[folder],'Contexte')).toThrow();
 });
 it('filters unauthorized existing/create destinations before projection without adding a synthetic proposal',()=>{
  const value={...result,existing:[...result.existing,{folderId:other,reason:'Inaccessible.'}],created:[...result.created,{parentId:other,levels:['Autre'],reason:'Inaccessible.'}]};
  expect(projectInboxAnalysis(value,[folder],'Contexte').suggestions).toHaveLength(2);
  expect(()=>projectInboxAnalysis({existing:[{folderId:other,reason:'Inaccessible.'}],created:[{parentId:other,levels:['Autre'],reason:'Inaccessible.'}],contradiction:divergence},[],'Contexte')).toThrow();
  expect(()=>projectInboxAnalysis({existing:[],created:[],contradiction:divergence},[],'Contexte')).toThrow();
  expect(projectInboxAnalysis({existing:[],created:[]},[],'Contexte')).toEqual({suggestions:[]});
 });
 it.each(['<script>','\u202eTexte','Ligne\nseconde',42])('still rejects hostile contradiction without applicable context %j',contradiction=>{
  expect(()=>projectInboxAnalysis({...result,contradiction},[folder],'')).toThrow();
 });
 it('revalidates a complete Unicode1501 persisted projection using the unchanged provider bounds',()=>{
  const raw={existing:[{folderId:folder.id,reason:'😀'.repeat(500)}],created:[{parentId:null,levels:['Eau'],reason:'😀'.repeat(500)}],contradiction:'🧭'.repeat(1000)};
  const projection=projectInboxAnalysis(raw,[folder],'Contexte');
  expect(validateInboxAnalysisProjection(JSON.parse(JSON.stringify(projection)),[folder],'Contexte')).toEqual(projection);
  expect(validateInboxAnalysisProjection({suggestions:[]},[],'')).toEqual({suggestions:[]});
  expect(validateInboxAnalysisProjection(projectInboxAnalysis(result,[folder],''),[folder],'')).not.toHaveProperty('contradiction');
  for(const altered of [
   {...projection,contradiction:'🧭'.repeat(1001)},
   {...projection,suggestions:projection.suggestions.map(s=>({...s,reason:'😀'+s.reason}))},
   {...projection,suggestions:projection.suggestions.map(s=>({...s,reason:s.reason+'x'}))},
   {...projection,suggestions:projection.suggestions.map(s=>({...s,label:'Label inventé'}))},
   {...projection,suggestions:projection.suggestions.map(s=>({...s,extra:'interdit'}))},
   {...projection,suggestions:[{...projection.suggestions[0],destination:{kind:'existing',folderId:other}}]},
   {...projection,contradiction:'<script>',suggestions:[]},
   {...projection,suggestions:[]},
   {...projection,extra:'interdit'},
  ])expect(()=>validateInboxAnalysisProjection(altered,[folder],'Contexte')).toThrow();
  expect(()=>validateInboxAnalysisProjection(projection,[folder],'')).toThrow();
 });
});
