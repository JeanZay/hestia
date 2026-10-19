import {randomUUID,createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {createApplication} from '../../src/server/application';
import {readServerConfig} from '../../src/server/config';
import {migrateDatabase} from '../../src/server/db/migrate';
import {provisionSyntheticMember} from '../../src/server/db/synthetic';
import type {AgendaCard,AgendaMutationInput} from '../../src/shared/agenda-contract';
import {dispatchAgendaMail} from '../../src/server/agenda/worker';
import type {AgendaMail,AgendaMailTransport} from '../../src/server/agenda/transport';
import {MailDeliveryError} from '../../src/server/identity/mail-error';
import {createObjectStore} from '../../src/server/storage';
import sharp from 'sharp';
describe('Agenda V1 on owned synthetic PostgreSQL',()=>{
 const config=readServerConfig();
 if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic agenda bench required');
 const pool=new Pool({connectionString:config.databaseUrl,max:8});
 const store=createObjectStore();
 let now=new Date(),app=createApplication(pool,config,{store,now:()=>now});
 const password='Synthetic agenda phrase only!',suffix=randomUUID();
 const emails=[`agenda-owner-${suffix}@example.invalid`,`agenda-reader-${suffix}@example.invalid`,`agenda-admin-${suffix}@example.invalid`];
 let actor:string,reader:string,admin:string,cookie:string,readerCookie:string,adminCookie:string;
 const req=(body?:unknown,selected=cookie,method=body===undefined?'GET':'POST',query='')=>new Request(config.origin+'/api/hestia/agenda'+query,{method,headers:{origin:config.origin,cookie:selected,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const fields=(extra:Partial<AgendaMutationInput>={}):AgendaMutationInput=>({requestId:randomUUID(),revision:0,title:'Agenda synthétique',description:'Description de test',category:'Synthétique',startDate:null,startTime:null,endDate:null,endTime:null,startFold:null,shareMode:'all',readerIds:[],links:[],documentIds:[],retainedDocumentLinkIds:[],reminders:[],...extra});
 const patch=(card:AgendaCard,extra:Partial<AgendaMutationInput>={}):AgendaMutationInput=>fields({...card,readerIds:card.shareMode==='selected'?card.readerIds??[]:[],documentIds:card.documents.flatMap(d=>d.state==='available'?[d.documentId]:[]),retainedDocumentLinkIds:card.documents.flatMap(d=>d.state==='unavailable'?[d.linkId]:[]),reminders:card.reminders.map(({id,unit,value,sendTime})=>({id,unit,value,sendTime})),revision:card.revision,...extra});
 // Explicitly pick fields: DTO metadata is never echoed into strict request validation.
 const saveBody=(card:AgendaCard,extra:Partial<AgendaMutationInput>={})=>{const p=patch(card,extra);return {requestId:p.requestId,revision:p.revision,title:p.title,description:p.description,category:p.category,startDate:p.startDate,startTime:p.startTime,endDate:p.endDate,endTime:p.endTime,startFold:p.startFold,shareMode:p.shareMode,readerIds:p.readerIds,links:p.links,documentIds:p.documentIds,retainedDocumentLinkIds:p.retainedDocumentLinkIds,reminders:p.reminders};};
 async function login(email:string){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email,password})}));expect(r.status).toBe(200);return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
 async function create(extra:Partial<AgendaMutationInput>={}){const body=fields(extra),r=await app.handleAgenda(req(body));expect(r.status).toBe(201);return {card:(await r.json()).card as AgendaCard,body};}
 async function update(card:AgendaCard,extra:Partial<AgendaMutationInput>={}){const body=saveBody(card,extra),r=await app.handleAgendaCard(req(body,cookie,'PATCH'),card.id);expect(r.status).toBe(200);return (await r.json()).card as AgendaCard;}
 beforeAll(async()=>{expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);await migrateDatabase(pool,config);actor=await provisionSyntheticMember(pool,{email:emails[0],name:'Camille Synthétique',password});reader=await provisionSyntheticMember(pool,{email:emails[1],name:'Louis Synthétique',password});admin=await provisionSyntheticMember(pool,{email:emails[2],name:'Admin Synthétique',password,role:'admin'});});
 beforeEach(async()=>{for(const table of ['hestia_agenda_operation','hestia_agenda_delivery','hestia_agenda_reminder','hestia_agenda_document_link','hestia_agenda_access','hestia_agenda_card'])await pool.query(`DELETE FROM ${table}`);await pool.query('UPDATE hestia_member SET active=true,recovering=false WHERE user_id=ANY($1::text[])',[ [actor,reader,admin] ]);now=new Date();app=createApplication(pool,config,{store,now:()=>now});cookie=await login(emails[0]);readerCookie=await login(emails[1]);adminCookie=await login(emails[2]);});
 afterAll(async()=>pool.end());
 it('persists one undated idea, creates daily inclusive views and shares CAS changes across both',async()=>{
  let {card}=await create();const list=await (await app.handleAgenda(req())).json();expect(list.cards.map((c:AgendaCard)=>c.id)).toContain(card.id);const day=await (await app.handleAgenda(req(undefined,cookie,'GET','?view=day&day=2027-04-05'))).json();expect(day.cards).toHaveLength(0);
  card=await update(card,{startDate:'2027-04-05',endDate:'2027-04-12',endTime:'17:30'});for(const date of ['2027-04-05','2027-04-12'])expect((await (await app.handleAgenda(req(undefined,cookie,'GET',`?view=day&day=${date}`))).json()).cards[0].id).toBe(card.id);expect((await (await app.handleAgenda(req(undefined,cookie,'GET','?view=day&day=2027-04-13'))).json()).cards).toHaveLength(0);expect((await pool.query('SELECT count(*) FROM hestia_agenda_card')).rows[0].count).toBe('1');
 });
 it('rejects an old tab actor before any create, receipt, lifecycle, patch or upload business effect',async()=>{
  const {card}=await create({shareMode:'selected'}),mismatch=(body?:unknown,method=body===undefined?'GET':'POST')=>{const r=req(body,cookie,method);r.headers.set('X-Hestia-Expected-Actor',encodeURIComponent(reader));return r;};
  const before=(await pool.query('SELECT count(*) FROM hestia_agenda_operation')).rows[0].count;
  expect((await app.handleAgenda(mismatch(fields()))).status).toBe(401);
  expect((await app.handleAgendaCard(mismatch(saveBody(card),'PATCH'),card.id)).status).toBe(401);
  expect((await app.handleAgendaArchive(mismatch({requestId:randomUUID(),revision:card.revision}),card.id)).status).toBe(401);
  expect((await app.handleAgendaReopen(mismatch({requestId:randomUUID(),revision:card.revision}),card.id)).status).toBe(401);
  expect((await app.handleAgendaOperation(mismatch(),randomUUID())).status).toBe(401);
  const folderResponse=await app.handleFolders(req({name:'Actor guard synthetic '+randomUUID()})),folderId=(await folderResponse.json()).folder.id;
  const upload=mismatch({folderId,idempotencyKey:randomUUID(),fileName:'synthetic.png',title:'No cross-actor upload',size:9,mediaType:'image/png',sha256:createHash('sha256').update('synthetic').digest('hex'),source:'import'});
  expect((await app.handleUploads(upload)).status).toBe(401);
  const malformed=req(undefined);malformed.headers.set('X-Hestia-Expected-Actor','%XX');expect((await app.handleAgenda(malformed)).status).toBe(401);
  expect((await pool.query('SELECT count(*) FROM hestia_agenda_operation')).rows[0].count).toBe(before);
  expect((await pool.query('SELECT title,archived_at,revision FROM hestia_agenda_card WHERE id=$1',[card.id])).rows[0]).toMatchObject({title:card.title,archived_at:null,revision:card.revision});
 });
 it('replays exactly one create/save intention and returns full current conflict without overwriting',async()=>{
  const {card,body}=await create(),retry=await app.handleAgenda(req(body));expect((await retry.json()).card.id).toBe(card.id);expect((await pool.query('SELECT count(*) FROM hestia_agenda_card')).rows[0].count).toBe('1');
  expect((await app.handleAgenda(req({...body,title:'Same key other command'}))).status).toBe(409);
  const second=await update(card,{description:'Version serveur complète',links:[{label:'Site synthétique',url:'https://example.invalid'}]});const conflict=await app.handleAgendaCard(req(saveBody(card,{title:'Ne pas écraser'}),cookie,'PATCH'),card.id);expect(conflict.status).toBe(409);expect((await conflict.json()).current).toMatchObject({revision:second.revision,description:'Version serveur complète',links:second.links});
  const receipt=await app.handleAgendaOperation(req(undefined,cookie,'GET'),body.requestId);expect((await receipt.json()).status).toBe('committed');expect((await (await app.handleAgendaOperation(req(undefined,readerCookie,'GET'),body.requestId)).json()).status).toBe('not-recorded');
 });
 it('keeps restricted cards invisible, denies admin management and masks another restricted audience',async()=>{
  const {card}=await create({shareMode:'selected',readerIds:[reader]});expect((await app.handleAgendaCard(req(undefined,adminCookie),card.id)).status).toBe(404);const other=await (await app.handleAgenda(req(undefined,adminCookie))).json();expect(other.cards).toHaveLength(0);expect(other.categories).toEqual([]);expect(other.total).toBe(0);
  const read=(await (await app.handleAgendaCard(req(undefined,readerCookie),card.id)).json()).card;expect(read.canManage).toBe(false);expect(read.readerIds).toBeUndefined();expect(read.reminders).toEqual([]);expect((await app.handleAgendaCard(req(saveBody(card),readerCookie,'PATCH'),card.id)).status).toBe(404);
  expect((await (await app.handleAgenda(req(undefined,readerCookie,'GET',`?personMode=shared&personId=${admin}`))).json()).cards).toHaveLength(0);
 });
 it('preserves ownership across auth recovery epoch while invalidating old command receipts',async()=>{
  const {card,body}=await create({shareMode:'selected'});const previous=(await pool.query('SELECT departure_epoch FROM hestia_member WHERE user_id=$1',[actor])).rows[0].departure_epoch;await pool.query('UPDATE hestia_member SET epoch=epoch+1 WHERE user_id=$1',[actor]);cookie=await login(emails[0]);expect((await pool.query('SELECT departure_epoch FROM hestia_member WHERE user_id=$1',[actor])).rows[0].departure_epoch).toBe(previous);expect((await (await app.handleAgendaOperation(req(),body.requestId)).json()).status).toBe('not-recorded');expect((await update(card,{title:'Toujours mon idée'})).title).toBe('Toujours mon idée');
 });
 it('freezes creator-departure archives atomically, stops reminders and rejects new/readmitted members',async()=>{
  const future=new Date(now.getTime()+86400000),date=future.toISOString().slice(0,10);const {card}=await create({startDate:date,reminders:[{id:randomUUID(),unit:'days',value:0,sendTime:'23:00'}]});await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[actor]);const raw=(await pool.query('SELECT * FROM hestia_agenda_card WHERE id=$1',[card.id])).rows[0];expect(raw.archived_at).toBeTruthy();expect(raw.creator_departed_at).toBeTruthy();expect((await pool.query('SELECT configuration_state FROM hestia_agenda_reminder WHERE card_id=$1',[card.id])).rows[0].configuration_state).toBe('stopped');
  expect((await app.handleAgendaCard(req(undefined,readerCookie),card.id)).status).toBe(200);const newId=await provisionSyntheticMember(pool,{email:`agenda-new-${randomUUID()}@example.invalid`,name:'Nouveau Synthétique',password});expect((await pool.query('SELECT * FROM hestia_agenda_access WHERE card_id=$1 AND user_id=$2',[card.id,newId])).rowCount).toBe(0);
  await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[reader]);await pool.query('UPDATE hestia_member SET active=true WHERE user_id=$1',[reader]);readerCookie=await login(emails[1]);expect((await app.handleAgendaCard(req(undefined,readerCookie),card.id)).status).toBe(404);
  await pool.query('UPDATE hestia_member SET active=true WHERE user_id=$1',[actor]);cookie=await login(emails[0]);expect((await app.handleAgendaCard(req(undefined,cookie),card.id)).status).toBe(404);
 });
 it('preserves continuous access token but changes it on effective withdrawal and regrant',async()=>{
  let {card}=await create();const access=async()=>(await pool.query('SELECT eligibility_token,eligible_since FROM hestia_agenda_access WHERE card_id=$1 AND user_id=$2',[card.id,reader])).rows[0];const first=await access();card=await update(card,{shareMode:'selected',readerIds:[reader]});expect((await access()).eligibility_token).toBe(first.eligibility_token);card=await update(card,{readerIds:[]});now=new Date(now.getTime()+1);card=await update(card,{readerIds:[reader]});expect((await access()).eligibility_token).not.toBe(first.eligibility_token);expect((await access()).eligible_since.getTime()).toBe(now.getTime());
 });
 it('regenerates only changed reminder/start, not end alone; reopen skips all old due times',async()=>{
  const tomorrow=new Date(now.getTime()+86400000).toISOString().slice(0,10),rid=randomUUID();let {card}=await create({startDate:tomorrow,startTime:'15:00',reminders:[{id:rid,unit:'hours',value:1,sendTime:null}]});const read=async()=>(await pool.query('SELECT * FROM hestia_agenda_reminder WHERE card_id=$1 AND id=$2',[card.id,rid])).rows[0];const first=await read();card=await update(card,{endDate:tomorrow,endTime:'17:00'});expect((await read()).generation).toBe(first.generation);card=await update(card,{startTime:'16:00'});expect((await read()).generation).toBe(first.generation+1);
  const archived=await app.handleAgendaArchive(req({requestId:randomUUID(),revision:card.revision}),card.id);card=(await archived.json()).card;now=new Date((await read()).due_at.getTime()+1);const reopened=await app.handleAgendaReopen(req({requestId:randomUUID(),revision:card.revision}),card.id);expect(reopened.status).toBe(200);expect((await read()).configuration_state).toBe('past');
 });
 it('links Documents under independent folder rights and retains opaque unavailable links safely',async()=>{
  const folderResponse=await app.handleFolders(req({name:'Agenda coffre synthétique '+randomUUID()}));const folderId=(await folderResponse.json()).folder.id as string,id=randomUUID(),key='agenda-synthetic/'+id,hash=createHash('sha256').update('synthetic').digest('hex');
  await pool.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,final_key,reservation_released) VALUES($1,$2,$3,$2,$1,$4,'Document synthétique','synthetic.txt','text/plain',9,$4,'import','completed',$5,true)`,[id,actor,folderId,hash,key]);
  await pool.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready) VALUES($1,$2,'original',9,$3,true)",[key,id,hash]);const doc=randomUUID();await pool.query(`INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported) VALUES($1,$2,$3,$3,'Synthetic','Titre coffre privé','private.txt','text/plain',9,$4,'import',$5,false)`,[doc,folderId,actor,hash,key]);
  let {card}=await create({documentIds:[doc]});expect(card.documents[0].state).toBe('available');const other=(await (await app.handleAgendaCard(req(undefined,readerCookie),card.id)).json()).card;expect(other.documents).toEqual([{linkId:card.documents[0].linkId,state:'unavailable'}]);
  await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND capability='consulter'",[folderId]);card=(await (await app.handleAgendaCard(req(),card.id)).json()).card;expect(card.documents[0].state).toBe('unavailable');card=await update(card,{description:'Association conservée opaque'});expect(card.documents[0].state).toBe('unavailable');expect((await app.handleAgendaCard(req(saveBody(card,{retainedDocumentLinkIds:[randomUUID()]}),cookie,'PATCH'),card.id)).status).toBe(404);
  card=await update(card,{retainedDocumentLinkIds:[]});expect(card.documents).toEqual([]);expect((await pool.query('SELECT * FROM hestia_document WHERE id=$1',[doc])).rowCount).toBe(1);
 });
 async function depositOnly(){
  const fr=await app.handleFolders(req({name:'Dépôt seul synthétique '+randomUUID()})),folderId=(await fr.json()).folder.id as string;
  await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND capability='consulter'",[folderId]);
  const image=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();
  const init=await app.handleUploads(req({folderId,idempotencyKey:randomUUID(),fileName:'private-synthetic.png',title:'Titre privé synthétique',size:image.length,mediaType:'image/png',sha256:createHash('sha256').update(image).digest('hex'),source:'import'}));expect(init.status).toBe(201);const id=(await init.json()).operation.id as string;
  expect((await app.handleUploadChunk(new Request(config.origin+'/api/hestia/uploads/'+id,{method:'PUT',headers:{origin:config.origin,cookie,'content-type':'application/octet-stream'},body:new Uint8Array(image)}),id,'0')).status).toBe(200);
  const done=await app.handleUploadComplete(req({keepDuplicate:true}),id);expect(done.status).toBe(200);expect((await done.json()).document).toBeNull();return {id,folderId};
 }
 it('associates a newly completed deposit-only upload by its server admission binding without private metadata',async()=>{
  const {id,folderId}=await depositOnly();const {card}=await create({completedUploadIds:[id]});expect(card.documents).toHaveLength(1);expect(card.documents[0]).toEqual({linkId:expect.any(String),state:'unavailable'});expect(JSON.stringify(card)).not.toContain('private-synthetic.png');
  const list=await app.handleAgenda(req());expect(list.headers.get('X-Hestia-Actor')).toBe(encodeURIComponent(actor));
  const one=(await pool.query('SELECT document_id FROM hestia_upload WHERE id=$1',[id])).rows[0];expect((await app.handleAgendaAvailableDocuments(req(undefined,cookie,'GET','?documentId='+one.document_id))).status).toBe(200);expect((await (await app.handleAgendaAvailableDocuments(req(undefined,cookie,'GET','?documentId='+one.document_id))).json()).documents).toEqual([]);
  await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND capability='déposer'",[folderId]);expect((await app.handleAgenda(req(fields({completedUploadIds:[id]})))).status).toBe(404);
 });
 it('denies cross-actor, missing-binding and old-session admission upload references',async()=>{
  const {id}=await depositOnly();expect((await app.handleAgenda(req(fields({completedUploadIds:[id]}),readerCookie))).status).toBe(404);
  await pool.query('UPDATE hestia_member SET epoch=epoch+1 WHERE user_id=$1',[actor]);cookie=await login(emails[0]);expect((await app.handleAgenda(req(fields({completedUploadIds:[id]})))).status).toBe(404);
  await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1',[actor]);await pool.query('UPDATE hestia_member SET active=true WHERE user_id=$1',[actor]);cookie=await login(emails[0]);expect((await app.handleAgenda(req(fields({completedUploadIds:[id]})))).status).toBe(404);
  await pool.query('DELETE FROM hestia_agenda_upload_admission WHERE upload_id=$1',[id]);expect((await app.handleAgenda(req(fields({completedUploadIds:[id]})))).status).toBe(404);expect((await pool.query('SELECT count(*) FROM hestia_agenda_card')).rows[0].count).toBe('0');
 });
 async function dueCard(timed=true){
  const rid=randomUUID(),result=await create({shareMode:'selected',readerIds:[reader],startDate:'2027-04-05',startTime:timed?'15:00':null,endDate:'2027-04-12',reminders:[{id:rid,unit:timed?'hours':'days',value:timed?1:0,sendTime:timed?null:'09:00'}]});
  const reminder=(await pool.query('SELECT * FROM hestia_agenda_reminder WHERE card_id=$1 AND id=$2',[result.card.id,rid])).rows[0];now=new Date(reminder.due_at.getTime()+1);
  return {...result,rid,reminder};
 }
 const payload=(m:AgendaMail)=>JSON.stringify({to:m.email,title:m.title,date:m.date,card:m.cardId});
 const deliver=(send:AgendaMailTransport,barrier?:NonNullable<Parameters<typeof dispatchAgendaMail>[3]>['barrier'])=>dispatchAgendaMail(pool,config.secret,send,{now:()=>now,barrier});
 it('materializes a single intention per eligible reader and never duplicates accepted reminders',async()=>{
  await dueCard();const sent:string[]=[];const send:AgendaMailTransport=async m=>{expect(await m.bindPayload(payload(m))).toBe(true);sent.push(m.id);return{providerId:randomUUID()};};
  expect((await deliver(send)).state).toBe('sent');expect((await deliver(send)).state).toBe('sent');expect((await deliver(send)).state).toBe('idle');expect(new Set(sent).size).toBe(2);
  expect((await pool.query("SELECT count(*) FROM hestia_agenda_delivery WHERE state='accepted'")).rows[0].count).toBe('2');
 });
 it('uses the identical delivery ID and body after ambiguous failure, within its remaining start window',async()=>{
  await dueCard();const calls:{id:string;body:string}[]=[];let fail=true;
  const send:AgendaMailTransport=async m=>{const body=payload(m);expect(await m.bindPayload(body)).toBe(true);calls.push({id:m.id,body});if(fail){fail=false;throw new MailDeliveryError(true);}return{providerId:randomUUID()};};
  expect((await deliver(send)).state).toBe('failed');now=new Date(now.getTime()+61000);
  // Isolate the failed intention so ordering cannot choose its other recipient first.
  await pool.query("UPDATE hestia_agenda_delivery SET next_attempt_at='infinity' WHERE state='pending'");
  expect((await deliver(send)).state).toBe('sent');expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
 });
 it('reclaims a crashed marked lease with the stable binding, and fences its stale owner',async()=>{
  await dueCard();let id='',body='';
  const interrupted:AgendaMailTransport=async m=>{id=m.id;body=payload(m);expect(await m.bindPayload(body)).toBe(true);throw new MailDeliveryError(true);};
  await deliver(interrupted);await pool.query("UPDATE hestia_agenda_delivery SET next_attempt_at='infinity' WHERE state='pending'");
  await pool.query("UPDATE hestia_agenda_delivery SET state='marked',lease_until=$2,lease_token=$3 WHERE id=$1",[id,new Date(now.getTime()-1),randomUUID()]);
  const old=(await pool.query('SELECT fence,lease_token FROM hestia_agenda_delivery WHERE id=$1',[id])).rows[0];
  const send:AgendaMailTransport=async m=>{expect(m.id).toBe(id);expect(payload(m)).toBe(body);expect(await m.bindPayload(body)).toBe(true);return{providerId:randomUUID()};};
  expect((await deliver(send)).state).toBe('sent');expect((await pool.query("UPDATE hestia_agenda_delivery SET state='failed' WHERE id=$1 AND fence=$2 AND lease_token=$3",[id,old.fence,old.lease_token])).rowCount).toBe(0);
 });
 it('rechecks archival after claim and never performs provider I/O after failed binding',async()=>{
  const {card}=await dueCard();let network=0;
  const send:AgendaMailTransport=async m=>{if(!await m.bindPayload(payload(m)))throw new MailDeliveryError(false);network++;return{providerId:randomUUID()};};
  const result=await deliver(send,async stage=>{if(stage==='claimed'){expect((await app.handleAgendaArchive(req({requestId:randomUUID(),revision:card.revision}),card.id)).status).toBe(200);}});
  expect(result.state).toBe('cancelled');expect(network).toBe(0);
 });
 it('preserves possibly accepted attempts as uncertain when their card is archived',async()=>{
  const {card}=await dueCard();await deliver(async m=>{expect(await m.bindPayload(payload(m))).toBe(true);throw new MailDeliveryError(true);});
  expect((await app.handleAgendaArchive(req({requestId:randomUUID(),revision:card.revision}),card.id)).status).toBe(200);
  const states=(await pool.query('SELECT state,first_attempt_at FROM hestia_agenda_delivery WHERE card_id=$1',[card.id])).rows;
  expect(states.filter(r=>r.first_attempt_at).map(r=>r.state)).toEqual(['uncertain']);
 });
 it('expires a timed intention at its start and an untimed one after its whole first day',async()=>{
  const first=await dueCard();now=new Date(first.reminder.cutoff_at);let called=0;const send:AgendaMailTransport=async()=>{called++;return{providerId:randomUUID()};};expect((await deliver(send)).state).toBe('idle');expect(called).toBe(0);
  await pool.query('DELETE FROM hestia_agenda_operation');await pool.query('DELETE FROM hestia_agenda_delivery');await pool.query('DELETE FROM hestia_agenda_reminder');await pool.query('DELETE FROM hestia_agenda_access');await pool.query('DELETE FROM hestia_agenda_card');now=new Date();
  const untimed=await dueCard(false);now=new Date(untimed.reminder.cutoff_at.getTime()-1);
  expect((await deliver(async m=>{expect(await m.bindPayload(payload(m))).toBe(true);return{providerId:randomUUID()};})).state).toBe('sent');now=new Date(untimed.reminder.cutoff_at);expect((await deliver(send)).state).toBe('cancelled');expect(called).toBe(0);
 });
 it('rejects a replacement body after a potentially accepted attempt without creating another key',async()=>{
  const {card}=await dueCard();let attempted='';await deliver(async m=>{attempted=m.id;expect(await m.bindPayload(payload(m))).toBe(true);throw new MailDeliveryError(true);});
  await pool.query("UPDATE hestia_agenda_delivery SET next_attempt_at='infinity' WHERE state='pending'");await update(card,{title:'Titre changé après tentative'});now=new Date(now.getTime()+61000);let network=0;
  const result=await deliver(async m=>{if(!await m.bindPayload(payload(m)))throw new MailDeliveryError(false);network++;return{providerId:randomUUID()};});expect(result.state).toBe('cancelled');expect(network).toBe(0);expect((await pool.query('SELECT state FROM hestia_agenda_delivery WHERE id=$1',[attempted])).rows[0].state).toBe('uncertain');
 });
});
