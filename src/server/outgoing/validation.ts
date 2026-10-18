import { domainToASCII } from 'node:url';
import { bodyBytes, invalid, isUuid } from '../access';
import { OUTGOING_LIMITS as L } from '../../shared/outgoing-contract';
export type Composition = { to: string[]; subject: string; message: string };
export async function outgoingJson(request: Request, keys: string[]) {
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw invalid();
  try { const value: unknown=JSON.parse((await bodyBytes(request,L.requestBytes)).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw invalid();
    return value as Record<string,unknown>;
  } catch {throw invalid();}
}
export function outgoingRevision(value: unknown) { if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>=2147483647)throw invalid(); return Number(value); }
export function outgoingId(value: unknown) { if(!isUuid(value))throw invalid();return value.toLowerCase(); }
export function composition(input: Record<string,unknown>): Composition {
  if(!Array.isArray(input.to)||input.to.length>L.recipients||typeof input.subject!=='string'||typeof input.message!=='string')throw invalid();
  const to=input.to.map(value=>{if(typeof value!=='string'||Buffer.byteLength(value)>L.addressBytes||/[\x00-\x20\x7f]/.test(value))throw invalid();return value;});
  const subject=input.subject.trim(),message=input.message.replace(/\r\n/g,'\n');
  if([...subject].length>L.subject||/[\x00-\x1f\x7f]/.test(subject)||[...message].length>L.message||/[\x00-\x08\x0b-\x1f\x7f]/.test(message))throw invalid();
  return {to,subject,message};
}
export function normalizeAddress(value: string) {
  const at=value.lastIndexOf('@'),local=value.slice(0,at),domain=domainToASCII(value.slice(at+1)).toLowerCase();
  if(at<1||!domain.includes('.')||!domain||/[^a-z0-9.-]/.test(domain)||domain.split('.').some(x=>!x||x.startsWith('-')||x.endsWith('-'))
    ||!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..'))throw invalid();
  const result=local+'@'+domain;if(Buffer.byteLength(result)>L.addressBytes)throw invalid();return result;
}
export function validateEnvelope(value: Composition) {
  if(!value.to.length||!value.subject)throw invalid();const to=value.to.map(normalizeAddress);
  if(new Set(to).size!==to.length)throw invalid();return {...value,to};
}
