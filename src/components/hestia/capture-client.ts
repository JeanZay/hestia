import type { CaptureDto, CapturePageReservationDto, CaptureMediaType } from "../../shared/capture-contract";

export class CaptureError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type CaptureJob = { priority: "read" | "write"; start: () => Promise<void> };
type CaptureQueue = { running: boolean; jobs: CaptureJob[] };
const captureQueues = new Map<string, CaptureQueue>();
/** One operation at a time per aggregate. Writes pass queued previews, never the
 * active request. Aborted queued reads own no bytes and are removed immediately. */
function captureTurn<T>(captureId:string, signal:AbortSignal, priority:"read"|"write", task:()=>Promise<T>):Promise<T> {
  const queue=captureQueues.get(captureId)||{running:false,jobs:[]};captureQueues.set(captureId,queue);
  const result=new Promise<T>((resolve,reject)=>{
    const cancel=()=>{const index=queue.jobs.indexOf(job);if(index>=0){queue.jobs.splice(index,1);signal.removeEventListener("abort",cancel);reject(signal.reason);}};
    const job:CaptureJob={priority,start:async()=>{signal.removeEventListener("abort",cancel);try{signal.throwIfAborted();resolve(await task());}catch(error){reject(error);}}};
    const nextRead=priority==="write"?queue.jobs.findIndex(j=>j.priority==="read"):-1;
    if(nextRead<0)queue.jobs.push(job);else queue.jobs.splice(nextRead,0,job);
    signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();
  });
  if(!queue.running){queue.running=true;void (async()=>{while(queue.jobs.length)await queue.jobs.shift()!.start();queue.running=false;if(captureQueues.get(captureId)===queue)captureQueues.delete(captureId);})();}
  return result;
}
export async function captureRequest<T>(path: string, signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
  const send=async()=>{
    const response = await fetch('/api/hestia'+path, { method, signal:AbortSignal.any([signal,AbortSignal.timeout(100_000)]), credentials: "same-origin", cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CaptureError(response.status, data?.error?.code || "UNAVAILABLE", data?.error?.message || "L’action n’a pas pu aboutir. Réessayez.");
    return data as T;
  };
  // Analyze is deliberately outside this queue: a waiting provider must never
  // delay choosing a destination, previewing rights or recording manually.
  const aggregate=path.match(/^\/capture\/([^/?]+)(?:\/(?:pages(?:\/[^/?]+\/complete)?|prepare|preview|finalize))?$/)?.[1];
  return method!=="GET"&&aggregate ? captureTurn(aggregate,signal,"write",send) : send();
}
export type PendingPage = { file: File; key: string; hash?: string; reservation?: CapturePageReservationDto; replacePageId?: string };
export async function uploadCapturePage(capture: CaptureDto, pending: PendingPage, signal: AbortSignal, progress: (value: number) => void) {
  if (pending.file.size > 20 * 1024 * 1024 || !pending.file.size) throw new Error("Le fichier doit contenir entre 1 octet et 20 Mio.");
  pending.hash ??= Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await pending.file.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
  signal.throwIfAborted();
  const mediaType = pending.file.type || ({pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif"}[pending.file.name.split(".").pop()?.toLowerCase() || ""]);
  // A prior completion may have committed before its response was lost. Ask
  // the idempotent completion endpoint before replaying already purged chunks.
  if (pending.reservation) {
    try {
      const saved = await captureRequest<{capture:CaptureDto}>(`/capture/${capture.id}/pages/${pending.reservation.upload.id}/complete`, signal, "POST", {version:pending.reservation.captureVersion});
      progress(100); return saved.capture;
    } catch (error) {
      if (!(error instanceof CaptureError) || error.code !== "INCOMPLETE_UPLOAD") throw error;
    }
  }
  pending.reservation ??= await captureRequest<CapturePageReservationDto>(`/capture/${capture.id}/pages`, signal, "POST", { version: capture.version, idempotencyKey: pending.key, fileName: pending.file.name, mediaType: mediaType as CaptureMediaType, size: pending.file.size, sha256: pending.hash, replacePageId: pending.replacePageId });
  const { upload, captureVersion } = pending.reservation;
  for (let offset = 0, index = 0; offset < pending.file.size; offset += upload.chunkSize, index++) {
    const response = await captureTurn(capture.id,signal,"write",()=>fetch(`/api/hestia/capture/${capture.id}/pages/${upload.id}/chunks/${index}`, { method: "PUT", credentials: "same-origin", cache: "no-store", signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]), headers: { "Content-Type": "application/octet-stream" }, body: pending.file.slice(offset, offset + upload.chunkSize) }));
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new CaptureError(response.status, data?.error?.code || "UPLOAD_FAILED", data?.error?.message || "Envoi interrompu. Cette page n’est pas encore confirmée."); }
    progress(Math.round(Math.min(offset + upload.chunkSize, pending.file.size) / pending.file.size * 100));
  }
  return (await captureRequest<{capture: CaptureDto}>(`/capture/${capture.id}/pages/${upload.id}/complete`, signal, "POST", { version: captureVersion })).capture;
}

// No image bytes are fetched until this preview's turn starts.
export async function captureBlob(captureId: string, selector: {pageId: string} | {artifactId: string}, signal: AbortSignal): Promise<Blob> {
  return captureTurn(captureId,signal,"read",()=>readCaptureBlob(captureId,selector,signal));
}
/** Authenticated bounded reads. No public/object-store URL enters the browser. */
async function readCaptureBlob(captureId: string, selector: {pageId: string} | {artifactId: string}, signal: AbortSignal): Promise<Blob> {
  const chunks: ArrayBuffer[] = []; let offset = 0, total = 20 * 1024 * 1024, type = "";
  while (offset < total) {
    const query = new URLSearchParams({ ...selector, offset: String(offset), length: String(Math.min(2 * 1024 * 1024, total - offset)) });
    const response = await fetch(`/api/hestia/capture/${captureId}/content?${query}`, { credentials: "same-origin", cache: "no-store", signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]) });
    if (!response.ok) throw new CaptureError(response.status, "PREVIEW_FAILED", "Aperçu indisponible. Actualisez les pages avant de poursuivre.");
    const range = response.headers.get("Content-Range")?.match(/bytes (\d+)-(\d+)\/(\d+)/);
    const bytes = await response.arrayBuffer();
    if (!range || Number(range[1]) !== offset || Number(range[2]) + 1 !== offset + bytes.byteLength || !bytes.byteLength || Number(range[3]) > 20 * 1024 * 1024) throw new Error("Aperçu indisponible.");
    total = Number(range[3]); type = response.headers.get("Content-Type") || "application/octet-stream";
    chunks.push(bytes); offset += bytes.byteLength;
  }
  return new Blob(chunks, {type});
}
