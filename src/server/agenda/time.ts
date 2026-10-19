// Pure and browser safe: Intl and shared types only. Never import server access/config.
import type {AgendaCardFields,AgendaFold,AgendaReminderInput,AgendaTiming} from '../../shared/agenda-contract';
const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export class AgendaTimeError extends Error{constructor(public field:string,public code:'invalid'|'nonexistent-time'|'ambiguous-time',message:string){super(message);}}
export function validAgendaDate(value:string){const n=Date.parse(`${value}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;}
export const validAgendaTime=(value:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function parts(t:number){return Object.fromEntries(formatter.formatToParts(t).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));}
export function agendaLocalParts(t:number|Date){const p=parts(Number(t));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
export function agendaAddDays(date:string,days:number){if(!validAgendaDate(date)||!Number.isSafeInteger(days))throw new AgendaTimeError('startDate','invalid','Date invalide.');const n=new Date(`${date}T12:00:00Z`);n.setUTCDate(n.getUTCDate()+days);if(!Number.isFinite(n.getTime())||n.getUTCFullYear()<1||n.getUTCFullYear()>9999)throw new AgendaTimeError('reminders','invalid','Le rappel dépasse les dates prises en charge.');return n.toISOString().slice(0,10);}
export function agendaLocalCandidates(date:string,time:string):number[]{
 if(!validAgendaDate(date)||!validAgendaTime(time))return [];
 const naive=Date.parse(`${date}T${time}:00Z`),offsets=new Set<number>();
 for(const step of [-36,-12,0,12,36]){const t=naive+step*3600000,p=parts(t);offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)-t);}
 return [...new Set([...offsets].map(o=>naive-o).filter(t=>{const p=agendaLocalParts(t);return p.date===date&&p.time===time;}))].sort((a,b)=>a-b);
}
export function resolveParisLocal(date:string,time:string,fold:AgendaFold|null=null,field='startTime'):number{
 if(!validAgendaDate(date)||!validAgendaTime(time))throw new AgendaTimeError(field,'invalid','Date ou heure invalide.');
 const xs=agendaLocalCandidates(date,time);if(!xs.length)throw new AgendaTimeError(field,'nonexistent-time','Cette heure n’existe pas dans le fuseau du foyer. Choisissez une autre heure.');
 if(xs.length>1&&!fold)throw new AgendaTimeError(field,'ambiguous-time',field==='startTime'?'Cette heure se présente deux fois : choisissez le premier ou le second passage.':'Cette heure se présente deux fois. Choisissez un autre horaire.');
 return fold==='second'?xs[xs.length-1]:xs[0];
}
type Dates=Pick<AgendaCardFields,'startDate'|'startTime'|'startFold'|'endDate'|'endTime'>;
export function agendaCutoff(fields:Dates):number|null{if(!fields.startDate)return null;return fields.startTime?resolveParisLocal(fields.startDate,fields.startTime,fields.startFold):resolveParisLocal(agendaAddDays(fields.startDate,1),'00:00',null,'startDate');}
export function agendaReminderDue(fields:Dates,r:AgendaReminderInput):number{
 if(!fields.startDate)throw new AgendaTimeError('reminders','invalid','Un rappel nécessite une date de début.');
 if(r.unit==='hours'){if(!fields.startTime)throw new AgendaTimeError('reminders','invalid','Un rappel en heures nécessite une heure de début.');return resolveParisLocal(fields.startDate,fields.startTime,fields.startFold)-r.value*3600000;}
 const time=fields.startTime??r.sendTime;if(!time)throw new AgendaTimeError('reminders','invalid','Choisissez l’heure d’envoi du rappel.');
 return resolveParisLocal(agendaAddDays(fields.startDate,-r.value),time,null,'reminders');
}
export function computeAgendaTiming(fields:Dates&{reminders:AgendaReminderInput[]},now:number|Date=Date.now()):AgendaTiming{
 if(!fields.startDate){if(fields.startTime||fields.endDate||fields.endTime||fields.startFold||fields.reminders.length)throw new AgendaTimeError('startDate','invalid','Choisissez une date de début ou retirez les dates et les rappels.');return {startAt:null,cutoffAt:null,reminderSchedule:[]};}
 if(!validAgendaDate(fields.startDate))throw new AgendaTimeError('startDate','invalid','Date de début invalide.');
 if(fields.endDate&&!validAgendaDate(fields.endDate))throw new AgendaTimeError('endDate','invalid','Date de fin invalide.');
 if(fields.startFold&&!fields.startTime)throw new AgendaTimeError('startFold','invalid','Le choix du passage nécessite une heure de début.');
 const startAt=fields.startTime?resolveParisLocal(fields.startDate,fields.startTime,fields.startFold):null;
 const endDate=fields.endDate??fields.startDate;
 if(endDate<fields.startDate)throw new AgendaTimeError('endDate','invalid','La fin ne peut pas précéder le début.');
 if(fields.endTime){const endAt=resolveParisLocal(endDate,fields.endTime,null,'endTime');if(startAt!==null&&endAt<startAt)throw new AgendaTimeError('endTime','invalid','La fin ne peut pas précéder le début.');}
 const cutoffAt=agendaCutoff(fields);
 return {startAt,cutoffAt,reminderSchedule:fields.reminders.map(r=>{const sendAt=agendaReminderDue(fields,r);if(cutoffAt!==null&&sendAt>=cutoffAt)throw new AgendaTimeError('reminders','invalid','Le rappel doit pouvoir être envoyé avant le début. Choisissez un décalage plus grand.');return {id:r.id,sendAt,state:sendAt<=Number(now)?'past':'scheduled'};})};
}
