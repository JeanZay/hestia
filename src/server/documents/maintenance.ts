import { DEFAULT_CLASSIFICATION_LIMITS } from '../classification/types';
import { timingSafeEqual } from "node:crypto";
import { guarded, HttpError, response } from "../access";

type Maintenance = {
  cleanupTrash: (limit: number) => Promise<{purged:number;failed:number}>;
  cleanupUploads: (limit: number, maxObjects: number) => Promise<{cleaned:number}>;
  cleanupCaptures: (limit: number, maxObjects: number) => Promise<{cleaned:number;failed:number}>;
  cleanupClassification: (limit: number) => Promise<{cleaned:number}>;
  cleanupVersions?: (limit:number,maxObjects:number)=>Promise<{cleaned:number;failed:number}>;
  cleanup?:()=>Promise<unknown>;
  cleanupSummary?:(limit:number)=>Promise<unknown>;
  runSummaryBatch?:(limit:number,budgetMs:number)=>Promise<unknown>;
  runAcknowledgements?:()=>Promise<unknown>;
  cleanupOutgoing?:(limit:number)=>Promise<unknown>;
};
/** Internal scheduler authentication is separate from family sessions. */
export function handleMaintenance(request: Request, secret: string | undefined, application: () => Maintenance) {
  const began=performance.now(),remaining=()=>50000-(performance.now()-began);
  return guarded(async () => {
    if (request.method!=="GET") throw new HttpError(405,"METHOD_NOT_ALLOWED","Action indisponible.");
    if (!secret || secret.length<32) throw new HttpError(404,"NOT_FOUND","Action indisponible.");
    const supplied=Buffer.from(request.headers.get("authorization") ?? ""), expected=Buffer.from(`Bearer ${secret}`);
    if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected))
      throw new HttpError(401,"UNAUTHENTICATED","Authentification requise.");
    const app=application();
    // Bounded work; a crash/retry resumes from the durable object ledger.
    const trash=await app.cleanupTrash(20);
    const uploads=await app.cleanupUploads(20,100);
    const captures=await app.cleanupCaptures(20,100);
    const classification=await app.cleanupClassification(100);
    const versions=await app.cleanupVersions?.(20,100);
    const inbox=await app.cleanup?.();
    const summaryCleanup=await app.cleanupSummary?.(100);
    const outgoing=remaining()>2000?await app.cleanupOutgoing?.(100):undefined;
    const acknowledgements=remaining()>6000?await app.runAcknowledgements?.():undefined;
    const summaries=remaining()>DEFAULT_CLASSIFICATION_LIMITS.requestTimeoutMs?await app.runSummaryBatch?.(4,Math.min(35000,remaining())):undefined;
    return response({trash,uploads,captures,classification,versions,inbox,summaryCleanup,outgoing,summaries,acknowledgements},trash.failed || captures.failed || versions?.failed ? 503 : 200);
  });
}
