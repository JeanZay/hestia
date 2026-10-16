import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { issueGrant, POLICY_LOCK_KEY } from "../../src/server/permissions/service";
import type { WorkspaceSnapshot } from "../../src/lib/workspace";

describe("workspace snapshots with real admission, transactions and rights", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw Error("Owned synthetic bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  let statements: string[] | null = null;
  pool.on("connect", client => {
    const query = client.query;
    client.query = ((...args: unknown[]) => {
      const first = args[0];
      if (statements) statements.push(typeof first === "string" ? first : String((first as { text?: string })?.text ?? ""));
      return Reflect.apply(query, client, args);
    }) as typeof client.query;
  });
  let storageCalls = 0;
  const unexpectedStorage = async (): Promise<never> => { storageCalls++; throw Error("Metadata must not request stored bytes"); };
  const app = createApplication(pool, config, { store: { put: unexpectedStorage, getRange: unexpectedStorage, delete: unexpectedStorage } });
  const users: { id: string; email: string; cookie: string }[] = [];
  const fixtureUploads: string[] = [];
  const password = "Synthetic workspace phrase only!";
  let root: string, left: string, right: string, reference: string, documentId: string;
  function req(path = "/api/hestia/workspace", options: { body?: unknown; user?: number; activity?: string; method?: string } = {}) {
    return new Request(config.origin + path, { method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: { origin: config.origin, cookie: users[options.user ?? 0]?.cookie ?? "", ...(options.activity === undefined ? {} : { "X-Hestia-Activity": options.activity }),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  }
  async function tx<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [POLICY_LOCK_KEY]);
      const value = await action(client); await client.query("COMMIT"); return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async function folder(name: string, parentId: string | null) {
    const result = await app.handleFolders(req("/api/hestia/folders", { body: { name, parentId, idempotencyKey: randomUUID() } }));
    expect(result.status).toBe(201); return (await result.json()).folder.id as string;
  }
  // Synthetic metadata only: neither fixtures nor this GET read any real file.
  async function documents(folderId: string, count = 1, title = "Échéance synthétique") {
    const upload = randomUUID();
    await pool.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,reservation_released)
      VALUES($1,$2,$3,$2,$1,repeat('a',64),$4,'synthetic.pdf','application/pdf',1,repeat('b',64),'import','cancelled',true)`, [upload, users[0].id, folderId, title]);
    fixtureUploads.push(upload);
    const rows = (await pool.query<{ id: string }>(`WITH ids AS (SELECT gen_random_uuid() AS id FROM generate_series(1,$4::int)),
      objects AS (INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready)
      SELECT 'workspace-synthetic/'||id,$1,'original',1,repeat('b',64),true FROM ids RETURNING object_key)
      INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported)
      SELECT split_part(object_key,'/',2)::uuid,$2,$3,$3,'Membre synthétique',$5,'synthetic.pdf','application/pdf',1,repeat('b',64),'import',object_key,true FROM objects RETURNING id`,
      [upload, folderId, users[0].id, count, title])).rows;
    return rows.map(row => row.id);
  }
  async function removeFixtureDocuments(ids?:string[]) {
    await tx(async client=>{
      // No bytes exist for these explicitly owned metadata fixtures. Preserve
      // the production FK cycle and remove both sides in one deferred commit.
      const selected=(await client.query<{id:string;content_id:string}>(`SELECT d.id,r.content_id FROM hestia_document d
        JOIN hestia_document_revision r ON r.document_id=d.id
        WHERE d.object_key IN(SELECT object_key FROM hestia_upload_object WHERE upload_id=ANY($1::uuid[]))
        AND ($2::uuid[] IS NULL OR d.id=ANY($2::uuid[]))`,[fixtureUploads,ids??null])).rows;
      const documentIds=[...new Set(selected.map(r=>r.id))],contentIds=selected.map(r=>r.content_id);
      await client.query('DELETE FROM hestia_content_summary WHERE content_id=ANY($1::uuid[])',[contentIds]);
      await client.query('DELETE FROM hestia_document_revision WHERE document_id=ANY($1::uuid[])',[documentIds]);
      await client.query('DELETE FROM hestia_document WHERE id=ANY($1::uuid[])',[documentIds]);
      await client.query('DELETE FROM hestia_content WHERE id=ANY($1::uuid[])',[contentIds]);
    });
  }
  async function snapshot(query = "", user = 0, activity?: string) {
    const result = await app.handleWorkspace(req("/api/hestia/workspace" + query, { user, activity }));
    expect(result.status).toBe(200); return await result.json() as WorkspaceSnapshot;
  }
  const grant = (folderId = root) => tx(client => issueGrant(client, users[0].id, folderId, { authorityId: reference, subject: users[1].id, capability: "consulter" }));
  const touched = async (user = 0) => (await pool.query(`SELECT p.touched_at FROM hestia_session_policy p JOIN session s ON s.id=p.session_id WHERE s."userId"=$1 ORDER BY p.started_at DESC LIMIT 1`, [users[user].id])).rows[0].touched_at as Date;
  beforeAll(async () => {
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();
    await migrateDatabase(pool, config);
    for (let index = 0; index < 3; index++) {
      const email = `workspace-${randomUUID()}@example.invalid`;
      users.push({ email, id: await provisionSyntheticMember(pool, { email, name: `Workspace synthétique ${index}`, password, role: index === 2 ? "admin" : "member" }), cookie: "" });
    }
  });
  beforeEach(async () => {
    for (const user of users) {
      await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
      const response = await app.handleAuth(req("/api/auth/sign-in/email", { body: { email: user.email, password } }));
      expect(response.status).toBe(200); user.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    }
    root = await folder(`Workspace ${randomUUID()}`, null); left = await folder("Dossier A", root); right = await folder("Dossier B", root);
    reference = (await pool.query("SELECT reference_grant_id FROM hestia_folder WHERE id=$1", [root])).rows[0].reference_grant_id;
    [documentId] = await documents(left); storageCalls = 0;
  });
  afterEach(async () => {
    // These records have no stored original. Remove only this case's metadata,
    // so the resource-limit corpus cannot consume another suite's cleanup budget.
    await removeFixtureDocuments();
    await pool.query("DELETE FROM hestia_upload_object WHERE upload_id=ANY($1::uuid[])", [fixtureUploads]);
    await pool.query("DELETE FROM hestia_upload WHERE id=ANY($1::uuid[])", [fixtureUploads]);
    fixtureUploads.length = 0;
  });
  afterAll(async () => { await pool.end(); });

  it("combines the same public projections as the four legacy reads in one transaction and one graph", async () => {
    const user = (await (await app.handleSession(req("/api/hestia/session"))).json()).user;
    const folders = (await (await app.handleFolders(req("/api/hestia/folders"))).json()).folders;
    const selectedFolder = (await (await app.handleFolder(req(`/api/hestia/folders/${left}`), left)).json()).folder;
    const oldDocuments = (await (await app.handleDocuments(req(`/api/hestia/documents?folderId=${left}`))).json()).documents;
    statements = [];
    let result: Response;
    try { result = await app.handleWorkspace(req(`/api/hestia/workspace?folderId=${left}`)); }
    finally { const captured = statements; statements = null;
      expect(captured.filter(sql => sql === "BEGIN")).toHaveLength(1);
      expect(captured.filter(sql => sql === "COMMIT")).toHaveLength(1);
      expect(captured.filter(sql => /FROM hestia_grant ORDER BY/.test(sql))).toHaveLength(1);
      expect(captured.some(sql => sql.includes("touched_at=clock_timestamp()"))).toBe(false);
    }
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toBe("Cookie");
    const body = await result.json();
    expect(body).toEqual({ user, folders, selectedFolder, documents: oldDocuments, now: expect.any(String) });
    expect(Number.isFinite(Date.parse(body.now))).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/object_key|workspace-synthetic|session_id|member_epoch/);
    expect(storageCalls).toBe(0);
  });
  it("loads no documents at home and searches global or selected visible metadata without accent sensitivity", async () => {
    const home = await snapshot(); expect(home.selectedFolder).toBeNull(); expect(home.documents).toEqual([]);
    expect((await snapshot("?q=echeance")).documents.map(document => document.id)).toContain(documentId);
    expect((await snapshot(`?folderId=${left}&q=ECHEANCE`)).documents.map(document => document.id)).toEqual([documentId]);
    expect((await snapshot(`?folderId=${right}&q=ECHEANCE`)).documents).toEqual([]);
    const foreign = await snapshot("?q=echeance", 2); expect(foreign.folders).toEqual([]); expect(foreign.documents).toEqual([]);
    expect(storageCalls).toBe(0);
  });
  it("does not disclose whether an unavailable selection exists and keeps the allowed inventory", async () => {
    await grant(right);
    const hidden = await snapshot(`?folderId=${left}&q=echeance`, 1);
    const absent = await snapshot(`?folderId=${randomUUID()}&q=echeance`, 1);
    expect({ ...hidden, now: null }).toEqual({ ...absent, now: null });
    expect(hidden.selectedFolder).toBeNull(); expect(hidden.documents).toEqual([]);
    expect(hidden.folders.map(folder => folder.id)).toContain(right);
    await pool.query("UPDATE hestia_folder SET trashed_at=clock_timestamp() WHERE id=$1", [left]);
    expect(await snapshot(`?folderId=${left}`)).toMatchObject({ selectedFolder: null, documents: [] });
  });
  it("rejects malformed, duplicated, unexpected and overlong parameters and activity values", async () => {
    for (const query of ["?folderId=", "?folderId=no", `?folderId=${left}&folderId=${right}`, "?q=x&q=y", "?trash=true", `?q=${"a".repeat(201)}`]) {
      expect((await app.handleWorkspace(req("/api/hestia/workspace" + query))).status).toBe(400);
    }
    for (const activity of ["passive", "true", "", "INTERACTIVE"]) expect((await app.handleWorkspace(req(undefined, { activity }))).status).toBe(400);
    expect((await app.handleWorkspace(req(undefined, { method: "POST" }))).status).toBe(405);
    expect((await app.handleWorkspace(req(undefined, { user: 99 }))).status).toBe(401);
  });
  it("keeps background reads passive and touches only explicit interaction, never reviving an idle session", async () => {
    await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '5 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
    const before = await touched(); await snapshot(`?folderId=${left}`); expect(await touched()).toEqual(before);
    await snapshot(`?folderId=${left}`, 0, "interactive"); expect((await touched()).getTime()).toBeGreaterThan(before.getTime());
    await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '31 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
    for (const activity of [undefined, "interactive"]) expect((await app.handleWorkspace(req(undefined, { activity }))).status).toBe(401);
  });
  it("checks session expiry again after waiting for the policy lock", async () => {
    await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '30 minutes'+interval '1 second' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
    const blocker = await pool.connect(); let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock($1)", [POLICY_LOCK_KEY]);
      pending = app.handleWorkspace(req(`/api/hestia/workspace?folderId=${left}`, { activity: "interactive" }));
      await blocker.query("SELECT pg_sleep(1.15)"); await blocker.query("COMMIT"); expect((await pending).status).toBe(401);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); if (pending) await pending; }
  });
  it("loads rights after lock wait and immediately excludes expired or revoked access", async () => {
    const id = await grant(left); expect((await snapshot(`?folderId=${left}`, 1)).documents).toHaveLength(1);
    const blocker = await pool.connect(); let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock($1)", [POLICY_LOCK_KEY]);
      await blocker.query("UPDATE hestia_grant SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1", [id]);
      pending = app.handleWorkspace(req(`/api/hestia/workspace?folderId=${left}`, { user: 1 }));
      await blocker.query("SELECT pg_sleep(1.15)"); await blocker.query("COMMIT");
      expect(await (await pending).json()).toMatchObject({ selectedFolder: null, documents: [] });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); if (pending) await pending; }
    await grant(right); expect((await snapshot(`?folderId=${right}`, 1)).selectedFolder?.id).toBe(right);
    await pool.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2", [right, users[1].id]);
    expect(await snapshot(`?folderId=${right}`, 1)).toMatchObject({ selectedFolder: null, documents: [] });
    await pool.query("UPDATE hestia_member SET epoch=epoch+1 WHERE user_id=$1", [users[1].id]);
    expect((await app.handleWorkspace(req(undefined, { user: 1 }))).status).toBe(401);
  });
  it("updates document and child counters on both parents after a confirmed move", async () => {
    const child = await folder("Enfant déplacé", left);
    for (const [kind, sourceId] of [["folder", child], ["document", documentId]] as const) {
      const input = { kind, sourceId, destinationId: right };
      const preview = await app.handleMovePreview(req("/api/hestia/move-preview", { body: input })); expect(preview.status).toBe(200);
      const reviewed = await preview.json(); expect(reviewed.allowed).toBe(true);
      const moved = await app.handleMove(req("/api/hestia/moves", { body: { ...input, previewToken: reviewed.previewToken, idempotencyKey: randomUUID() } })); expect(moved.status).toBe(200);
    }
    const state = await snapshot(`?folderId=${right}`);
    expect(state.folders.find(folder => folder.id === left)).toMatchObject({ childCount: 0, documentCount: 0, docCount: 0 });
    expect(state.selectedFolder).toMatchObject({ childCount: 1, documentCount: 1, docCount: 1 });
    expect(state.documents.map(document => document.id)).toEqual([documentId]);
  });
  // This volume-boundary check includes fixture triggers and cleanup, not a latency benchmark.
  it("preserves the bounded document listing failure without returning a truncated snapshot", async () => {
    const ids = await documents(right, 10001, "Batch synthétique borné");
    try {
      expect(ids).toHaveLength(10001);
      const result = await app.handleWorkspace(req(`/api/hestia/workspace?folderId=${right}`));
      expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { code: "RESOURCE_LIMIT" } });
    } finally { await removeFixtureDocuments(ids); }
  }, 60_000);
  it("supports protected minimal household counts and passive reads while preserving legacy defaults", async () => {
    for (const status of ["active", "removed"]) {
      const expected = Number((await pool.query("SELECT count(*) AS n FROM hestia_member WHERE active=$1", [status === "active"])).rows[0].n);
      const result = await app.handleMembers(req(`/api/hestia/members?summary=true&status=${status}`, { user: 2, activity: "passive" }));
      expect(result.status).toBe(200); expect(await result.json()).toEqual({ count: expected });
    }
    expect((await app.handleMembers(req("/api/hestia/members?summary=true"))).status).toBe(404);
    for (const query of ["summary=false", "summary=true&offset=0", "summary=true&limit=1", "summary=true&summary=true"]) {
      expect((await app.handleMembers(req("/api/hestia/members?" + query, { user: 2 }))).status).toBe(400);
    }
    await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '5 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[2].id]);
    const before = await touched(2);
    const reads = [app.handleMembers, app.handleUnmanagedFolders, app.handleInvitations, app.handleReadmissions];
    for (const read of reads) expect((await read(req("/api/hestia/household", { user: 2, activity: "passive" }))).status).toBe(200);
    expect(await touched(2)).toEqual(before);
    for (const read of reads) expect((await read(req("/api/hestia/household", { user: 2, activity: "invalid" }))).status).toBe(400);
    expect((await app.handleMembers(req("/api/hestia/members", { user: 2 }))).status).toBe(200);
    expect((await touched(2)).getTime()).toBeGreaterThan(before.getTime());
  });
  it("keeps automatic document and access panel reads passive without changing legacy interaction defaults", async () => {
    const reads = [
      (activity?: string) => app.handleDocuments(req(`/api/hestia/documents?folderId=${left}`, { activity })),
      (activity?: string) => app.handleDocuments(req(`/api/hestia/documents?folderId=${left}&trash=true`, { activity })),
      (activity?: string) => app.handleDocument(req(`/api/hestia/documents/${documentId}`, { activity }), documentId),
      (activity?: string) => app.handleFolderAccess(req(`/api/hestia/folders/${left}/access`, { activity }), left),
    ];
    await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '5 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
    const before = await touched();
    for (const read of reads) {
      expect((await read("passive")).status).toBe(200);
      expect(await touched()).toEqual(before);
      expect((await read("invalid")).status).toBe(400);
    }
    for (const read of reads) {
      await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '5 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
      const old = await touched(); expect((await read()).status).toBe(200);
      expect((await touched()).getTime()).toBeGreaterThan(old.getTime());
    }
    await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '31 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
    for (const read of reads) expect((await read("passive")).status).toBe(401);
  });
  it("keeps trash listing passive by default and permits passive preview tokens without making commits passive", async () => {
    const ageSession = async () => {
      await pool.query(`UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '5 minutes' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)`, [users[0].id]);
      return touched();
    };
    const old = await ageSession();
    for (const activity of [undefined, "passive"]) {
      expect((await app.handleTrashGroups(req("/api/hestia/trash", { activity }))).status).toBe(200);
      expect(await touched()).toEqual(old);
    }
    expect((await app.handleTrashGroups(req("/api/hestia/trash", { activity: "invalid" }))).status).toBe(400);
    expect((await app.handleTrashGroups(req("/api/hestia/trash", { activity: "interactive" }))).status).toBe(200);
    expect((await touched()).getTime()).toBeGreaterThan(old.getTime());
    const before = await ageSession();
    const preview = await app.handleFolderTrashPreview(req(`/api/hestia/folders/${right}/trash-preview`, { body: {}, activity: "passive" }), right);
    expect(preview.status).toBe(200); const planned = await preview.json(); expect(planned.allowed).toBe(true);
    expect(await touched()).toEqual(before);
    const token = (await pool.query("SELECT actor_id,expires_at FROM hestia_trash_preview WHERE token=$1", [planned.previewToken])).rows[0];
    expect(token.actor_id).toBe(users[0].id); expect(token.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect((await pool.query("SELECT trashed_at,version FROM hestia_folder WHERE id=$1", [right])).rows[0]).toEqual({ trashed_at: null, version: 1 });
    expect((await app.handleFolderTrashPreview(req(`/api/hestia/folders/${right}/trash-preview`, { body: {}, activity: "invalid" }), right)).status).toBe(400);
    expect((await app.handleFolderTrashPreview(req(`/api/hestia/folders/${right}/trash-preview`, { body: {} }), right)).status).toBe(200);
    expect((await touched()).getTime()).toBeGreaterThan(before.getTime());
    const preCommit = await ageSession();
    const committed = await app.handleFolderTrash(req(`/api/hestia/folders/${right}/trash`, { body: { previewToken: planned.previewToken, idempotencyKey: randomUUID() }, activity: "passive" }), right);
    expect(committed.status).toBe(200); expect((await touched()).getTime()).toBeGreaterThan(preCommit.getTime());
    const groups = await (await app.handleTrashGroups(req("/api/hestia/trash"))).json();
    const group = groups.groups.find((entry: { folderId: string }) => entry.folderId === right); expect(group).toBeTruthy();
    const preRestore = await ageSession();
    const restore = await app.handleFolderRestorePreview(req(`/api/hestia/trash/${group.id}/restore-preview`, { body: { destinationId: root }, activity: "passive" }), group.id);
    expect(restore.status).toBe(200); const restored = await restore.json(); expect(restored.allowed).toBe(true);
    expect(await touched()).toEqual(preRestore);
    expect((await pool.query("SELECT status FROM hestia_trash_group WHERE id=$1", [group.id])).rows[0].status).toBe("trashed");
    expect((await app.handleFolderRestorePreview(req(`/api/hestia/trash/${group.id}/restore-preview`, { body: { destinationId: root }, activity: "invalid" }), group.id)).status).toBe(400);
    expect((await app.handleFolderRestorePreview(req(`/api/hestia/trash/${group.id}/restore-preview`, { body: { destinationId: root } }), group.id)).status).toBe(200);
    expect((await touched()).getTime()).toBeGreaterThan(preRestore.getTime());
    const priorRestoreCommit = await ageSession();
    expect((await app.handleFolderRestore(req(`/api/hestia/trash/${group.id}/restore`, { body: { destinationId: root, previewToken: restored.previewToken, idempotencyKey: randomUUID() }, activity: "passive" }), group.id)).status).toBe(200);
    expect((await touched()).getTime()).toBeGreaterThan(priorRestoreCommit.getTime());
  });
});
