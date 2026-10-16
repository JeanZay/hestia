import { describe,expect,it } from 'vitest';
import { parseSummary,parseSummaryProfile,SUMMARY_CONTRACT_SHA256,SUMMARY_INSTRUCTIONS } from '../../src/server/summary/provider';
import { OPENROUTER_CLASSIFICATION_CONTRACT_SHA256 } from '../../src/server/classification/openrouter';
import { readSummaryDeployment } from '../../src/server/summary/deployment';
import { readInboxDeployment } from '../../src/server/config';
describe('document-only summaries and isolated deployment admission',()=>{
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
