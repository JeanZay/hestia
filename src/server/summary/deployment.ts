import type { ServerConfig } from '../config';
import { createOpenRouterSummaryProvider,parseSummaryProfile } from './provider';
export function readSummaryDeployment(environment:ServerConfig['environment'],env:Readonly<Record<string,string|undefined>>=process.env,now=()=>new Date()){
 const disabled={summaryProviders:[]};
 if(!['dev','production'].includes(environment)||env.HESTIA_SUMMARY_REMOTE!==`openrouter-summary-${environment}`)return disabled;
 const source=env.HESTIA_OPENROUTER_SUMMARY_PROFILE;if(!source||Buffer.byteLength(source)>16384)return disabled;
 try{const p=parseSummaryProfile(JSON.parse(source),now());return p?{summaryProviders:[createOpenRouterSummaryProvider([p],fetch,now)]}:disabled;}catch{return disabled;}
}
