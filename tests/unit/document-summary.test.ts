import { describe,expect,it } from 'vitest';
import { parseSummary,parseSummaryProfile,SUMMARY_CONTRACT_SHA256,SUMMARY_INSTRUCTIONS } from '../../src/server/summary/provider';
import { OPENROUTER_CLASSIFICATION_CONTRACT_SHA256 } from '../../src/server/classification/openrouter';
import { readSummaryDeployment } from '../../src/server/summary/deployment';
import { readInboxDeployment } from '../../src/server/config';
import { contentSummary } from '../../src/server/documents/revisions';
describe('document-only summaries and isolated deployment admission',()=>{
 it('distinguishes a truly absent summary from scheduled, running and terminal work',()=>{
  expect(contentSummary(null,null)).toEqual({status:'none'});
  expect(contentSummary('pending',null)).toEqual({status:'pending'});
  expect(contentSummary('running',null)).toEqual({status:'running'});
  expect(contentSummary('ready','Phrase synthétique entière.')).toEqual({status:'ready',text:'Phrase synthétique entière.'});
  expect(contentSummary('unknown',null)).toEqual({status:'unknown'});
  expect(contentSummary('unavailable',null)).toEqual({status:'unavailable'});
 });
 it('publishes durable causes only in unavailable projections and hides forbidden or arbitrary details',()=>{
  for(const cause of ['ai-off','budget','unreadable','format'])expect(contentSummary('unavailable',null,cause)).toEqual({status:'unavailable',cause});
  expect(contentSummary('pending',null,'budget',true)).toEqual({status:'unavailable',cause:'budget'});
  expect(contentSummary('pending',null,null,true)).toEqual({status:'unavailable'});
  expect(contentSummary('pending',null,'PRIVATE_FILENAME')).toEqual({status:'pending'});
  expect(contentSummary('unavailable',null,'PRIVATE_MAIL_BODY')).toEqual({status:'unavailable'});
  expect(contentSummary('unavailable',null,'budget',false,false)).toEqual({status:'unavailable'});
 });
 it('keeps exact two-hundred-codepoint text and fails closed for malformed ready projections',()=>{
  const text='😀'.repeat(200);expect(contentSummary('ready',text)).toEqual({status:'ready',text});
  for(const invalid of ['',null,'😀'.repeat(201)])expect(contentSummary('ready',invalid)).toEqual({status:'unavailable'});
 });
 it('accepts one bounded Unicode sentence without slicing code points',()=>{
  expect(parseSummary({summary:'Facture Atelier Démo datée du 15 octobre 2026.'})).toContain('Atelier Démo');
  expect([...parseSummary({summary:'😀'.repeat(200)})!]).toHaveLength(200);
  expect(()=>parseSummary({summary:'😀'.repeat(201)})).toThrow();
  expect(parseSummary({summary:null})).toBeNull();
 });
 it.each(['Première phrase. Deuxième phrase.','Première phrase. seconde phrase.','Une phrase ! Encore une.','<script>','Une\nligne.','\u202eTexte',' '])('rejects invalid model text %j',summary=>{expect(()=>parseSummary({summary})).toThrow();});
 it('rejects context channels and arbitrary provider fields',()=>{
  expect(()=>parseSummary({summary:'Facture.',folderId:'hidden'})).toThrow();
  expect(()=>parseSummary('not json')).toThrow();
  expect(SUMMARY_INSTRUCTIONS).toContain('uniquement les informations lisibles');
  expect(SUMMARY_CONTRACT_SHA256).not.toBe(OPENROUTER_CLASSIFICATION_CONTRACT_SHA256);
 });
 it('fails closed without separate qualified evidence',()=>{
  expect(parseSummaryProfile({classificationContractSha256:OPENROUTER_CLASSIFICATION_CONTRACT_SHA256})).toBeNull();
  expect(readSummaryDeployment('dev',{HESTIA_SUMMARY_REMOTE:'openrouter-summary-dev',HESTIA_OPENROUTER_SUMMARY_PROFILE:'{}'})).toEqual({summaryProviders:[]});
  expect(readSummaryDeployment('local',{})).toEqual({summaryProviders:[]});
 });
 it('refuses a shared or crossed technical mailbox and incomplete relay identity',()=>{
  expect(readInboxDeployment('dev',{})).toEqual({});
  expect(()=>readInboxDeployment('dev',{HESTIA_INBOX_ENABLED:'true',HESTIA_INBOX_ADDRESS:'hestia.macaire.prod@gmail.com'})).toThrow('INBOX_CONFIGURATION_INVALID');
  expect(()=>readInboxDeployment('production',{HESTIA_INBOX_ENABLED:'true',HESTIA_INBOX_ADDRESS:'hestia.macaire.prod@gmail.com',HESTIA_INBOX_RELAY_ACTOR:'hestia-gmail-production',HESTIA_INBOX_RELAY_SECRET:'short',HESTIA_INBOX_RELAY_EPOCH:'1'})).toThrow();
 });
});
