import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import type { TranscriptionPayload } from "../../src/server/transcription/types";
import type { OutgoingDraftDto } from "../../src/shared/outgoing-contract";
import { createObjectStore } from "../../src/server/storage";

function wav() {
  const value = Buffer.alloc(32044); value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVEfmt ", 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write("data", 36); value.writeUInt32LE(32000, 40); return value;
}

describe("private outgoing dictation on owned SQL", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw Error("Owned synthetic bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  let calls: TranscriptionPayload[], outcome: () => Promise<{ text: string; actualMicros: number | null }>;
  const readFolders = vi.fn(async () => { throw Error("Outgoing must never read document vocabulary"); });
  const app = createApplication(pool, config, { store: createObjectStore(), transcription: { readAuthorizedFolders: readFolders,
    providers: [{ id: "fixture", mode: "synthetic", label: "Fixture", models: [{ id: "fixture", label: "Fixture", vocabularySupported: true }],
      quote: () => ({ maximumMicros: 100, currency: "EUR" }),
      async transcribe(_config, payload) { calls.push(payload); return outcome(); } }] } });
  const email = `outgoing-dictation-${randomUUID()}@example.invalid`, adminEmail = `outgoing-dictation-admin-${randomUUID()}@example.invalid`,
    otherEmail = `outgoing-dictation-other-${randomUUID()}@example.invalid`, password = "Synthetic dictation phrase only!";
  let actorId: string, cookie: string, adminCookie: string, otherCookie: string, draft: OutgoingDraftDto;
  function req(body?: unknown, selected = cookie, method = body === undefined ? "GET" : "POST") {
    return new Request(config.origin + "/api/hestia/outgoing", { method, headers: { origin: config.origin, cookie: selected,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(address: string) {
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const response = await app.handleAuth(new Request(config.origin + "/api/auth/sign-in/email", { method: "POST",
      headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ email: address, password }) }));
    expect(response.status).toBe(200); return response.headers.getSetCookie().map(x => x.split(";")[0]).join("; ");
  }
  const query = (field = "message", baseRevision = draft.revision) => `outgoingDraftId=${draft.id}&field=${field}&baseRevision=${baseRevision}`;
  function transcribe(params = query(), key = randomUUID(), selected = cookie, method = "POST") {
    return app.handleTranscriptions(new Request(`${config.origin}/api/hestia/transcriptions?${params}&idempotencyKey=${key}`, {
      method, headers: { origin: config.origin, cookie: selected, ...(method === "POST" ? { "content-type": "audio/wav" } : {}) },
      ...(method === "POST" ? { body: wav() } : {}) }));
  }
  async function save(value: string, target = draft) {
    const response = await app.handleOutgoingDraft(req({ revision: target.revision, to: ["recipient@example.invalid"], subject: "Sujet privé",
      message: value, attachmentIds: [] }, cookie, "PATCH"), target.id);
    expect(response.status).toBe(200); return (await response.json()).draft as OutgoingDraftDto;
  }
  const configure = async (monthlyLimitMicros = 500) => {
    const before = (await (await app.handleTranscriptionSettings(req(undefined, adminCookie))).json()).settings;
    expect((await app.handleTranscriptionSettings(req({ version: before.version, provider: "fixture", model: "fixture", enabled: true,
      monthlyLimitMicros, apiKey: "synthetic-only-key" }, adminCookie, "PUT"))).status).toBe(200);
  };
  function delayed() {
    let finish!: () => void, entered!: () => void;
    const sent = new Promise<void>(resolve => { entered = resolve; });
    outcome = async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return { text: "Résultat privé", actualMicros: 20 }; };
    return { sent, finish: () => finish() };
  }
  beforeAll(async () => {
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();
    await migrateDatabase(pool, config);
    actorId = await provisionSyntheticMember(pool, { email, name: "Membre dictant", password });
    await provisionSyntheticMember(pool, { email: adminEmail, name: "Admin distinct", password, role: "admin" });
    await provisionSyntheticMember(pool, { email: otherEmail, name: "Autre membre", password });
    adminCookie = await login(adminEmail); otherCookie = await login(otherEmail);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM hestia_transcription_request");
    await pool.query("DELETE FROM hestia_outgoing_draft");
    await pool.query('UPDATE hestia_member SET active=true,recovering=false WHERE user_id=$1', [actorId]);
    await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [actorId]);
    cookie = await login(email); calls = []; readFolders.mockClear();
    outcome = async () => ({ text: "Transcription synthétique", actualMicros: 20 });
    const created = await app.handleOutgoing(req({})); expect(created.status).toBe(200); draft = (await created.json()).draft;
    await configure();
  });
  afterAll(async () => { await pool.end(); });
  it("admits only the real editable private draft and never reads or sends context", async () => {
    draft = await save("Message déjà écrit");
    const before = (await pool.query('SELECT ciphertext FROM hestia_outgoing_draft WHERE id=$1', [draft.id])).rows[0].ciphertext;
    expect(await (await transcribe(query(), randomUUID(), cookie, "GET")).json()).toMatchObject({ available: true, vocabularySupported: false });
    for (const selected of [adminCookie, otherCookie]) expect((await transcribe(query(), randomUUID(), selected)).status).toBe(404);
    const result = await (await transcribe()).json();
    expect(result).toMatchObject({ status: "complete", text: "Transcription synthétique", outgoing: { draftId: draft.id, field: "message", baseRevision: draft.revision, revision: draft.revision } });
    expect(calls).toHaveLength(1); expect(calls[0].vocabulary).toEqual([]); expect(Object.keys(calls[0]).sort()).toEqual(["bytes", "durationMs", "mediaType", "vocabulary"]);
    expect(calls[0].bytes.every(value => value === 0)).toBe(true); expect(readFolders).not.toHaveBeenCalled();
    expect((await pool.query('SELECT ciphertext FROM hestia_outgoing_draft WHERE id=$1', [draft.id])).rows[0].ciphertext).toBe(before);
    expect(JSON.stringify((await pool.query('SELECT * FROM hestia_transcription_request')).rows)).not.toContain("Transcription");
  });
  it("requires exactly one source, one permitted field and bounded base revision", async () => {
    for (const params of [`${query()}&captureId=${randomUUID()}`, `${query()}&inboxAttachmentId=${randomUUID()}`, `outgoingDraftId=${draft.id}`,
      `outgoingDraftId=${draft.id}&field=to&baseRevision=1`, `outgoingDraftId=${draft.id}&field=message`, `${query()}&field=subject`,
      `outgoingDraftId=${draft.id}&field=subject&baseRevision=0`, `outgoingDraftId=${draft.id}&field=subject&baseRevision=2147483647`,
      `captureId=${randomUUID()}&field=subject`, `captureId=${randomUUID()}&baseRevision=1`]) expect((await transcribe(params)).status).toBe(400);
    expect((await transcribe(`outgoingDraftId=${draft.id}&field=message`, randomUUID(), cookie, "GET")).status).toBe(200);
    expect((await transcribe(`outgoingDraftId=${randomUUID()}&field=message&baseRevision=1`)).status).toBe(404);
    expect((await transcribe(query("message", draft.revision + 1))).status).toBe(404);
    expect(calls).toHaveLength(0); expect(readFolders).not.toHaveBeenCalled();
  });
  it("binds idempotency to field and intention while tolerating autosave revision increases", async () => {
    const key = randomUUID(), params = query("subject");
    const first = await (await transcribe(params, key)).json(); expect(first.status).toBe("complete");
    draft = await save("Saisie après résultat");
    expect(await (await transcribe(params, key)).json()).toMatchObject({ transcriptionId: first.transcriptionId, status: "stale" });
    expect((await transcribe(query("message", 1), key)).status).toBe(409);
    expect((await transcribe(query("subject"), key)).status).toBe(409); expect(calls).toHaveLength(1);
  });
  it("returns a bound proposal after normal edits before admission and during I/O", async () => {
    const params = query(), baseRevision = draft.revision; draft = await save("Avant appel");
    const barrier = delayed(), pending = transcribe(params); await barrier.sent;
    draft = await save("Conserver édition concurrente"); barrier.finish();
    expect(await (await pending).json()).toMatchObject({ status: "complete", text: "Résultat privé", outgoing: { field: "message", baseRevision, revision: draft.revision } });
    expect((await (await app.handleOutgoing(req())).json()).draft.message).toBe("Conserver édition concurrente");
  });
  it.each(["replace", "lock", "attempt", "departure", "unverified"])("discards late output after %s and settles once", async change => {
    const barrier = delayed(), pending = transcribe(); await barrier.sent;
    if (change === "replace") { await pool.query('DELETE FROM hestia_outgoing_draft WHERE id=$1', [draft.id]); await app.handleOutgoing(req({})); }
    if (change === "lock") await pool.query('UPDATE hestia_outgoing_draft SET lock_operation_id=$2 WHERE id=$1', [draft.id, randomUUID()]);
    if (change === "attempt") await pool.query('UPDATE hestia_outgoing_draft SET consumed_revision=revision WHERE id=$1', [draft.id]);
    if (change === "departure") await pool.query('UPDATE hestia_member SET departure_epoch=departure_epoch+1 WHERE user_id=$1', [actorId]);
    if (change === "unverified") await pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [actorId]);
    barrier.finish(); expect(await (await pending).json()).toMatchObject({ status: "stale" });
    expect(calls).toHaveLength(1); expect(readFolders).not.toHaveBeenCalled();
    expect(Number((await pool.query('SELECT actual_micros FROM hestia_transcription_request')).rows[0].actual_micros)).toBe(20);
  });
  it("rejects revoked actor access after provider I/O without returning text", async () => {
    const barrier = delayed(), pending = transcribe(); await barrier.sent;
    await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1', [actorId]); barrier.finish();
    const response = await pending; expect(response.status).toBe(401); expect(await response.text()).not.toContain("Résultat privé");
    expect(Number((await pool.query('SELECT actual_micros FROM hestia_transcription_request')).rows[0].actual_micros)).toBe(20);
  });
  it("uses the common budget and makes no automatic retry", async () => {
    await configure(100); const barrier = delayed(), pending = transcribe(); await barrier.sent;
    expect((await transcribe(query("subject"))).status).toBe(409);
    const created = await app.handleCaptures(req({ kind: "import", idempotencyKey: randomUUID(), currentFolderId: null }));
    expect(created.status).toBe(201); const captureId = (await created.json()).capture.id;
    expect(await (await transcribe(`captureId=${captureId}`, randomUUID(), cookie, "GET")).json()).toMatchObject({ available: false, reason: "budget" });
    expect((await transcribe(`captureId=${captureId}`)).status).toBe(409);
    barrier.finish(); await pending;
    const settings = (await (await app.handleTranscriptionSettings(req(undefined, adminCookie))).json()).settings;
    expect(settings.spentMicros).toBe(20); expect(settings.reservedMicros).toBe(0); expect(calls).toHaveLength(1);
    outcome = async () => { throw Error("Synthetic failure"); };
    await configure(200); expect(await (await transcribe()).json()).toMatchObject({ status: "failed" }); expect(calls).toHaveLength(2);
  });
  it("returns bounded over-limit/invalid proposals for editing, but normal draft PATCH remains strict", async () => {
    for (const text of ["x".repeat(20_001), "bad\u0000text"]) {
      outcome = async () => ({ text, actualMicros: 20 });
      expect(await (await transcribe()).json()).toMatchObject({ status: "complete", text });
      expect((await app.handleOutgoingDraft(req({ revision: draft.revision, to: [], subject: "", message: text, attachmentIds: [] }, cookie, "PATCH"), draft.id)).status).toBe(400);
    }
    expect((await (await app.handleOutgoing(req())).json()).draft.message).toBe("");
    expect(readFolders).not.toHaveBeenCalled();
  });
});
