import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import type { TranscriptionPayload } from "../../src/server/transcription/types";
import type { AgendaCard, AgendaMutationInput } from "../../src/shared/agenda-contract";
import { createObjectStore } from "../../src/server/storage";

function wav(seconds = 1) {
  const value = Buffer.alloc(44 + seconds * 32000); value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVEfmt ", 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write("data", 36); value.writeUInt32LE(value.length - 44, 40); return value;
}

describe("Agenda form dictation on owned synthetic SQL", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw Error("Owned synthetic bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  let calls: TranscriptionPayload[], outcome: () => Promise<{ text: string; actualMicros: number | null }>;
  const readFolders = vi.fn(async () => { throw Error("Agenda must never read document vocabulary"); });
  const app = createApplication(pool, config, { store: createObjectStore(), transcription: { readAuthorizedFolders: readFolders,
    providers: [{ id: "fixture", mode: "synthetic", label: "Fixture", models: [{ id: "fixture", label: "Fixture", vocabularySupported: true }],
      quote: () => ({ maximumMicros: 100, currency: "EUR" }),
      async transcribe(_config, payload) { calls.push(payload); return outcome(); } }] } });
  const suffix = randomUUID(), password = "Synthetic agenda dictation phrase only!";
  const email = `agenda-dictation-${suffix}@example.invalid`, adminEmail = `agenda-dictation-admin-${suffix}@example.invalid`, otherEmail = `agenda-dictation-other-${suffix}@example.invalid`;
  let actorId: string, otherId: string, cookie: string, adminCookie: string, otherCookie: string, formSessionId: string;
  function req(body?: unknown, selected = cookie, method = body === undefined ? "GET" : "POST") {
    return new Request(config.origin + "/api/hestia/agenda", { method, headers: { origin: config.origin, cookie: selected,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const fields = (extra: Partial<AgendaMutationInput> = {}): AgendaMutationInput => ({ requestId: randomUUID(), revision: 0,
    title: "Titre conservé", description: "Texte conservé", category: "", startDate: null, startTime: null, endDate: null, endTime: null,
    startFold: null, shareMode: "all", readerIds: [], links: [], documentIds: [], retainedDocumentLinkIds: [], reminders: [], ...extra });
  async function create() {
    const response = await app.handleAgenda(req(fields())); expect(response.status).toBe(201); return (await response.json()).card as AgendaCard;
  }
  const query = (field = "description", card?: AgendaCard, session = formSessionId) => `agendaFormSessionId=${session}&field=${field}${card ? `&agendaCardId=${card.id}&baseRevision=${card.revision}` : ""}`;
  function transcribe(params = query(), key = randomUUID(), selected = cookie, method = "POST", audio = wav(), expectedActor = actorId) {
    return app.handleTranscriptions(new Request(`${config.origin}/api/hestia/transcriptions?${params}&idempotencyKey=${key}`, {
      method, headers: { origin: config.origin, cookie: selected, "X-Hestia-Expected-Actor": encodeURIComponent(expectedActor),
        ...(method === "POST" ? { "content-type": "audio/wav" } : {}) }, ...(method === "POST" ? { body: audio } : {}) }));
  }
  async function login(address: string) {
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const response = await app.handleAuth(new Request(config.origin + "/api/auth/sign-in/email", { method: "POST",
      headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ email: address, password }) }));
    expect(response.status).toBe(200); return response.headers.getSetCookie().map(x => x.split(";")[0]).join("; ");
  }
  const configure = async (monthlyLimitMicros = 500, enabled = true) => {
    const before = (await (await app.handleTranscriptionSettings(req(undefined, adminCookie))).json()).settings;
    expect((await app.handleTranscriptionSettings(req({ version: before.version, provider: "fixture", model: "fixture", enabled,
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
    otherId = await provisionSyntheticMember(pool, { email: otherEmail, name: "Autre membre", password });
    adminCookie = await login(adminEmail); otherCookie = await login(otherEmail);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM hestia_transcription_request");
    for (const table of ["operation", "delivery", "reminder", "document_link", "access", "card"]) await pool.query(`DELETE FROM hestia_agenda_${table}`);
    await pool.query('UPDATE hestia_member SET active=true,recovering=false WHERE user_id=$1', [actorId]);
    await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [actorId]);
    cookie = await login(email); formSessionId = randomUUID(); calls = []; readFolders.mockClear();
    outcome = async () => ({ text: "Transcription synthétique", actualMicros: 20 }); await configure();
  });
  afterAll(async () => { await pool.end(); });
  it("transcribes a bound unsaved form without creating a card or fake capture or sending context", async () => {
    const count = async (table: string) => (await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count;
    const captureCount = await count("hestia_capture");
    const availability = await transcribe(query(), randomUUID(), cookie, "GET");
    expect(availability.headers.get("X-Hestia-Actor")).toBe(encodeURIComponent(actorId));
    expect(await availability.json()).toMatchObject({ available: true, vocabularySupported: false, maxDurationMs: 120000 });
    const response = await transcribe(query("title")); expect(response.status).toBe(200);
    expect(response.headers.get("X-Hestia-Actor")).toBe(encodeURIComponent(actorId));
    expect(await response.json()).toMatchObject({ status: "complete", text: "Transcription synthétique",
      agenda: { formSessionId, field: "title", cardId: null, baseRevision: null, revision: null } });
    expect(await count("hestia_agenda_card")).toBe("0"); expect(await count("hestia_agenda_operation")).toBe("0"); expect(await count("hestia_capture")).toBe(captureCount);
    expect(calls).toHaveLength(1); expect(calls[0].vocabulary).toEqual([]); expect(Object.keys(calls[0]).sort()).toEqual(["bytes", "durationMs", "mediaType", "vocabulary"]);
    expect(calls[0].bytes.every(value => value === 0)).toBe(true); expect(readFolders).not.toHaveBeenCalled();
    expect(JSON.stringify((await pool.query('SELECT * FROM hestia_transcription_request')).rows)).not.toContain("Transcription");
  });
  it("requires one source and field, a valid form UUID, and an exact optional card/revision pair", async () => {
    const card = await create();
    for (const params of [`${query()}&captureId=${randomUUID()}`, `${query()}&inboxAttachmentId=${randomUUID()}`, `${query()}&outgoingDraftId=${randomUUID()}`,
      `${query()}&field=title`, `agendaFormSessionId=${formSessionId}`, `agendaFormSessionId=bad&field=title`, query("message"),
      `${query()}&agendaCardId=${card.id}`, `${query()}&baseRevision=1`, `${query()}&agendaCardId=bad&baseRevision=1`,
      `${query()}&agendaCardId=${card.id}&baseRevision=0`, `${query()}&agendaCardId=${card.id}&baseRevision=2147483647`, `${query()}&agendaFormSessionId=${randomUUID()}`])
      expect((await transcribe(params)).status).toBe(400);
    expect((await transcribe(query("description", { ...card, revision: card.revision + 1 }))).status).toBe(404);
    expect((await transcribe(query("description", { ...card, id: randomUUID() }))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
  it("admits only the active creator for an existing editable card and preserves saved text", async () => {
    const card = await create();
    for (const selected of [otherCookie, adminCookie]) {
      const request = new Request(`${config.origin}/api/hestia/transcriptions?${query("title", card)}&idempotencyKey=${randomUUID()}`, {
        method: "POST", headers: { origin: config.origin, cookie: selected, "content-type": "audio/wav" }, body: wav() });
      const denied = await app.handleTranscriptions(request); expect(denied.status).toBe(404); expect(denied.headers.get("X-Hestia-Actor")).toBeTruthy();
    }
    expect(await (await transcribe(query("description", card))).json()).toMatchObject({ status: "complete",
      agenda: { formSessionId, field: "description", cardId: card.id, baseRevision: card.revision, revision: card.revision } });
    expect((await pool.query('SELECT title,description,revision FROM hestia_agenda_card WHERE id=$1', [card.id])).rows[0])
      .toMatchObject({ title: card.title, description: card.description, revision: card.revision });
    await pool.query('UPDATE hestia_agenda_card SET archived_at=clock_timestamp() WHERE id=$1', [card.id]);
    expect((await transcribe(query("title", card))).status).toBe(404); expect(calls).toHaveLength(1);
  });
  it("rejects stale-account, expired-session and unverified admission before any provider receipt", async () => {
    expect((await transcribe(query(), randomUUID(), cookie, "POST", wav(), otherId)).status).toBe(401);
    await pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [actorId]);
    expect((await transcribe()).status).toBe(404);
    await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [actorId]);
    await pool.query('UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval \'31 minutes\' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)', [actorId]);
    expect((await transcribe()).status).toBe(401); expect(calls).toHaveLength(0);
    expect((await pool.query('SELECT count(*) FROM hestia_transcription_request')).rows[0].count).toBe("0");
  });
  it("binds a paid intention to session, field and existing-card identity, with no transcript replay", async () => {
    const key = randomUUID(), params = query("title"), result = await (await transcribe(params, key)).json();
    expect(await (await transcribe(params, key)).json()).toMatchObject({ transcriptionId: result.transcriptionId, status: "stale" });
    for (const changed of [query("description"), query("title", undefined, randomUUID()), query("title", await create())])
      expect((await transcribe(changed, key)).status).toBe(409);
    expect(calls).toHaveLength(1);
  });
  it("returns pending for an exact concurrent retry without another provider call", async () => {
    const key = randomUUID(), barrier = delayed(), pending = transcribe(query(), key); await barrier.sent;
    expect(await (await transcribe(query(), key)).json()).toMatchObject({ status: "pending" });
    barrier.finish(); expect(await (await pending).json()).toMatchObject({ status: "complete" }); expect(calls).toHaveLength(1);
  });
  it.each(["revision", "archive", "access", "departure", "unverified"])("discards existing-card late results after %s and settles once", async change => {
    const card = await create(), barrier = delayed(), pending = transcribe(query("description", card)); await barrier.sent;
    if (change === "revision") await pool.query('UPDATE hestia_agenda_card SET revision=revision+1 WHERE id=$1', [card.id]);
    if (change === "archive") await pool.query('UPDATE hestia_agenda_card SET archived_at=clock_timestamp() WHERE id=$1', [card.id]);
    if (change === "access") await pool.query('UPDATE hestia_agenda_access SET active=false,ended_at=clock_timestamp() WHERE card_id=$1 AND user_id=$2', [card.id, actorId]);
    if (change === "departure") await pool.query('UPDATE hestia_member SET departure_epoch=departure_epoch+1 WHERE user_id=$1', [actorId]);
    if (change === "unverified") await pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [actorId]);
    barrier.finish(); expect(await (await pending).json()).toMatchObject({ status: "stale" });
    expect(calls).toHaveLength(1); expect(Number((await pool.query('SELECT actual_micros FROM hestia_transcription_request')).rows[0].actual_micros)).toBe(20);
  });
  it.each(["departure", "epoch", "revoked", "expired"])("protects unsaved forms from a late %s change", async change => {
    const barrier = delayed(), pending = transcribe(); await barrier.sent;
    if (change === "departure") await pool.query('UPDATE hestia_member SET departure_epoch=departure_epoch+1 WHERE user_id=$1', [actorId]);
    if (change === "epoch") await pool.query('UPDATE hestia_member SET epoch=epoch+1 WHERE user_id=$1', [actorId]);
    if (change === "revoked") await pool.query('UPDATE hestia_member SET active=false WHERE user_id=$1', [actorId]);
    if (change === "expired") await pool.query('UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval \'31 minutes\' WHERE session_id IN (SELECT id FROM session WHERE "userId"=$1)', [actorId]);
    barrier.finish(); const response = await pending;
    expect(response.status).toBe(change === "departure" ? 200 : 401);
    const body = await response.json(); expect(body.text).toBeUndefined(); if (change === "departure") expect(body.status).toBe("stale");
    expect(Number((await pool.query('SELECT actual_micros FROM hestia_transcription_request')).rows[0].actual_micros)).toBe(20);
  });
  it("shares the household budget with Capture and never retries on disabled or failed transcription", async () => {
    await configure(100); const barrier = delayed(), pending = transcribe(); await barrier.sent;
    expect((await transcribe(query("title"))).status).toBe(409);
    const created = await app.handleCaptures(req({ kind: "import", idempotencyKey: randomUUID(), currentFolderId: null }));
    expect(created.status).toBe(201); const captureId = (await created.json()).capture.id;
    expect(await (await transcribe(`captureId=${captureId}`, randomUUID(), cookie, "GET")).json()).toMatchObject({ available: false, reason: "budget" });
    barrier.finish(); await pending;
    await configure(200, false); expect(await (await transcribe(query(), randomUUID(), cookie, "GET")).json()).toMatchObject({ available: false, reason: "disabled" });
    expect((await transcribe()).status).toBe(409); expect(calls).toHaveLength(1);
    await configure(200); outcome = async () => { throw Error("Synthetic failure"); };
    expect(await (await transcribe()).json()).toMatchObject({ status: "failed" }); expect(calls).toHaveLength(2);
  });
  it("rejects oversized audio but keeps empty, over-limit and invalid text as editable bounded proposals", async () => {
    expect((await transcribe(query(), randomUUID(), cookie, "POST", wav(121))).status).toBe(400); expect(calls).toHaveLength(0);
    for (const text of ["", "x".repeat(20001), "bad\u0000text"]) {
      outcome = async () => ({ text, actualMicros: 20 }); expect(await (await transcribe()).json()).toMatchObject({ status: "complete", text });
      if (text) expect((await app.handleAgenda(req(fields({ description: text })))).status).toBe(400);
    }
    expect((await pool.query('SELECT count(*) FROM hestia_agenda_card')).rows[0].count).toBe("0"); expect(readFolders).not.toHaveBeenCalled();
  });
});
