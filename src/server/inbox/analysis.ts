import { unavailable } from '../access';
import type { AuthorizedFolder, InboxClassificationContext } from '../classification/types';
import { parseClassificationResult } from '../classification/validation';
import type { InboxAnalysisDto, InboxSuggestionDto } from '../../shared/inbox-contract';

/** Construct only from explicit server Inbox fields; never inspect Capture text. */
export function typedInboxAnalysisContext(input: { subject?: string; body?: string; partial?: boolean; comment?: string }): InboxClassificationContext | undefined {
 const subject=input.subject??'',body=input.body??'',comment=input.comment??'';
 if(!subject.trim()&&!body.trim()&&!comment.trim())return undefined;
 return Object.freeze({mail:Object.freeze({subject,body,partial:input.partial===true}),comment});
}
/** Compatibility context for the existing private projection, never a summary. */
export function inboxAnalysisContext(input: { subject?: string; body?: string; partial?: boolean; comment?: string }): string {
 const context=typedInboxAnalysisContext(input);return context?JSON.stringify(context):'';
}

// The provider fields remain independently capped at 500 and 1000 Unicode points.
// Existing Inbox reason text displays both in full, separated by exactly one space.
export const INBOX_REASON_MAX_CODE_POINTS=1501;
export function projectInboxAnalysis(value: unknown, folders: readonly AuthorizedFolder[], context: string): Pick<InboxAnalysisDto,'suggestions'|'contradiction'> {
 const result=parseClassificationResult(value,folders,16384,8,true,context);
 const contradiction=result.contradiction;
 const reason=(source:string)=>{
  const text=contradiction?`${source} ${contradiction}`:source;
  if([...text].length>INBOX_REASON_MAX_CODE_POINTS)throw unavailable();
  return text;
 };
 const suggestions:InboxSuggestionDto[]=[
  ...result.existing.map(s=>({destination:{kind:'existing' as const,folderId:s.folderId},label:folders.find(f=>f.id===s.folderId)!.path.map(p=>p.name).join(' / '),reason:reason(s.reason)})),
  ...result.created.map(s=>({destination:{kind:'create' as const,parentId:s.parentId,levels:s.levels},label:s.levels.join(' / '),reason:reason(s.reason)})),
 ];
 // No new Inbox visual state: an applicable divergence needs an existing reason
 // to carry it. Refuse an incomplete ready result rather than hide the conflict.
 if(contradiction&&!suggestions.length)throw unavailable();
 return {suggestions,...(contradiction?{contradiction}:{})};
}

/** Validate a persisted projection by reconstructing its provider fields and
 * applying the same admission rules again. This proves structural composition,
 * not that the provider actually emitted these fields (which needs custody).
 * Callers pass only suggestions/contradiction, without lifecycle status. */
export function validateInboxAnalysisProjection(value: unknown, folders: readonly AuthorizedFolder[], context: string): Pick<InboxAnalysisDto,'suggestions'|'contradiction'> {
 const record=(input:unknown,keys:readonly string[]):Record<string,unknown>=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))throw unavailable();
  return input as Record<string,unknown>;
 };
 const input=record(value,['suggestions','contradiction']);
 if(!Array.isArray(input.suggestions))throw unavailable();
 const suggestions=input.suggestions;
 const existing:unknown[]=[],created:unknown[]=[];
 const contradiction=input.contradiction;
 if(contradiction!==undefined&&typeof contradiction!=='string')throw unavailable();
 for(const suggestion of suggestions){
  const row=record(suggestion,['destination','label','reason']);
  if(typeof row.reason!=='string'||typeof row.label!=='string')throw unavailable();
  const suffix=contradiction===undefined?'':` ${contradiction}`;
  if(suffix&&!row.reason.endsWith(suffix))throw unavailable();
  const source=suffix?row.reason.slice(0,-suffix.length):row.reason;
  const destination=record(row.destination,['kind','folderId','parentId','levels']);
  if(destination.kind==='existing'){
   record(destination,['kind','folderId']);existing.push({folderId:destination.folderId,reason:source});
  }else if(destination.kind==='create'){
   record(destination,['kind','parentId','levels']);created.push({parentId:destination.parentId,levels:destination.levels,reason:source});
  }else throw unavailable();
 }
 const projected=projectInboxAnalysis({existing,created,...(contradiction===undefined?{}:{contradiction})},folders,context);
 // Compare fields independently of JSON property ordering, including authorized
 // labels, normalized paths, duplicate filtering and existing/create ordering.
 if(projected.contradiction!==contradiction||projected.suggestions.length!==suggestions.length)throw unavailable();
 projected.suggestions.forEach((row,index)=>{
  const supplied=record(suggestions[index],['destination','label','reason']),destination=record(supplied.destination,['kind','folderId','parentId','levels']);
  if(row.label!==supplied.label||row.reason!==supplied.reason||row.destination.kind!==destination.kind)throw unavailable();
  if(row.destination.kind==='existing'){
   if(row.destination.folderId!==destination.folderId)throw unavailable();
  }else if(row.destination.parentId!==destination.parentId||JSON.stringify(row.destination.levels)!==JSON.stringify(destination.levels))throw unavailable();
 });
 return projected;
}
