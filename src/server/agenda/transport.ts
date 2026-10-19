import type { ServerConfig } from '../config';
import { MailDeliveryError } from '../identity/mail-error';

export type AgendaMail = {
  id:string; email:string; title:string; date:string; cardId:string;
  bindPayload:(payload:string)=>Promise<boolean>;
};
export type AgendaMailTransport = (mail:AgendaMail)=>Promise<{providerId:string}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&/^[^@\s<>,;:"\\\x00-\x1f\x7f]+@[^@\s<>,;:"\\\x00-\x1f\x7f]+\.[^@\s<>,;:"\\\x00-\x1f\x7f]+$/.test(value);
async function boundedBody(result:Response):Promise<unknown>{
  const reader=result.body?.getReader();if(!reader)throw new MailDeliveryError(true);
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){await reader.cancel();throw new MailDeliveryError(true);}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Local mode never sends, even when credentials have been inherited. */
export function createAgendaTransport(config:ServerConfig,env:Readonly<Record<string,string|undefined>>=process.env,request:typeof fetch=fetch):AgendaMailTransport|undefined{
  if(config.environment==='local'||env.HESTIA_AGENDA_MAIL_ENABLED!=='true')return undefined;
  const from=env.HESTIA_MAIL_FROM,key=env.RESEND_API_KEY;
  const origin=new URL(config.origin);
  if(env.HESTIA_MAIL_PROVIDER!=='resend'||!address(from)||!key||/\s/.test(key)||origin.protocol!=='https:'||origin.origin!==config.origin)throw new Error('AGENDA_MAIL_CONFIGURATION_INVALID');
  return async message=>{
    if(!uuid.test(message.id)||!uuid.test(message.cardId)||!address(message.email)||!message.title.trim()||[...message.title].length>200||/[\x00-\x1f\x7f]/.test(message.title)||!/^\d{4}-\d{2}-\d{2}(?: à \d{2}:\d{2})?$/.test(message.date))throw new MailDeliveryError(false);
    const url=new URL('/',origin);url.searchParams.set('agenda',message.cardId);
    const payload=JSON.stringify({from,to:[message.email],subject:`Hestia — rappel : ${message.title}`,text:`${message.title}\nDébut : ${message.date} (Europe/Paris)\n\nConsultez la fiche dans votre espace Hestia : ${url.href}\nLa connexion et vos droits actuels sont nécessaires.`});
    try{
      if(!await message.bindPayload(payload))throw new MailDeliveryError(false);
      const result=await request('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:`Bearer ${key}`,'content-type':'application/json','Idempotency-Key':`hestia/agenda/${message.id}`},body:payload});
      if(!result.ok){
        let permanentConflict=false;
        if(result.status===409){try{const parsed=await boundedBody(result) as {name?:unknown}|null;permanentConflict=parsed?.name==='invalid_idempotent_request';}catch{/* The durable worker bounds unknown conflicts. */}}
        else await result.body?.cancel();
        const seconds=Number(result.headers.get('retry-after'));
        throw new MailDeliveryError(!permanentConflict&&([408,409,429].includes(result.status)||result.status>=500),Number.isFinite(seconds)&&seconds>0?Math.min(seconds,3600):undefined);
      }
      const parsed=await boundedBody(result) as {id?:unknown}|null;
      if(!parsed||typeof parsed.id!=='string'||!uuid.test(parsed.id))throw new MailDeliveryError(true);
      return{providerId:parsed.id};
    }catch(error){if(error instanceof MailDeliveryError)throw error;throw new MailDeliveryError(true);}
  };
}
