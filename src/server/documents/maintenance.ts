import { timingSafeEqual } from "node:crypto";
import { guarded, HttpError, response } from "../access";

type Maintenance = {
  cleanupTrash: (limit: number) => Promise<{purged:number;failed:number}>;
  cleanupUploads: (limit: number, maxObjects: number) => Promise<{cleaned:number}>;
};
/** Internal scheduler authentication is separate from family sessions. */
export function handleMaintenance(request: Request, secret: string | undefined, application: () => Maintenance) {
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
    return response({trash,uploads},trash.failed ? 503 : 200);
  });
}
