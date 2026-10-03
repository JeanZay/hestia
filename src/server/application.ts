import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createAuth } from "./auth/options";
import type { ServerConfig } from "./config";
import { CAPABILITIES } from "./permissions/capabilities";

import { createAccess, HttpError, unavailable, unauthenticated, invalid, response, guarded, json, textField, type Actor } from "./access";
import { createDocuments, type DocumentDependencies } from "./documents/service";
const folderName = (value: unknown) => textField(value, 120);
type Folder = { id: string; name: string; version: number; capabilities: string[]; documentCount: number };

export function createApplication(pool: Pool, config: ServerConfig, dependencies?: DocumentDependencies) {
  const auth = createAuth(pool, config);
  const access = createAccess(pool, config, auth);
  const { origin, transaction, withActor } = access;
  async function foldersFor(client: PoolClient, actor: Actor, id?: string): Promise<Folder[]> {
    const found = await client.query(`SELECT f.id,f.name,f.version,(SELECT count(*) FROM hestia_document d WHERE d.folder_id=f.id AND d.trashed_at IS NULL AND d.purged_at IS NULL) AS document_count,
      array_agg(DISTINCT g.capability ORDER BY g.capability) AS capabilities
      FROM hestia_folder f JOIN hestia_grant g ON g.folder_id=f.id
      WHERE g.user_id=$1 AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
        AND ($2::uuid IS NULL OR f.id=$2::uuid)
      GROUP BY f.id HAVING bool_or(g.capability='consulter')
      ORDER BY f.created_at,f.id`, [actor.id,id ?? null]);
    return found.rows.map(row => ({ id: row.id, name: row.name, version: row.version, capabilities: row.capabilities, documentCount: Number(row.document_count) }));
  }
  function handleAuth(request: Request) {
    return guarded(async () => {
      const url = new URL(request.url);
      const login = url.pathname === "/api/auth/sign-in/email";
      const logout = url.pathname === "/api/auth/sign-out";
      if (url.search || request.method !== "POST" || (!login && !logout)) throw new HttpError(404, "NOT_FOUND", "Action indisponible.");
      origin(request);
      const input = await json(request, login ? ["email", "password"] : []);
      if (login && (typeof input.email !== "string" || typeof input.password !== "string"
        || input.email.length > 254 || input.password.length > 128)) throw invalid();
      const email = login ? (input.email as string).trim().toLowerCase() : "";
      const before = login ? (await pool.query(`SELECT m.user_id,m.active,m.epoch FROM hestia_member m
        JOIN "user" u ON u.id=m.user_id WHERE u.email=$1`, [email])).rows[0] : null;
      const next = new Request(request.url, { method: "POST", headers: request.headers,
        body: JSON.stringify(login ? { email, password: input.password, rememberMe: false } : {}) });
      const result = await auth.handler(next);
      if (!result.ok) {
        if (result.status === 429) throw new HttpError(429, "RATE_LIMITED", "Trop de tentatives. Réessayez plus tard.");
        throw new HttpError(401, "INVALID_CREDENTIALS", "Adresse ou mot de passe incorrect.");
      }
      if (logout) return response({ success: true }, 200, result.headers);
      const cookie = result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      const session = await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
      if (!session) throw unauthenticated();
      const admitted = await transaction(async client => {
        const current = (await client.query("SELECT active,epoch FROM hestia_member WHERE user_id=$1 FOR UPDATE", [session.user.id])).rows[0];
        if (!before?.active || before.user_id !== session.user.id || !current?.active || before.epoch !== current.epoch) {
          await client.query("DELETE FROM session WHERE id=$1", [session.session.id]);
          return false;
        }
        await client.query("INSERT INTO hestia_session_policy(session_id,member_epoch) VALUES($1,$2)", [session.session.id,current.epoch]);
        return true;
      });
      if (!admitted) throw new HttpError(401, "INVALID_CREDENTIALS", "Adresse ou mot de passe incorrect.");
      return response({ user: { id: session.user.id, name: session.user.name, email: session.user.email } }, 200, result.headers);
    });
  }
  function handleSession(request: Request) {
    // Background admission polling must not keep an idle browser signed in.
    return guarded(async () => response({ user: await withActor(request, async (_client, actor) => actor, false) }));
  }
  function handleFolders(request: Request) {
    return guarded(async () => {
      if (request.method === "GET") return response({ folders: await withActor(request, foldersFor) });
      if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Action indisponible.");
      origin(request);
      const name = folderName((await json(request, ["name"])).name);
      const folder = await withActor(request, async (client, actor) => {
        const id = randomUUID();
        await client.query("INSERT INTO hestia_folder(id,name,created_by) VALUES($1,$2,$3)", [id,name,actor.id]);
        for (const capability of CAPABILITIES) {
          await client.query("INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(),id,actor.id,capability,capability === "administrer" ? "reference" : "direct"]);
        }
        return (await foldersFor(client, actor, id))[0];
      });
      return response({ folder }, 201);
    });
  }
  function handleFolder(request: Request, id: string) {
    return guarded(async () => {
      origin(request);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw unavailable();
      const input = await json(request, ["name", "version"]), name = folderName(input.name);
      if (!Number.isSafeInteger(input.version) || (input.version as number) < 1
        || (input.version as number) > 2_147_483_647) throw invalid();
      const folder = await withActor(request, async (client, actor) => {
        await client.query("SELECT id FROM hestia_folder WHERE id=$1 FOR UPDATE", [id]);
        const current = (await foldersFor(client, actor, id))[0];
        if (!current || !current.capabilities.includes("modifier")) throw unavailable();
        const updated = await client.query("UPDATE hestia_folder SET name=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND version=$3 RETURNING version", [name,id,input.version]);
        if (!updated.rowCount) throw new HttpError(409, "VERSION_CONFLICT", "Ce dossier a changé. Actualisez-le avant de réessayer.");
        return { ...current, name, version: updated.rows[0].version };
      });
      return response({ folder });
    });
  }
  return { handleAuth, handleSession, handleFolders, handleFolder, ...createDocuments(pool, access, dependencies) };
}


