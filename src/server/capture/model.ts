import { createHash } from "node:crypto";
import { bodyBytes, HttpError, invalid, isUuid } from "../access";
import { CAPTURE_PATH_MAX_LEVELS, normalizeCaptureLevel } from "../../shared/capture-path";
import type { CaptureCrop, CaptureDestination, CaptureFinalizeInput, CapturePreviewInput } from "../../shared/capture-contract";
export const digest=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
export const conflict=(code:string,message:string)=>new HttpError(409,code,message);
/** Twenty 120-code-point levels can exceed the ordinary 4 KiB form limit.
 * 32 KiB also admits JSON-escaped surrogate pairs without raising other routes. */
export async function destinationJson(request:Request,keys:string[]):Promise<Record<string,unknown>> {
  if(request.headers.get("content-type")?.split(";")[0]!=="application/json")throw invalid();
  try {
    const value:unknown=JSON.parse((await bodyBytes(request,32*1024)).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw invalid();
    return value as Record<string,unknown>;
  }catch{throw invalid();}
}
export function integer(value:unknown,min=1,max=2_147_483_646):number {if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw invalid();return Number(value);}
export function uuid(value:unknown):string {if(!isUuid(value))throw invalid();return value.toLowerCase();}
export function crop(value:unknown):CaptureCrop {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!=="b,l,r,t")throw invalid();
  const v=value as Record<string,unknown>;const out={t:integer(v.t,0,40),r:integer(v.r,0,40),b:integer(v.b,0,40),l:integer(v.l,0,40)};
  if(Object.values(out).some(n=>n%5))throw invalid();return out;
}
export function destination(value:unknown):CaptureDestination {
  if(!value||typeof value!=="object"||Array.isArray(value))throw invalid();const v=value as Record<string,unknown>;
  if(v.kind==="existing"&&Object.keys(v).sort().join()==="folderId,kind")return {kind:"existing",folderId:uuid(v.folderId)};
  if(v.kind!=="create"||Object.keys(v).sort().join()!=="kind,levels,parentId"||!Array.isArray(v.levels)||v.levels.length<1||v.levels.length>CAPTURE_PATH_MAX_LEVELS)throw invalid();
  return {kind:"create",parentId:v.parentId===null?null:uuid(v.parentId),levels:v.levels.map(value=>{const name=normalizeCaptureLevel(value);if(name===null)throw invalid();return name;})};
}
export function previewInput(value:Record<string,unknown>):CapturePreviewInput {
  if(typeof value.keepDuplicate!=="boolean")throw invalid();
  return {version:integer(value.version),artifactId:uuid(value.artifactId),destination:destination(value.destination),keepDuplicate:value.keepDuplicate};
}
export function finalInput(value:Record<string,unknown>):CaptureFinalizeInput {
  const preview=previewInput(value);if(typeof value.previewToken!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(value.previewToken))throw invalid();
  return {...preview,previewToken:value.previewToken,idempotencyKey:uuid(value.idempotencyKey)};
}
export const previewHash=(id:string,input:CapturePreviewInput)=>digest(JSON.stringify([id,input.version,input.artifactId,input.destination,input.keepDuplicate]));
export const finalHash=(id:string,input:CaptureFinalizeInput)=>digest(JSON.stringify([previewHash(id,input),input.previewToken]));
