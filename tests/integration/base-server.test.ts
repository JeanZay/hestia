import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";

describe("persistent member admission and private folders", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)) {
    throw new Error("Integration tests require an isolated local hestia_test_ database");
  }
  const pool = new Pool({ connectionString: config.databaseUrl, max: 6 });
  const app = createApplication(pool, config);
  const password = "Synthetic integration phrase only!";
  const suffix = randomUUID();
  const email = `camille-${suffix}@example.invalid`;
  const outsiderEmail = `admin-${suffix}@example.invalid`;
  let userId: string, outsiderId: string, cookie: string, outsiderCookie: string, folderId: string;
  function request(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
    const headers = new Headers({ origin: options.origin ?? config.origin });
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return new Request(config.origin + path, { method: options.method ?? (options.body === undefined ? "GET" : "POST"), headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  }
  async function login(loginEmail = email) {
    const result = await app.handleAuth(request("/api/auth/sign-in/email", { body: { email: loginEmail, password } }));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.token).toBeUndefined();
    return { result, cookie: result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  }
  beforeAll(async () => {
    await migrateDatabase(pool, config);
    await migrateDatabase(pool, config); // replay is non-destructive
    userId = await provisionSyntheticMember(pool, { email, name: "Camille Synthétique", password });
    outsiderId = await provisionSyntheticMember(pool, { email: outsiderEmail, name: "Admin Synthétique", password, role: "admin" });
    cookie = (await login()).cookie;
    outsiderCookie = (await login(outsiderEmail)).cookie;
  }, 30000);
  beforeEach(async () => {
    // Independent cases begin outside the persisted limiter window. The limiter
    // remains enabled, and its real threshold is exercised below without resets.
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
  });
  afterAll(async () => { await pool.end(); });

  it("accepts a verified admitted member with an HttpOnly cookie and no private caching", async () => {
    const result = await app.handleSession(request("/api/hestia/session", { cookie }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ user: { id: userId, name: "Camille Synthétique", email, role: "member" } });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const signIn = await login();
    expect(signIn.result.headers.getSetCookie().some(value => /HttpOnly/i.test(value))).toBe(true);
    expect(signIn.result.headers.getSetCookie().some(value => /SameSite=Lax/i.test(value))).toBe(true);
  });
  it("denies anonymous and forged sessions", async () => {
    for (const value of [undefined, "better-auth.session_token=forged"]) {
      expect((await app.handleSession(request("/api/hestia/session", { cookie: value }))).status).toBe(401);
      expect((await app.handleFolders(request("/api/hestia/folders", { cookie: value }))).status).toBe(401);
    }
  });
  it("closes signup, raw session lookup and unrelated auth routes", async () => {
    for (const path of ["/sign-up/email", "/get-session", "/update-user", "/sign-in/email?redirect=x"]) {
      expect((await app.handleAuth(request("/api/auth" + path, { body: {}, cookie }))).status).toBe(404);
    }
    expect((await app.handleAuth(request("/api/auth/sign-in/email", { body: { email, password }, origin: "https://hostile.invalid" }))).status).toBe(403);
  });
  it("enforces the real sign-in rate limit, including wrong passwords", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      statuses.push((await app.handleAuth(request("/api/auth/sign-in/email", { body: { email, password: "Incorrect synthetic password" } }))).status);
    }
    expect(statuses).toEqual([401,401,401,429]);
  });
  it("creates one durable private folder and exactly seven explicit grants atomically", async () => {
    const result = await app.handleFolders(request("/api/hestia/folders", { body: { name: "  Appareils  " }, cookie }));
    expect(result.status).toBe(201);
    const { folder } = await result.json();
    folderId = folder.id;
    expect(folder).toMatchObject({ name: "Appareils", version: 1, documentCount: 0 });
    expect([...folder.capabilities].sort()).toEqual(["consulter", "déposer", "modifier", "supprimer", "partager", "exporter", "administrer"].sort());
    const grants = await pool.query("SELECT user_id,kind,capability FROM hestia_grant WHERE folder_id=$1", [folderId]);
    expect(grants.rowCount).toBe(7);
    expect(grants.rows.every(row => row.user_id === userId)).toBe(true);
    expect(grants.rows.filter(row => row.kind === "reference")).toEqual([{ user_id: userId, kind: "reference", capability: "administrer" }]);
    const reconnected = await login();
    const separatePool = new Pool({ connectionString: config.databaseUrl });
    try {
      const otherProcess = createApplication(separatePool, config);
      const list = await otherProcess.handleFolders(request("/api/hestia/folders", { cookie: reconnected.cookie }));
      expect((await list.json()).folders.some((entry: { id: string }) => entry.id === folderId)).toBe(true);
    } finally { await separatePool.end(); }
  });
  it("never gives a global admin implicit read or modification rights", async () => {
    const list = await app.handleFolders(request("/api/hestia/folders", { cookie: outsiderCookie }));
    expect(await list.json()).toEqual({ folders: [] });
    const hidden = await app.handleFolder(request("/api/hestia/folders/" + folderId, { method: "PATCH", body: { name: "Intrusion", version: 1 }, cookie: outsiderCookie }), folderId);
    expect(hidden.status).toBe(404);
    const absent = await app.handleFolder(request("/api/hestia/folders/" + randomUUID(), { method: "PATCH", body: { name: "Intrusion", version: 1 }, cookie: outsiderCookie }), randomUUID());
    expect(await hidden.json()).toEqual(await absent.json());
    expect(outsiderId).not.toBe(userId);
  });
  it("rolls back the folder and every earlier grant when grant persistence fails", async () => {
    await pool.query(`CREATE FUNCTION hestia_test_fail_grant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.capability='modifier' AND EXISTS(SELECT 1 FROM hestia_folder WHERE id=NEW.folder_id AND name='Atomic rollback synthetic') THEN
          RAISE EXCEPTION 'synthetic write failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER hestia_test_fail_grant BEFORE INSERT ON hestia_grant FOR EACH ROW EXECUTE FUNCTION hestia_test_fail_grant()`);
    try {
      const result = await app.handleFolders(request("/api/hestia/folders", { cookie, body: { name: "Atomic rollback synthetic" } }));
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ error: { code: "UNAVAILABLE", message: "Service momentanément indisponible. Réessayez." } });
      expect((await pool.query("SELECT id FROM hestia_folder WHERE name='Atomic rollback synthetic'")).rowCount).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER hestia_test_fail_grant ON hestia_grant; DROP FUNCTION hestia_test_fail_grant()");
    }
  });
  it("requires both consulter and modifier; administrer adds no hidden read", async () => {
    await pool.query("UPDATE hestia_grant SET revoked_at=now() WHERE folder_id=$1 AND capability='consulter'", [folderId]);
    const list = await app.handleFolders(request("/api/hestia/folders", { cookie }));
    expect(await list.json()).toEqual({ folders: [] });
    expect((await app.handleFolder(request("/api/hestia/folders/" + folderId, { method: "PATCH", body: { name: "Invisible", version: 1 }, cookie }), folderId)).status).toBe(404);
    await expect(pool.query("UPDATE hestia_grant SET revoked_at=NULL WHERE folder_id=$1", [folderId])).rejects.toMatchObject({ code: "23514" });
    await pool.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,author_id,subject_epoch)
      SELECT $1,$2,$3,'consulter','direct',$3,departure_epoch FROM hestia_member WHERE user_id=$3`, [randomUUID(),folderId,userId]);
    await pool.query("UPDATE hestia_grant SET expires_at=now()-interval '1 second' WHERE folder_id=$1 AND capability='modifier'", [folderId]);
    expect((await app.handleFolder(request("/api/hestia/folders/" + folderId, { method: "PATCH", body: { name: "Forbidden", version: 1 }, cookie }), folderId)).status).toBe(404);
    await pool.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,author_id,subject_epoch)
      SELECT $1,$2,$3,'modifier','direct',$3,departure_epoch FROM hestia_member WHERE user_id=$3`, [randomUUID(),folderId,userId]);
  });
  it("serializes concurrent renames with optimistic conflict detection", async () => {
    const update = (name: string) => app.handleFolder(request("/api/hestia/folders/" + folderId, { method: "PATCH", body: { name, version: 1 }, cookie }), folderId);
    const results = await Promise.all([update("Factures"), update("Garanties")]);
    expect(results.map(result => result.status).sort()).toEqual([200,409]);
    const row = (await pool.query("SELECT name,version FROM hestia_folder WHERE id=$1", [folderId])).rows[0];
    expect(row.version).toBe(2);
    expect(["Factures", "Garanties"]).toContain(row.name);
  });
  it("rejects malformed names, unexpected authority fields and cross-origin writes", async () => {
    for (const body of [{ name: " " }, { name: "a".repeat(121) }, { name: "Nom", userId: outsiderId }, { name: "\u0000" }]) {
      expect((await app.handleFolders(request("/api/hestia/folders", { body, cookie }))).status).toBe(400);
    }
    expect((await app.handleFolders(request("/api/hestia/folders", { body: { name: "Cross origin" }, cookie, origin: "https://hostile.invalid" }))).status).toBe(403);
    const tooLarge = new Request(config.origin + "/api/hestia/folders", { method: "POST", headers: { origin: config.origin, "content-type": "application/json", cookie }, body: JSON.stringify({ name: "x".repeat(5000) }) });
    expect((await app.handleFolders(tooLarge)).status).toBe(400);
    expect((await app.handleFolder(request("/api/hestia/folders/" + folderId, { method: "PATCH", body: { name: "Name", version: Number.MAX_SAFE_INTEGER }, cookie }), folderId)).status).toBe(400);
  });
  it("denies admission removal and invalidates sessions across re-admission epochs", async () => {
    await pool.query("UPDATE hestia_member SET active=false,epoch=epoch+1 WHERE user_id=$1", [userId]);
    expect((await app.handleSession(request("/api/hestia/session", { cookie }))).status).toBe(401);
    expect((await app.handleAuth(request("/api/auth/sign-in/email", { body: { email, password } }))).status).toBe(401);
    await pool.query("UPDATE hestia_member SET active=true WHERE user_id=$1", [userId]);
    expect((await app.handleSession(request("/api/hestia/session", { cookie }))).status).toBe(401);
    cookie = (await login()).cookie;
  });
  it("enforces idle and absolute expiry from server state", async () => {
    const before = await pool.query("SELECT session_id,touched_at FROM hestia_session_policy WHERE session_id IN (SELECT id FROM session WHERE \"userId\"=$1) ORDER BY session_id", [userId]);
    expect((await app.handleSession(request("/api/hestia/session", { cookie }))).status).toBe(200);
    const after = await pool.query("SELECT session_id,touched_at FROM hestia_session_policy WHERE session_id IN (SELECT id FROM session WHERE \"userId\"=$1) ORDER BY session_id", [userId]);
    expect(after.rows).toEqual(before.rows);
    await pool.query("UPDATE hestia_session_policy SET touched_at=now()-interval '31 minutes' WHERE session_id IN (SELECT id FROM session WHERE \"userId\"=$1)", [userId]);
    expect((await app.handleSession(request("/api/hestia/session", { cookie }))).status).toBe(401);
    cookie = (await login()).cookie;
    await pool.query("UPDATE hestia_session_policy SET started_at=now()-interval '13 hours' WHERE session_id IN (SELECT id FROM session WHERE \"userId\"=$1)", [userId]);
    expect((await app.handleSession(request("/api/hestia/session", { cookie }))).status).toBe(401);
    cookie = (await login()).cookie;
  });
  it("revokes a signed-out session even when its earlier cookie is replayed", async () => {
    const logout = await app.handleAuth(request("/api/auth/sign-out", { body: {}, cookie }));
    expect(logout.status).toBe(200);
    expect((await app.handleSession(request("/api/hestia/session", { cookie }))).status).toBe(401);
  });
});

