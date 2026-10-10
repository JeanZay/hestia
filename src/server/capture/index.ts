import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { type Access,type Actor,HttpError,bodyBytes,guarded,invalid,isUuid,json,privateHeaders,response,textField,unavailable } from "../access";
import { validateOriginal } from "../formats";
import { folderNameKey } from "../db/folder-name";
import { getFolderAccess, loadFolderAccessGraph } from "../permissions/service";
import { evaluateTreeAccess } from "../permissions/tree";
import type { CaptureDto,CapturePageDto,CaptureArtifactDto,CaptureMediaType,CaptureRotation,CaptureCrop,CapturePreviewInput,CapturePreviewDto,CaptureDocumentDto,CaptureFinalizeInput,CaptureOperationDto } from "../../shared/capture-contract";
import type { CaptureDependencies,CaptureService,CaptureLimits,AnalysisIdentity,AnalysisSelection,RenderPage } from "./types";
import { createCaptureRenderer,inspectCaptureImage } from "./renderer";
import { digest,conflict,integer,uuid,crop,previewInput,finalInput,previewHash,finalHash } from "./model";
export type {CaptureDependencies,CaptureService,CaptureAnalysisBridge,AnalysisIdentity,AnalysisSelection} from "./types";
const CHUNK=2*1024*1024, MAX=20*1024*1024;
const TYPES:CaptureMediaType[]=["application/pdf","image/jpeg","image/png","image/webp","image/heic","image/heif"];
export const DEFAULT_CAPTURE_LIMITS:CaptureLimits={fileBytes:MAX,imagePixels:40_000_000,pages:20,totalPixels:200_000_000,sourceBytes:200*1024*1024,generationTimeoutMs:90_000,maxDraftsPerActor:20,maxConcurrentGenerations:1};
type CaptureRow={id:string;actor_id:string;actor_epoch:number;kind:"camera"|"import";version:number;state:CaptureDto["state"];created_at:Date;expires_at:Date;current_folder_id:string|null;title:string;format:CaptureDto["format"];identity_sha:string};
type PageRow={id:string;capture_id:string;identity_sha:string;expected_version:number;replace_page_id:string|null;file_name:string;media_type:CaptureMediaType;size:number;sha256:string;status:string;object_key:string;version:number;position:number;rotation:CaptureRotation;crop:CaptureCrop;width:number;height:number;saved_at:Date|null;preview_key:string|null;preview_version:number|null};
type ArtifactRow={id:string;capture_id:string;capture_version:number;manifest_sha:string;object_key:string;media_type:CaptureMediaType;file_name:string;size:number;sha256:string;page_count:number};
type ObjectRow={object_key:string;size:number;sha256:string;ready:boolean;deleted_at:Date|null;promoted:boolean};
const pageDto=(p:PageRow):CapturePageDto=>({id:p.id,version:p.version,order:p.position,rotation:p.rotation,crop:p.crop,size:p.size,mediaType:p.media_type,width:p.width,height:p.height,savedAt:p.saved_at!.toISOString()});
const artifactDto=(a:ArtifactRow):CaptureArtifactDto=>({id:a.id,version:a.capture_version,mediaType:a.media_type,fileName:a.file_name,size:a.size,sha256:a.sha256,pageCount:a.page_count});
const manifest=(c:CaptureRow,pages:PageRow[])=>digest(JSON.stringify([c.id,c.version,c.title,c.format,pages.map(p=>[p.id,p.version,p.sha256,p.rotation,p.crop,p.position])]));
const method=(r:Request,...allowed:string[])=>{if(!allowed.includes(r.method))throw new HttpError(405,"METHOD_NOT_ALLOWED","Action indisponible.");};
const version=(row:CaptureRow,v:unknown)=>{if(row.version!==integer(v))throw conflict("VERSION_CONFLICT","Ce brouillon a changé. Actualisez-le avant de continuer.");};
const closed=()=>new HttpError(410,"CAPTURE_EXPIRED","Ce brouillon est expiré ou fermé.");
const renderPage=(p:PageRow):RenderPage=>({id:p.id,version:p.version,mediaType:p.media_type,size:p.size,sha256:p.sha256,width:p.width,height:p.height,rotation:p.rotation,crop:p.crop});
export function createCaptureService(pool:Pool,access:Access,deps:CaptureDependencies):CaptureService {
 const limits={...DEFAULT_CAPTURE_LIMITS,...deps.limits};
 for(const [key,max] of Object.entries(DEFAULT_CAPTURE_LIMITS)){const n=limits[key as keyof CaptureLimits];if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error("Invalid capture limits");}
 const clock=deps.clock??(async(client:PoolClient)=>(await client.query<{now:Date}>("SELECT clock_timestamp() AS now")).rows[0].now);
 const validate=deps.validateOriginal??validateOriginal,renderer=deps.renderer??createCaptureRenderer(limits.generationTimeoutMs);
 const {withActor,transaction,origin}=access;const db=()=>access.currentClient()??pool;
 const epoch=async(client:PoolClient,actor:Actor)=>Number((await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1",[actor.id])).rows[0].epoch);
 async function owned(client:PoolClient,actor:Actor,id:string,open=true):Promise<CaptureRow>{
  if(!isUuid(id))throw unavailable();
  const row=(await client.query<CaptureRow>("SELECT * FROM hestia_capture WHERE id=$1 AND actor_id=$2 FOR UPDATE",[id,actor.id])).rows[0];
  if(!row||row.actor_epoch!==await epoch(client,actor))throw unavailable();
  if(open&&(row.expires_at<=(await clock(client))||!["open","preparing"].includes(row.state)))throw closed();return row;
 }
 async function pages(client:PoolClient,id:string){return (await client.query<PageRow>("SELECT * FROM hestia_capture_page WHERE capture_id=$1 AND status='saved' ORDER BY position,id",[id])).rows;}
 async function dto(client:PoolClient,c:CaptureRow):Promise<CaptureDto>{return {id:c.id,kind:c.kind,version:c.version,state:c.state,createdAt:c.created_at.toISOString(),expiresAt:c.expires_at.toISOString(),currentFolderId:c.current_folder_id,title:c.title,format:c.format,pages:(await pages(client,c.id)).map(pageDto)};}
 async function operation<T>(id:string,action:()=>Promise<T>,skip=false):Promise<T|undefined>{
  const client=await pool.connect();let locked=false;
  try{locked=(await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,4819)) AS locked",[id])).rows[0].locked;
   if(!locked){if(skip)return;throw conflict("CAPTURE_BUSY","Ce brouillon est en cours de traitement. Réessayez dans un instant.");}
   return await access.usingClient(client,action);
  }finally{try{if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended($1,4819))",[id]);}finally{client.release();}}
 }
 async function reserve(client:PoolClient,c:CaptureRow,kind:string,size:number,key?:string){
  await deps.budget.assertAdditional(client,[{ownerId:c.actor_id,bytes:size}]);const objectKey=key??`capture/${c.id}/${randomUUID()}`;
  await client.query("INSERT INTO hestia_capture_object(object_key,capture_id,owner_id,kind,charged_bytes,size) VALUES($1,$2,$3,$4,$5,$5)",[objectKey,c.id,c.actor_id,kind,size]);return objectKey;
 }
 async function readObject(key:string,size:number,sha:string){
  if(!Number.isSafeInteger(size)||size<1||size>MAX)throw invalid();const bytes=new Uint8Array(size);
  for(let offset=0;offset<size;offset+=CHUNK){const piece=await deps.store.getRange(key,offset,Math.min(size,offset+CHUNK)-1);if(piece.length!==Math.min(CHUNK,size-offset))throw unavailable();bytes.set(piece,offset);}
  if(digest(bytes)!==sha)throw new HttpError(422,"INTEGRITY_ERROR","Le fichier reçu est incomplet ou altéré.");return bytes;
 }
 async function invalidate(client:PoolClient,c:CaptureRow){
  await client.query("UPDATE hestia_capture_object SET purge=true WHERE kind='artifact' AND object_key IN(SELECT object_key FROM hestia_capture_artifact WHERE capture_id=$1)",[c.id]);
  await client.query("DELETE FROM hestia_capture_preview WHERE capture_id=$1",[c.id]);
 }
 async function page(client:PoolClient,id:string,pageId:string){if(!isUuid(pageId))throw unavailable();const p=(await client.query<PageRow>("SELECT * FROM hestia_capture_page WHERE id=$1 AND capture_id=$2 FOR UPDATE",[pageId,id])).rows[0];if(!p||p.status==="removed")throw unavailable();return p;}
 async function artifact(client:PoolClient,c:CaptureRow,id:string){
  const a=(await client.query<ArtifactRow>("SELECT a.* FROM hestia_capture_artifact a JOIN hestia_capture_object o ON o.object_key=a.object_key WHERE a.id=$1 AND a.capture_id=$2 AND a.capture_version=$3 AND o.ready AND o.deleted_at IS NULL AND NOT o.purge",[uuid(id),c.id,c.version])).rows[0];
  if(!a||a.manifest_sha!==manifest(c,await pages(client,c.id)))throw conflict("VERSION_CONFLICT","Préparez à nouveau le document avant de continuer.");return a;
 }
 async function handleCaptures(request:Request){return guarded(async()=>{
  method(request,"GET","POST");if(request.method==="GET")return response(await withActor(request,async(client,actor)=>{const now=await clock(client);const rows=(await client.query<CaptureRow>("SELECT * FROM hestia_capture WHERE actor_id=$1 AND actor_epoch=$2 AND kind='camera' AND state IN ('open','preparing') AND expires_at>$3 ORDER BY created_at DESC LIMIT 100",[actor.id,await epoch(client,actor),now])).rows;return {captures:await Promise.all(rows.map(row=>dto(client,row))),now:now.toISOString()};}));
  origin(request);const input=await json(request,["kind","idempotencyKey","currentFolderId"]);if(!["camera","import"].includes(String(input.kind)))throw invalid();const key=uuid(input.idempotencyKey),folder=input.currentFolderId==null?null:uuid(input.currentFolderId),identity=digest(JSON.stringify([input.kind,folder]));
  return response(await withActor(request,async(client,actor)=>{const actorEpoch=await epoch(client,actor);const old=(await client.query<CaptureRow>("SELECT * FROM hestia_capture WHERE actor_id=$1 AND actor_epoch=$2 AND idempotency_key=$3",[actor.id,actorEpoch,key])).rows[0];if(old){if(old.identity_sha!==identity)throw conflict("IDEMPOTENCY_CONFLICT","Cette demande correspond à un autre brouillon.");await owned(client,actor,old.id);return {capture:await dto(client,old)};}
   const now=await clock(client);const count=Number((await client.query("SELECT count(*) FROM hestia_capture WHERE actor_id=$1 AND state IN ('open','preparing') AND expires_at>$2",[actor.id,now])).rows[0].count);if(count>=limits.maxDraftsPerActor)throw new HttpError(429,"CAPTURE_LIMIT","Trop de brouillons en cours. Abandonnez un brouillon avant de recommencer.");
   let current=folder;if(current&&!(await getFolderAccess(client,actor.id,current)).capabilities.includes("consulter"))current=null;
   const row=(await client.query<CaptureRow>("INSERT INTO hestia_capture(id,actor_id,actor_epoch,kind,idempotency_key,identity_sha,created_at,expires_at,current_folder_id,format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[randomUUID(),actor.id,actorEpoch,input.kind,key,identity,now,new Date(now.getTime()+(input.kind==="camera"?168:1)*3600000),current,input.kind==="camera"?"pdf":"original"])).rows[0];return {capture:await dto(client,row)};
  }),201);
 });}
 async function handleCapture(request:Request,id:string){return guarded(async()=>{
  method(request,"GET","PATCH","DELETE");if(request.method==="GET")return response(await withActor(request,async(client,actor)=>({capture:await dto(client,await owned(client,actor,id))})));
  origin(request);const input=await json(request,request.method==="DELETE"?["version"]:["version","title","format","pages"]);
  return (await operation(id,async()=>response(await withActor(request,async(client,actor)=>{
   const c=await owned(client,actor,id);version(c,input.version);await deps.budget.lock(client);
   if(request.method==="DELETE"){await client.query("UPDATE hestia_capture SET state='abandoned',version=version+1 WHERE id=$1",[id]);await client.query("UPDATE hestia_capture_object SET purge=true WHERE capture_id=$1 AND NOT promoted",[id]);return {capture:await dto(client,{...c,state:"abandoned",version:c.version+1})};}
   const title=textField(input.title,200),format=input.format;if(!Array.isArray(input.pages)||input.pages.length>limits.pages||!["pdf","image","original"].includes(String(format)))throw invalid();const current=await pages(client,id);
   if(c.kind==="import"&&(format!=="original"||input.pages.length!==current.length))throw invalid();if(c.kind==="camera"&&(format==="original"||(format==="image"&&input.pages.length>1)))throw invalid();
   const seen=new Set<string>();for(let i=0;i<input.pages.length;i++){const item=input.pages[i];if(!item||typeof item!=="object"||Object.keys(item).sort().join()!=="crop,id,rotation")throw invalid();const p=current.find(p=>p.id===uuid(item.id));if(!p||seen.has(p.id))throw invalid();seen.add(p.id);const rotate=integer(item.rotation,0,270);if(rotate%90)throw invalid();const adjusted=crop(item.crop);if(c.kind==="import"&&(rotate!==0||Object.values(adjusted).some(n=>n)))throw invalid();
    if(rotate!==p.rotation||Object.keys(adjusted).some(k=>adjusted[k as keyof CaptureCrop]!==p.crop[k as keyof CaptureCrop])){await client.query("UPDATE hestia_capture_object SET purge=true WHERE object_key=$1",[p.preview_key]);await client.query("UPDATE hestia_capture_page SET rotation=$2,crop=$3,position=$4,version=version+1,preview_key=NULL,preview_version=NULL WHERE id=$1",[p.id,rotate,adjusted,i]);}else await client.query("UPDATE hestia_capture_page SET position=$2 WHERE id=$1",[p.id,i]);}
   // A complete manifest edit also cancels unsaved selections, under the same writer lock.
   const unsaved=(await client.query<PageRow>("UPDATE hestia_capture_page SET status='removed' WHERE capture_id=$1 AND status='uploading' RETURNING *",[id])).rows;
   for(const pending of unsaved)await client.query("UPDATE hestia_capture_object SET purge=true WHERE object_key=$1 OR object_key IN(SELECT object_key FROM hestia_capture_chunk WHERE page_id=$2)",[pending.object_key,pending.id]);
   for(const p of current)if(!seen.has(p.id)){await client.query("UPDATE hestia_capture_page SET status='removed' WHERE id=$1",[p.id]);await client.query("UPDATE hestia_capture_object SET purge=true WHERE object_key=ANY($1::text[])",[[p.object_key,p.preview_key].filter(Boolean)]);}
   await invalidate(client,c);const updated=(await client.query<CaptureRow>("UPDATE hestia_capture SET title=$2,format=$3,version=version+1,state='open' WHERE id=$1 RETURNING *",[id,title,format])).rows[0];return {capture:await dto(client,updated)};
  }))))!;
 });}
 async function handleCapturePages(request:Request,id:string){return guarded(async()=>{
  method(request,"POST");origin(request);const input=await json(request,["version","idempotencyKey","fileName","mediaType","size","sha256","replacePageId"]);const key=uuid(input.idempotencyKey),name=textField(input.fileName,255),size=integer(input.size,1,limits.fileBytes),type=String(input.mediaType) as CaptureMediaType;
  if(!TYPES.includes(type)||typeof input.sha256!=="string"||!/^[a-f0-9]{64}$/.test(input.sha256))throw invalid();const replace=input.replacePageId===undefined?null:uuid(input.replacePageId);const identity=digest(JSON.stringify([name,type,size,input.sha256,replace]));
  return (await operation(id,async()=>response(await withActor(request,async(client,actor)=>{
   const c=await owned(client,actor,id);version(c,input.version);if(c.kind==="camera"&&type==="application/pdf")throw invalid();
   const previous=(await client.query<PageRow>("SELECT * FROM hestia_capture_page WHERE capture_id=$1 AND idempotency_key=$2",[id,key])).rows[0];if(previous){if(previous.identity_sha!==identity)throw conflict("IDEMPOTENCY_CONFLICT","Cette page correspond à un autre envoi.");return {upload:{id:previous.id,chunkSize:CHUNK},captureVersion:c.version};}
   const active=(await client.query<PageRow>("SELECT * FROM hestia_capture_page WHERE capture_id=$1 AND status<>'removed'",[id])).rows;if(replace&&!active.some(p=>p.id===replace&&p.status==="saved"))throw unavailable();
   if(active.filter(p=>p.id!==replace).length>=(c.kind==="import"?1:limits.pages)||active.reduce((n,p)=>n+p.size,0)+size>limits.sourceBytes)throw new HttpError(413,"CAPTURE_LIMIT","Ce document atteint la limite de pages ou de taille. Les pages enregistrées sont conservées.");
   const objectKey=await reserve(client,c,"source",size),pageId=randomUUID();await client.query("INSERT INTO hestia_capture_page(id,capture_id,idempotency_key,identity_sha,expected_version,replace_page_id,file_name,media_type,size,sha256,object_key,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[pageId,id,key,identity,c.version,replace,name,type,size,input.sha256,objectKey,active.length]);return {upload:{id:pageId,chunkSize:CHUNK},captureVersion:c.version};
  }))))!;
 });}
 async function handleCapturePageChunk(request:Request,id:string,pageId:string,indexText:string){return guarded(async()=>{
  method(request,"PUT");origin(request);if(!/^\d+$/.test(indexText))throw invalid();const index=integer(Number(indexText),0,9);const bytes=await bodyBytes(request,CHUNK),sha=digest(bytes);
  return (await operation(id,async()=>{let key="";let already=false;
   await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id),p=await page(client,id,pageId);if(p.status!=="uploading"||bytes.length!==Math.min(CHUNK,p.size-index*CHUNK)||!bytes.length)throw invalid();
    const old=(await client.query<ObjectRow>("SELECT o.* FROM hestia_capture_chunk ch JOIN hestia_capture_object o ON o.object_key=ch.object_key WHERE ch.page_id=$1 AND ch.chunk_index=$2",[pageId,index])).rows[0];
    if(old){if(old.sha256!==sha||old.size!==bytes.length)throw conflict("IDEMPOTENCY_CONFLICT","Cette portion correspond à d’autres données.");if(old.ready){already=true;return;}key=old.object_key;return;}
    key=await reserve(client,c,"chunk",bytes.length);await client.query("UPDATE hestia_capture_object SET sha256=$2 WHERE object_key=$1",[key,sha]);await client.query("INSERT INTO hestia_capture_chunk VALUES($1,$2,$3)",[pageId,index,key]);
   });if(!already){await deps.store.put(key,bytes,"application/octet-stream");await withActor(request,async(client,actor)=>{await owned(client,actor,id);const p=await page(client,id,pageId);if(p.status!=="uploading")throw closed();await client.query("UPDATE hestia_capture_object SET ready=true WHERE object_key=$1",[key]);});}return response({received:true});
  }))!;
 });}
 async function handleCapturePageComplete(request:Request,id:string,pageId:string){return guarded(async()=>{
  method(request,"POST");origin(request);const input=await json(request,["version"]);
  return (await operation(id,async()=>{
   const initial=await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id),p=await page(client,id,pageId);if(p.status==="saved")return {c,p,parts:[] as (ObjectRow&{chunk_index:number})[],done:true};version(c,input.version);if(p.expected_version!==c.version)throw conflict("VERSION_CONFLICT","Ce brouillon a changé. Reprenez l’envoi de cette page.");
    const parts=(await client.query<ObjectRow&{chunk_index:number}>("SELECT o.*,ch.chunk_index FROM hestia_capture_chunk ch JOIN hestia_capture_object o ON o.object_key=ch.object_key WHERE ch.page_id=$1 ORDER BY ch.chunk_index",[pageId])).rows;if(parts.length!==Math.ceil(p.size/CHUNK)||parts.some((x,i)=>!x.ready||x.deleted_at||x.chunk_index!==i))throw conflict("INCOMPLETE_UPLOAD","L’envoi de cette page n’est pas terminé.");return {c,p,parts,done:false};});
   if(initial.done)return response(await withActor(request,async(client,actor)=>({capture:await dto(client,await owned(client,actor,id)),page:pageDto(initial.p)})));
   const bytes=new Uint8Array(initial.p.size);for(const part of initial.parts){bytes.set(await readObject(part.object_key,part.size,part.sha256),part.chunk_index*CHUNK);await withActor(request,async(client,actor)=>{version(await owned(client,actor,id),input.version);});}
   if(digest(bytes)!==initial.p.sha256)throw new HttpError(422,"INTEGRITY_ERROR","La page reçue est altérée.");let checked:Awaited<ReturnType<typeof validate>>;
   try{checked=await validate(bytes,initial.p.media_type);}catch{throw new HttpError(422,"INVALID_FILE","Ce fichier est invalide ou son format n’est pas pris en charge.");}
   const dimensions=initial.c.kind==="camera"?await inspectCaptureImage(bytes,checked.mediaType as CaptureMediaType):{width:0,height:0};
   await withActor(request,async(client,actor)=>{version(await owned(client,actor,id),input.version);const current=await pages(client,id);const pixels=current.filter(p=>p.id!==initial.p.replace_page_id).reduce((n,p)=>n+p.width*p.height,0)+dimensions.width*dimensions.height;if(pixels>limits.totalPixels||dimensions.width*dimensions.height>limits.imagePixels)throw new HttpError(413,"CAPTURE_LIMIT","Le document dépasse la limite de pixels. Les pages enregistrées sont conservées.");});
   await deps.store.put(initial.p.object_key,bytes,checked.mediaType);
   return response(await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id);version(c,input.version);await deps.budget.lock(client);
    if(initial.p.replace_page_id){const old=await page(client,id,initial.p.replace_page_id);await client.query("UPDATE hestia_capture_page SET status='removed' WHERE id=$1",[old.id]);await client.query("UPDATE hestia_capture_object SET purge=true WHERE object_key=ANY($1::text[])",[[old.object_key,old.preview_key].filter(Boolean)]);initial.p.position=old.position;}
    await client.query("UPDATE hestia_capture_object SET ready=true,sha256=$2 WHERE object_key=$1",[initial.p.object_key,initial.p.sha256]);await client.query("UPDATE hestia_capture_object SET purge=true WHERE object_key IN(SELECT object_key FROM hestia_capture_chunk WHERE page_id=$1)",[pageId]);
    const p=(await client.query<PageRow>("UPDATE hestia_capture_page SET status='saved',saved_at=$2,width=$3,height=$4,position=$5,media_type=$6 WHERE id=$1 RETURNING *",[pageId,await clock(client),dimensions.width,dimensions.height,initial.p.position,checked.mediaType])).rows[0];await invalidate(client,c);
    const updated=(await client.query<CaptureRow>("UPDATE hestia_capture SET version=version+1,state='open',format=CASE WHEN kind='camera' AND (SELECT count(*) FROM hestia_capture_page WHERE capture_id=$1 AND status='saved')>1 THEN 'pdf' ELSE format END WHERE id=$1 RETURNING *",[id])).rows[0];return {capture:await dto(client,updated),page:pageDto(p)};
   }));
  }))!;
 });}
 async function withGeneration<T>(action:()=>Promise<T>):Promise<T>{
  const client=access.currentClient();if(!client)throw new Error("Capture operation lock required");
  const acquired=(await client.query("SELECT pg_try_advisory_lock(481900001) AS locked")).rows[0].locked;
  if(!acquired)throw conflict("CAPTURE_BUSY","Une préparation est déjà en cours. Réessayez dans un instant.");
  try{return await action();}finally{await client.query("SELECT pg_advisory_unlock(481900001)");}
 }
 async function render(request:Request,c:CaptureRow,selected:PageRow[],format:"pdf"|"image"){
  return withGeneration(()=>renderer({pages:selected.map(renderPage),format,signal:request.signal,readPage:async(pageId)=>{
   const p=selected.find(p=>p.id===pageId);if(!p)throw invalid();await withActor(request,async(client,actor)=>{version(await owned(client,actor,c.id),c.version);});
   const bytes=await readObject(p.object_key,p.size,p.sha256);await withActor(request,async(client,actor)=>{version(await owned(client,actor,c.id),c.version);});return bytes;
  }}));
 }
 async function handleCapturePrepare(request:Request,id:string){return guarded(async()=>{
  method(request,"POST");origin(request);const input=await json(request,["version"]);
  return (await operation(id,async()=>{let key:string|null=null;
   try{
    const initial=await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id);version(c,input.version);const selected=await pages(client,id);if(!selected.length)throw conflict("CAPTURE_EMPTY","Ajoutez au moins une page enregistrée.");
     const existing=(await client.query<ArtifactRow>("SELECT a.* FROM hestia_capture_artifact a JOIN hestia_capture_object o ON o.object_key=a.object_key WHERE a.capture_id=$1 AND a.capture_version=$2 AND o.ready AND o.deleted_at IS NULL AND NOT o.purge",[id,c.version])).rows[0];
     if(existing)return {c,selected,existing};if(c.kind==="camera")key=await reserve(client,c,"artifact",limits.fileBytes,`originals/${randomUUID()}`);
     await client.query("UPDATE hestia_capture SET state='preparing' WHERE id=$1",[id]);return {c,selected,existing:null};
    });
    if(initial.existing)return response({capture:await withActor(request,async(client,actor)=>dto(client,await owned(client,actor,id))),artifact:artifactDto(initial.existing)});
    let size:number,sha:string,type:CaptureMediaType,fileName:string,objectKey:string;
    if(initial.c.kind==="import"){const source=initial.selected[0];if(initial.selected.length!==1)throw invalid();objectKey=source.object_key;size=source.size;sha=source.sha256;type=source.media_type;fileName=source.file_name;}
    else{
     const rendered=await render(request,initial.c,initial.selected,initial.c.format==="image"?"image":"pdf");size=rendered.bytes.length;if(!size||size>limits.fileBytes)throw new HttpError(413,"FILE_TOO_LARGE","Ce document dépasse la limite de 20 Mio. Les pages enregistrées sont conservées.");
     const checked=await validate(rendered.bytes,rendered.mediaType);type=checked.mediaType as CaptureMediaType;sha=digest(rendered.bytes);objectKey=key!;fileName=initial.c.title+(type==="application/pdf"?".pdf":".jpg");
     await withActor(request,async(client,actor)=>{version(await owned(client,actor,id),initial.c.version);});await deps.store.put(objectKey,rendered.bytes,type);
    }
    return response(await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id);version(c,initial.c.version);await deps.budget.lock(client);
     if(key)await client.query("UPDATE hestia_capture_object SET ready=true,size=$2,charged_bytes=$2,sha256=$3 WHERE object_key=$1",[key,size,sha]);
     const a=(await client.query<ArtifactRow>("INSERT INTO hestia_capture_artifact(id,capture_id,capture_version,manifest_sha,object_key,media_type,file_name,size,sha256,page_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[randomUUID(),id,c.version,manifest(c,initial.selected),objectKey,type,fileName,size,sha,initial.selected.length])).rows[0];await client.query("UPDATE hestia_capture SET state='open' WHERE id=$1",[id]);return {capture:await dto(client,{...c,state:"open"}),artifact:artifactDto(a)};
    }));
   }catch(error){await transaction(async client=>{if(key)await client.query("UPDATE hestia_capture_object SET purge=true WHERE object_key=$1 AND NOT promoted",[key]);await client.query("UPDATE hestia_capture SET state='open' WHERE id=$1 AND state='preparing'",[id]);});throw error;}
  }))!;
 });}
 async function adjustedPreview(request:Request,c:CaptureRow,p:PageRow):Promise<{key:string;size:number;sha:string;type:CaptureMediaType}>{
  if(c.kind!=="camera")throw unavailable();
  if(p.preview_key&&p.preview_version===p.version){const found=(await db().query<ObjectRow>("SELECT * FROM hestia_capture_object WHERE object_key=$1 AND ready AND deleted_at IS NULL AND NOT purge",[p.preview_key])).rows[0];if(found)return {key:found.object_key,size:found.size,sha:found.sha256,type:"image/jpeg"};}
  let key:string|null=null;
  try{
   key=await withActor(request,async(client,actor)=>{version(await owned(client,actor,c.id),c.version);return reserve(client,c,"artifact",limits.fileBytes);});
   const output=await render(request,c,[p],"image");if(!output.bytes.length||output.bytes.length>limits.fileBytes)throw invalid();const sha=digest(output.bytes);
   await withActor(request,async(client,actor)=>{version(await owned(client,actor,c.id),c.version);});await deps.store.put(key,output.bytes,"image/jpeg");
   await withActor(request,async(client,actor)=>{version(await owned(client,actor,c.id),c.version);await deps.budget.lock(client);await client.query("UPDATE hestia_capture_object SET size=$2,charged_bytes=$2,sha256=$3,ready=true WHERE object_key=$1",[key,output.bytes.length,sha]);await client.query("UPDATE hestia_capture_page SET preview_key=$2,preview_version=version WHERE id=$1",[p.id,key]);});
   return {key,size:output.bytes.length,sha,type:"image/jpeg"};
  }catch(error){if(key)await db().query("UPDATE hestia_capture_object SET purge=true WHERE object_key=$1",[key]);throw error;}
 }
 async function handleCaptureContent(request:Request,id:string){return guarded(async()=>{
  method(request,"GET");const url=new URL(request.url),pageId=url.searchParams.get("pageId"),artifactId=url.searchParams.get("artifactId");if(Boolean(pageId)===Boolean(artifactId))throw invalid();const offset=integer(Number(url.searchParams.get("offset")),0,MAX),length=integer(Number(url.searchParams.get("length")),1,CHUNK);
  return (await operation(id,async()=>{
   const selected=await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id);if(pageId){const p=await page(client,id,pageId);if(p.status!=="saved")throw unavailable();return {c,p,a:null};}return {c,p:null,a:await artifact(client,c,artifactId!)};});
   const object=selected.p?await adjustedPreview(request,selected.c,selected.p):{key:selected.a!.object_key,size:selected.a!.size,sha:selected.a!.sha256,type:selected.a!.media_type};
   if(offset>=object.size)throw new HttpError(416,"INVALID_RANGE","Cette portion est hors du fichier.");const end=Math.min(object.size,offset+length)-1;const bytes=await deps.store.getRange(object.key,offset,end);if(bytes.length!==end-offset+1)throw unavailable();
   return withActor(request,async(client,actor)=>{version(await owned(client,actor,id),selected.c.version);const headers=privateHeaders();headers.set("Content-Type",object.type);headers.set("Content-Length",String(bytes.length));headers.set("Content-Range",`bytes ${offset}-${end}/${object.size}`);headers.set("Content-Security-Policy","sandbox; default-src 'none'");return new Response(new Uint8Array(bytes),{status:206,headers});});
  }))!;
 });}
 type Plan={preview:Omit<CapturePreviewDto,"previewToken">;policy:string;ownerId:string;folderId:string};
 async function plan(client:PoolClient,actor:Actor,c:CaptureRow,input:CapturePreviewInput):Promise<Plan>{
  const a=await artifact(client,c,input.artifactId),destination=input.destination;const folderId=destination.kind==="existing"?destination.folderId:destination.parentId;
  const graph=await loadFolderAccessGraph(client);graph.now=(await clock(client)).getTime();const rights=evaluateTreeAccess(graph,actor.id,folderId);
  const required=destination.kind==="existing"?["consulter","déposer"]:["consulter","déposer","modifier"];
  if(required.some(cap=>!rights.capabilities.includes(cap)))throw unavailable();
  const names=(await client.query<{id:string;name:string;parent_folder_id:string|null}>("SELECT id,name,parent_folder_id FROM hestia_folder WHERE trashed_at IS NULL ORDER BY id LIMIT 10001")).rows;
  if(names.length>10000)throw new HttpError(503,"RESOURCE_LIMIT","Trop de dossiers pour cette opération.");
  const path:CapturePreviewDto["path"]=[];let current=names.find(f=>f.id===folderId);const seen=new Set<string>();
  while(current){if(seen.has(current.id))throw invalid();seen.add(current.id);if(!evaluateTreeAccess(graph,actor.id,current.id).capabilities.includes("consulter"))break;path.unshift({id:current.id,name:current.name,isNew:false});current=names.find(f=>f.id===current!.parent_folder_id);}
  if(destination.kind==="create"){
   const exists=await client.query("SELECT 1 FROM hestia_folder WHERE parent_folder_id=$1 AND name_key=$2 AND trashed_at IS NULL LIMIT 1",[folderId,folderNameKey(destination.levels[0])]);if(exists.rowCount)throw conflict("NAME_UNAVAILABLE","Ce nom n’est pas disponible ici. Choisissez un autre nom.");
   if(names.length+destination.levels.length>10000)throw new HttpError(503,"RESOURCE_LIMIT","Trop de dossiers pour cette opération.");
   path.push(...destination.levels.map(name=>({name,isNew:true})));
  }
  const profiles=graph.members.filter(m=>m.active).map(m=>({id:m.user_id,name:m.name,capabilities:evaluateTreeAccess(graph,m.user_id,folderId).capabilities}));
  const projection:CapturePreviewDto["access"]={capabilities:rights.capabilities,message:"Les accès du dossier choisi s’appliqueront à ce document."};
  if(rights.canShare||rights.canAdminister)projection.people=profiles.map(p=>({...p,capabilities:p.capabilities.filter(cap=>p.id===actor.id||Boolean(rights.authorityFor([cap],p.id)))})).filter(p=>p.capabilities.includes("consulter"));
  const duplicate=destination.kind==="existing"&&Boolean((await client.query("SELECT 1 FROM hestia_document WHERE folder_id=$1 AND sha256=$2 AND trashed_at IS NULL AND purged_at IS NULL LIMIT 1",[folderId,a.sha256])).rowCount);
  const policy=digest(JSON.stringify([folderId,path,rights.ownerId,profiles,graph.grants.filter(g=>graph.folders.some(f=>f.id===g.folder_id)),graph.restrictions,graph.cuts]));
  return {preview:{artifact:artifactDto(a),title:c.title,path,access:projection,duplicate},policy,ownerId:destination.kind==="create"?actor.id:rights.ownerId,folderId};
 }
 async function handleCapturePreview(request:Request,id:string){return guarded(async()=>{
  method(request,"POST");origin(request);const input=previewInput(await json(request,["version","artifactId","destination","keepDuplicate"]));
  return response(await withActor(request,async(client,actor)=>{const c=await owned(client,actor,id);version(c,input.version);const planned=await plan(client,actor,c,input),token=randomBytes(32).toString("base64url"),now=await clock(client);
   await client.query("DELETE FROM hestia_capture_preview WHERE capture_id=$1 AND expires_at<=$2",[id,now]);const count=Number((await client.query("SELECT count(*) FROM hestia_capture_preview WHERE capture_id=$1",[id])).rows[0].count);if(count>=20)await client.query("DELETE FROM hestia_capture_preview WHERE token=(SELECT token FROM hestia_capture_preview WHERE capture_id=$1 ORDER BY expires_at LIMIT 1)",[id]);
   await client.query("INSERT INTO hestia_capture_preview(token,capture_id,actor_epoch,identity_sha,policy_sha,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[token,id,c.actor_epoch,previewHash(id,input),planned.policy,new Date(Math.min(c.expires_at.getTime(),now.getTime()+15*60000))]);return {preview:{...planned.preview,previewToken:token}};
  }));
 });}
 async function recorded(client:PoolClient,actor:Actor,id:string,input:CaptureFinalizeInput):Promise<CaptureOperationDto|null>{
  const previous=(await client.query<{identity_sha:string;document_id:string;capture_id:string}>("SELECT * FROM hestia_capture_receipt WHERE actor_id=$1 AND actor_epoch=$2 AND idempotency_key=$3",[actor.id,await epoch(client,actor),input.idempotencyKey])).rows[0];if(!previous)return null;
  if(previous.capture_id!==id||previous.identity_sha!==finalHash(id,input))throw conflict("IDEMPOTENCY_CONFLICT","Cette opération correspond à une autre demande.");
  const d=(await client.query("SELECT * FROM hestia_document WHERE id=$1 AND trashed_at IS NULL AND purged_at IS NULL",[previous.document_id])).rows[0];if(!d)throw unavailable();const rights=await getFolderAccess(client,actor.id,d.folder_id);if(!rights.capabilities.includes("consulter"))throw unavailable();
  const document:CaptureDocumentDto={id:d.id,folderId:d.folder_id,title:d.title,fileName:d.file_name,mediaType:d.media_type,size:d.size,sha256:d.sha256,source:d.source,version:d.version,createdAt:d.created_at.toISOString(),uploadedByName:d.uploaded_by_name,previewSupported:d.preview_supported,capabilities:rights.capabilities};return {status:"recorded",document};
 }
 async function handleCaptureFinalize(request:Request,id:string){return guarded(async()=>{
  method(request,"POST");origin(request);const input=finalInput(await json(request,["version","artifactId","destination","keepDuplicate","previewToken","idempotencyKey"]));
  return (await operation(id,async()=>response(await withActor(request,async(client,actor)=>{
   const previous=await recorded(client,actor,id,input);if(previous)return previous;
   const c=await owned(client,actor,id);version(c,input.version);const a=await artifact(client,c,input.artifactId),planned=await plan(client,actor,c,input),now=await clock(client);
   const token=(await client.query<{identity_sha:string;policy_sha:string;actor_epoch:number;expires_at:Date}>("SELECT * FROM hestia_capture_preview WHERE token=$1 AND capture_id=$2",[input.previewToken,id])).rows[0];
   if(!token||token.actor_epoch!==c.actor_epoch||token.expires_at<=now||token.identity_sha!==previewHash(id,input)||token.policy_sha!==planned.policy)throw conflict("ACCESS_CHANGED","Les accès ou le document ont changé. Vérifiez et confirmez à nouveau.");
   if(planned.preview.duplicate&&!input.keepDuplicate)throw conflict("DUPLICATE","Ce fichier existe déjà dans ce dossier. Vous pouvez l’ajouter quand même.");
   await deps.budget.lock(client);let folderId=planned.folderId;
   if(input.destination.kind==="create")for(const name of input.destination.levels){const child=randomUUID();await client.query("INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id) VALUES($1,$2,$3,$4,$5)",[child,name,folderNameKey(name),actor.id,folderId]);folderId=child;}
   const documentId=randomUUID(),uploadId=randomUUID();
   await client.query("INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,created_at,expires_at,reservation_released,final_key,keep_duplicate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'completed',$13,$13,true,$14,$15)",[uploadId,actor.id,folderId,planned.ownerId,randomUUID(),finalHash(id,input),c.title,a.file_name,a.media_type,a.size,a.sha256,c.kind,now,a.object_key,input.keepDuplicate]);
   await client.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready) VALUES($1,$2,'original',$3,$4,true)",[a.object_key,uploadId,a.size,a.sha256]);
   await client.query("INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[documentId,folderId,planned.ownerId,actor.id,actor.name,c.title,a.file_name,a.media_type,a.size,a.sha256,c.kind,a.object_key,!a.media_type.startsWith("image/hei")]);
   await client.query("UPDATE hestia_upload SET document_id=$2 WHERE id=$1",[uploadId,documentId]);await client.query("UPDATE hestia_capture_object SET promoted=true,purge=false WHERE object_key=$1",[a.object_key]);
   await deps.budget.assertAdditional(client,[{ownerId:planned.ownerId,bytes:0},{ownerId:actor.id,bytes:0}]);
   await client.query("INSERT INTO hestia_capture_receipt(actor_id,actor_epoch,idempotency_key,capture_id,identity_sha,document_id,committed_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[actor.id,c.actor_epoch,input.idempotencyKey,id,finalHash(id,input),documentId,now]);
   await client.query("UPDATE hestia_capture SET state='finalized' WHERE id=$1",[id]);await client.query("UPDATE hestia_capture_object SET purge=true WHERE capture_id=$1 AND NOT promoted",[id]);
   return (await recorded(client,actor,id,input))!;
  }))))!;
 });}
 async function handleCaptureOperation(request:Request,operationId:string){return guarded(async()=>{
  method(request,"POST");origin(request);const raw=await json(request,["captureId","version","artifactId","destination","keepDuplicate","previewToken","idempotencyKey"]),id=uuid(raw.captureId),input=finalInput(raw);if(uuid(operationId)!==input.idempotencyKey)throw invalid();
  await withActor(request,async(client,actor)=>{await owned(client,actor,id,false);});
  const checked=await operation(id,()=>withActor(request,async(client,actor)=>{const receipt=await recorded(client,actor,id,input);if(receipt)return receipt;await owned(client,actor,id,false);return {status:"not-recorded" as const};}),true);
  return response(checked??{status:"in-progress"});
 });}
 const analysis={
  async inspect(client:PoolClient,actor:Actor,selection:AnalysisSelection):Promise<AnalysisIdentity>{const c=await owned(client,actor,selection.captureId);version(c,selection.version);const a=await artifact(client,c,selection.artifactId);return {...selection,actorId:actor.id,actorEpoch:c.actor_epoch,manifestSha256:a.manifest_sha,sha256:a.sha256,mediaType:a.media_type,size:a.size,expiresAt:c.expires_at.toISOString()};},
  async assertCurrent(client:PoolClient,actor:Actor,identity:AnalysisIdentity){const current=await analysis.inspect(client,actor,identity);if((Object.keys(current) as (keyof AnalysisIdentity)[]).some(key=>current[key]!==identity[key]))throw conflict("VERSION_CONFLICT","Le document a changé depuis la demande d’analyse.");},
  async readBytes(request:Request,identity:AnalysisIdentity){return (await operation(identity.captureId,async()=>{const a=await withActor(request,async(client,actor)=>{await analysis.assertCurrent(client,actor,identity);return artifact(client,await owned(client,actor,identity.captureId),identity.artifactId);});const bytes=await readObject(a.object_key,a.size,a.sha256);await withActor(request,async(client,actor)=>analysis.assertCurrent(client,actor,identity));return bytes;}))!;},
 };
 async function cleanupCaptures(limit:number,maxObjects:number){
  integer(limit,1,100);integer(maxObjects,1,1000);let cleaned=0,failed=0;
  const candidates=await transaction(async client=>{const now=await clock(client);return (await client.query<{id:string}>("SELECT c.id FROM hestia_capture c WHERE (c.state IN ('open','preparing') AND (c.expires_at<=$1 OR NOT EXISTS(SELECT 1 FROM hestia_member m WHERE m.user_id=c.actor_id AND m.active AND NOT m.recovering AND m.epoch=c.actor_epoch))) OR EXISTS(SELECT 1 FROM hestia_capture_object o WHERE o.capture_id=c.id AND NOT o.promoted AND o.deleted_at IS NULL AND (o.purge OR c.state IN ('finalized','abandoned','expired'))) ORDER BY c.created_at LIMIT $2",[now,limit])).rows;});
  for(const {id} of candidates){if(cleaned>=maxObjects)break;try{await operation(id,async()=>{
   const keys=await transaction(async client=>{await deps.budget.lock(client);const c=(await client.query<CaptureRow>("SELECT * FROM hestia_capture WHERE id=$1 FOR UPDATE",[id])).rows[0];const now=await clock(client);const active=(await client.query("SELECT 1 FROM hestia_member WHERE user_id=$1 AND active AND NOT recovering AND epoch=$2",[c.actor_id,c.actor_epoch])).rowCount;
    if(["open","preparing"].includes(c.state)&&(c.expires_at<=now||!active)){c.state="expired";await client.query("UPDATE hestia_capture SET state='expired' WHERE id=$1",[id]);}
    if(["finalized","abandoned","expired"].includes(c.state))await client.query("UPDATE hestia_capture_object SET purge=true WHERE capture_id=$1 AND NOT promoted",[id]);
    return (await client.query<{object_key:string}>("SELECT object_key FROM hestia_capture_object WHERE capture_id=$1 AND purge AND NOT promoted AND deleted_at IS NULL ORDER BY object_key LIMIT $2",[id,maxObjects-cleaned])).rows;
   });
   for(const {object_key:key} of keys){try{await deps.store.delete(key);await transaction(async client=>{await deps.budget.lock(client);await client.query("UPDATE hestia_capture_object SET deleted_at=$2,charged_bytes=0 WHERE object_key=$1 AND NOT promoted",[key,await clock(client)]);});cleaned++;}catch{failed++;}}
  },true);}catch{failed++;}}
  return {cleaned,failed};
 }
 return {handleCaptures,handleCapture,handleCapturePages,handleCapturePageChunk,handleCapturePageComplete,handleCapturePrepare,handleCaptureContent,handleCapturePreview,handleCaptureFinalize,handleCaptureOperation,cleanupCaptures,analysis};
}

