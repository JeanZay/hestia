import type { ServerConfig } from '../config';
import type { OutgoingDependencies } from './service';
import { normalizeAddress } from './validation';
import { createOutgoingResendTransport } from './transport';
/** Enabling is a separate deployment action after actual quota/resource qualification. */
export function readOutgoingDeployment(config:ServerConfig,env:Readonly<Record<string,string|undefined>>=process.env):Pick<OutgoingDependencies,'deployment'> {
  if(config.environment==='local'||env.HESTIA_OUTGOING_ENABLED!=='true')return {};
  try {
    const raw=JSON.parse(env.HESTIA_OUTGOING_QUALIFIED_PROFILE??'') as Record<string,unknown>;
    const caps=config.environment==='dev'?{actorHour:3,actorDay:5,globalHour:5,globalDay:5,recipientHour:10,recipientDay:10}
      :{actorHour:5,actorDay:10,globalHour:5,globalDay:5,recipientHour:20,recipientDay:20};
    if(Object.keys(raw).sort().join(',')!==[...Object.keys(caps),'qualificationId'].sort().join(',')||typeof raw.qualificationId!=='string'||!/^outgoing-[a-zA-Z0-9_-]{8,100}$/.test(raw.qualificationId))throw new Error();
    for(const [name,cap]of Object.entries(caps))if(!Number.isSafeInteger(raw[name])||Number(raw[name])<1||Number(raw[name])>cap)throw new Error();
    const sender=normalizeAddress(env.HESTIA_MAIL_FROM??''),transport=createOutgoingResendTransport(config,env.RESEND_API_KEY??'');
    if(env.HESTIA_MAIL_PROVIDER!=='resend'||!transport)throw new Error();
    return {deployment:{enabled:true,sender,transport,qualificationId:raw.qualificationId,actorHour:Number(raw.actorHour),actorDay:Number(raw.actorDay),globalHour:Number(raw.globalHour),globalDay:Number(raw.globalDay),recipientHour:Number(raw.recipientHour),recipientDay:Number(raw.recipientDay)}};
  }catch{ return {}; } // Missing/unqualified configuration stays visibly unavailable before I/O.
}
