import type { OutgoingFailureCode } from '../../shared/outgoing-contract';
import { OUTGOING_LIMITS } from '../../shared/outgoing-contract';
import type { ServerConfig } from '../config';
export type OutgoingPayload = { from: string; to: string[]; reply_to: string; subject: string; text: string;
  attachments: { filename: string; content: string; content_type: string }[] };
export type OutgoingTransportResult = { status: 'accepted'; providerId: string } | { status: 'rejected'; code: Exclude<OutgoingFailureCode,null> } | { status: 'uncertain' };
export type OutgoingTransport = { kind: 'simulated' | 'resend'; send: (input: { id: string; payload: string; signal: AbortSignal }) => Promise<OutgoingTransportResult> };
/** Local mode cannot use this adapter; hosted activation requires the qualified deployment profile. */
export function createOutgoingResendTransport(config: ServerConfig, credential: string, request: typeof fetch = fetch): OutgoingTransport | undefined {
  if(config.environment==='local')return undefined;
  if(!credential||/\s/.test(credential))throw new Error('OUTGOING_CONFIGURATION_INVALID');
  return {kind:'resend',async send({id,payload,signal}) {
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return {status:'rejected',code:'unavailable'};
    if(Buffer.byteLength(payload)>OUTGOING_LIMITS.encodedBytes)return {status:'rejected',code:'size'};
    try {
      const result=await request('https://api.resend.com/emails',{method:'POST',redirect:'error',signal,
        headers:{authorization:`Bearer ${credential}`,'content-type':'application/json','Idempotency-Key':`hestia/outgoing/${id}`},body:payload});
      if(!result.ok){await result.body?.cancel();return result.status>=400&&result.status<500&&![408,409,429].includes(result.status)
        ?{status:'rejected',code:result.status===422?'address':'unavailable'}:{status:'uncertain'};}
      const reader=result.body?.getReader();if(!reader)return {status:'uncertain'};const chunks:Uint8Array[]=[];let count=0;
      try {for(;;){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>2048){await reader.cancel();return {status:'uncertain'};}chunks.push(part.value);}}finally{reader.releaseLock();}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {id?:unknown};
      return typeof data.id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.id)?{status:'accepted',providerId:data.id}:{status:'uncertain'};
    }catch{return {status:'uncertain'};}
  }};
}
