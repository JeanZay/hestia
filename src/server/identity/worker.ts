import { timingSafeEqual } from "node:crypto";
import { guarded, HttpError, response } from "../access";

type Dispatch = () => Promise<{ state: string }>;
export async function runMailBatch(dispatch: Dispatch) {
  const counts = { sent: 0, failed: 0, cancelled: 0 };
  // Four sequential requests, each provider request bounded to five seconds.
  const until = Date.now() + 25000;
  for (let n = 0; n < 4 && Date.now() < until; n++) {
    const { state } = await dispatch();
    if (state === "transport-unavailable") return { ...counts, available: false };
    if (state === "idle") break;
    if (state === "sent" || state === "failed" || state === "cancelled") counts[state]++;
    else throw new Error("MAIL_WORKER_UNAVAILABLE");
  }
  return { ...counts, available: true };
}

export function handleMailWorker(request: Request, secret: string | undefined,
  work: () => ReturnType<typeof runMailBatch>) {
  return guarded(async () => {
    if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Action indisponible.");
    if (new URL(request.url).search || !secret || secret.length < 32) throw new HttpError(404, "NOT_FOUND", "Action indisponible.");
    const supplied = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new HttpError(401, "UNAUTHENTICATED", "Authentification requise.");
    const counts = await work();
    return response(counts, !counts.available || counts.failed ? 503 : 200);
  });
}

/** The route registers Next after only after the handler has committed successfully. */
export async function withMailTrigger(request: Request, handle: () => Promise<Response>,
  after: (task: () => Promise<void>) => void, work: () => Promise<unknown>) {
  const result = await handle();
  if (request.method === "POST" && result.ok) {
    try {
      after(async () => { try { await work(); } catch { /* Durable outbox is resumed by the worker. */ } });
    } catch { /* Scheduling failure cannot reverse the committed business result. */ }
  }
  return result;
}
