import { createHash } from "node:crypto";
import { HttpError, invalid, isUuid, textField } from "../access";
import type { CaptureCrop, CaptureDestination, CaptureFinalizeInput, CapturePreviewInput } from "../../shared/capture-contract";
export const digest=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
export const conflict=(code:string,message:string)=>new HttpError(409,code,message);
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
  if(v.kind!=="create"||Object.keys(v).sort().join()!=="kind,levels,parentId"||!Array.isArray(v.levels)||v.levels.length<1||v.levels.length>20)throw invalid();
  return {kind:"create",parentId:uuid(v.parentId),levels:v.levels.map(name=>textField(name,120))};
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
