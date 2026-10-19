import type { AgendaCard, AgendaCardFields, AgendaFold, AgendaMutationInput, AgendaMutationResult, AgendaReceipt, AgendaReminderInput } from '../../shared/agenda-contract';
import { agendaLocalCandidates, agendaReminderDue, agendaLocalParts, agendaAddDays } from '../../server/agenda/time';

export class AgendaError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) { super(message); }
}
/** A session-scoped transport: stale responses cannot enter a later session. */
export class AgendaTransport {
  private controller = new AbortController();
  constructor(private lost: () => void = () => {}, private fetcher: typeof fetch = fetch, private expectedActor: string | null = null) {}
  dispose() { this.controller.abort(); }
  get signal() { return this.controller.signal; }
  get actorHeaders():Record<string,string>{return this.expectedActor?{'X-Hestia-Expected-Actor':encodeURIComponent(this.expectedActor)}:{};}
  invalidateSession(){this.lost();this.dispose();}
  async request<T>(path: string, method = 'GET', body?: unknown, interactive = true): Promise<T> {
    if (this.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await this.fetcher.call(globalThis,'/api/hestia' + path, {method, credentials:'same-origin', cache:'no-store', signal:AbortSignal.any([this.signal,AbortSignal.timeout(30000)]), headers:{...(body === undefined ? {} : {'Content-Type':'application/json'}),...(interactive ? {'X-Hestia-Activity':'interactive'} : {}),...this.actorHeaders}, body:body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (this.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if(this.expectedActor&&path.startsWith('/agenda')){
      let actor:string|null=null;try{const header=response.headers.get('X-Hestia-Actor');actor=header===null?null:decodeURIComponent(header);}catch{}
      if((actor!==null&&actor!==this.expectedActor)||(actor===null&&(response.ok||data.current))){this.invalidateSession();throw new AgendaError(401,'ACTOR_CHANGED','La session a changé. Reconnectez-vous pour continuer.');}
    }
    if (!response.ok) { if (response.status === 401) this.invalidateSession(); throw new AgendaError(response.status,data?.error?.code || 'UNAVAILABLE',data?.error?.message || 'Impossible de joindre Hestia. Réessayez.',data); }
    return data as T;
  }
  async takeCurrent(id: string, expectedRevision: number): Promise<AgendaCard> {
    const {card} = await this.request<{card:AgendaCard}>('/agenda/'+encodeURIComponent(id));
    if (!card.canManage || card.archived) throw new AgendaError(403,'UNAVAILABLE','La fiche ne peut plus être modifiée.');
    if (card.revision !== expectedRevision) throw new AgendaError(409,'AGENDA_CONFLICT','Nouvelle modification enregistrée pendant votre relecture.',{current:card});
    return card;
  }
  async verify(requestId: string): Promise<AgendaReceipt> { return this.request('/agenda/operations/'+encodeURIComponent(requestId)); }
  async save(id: string | null, payload: AgendaMutationInput): Promise<AgendaMutationResult> { return this.request('/agenda'+(id?'/'+encodeURIComponent(id):''),id?'PATCH':'POST',payload); }
}
export const emptyAgendaFields = (day: string | null = null): AgendaCardFields => ({title:'',description:'',category:'',startDate:day,startTime:null,endDate:null,endTime:null,startFold:null,shareMode:'all',readerIds:[],links:[],documentIds:[],retainedDocumentLinkIds:[],reminders:[]});
export const agendaDateLabel=(date:string,short=false)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',...(short?{day:'numeric' as const,month:'short' as const}:{weekday:'long' as const,day:'numeric' as const,month:'long' as const,year:'numeric' as const})}).format(new Date(date+'T12:00:00Z')).replace(/\b1\b/,'1er');
export const agendaTimeLabel=(time:string)=>Number(time.slice(0,2))+' h'+(time.slice(3)==='00'?'':' '+time.slice(3));
export function cardFields(card: AgendaCard): AgendaCardFields {
  return {...emptyAgendaFields(),title:card.title,description:card.description,category:card.category,startDate:card.startDate,startTime:card.startTime,endDate:card.endDate,endTime:card.endTime,startFold:card.startFold,shareMode:card.shareMode,readerIds:card.readerIds??[],links:card.links.map(link=>({...link})),documentIds:card.documents.flatMap(d=>d.state==='available'?[d.documentId]:[]),retainedDocumentLinkIds:card.documents.filter(d=>d.state==='unavailable').map(d=>d.linkId),reminders:card.reminders.map(({id,unit,value,sendTime})=>({id,unit,value,sendTime}))};
}
export function agendaWhen(value: Pick<AgendaCardFields,'startDate'|'startTime'|'endDate'|'endTime'|'startFold'>): string {
  if (!value.startDate) return 'Sans date';
  const start=agendaDateLabel(value.startDate)+(value.startTime?' à '+agendaTimeLabel(value.startTime):'')+(value.startFold?' · '+(value.startFold==='first'?'Premier passage':'Second passage'):'');
  if(value.endDate&&value.endDate!==value.startDate){const days=1+(Date.parse(value.endDate+'T00:00:00Z')-Date.parse(value.startDate+'T00:00:00Z'))/86400000;return 'Du '+start+' au '+agendaDateLabel(value.endDate)+(value.endTime?' à '+agendaTimeLabel(value.endTime):'')+' ('+days+' jours)';}
  return start.charAt(0).toUpperCase()+start.slice(1)+(value.endTime?' – '+agendaTimeLabel(value.endTime):'');
}
export function agendaRowSlot(card:AgendaCard,day:string|null){
  if(!card.startDate)return {slot:'Sans date',sub:''};
  const length=1+(Date.parse((card.endDate??card.startDate)+'T00:00:00Z')-Date.parse(card.startDate+'T00:00:00Z'))/86400000;
  if(day){const currentDay=1+(Date.parse(day+'T00:00:00Z')-Date.parse(card.startDate+'T00:00:00Z'))/86400000;return {slot:currentDay>1?'En cours':card.startTime?agendaTimeLabel(card.startTime):'Journée',sub:length>1?'jour '+currentDay+' sur '+length+(day===card.endDate&&card.endTime?', jusqu’à '+agendaTimeLabel(card.endTime):''):card.endTime?'jusqu’à '+agendaTimeLabel(card.endTime):''};}
  return {slot:agendaDateLabel(card.startDate,true),sub:card.startTime?agendaTimeLabel(card.startTime):length>1?length+' jours':'journée'};
}
export const parisInstants=agendaLocalCandidates;
export function reminderPreview(fields: AgendaCardFields, reminder: AgendaReminderInput, now=Date.now()): {state:'scheduled'|'past'|'clarify';label:string} {
  if(!fields.startDate)return {state:'clarify',label:'Ajoutez une date de début.'};
  let instant:number;
  try{instant=agendaReminderDue(fields,reminder);}catch(error){return {state:'clarify',label:error instanceof Error?error.message:'Choisissez un horaire explicite.'};}
  const label=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'}).format(instant);
  return {state:instant<=now?'past':'scheduled',label:(instant<=now?'Horaire déjà passé — aucun envoi immédiat. ':'Envoi prévu le ')+label+' (Paris)'};
}
export const shiftAgendaDay=agendaAddDays;
export const agendaToday=()=>agendaLocalParts(Date.now()).date;
export function comparisonRows(server:AgendaCard, local:AgendaCardFields, memberName:(id:string)=>string, documentName:(id:string)=>string,completedUploadIds:string[]=[]) {
  const incoming=cardFields(server);
  const texts=(v:AgendaCardFields)=>({Titre:v.title,Description:v.description||'Sans description',Catégorie:v.category||'Sans catégorie',Quand:agendaWhen(v),Partage:v.shareMode==='all'?'Tout le foyer':v.readerIds.map(memberName).join(', ')||'Vous uniquement',Liens:v.links.map(l=>(l.label?l.label+' — ':'')+l.url).join('\n')||'Aucun lien',Documents:[...v.documentIds.map(documentName),...v.retainedDocumentLinkIds.map(()=>'Document indisponible')].join('\n')||'Aucun document',Rappels:v.reminders.map(r=>`${r.value} ${r.unit==='days'?'jour(s)':'heure(s)'} avant${r.sendTime?' à '+r.sendTime:''} — ${reminderPreview(v,r).label}`).join('\n')||'Aucun rappel'});
  const a=texts(incoming),b=texts(local);
  if(completedUploadIds.length)b.Documents=[b.Documents==='Aucun document'?'':b.Documents,...completedUploadIds.map(()=>'Document indisponible')].filter(Boolean).join('\n');
  const values=(v:AgendaCardFields,uploads:string[])=>({Titre:v.title,Description:v.description,Catégorie:v.category,Quand:[v.startDate,v.startTime,v.endDate,v.endTime,v.startFold],Partage:[v.shareMode,[...v.readerIds].sort()],Liens:v.links,Documents:[[...v.documentIds].sort(),[...v.retainedDocumentLinkIds].sort(),[...uploads].sort()],Rappels:v.reminders});
  const av=values(incoming,[]),bv=values(local,completedUploadIds);
  return Object.keys(a).map(key=>({key,server:a[key as keyof typeof a],local:b[key as keyof typeof b],same:JSON.stringify(av[key as keyof typeof av])===JSON.stringify(bv[key as keyof typeof bv])}));
}
export type AgendaUpload = {requestId:string; file:File; folderId:string; operationId?:string};
export async function uploadAgendaDocument(transport:AgendaTransport, upload:AgendaUpload, progress:(n:number)=>void, keepDuplicate=false):Promise<{documentId:string|null;completedUploadId:string}> {
  if(upload.file.size<1||upload.file.size>20*1024*1024)throw new Error('PDF ou photo : 20 Mio maximum par fichier.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await upload.file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
  if(transport.signal.aborted)throw new DOMException('Aborted','AbortError');
  const {operation}=await transport.request<{operation:{id:string;chunkSize:number;status:string}}>('/uploads','POST',{folderId:upload.folderId,idempotencyKey:upload.requestId,fileName:upload.file.name,title:upload.file.name.replace(/\.[^.]+$/,'')||upload.file.name,size:upload.file.size,mediaType:upload.file.type||({'pdf':'application/pdf','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp','heic':'image/heic','heif':'image/heif'}[upload.file.name.split('.').pop()!.toLowerCase()]??'application/octet-stream'),sha256:hash,source:'import'});
  upload.operationId=operation.id;
  if(operation.status==='uploading'){
    const size=Math.min(operation.chunkSize,2*1024*1024);if(!Number.isSafeInteger(size)||size<=0)throw new Error('Transfert indisponible.');
    for(let offset=0,index=0;offset<upload.file.size;offset+=size,index++){
      const response=await fetch(`/api/hestia/uploads/${operation.id}/chunks/${index}`,{method:'PUT',credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([transport.signal,AbortSignal.timeout(30000)]),headers:{'Content-Type':'application/octet-stream',...transport.actorHeaders},body:upload.file.slice(offset,offset+size)});
      if(!response.ok){const data=await response.json().catch(()=>({}));if(response.status===401)transport.invalidateSession();throw new AgendaError(response.status,data.error?.code??'UPLOAD_FAILED',data.error?.message??'Transfert interrompu. Réessayez.');} progress(Math.min(95,Math.round((offset+size)/upload.file.size*95)));
    }
  }
  const {document}=await transport.request<{document:{id:string}|null}>(`/uploads/${operation.id}/complete`,'POST',{keepDuplicate});
  progress(100);return {documentId:document?.id??null,completedUploadId:operation.id};
}
export type { AgendaFold };
