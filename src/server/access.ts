import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import type { createAuth } from "./auth/options";
import type { ServerConfig } from "./config";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const unavailable = () => new HttpError(404, "NOT_FOUND", "Ressource indisponible.");
export const unauthenticated = () => new HttpError(401, "UNAUTHENTICATED", "Veuillez vous reconnecter.");
export const invalid = () => new HttpError(400, "INVALID_INPUT", "Vérifiez les informations saisies.");
export const response = (data: unknown, status = 200, extra?: Headers) => {
  const headers = privateHeaders(extra);
  return Response.json(data, { status, headers });
};
export function privateHeaders(extra?: Headers) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store"); headers.set("Vary", "Cookie");
  headers.set("X-Content-Type-Options", "nosniff"); return headers;
}
export async function guarded(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof HttpError) return response({ error: { code: error.code, message: error.message } }, error.status);
    return response({ error: { code: "UNAVAILABLE", message: "Service momentanément indisponible. Réessayez." } }, 503);
  }
}
export async function bodyBytes(request: Request, limit: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw invalid(); }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
export async function json(request: Request, keys: string[]) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw invalid();
  try {
    const value: unknown = JSON.parse((await bodyBytes(request, 4096)).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
    return value as Record<string, unknown>;
  } catch { throw invalid(); }
}
export function textField(value: unknown, maximum: number) {
  if (typeof value !== "string") throw invalid();
  const result = value.trim();
  if (!result || [...result].length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw invalid();
  return result;
}
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export type Actor = { id: string; name: string; email: string };
export function createAccess(pool: Pool, config: ServerConfig, auth: ReturnType<typeof createAuth>) {
  const connection = new AsyncLocalStorage<PoolClient>();
  const signatures = new WeakMap<Request, ReturnType<typeof auth.api.getSession>>();
  function origin(request: Request) {
    if (request.headers.get("origin") !== config.origin) throw new HttpError(403, "FORBIDDEN", "Origine de la requête refusée.");
  }
  async function transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const bound = connection.getStore();
    const client = bound ?? await pool.connect();
    try {
      await client.query("BEGIN");
      // Shared with statement triggers in 003-access. Acquire before members,
      // sessions, budgets and folders so ancestry checks cannot deadlock.
      await client.query("SELECT pg_advisory_xact_lock(480519001)");
      const result = await action(client); await client.query("COMMIT"); return result;
    }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { if (!bound) client.release(); }
  }
  async function withActor<T>(request: Request, action: (client: PoolClient, actor: Actor) => Promise<T>, touch = true) {
    // A request signature is checked once; authoritative admission/session rows
    // are still rechecked in every transaction, including after remote I/O.
    let signature = signatures.get(request);
    if (!signature) { signature = auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } }); signatures.set(request, signature); }
    const signed = await signature;
    if (!signed) throw unauthenticated();
    return transaction(async client => {
      const member = await client.query("SELECT active,epoch FROM hestia_member WHERE user_id=$1 FOR UPDATE", [signed.user.id]);
      if (!member.rows[0]?.active) throw unauthenticated();
      const session = await client.query(`SELECT s.id FROM session s JOIN hestia_session_policy p ON p.session_id=s.id
        WHERE s.id=$1 AND s."userId"=$2 AND s."expiresAt">clock_timestamp()
          AND p.member_epoch=$3 AND p.started_at > clock_timestamp()-interval '12 hours'
          AND p.touched_at > clock_timestamp()-interval '30 minutes' FOR UPDATE OF s,p`, [signed.session.id,signed.user.id,member.rows[0].epoch]);
      if (!session.rowCount) throw unauthenticated();
      if (touch) await client.query("UPDATE hestia_session_policy SET touched_at=clock_timestamp() WHERE session_id=$1", [signed.session.id]);
      return action(client, { id: signed.user.id, name: signed.user.name, email: signed.user.email });
    });
  }
  return { origin, transaction, withActor, currentClient: () => connection.getStore(), usingClient: <T>(client: PoolClient, action: () => Promise<T>) => connection.run(client, action) };
}
export type Access = ReturnType<typeof createAccess>;



