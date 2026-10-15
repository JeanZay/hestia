import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createApplication } from "../../src/server/application";
import { createAuth } from "../../src/server/auth/options";
import { createAccess, HttpError } from "../../src/server/access";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { createClassificationCredentialCipher } from "../../src/server/classification/cipher";
import type { AuthorizedFolder } from "../../src/server/classification/types";
import { createTranscriptionService } from "../../src/server/transcription/service";
import type { TranscriptionDependencies, TranscriptionPayload } from "../../src/server/transcription/types";
import { transcriptionFailure } from "../../src/server/transcription/diagnostics";

function wav() {
  const value = Buffer.alloc(32044); value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVEfmt ", 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write("data", 36); value.writeUInt32LE(32000, 40); return value;
}
describe("dictation SQL lifecycle and independent budget", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname) || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw new Error("Owned synthetic integration bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  const app = createApplication(pool, config), access = createAccess(pool, config, createAuth(pool, config));
  const password = "Synthetic transcription test phrase only!", email = `transcription-${randomUUID()}@example.invalid`, memberEmail = `transcription-member-${randomUUID()}@example.invalid`;
  let actorId: string, cookie: string, memberCookie: string, captureId: string, now: Date, current = true, calls: string[], folders: AuthorizedFolder[], captured: TranscriptionPayload | undefined;
  let outcome: () => Promise<{ text: string; actualMicros: number | null }>;
  const deps: TranscriptionDependencies = {
    clock: async () => now, requestTimeoutMs: 2000, allowRemote: false,
    credentialCipher: createClassificationCredentialCipher("synthetic-transcription-secret-0123456789"), readAuthorizedFolders: async () => folders,
    capture: { async assertAvailable(client, actor, selected) {
      if (!current || selected !== captureId || actor.id !== actorId) throw new HttpError(404, "NOT_FOUND", "Unavailable");
      const epoch = Number((await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0].epoch);
      return { captureId, actorId, actorEpoch: epoch, expiresAt: "2027-01-08T00:00:00.000Z" };
    } },
    providers: ["one", "two"].map((id, index) => ({ id, mode: "synthetic" as const, label: id, models: [{ id: `fixture-${id}`, label: id, vocabularySupported: index === 0 }],
      quote: () => ({ maximumMicros: 100, currency: "EUR" as const }),
      async transcribe(_config, payload) { calls.push(id); captured = payload; return outcome(); } })),
  };
  const service = createTranscriptionService(pool, access, deps);
  function request(body?: unknown, method = body === undefined ? "GET" : "PUT", selectedCookie = cookie) {
    return new Request(`${config.origin}/api/hestia/transcription-settings`, { method, headers: { origin: config.origin, cookie: selectedCookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const settings = () => service.handleTranscriptionSettings(request());
  async function save(extra: Record<string, unknown> = {}) {
    const before = (await (await settings()).json()).settings;
    return service.handleTranscriptionSettings(request({ version: before.version, provider: "one", model: "fixture-one", monthlyLimitMicros: 500, enabled: true, apiKey: "synthetic-only-key", ...extra }));
  }
  async function login(selectedEmail: string) {
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const result = await app.handleAuth(new Request(`${config.origin}/api/auth/sign-in/email`, { method: "POST", headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ email: selectedEmail, password }) }));
    expect(result.status).toBe(200); return result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const transcribe = (key = randomUUID(), instance = service, bytes = wav()) => instance.handleTranscriptions(new Request(`${config.origin}/api/hestia/transcriptions?captureId=${captureId}&idempotencyKey=${key}`, {
    method: "POST", headers: { origin: config.origin, cookie, "content-type": "audio/wav" }, body: bytes,
  }));
  const available = () => service.handleTranscriptions(new Request(`${config.origin}/api/hestia/transcriptions?captureId=${captureId}`, { headers: { cookie } }));
  const ledger = async () => (await pool.query("SELECT *,to_char(month_start,'YYYY-MM-DD') AS month_utc FROM hestia_transcription_request ORDER BY created_at,id")).rows;
  beforeAll(async () => {
    const marker = await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker"); if (!marker.rows[0].marker) throw new Error("Missing bench marker");
    await migrateDatabase(pool, config);
    actorId = await provisionSyntheticMember(pool, { email, name: "Admin Synthétique", password, role: "admin" });
    await provisionSyntheticMember(pool, { email: memberEmail, name: "Membre Synthétique", password });
    cookie = await login(email); memberCookie = await login(memberEmail);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM hestia_transcription_request");
    await pool.query("UPDATE hestia_transcription_config SET version=1,provider='',model='',enabled=false,monthly_limit_micros=0,credential_sealed=NULL,key_set_at=NULL WHERE id=1");
    await pool.query("UPDATE hestia_member SET active=true,recovering=false,role='admin' WHERE user_id=$1", [actorId]); cookie = await login(email);
    now = new Date("2026-12-31T23:59:59Z"); captureId = randomUUID(); current = true; calls = []; captured = undefined;
    folders = [{ id: randomUUID(), name: "Véhicule A", path: [{ id: randomUUID(), name: "Hidden ancestor" }], canCreate: true }];
    outcome = async () => ({ text: "Texte synthétique, pas le véhicule A.", actualMicros: 20 });
  });
  afterAll(async () => { await pool.end(); });
  it("starts disabled, protects manager settings, seals the separate key and sends nothing on save", async () => {
    expect((await (await settings()).json()).settings).toMatchObject({ enabled: false, keyPresent: false, monthlyLimitMicros: 0 });
    expect((await service.handleTranscriptionSettings(request(undefined, "GET", memberCookie))).status).toBe(403);
    expect(await (await available()).json()).toMatchObject({ enabled: false, available: false, reason: "disabled" });
    const classificationBefore = (await pool.query("SELECT * FROM hestia_classification_config")).rows;
    expect((await save()).status).toBe(200); expect(calls).toEqual([]);
    expect(await (await settings()).text()).not.toContain("synthetic-only-key");
    expect((await pool.query("SELECT credential_sealed FROM hestia_transcription_config")).rows[0].credential_sealed).not.toContain("synthetic-only-key");
    expect((await pool.query("SELECT * FROM hestia_classification_config")).rows).toEqual(classificationBefore);
    const value = (await (await settings()).json()).settings;
    expect((await service.handleTranscriptionSettings(request({ version: value.version }, "DELETE"))).status).toBe(200);
    expect((await (await settings()).json()).settings.keyPresent).toBe(false);
  });
  it("makes one explicit call, returns text only once and keeps only financial/idempotency metadata", async () => {
    await save(); const key = randomUUID(), first = await transcribe(key), body = await first.json();
    expect(body).toMatchObject({ status: "complete", text: "Texte synthétique, pas le véhicule A." });
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(captured?.vocabulary).toEqual(["Véhicule A"]); expect(captured?.bytes.every(value => value === 0)).toBe(true);
    expect(await (await transcribe(key)).json()).toMatchObject({ transcriptionId: body.transcriptionId, status: "stale" });
    expect(calls).toEqual(["one"]);
    const receipts = await ledger(); expect(receipts).toHaveLength(1); expect(Number(receipts[0].actual_micros)).toBe(20);
    const stored = JSON.stringify(receipts); expect(stored).not.toContain(captureId); expect(stored).not.toContain("Véhicule"); expect(stored).not.toContain("Texte synthétique");
  });
  it("allows disabling an unavailable profile while retaining its key and prior debt", async () => {
    await save(); outcome = async () => { throw new Error("synthetic unavailable provider"); };
    await transcribe(); const before = await ledger();
    const sealed = (await pool.query("SELECT credential_sealed FROM hestia_transcription_config")).rows[0].credential_sealed;
    const unavailableService = createTranscriptionService(pool, access, { ...deps, providers: [] });
    const prior = (await (await unavailableService.handleTranscriptionSettings(request())).json()).settings;
    expect(prior.availableProviders).toEqual([]);
    const result = await unavailableService.handleTranscriptionSettings(request({ version: prior.version, provider: prior.provider, model: prior.model, enabled: false, monthlyLimitMicros: 10 }));
    expect(result.status).toBe(200);
    expect((await result.json()).settings).toMatchObject({ enabled: false, provider: "one", model: "fixture-one", keyPresent: true, monthlyLimitMicros: 10, reservedMicros: 100 });
    expect(await ledger()).toEqual(before); expect(calls).toEqual(["one"]);
    expect((await pool.query("SELECT credential_sealed FROM hestia_transcription_config")).rows[0].credential_sealed).toBe(sealed);
  });
  it("excludes overlong authorized vocabulary without blocking dictation or changing its settlement", async () => {
    folders = ["x".repeat(59), "é".repeat(26), "Véhicule B", "e\u0301".repeat(25)]
      .map(name => ({ id: randomUUID(), name, path: [], canCreate: true }));
    await save();
    expect(await (await transcribe()).json()).toMatchObject({ status: "complete", text: "Texte synthétique, pas le véhicule A." });
    expect(captured?.vocabulary).toEqual(["Véhicule B", "é".repeat(25)]);
    expect(calls).toEqual(["one"]); expect(Number((await ledger())[0].actual_micros)).toBe(20);
    folders = [{ id: randomUUID(), name: "x".repeat(59), path: [], canCreate: true }];
    expect((await (await transcribe()).json()).status).toBe("complete");
    expect(captured?.vocabulary).toEqual([]); expect(calls).toEqual(["one", "one"]);
    expect((await (await settings()).json()).settings).toMatchObject({ spentMicros: 40, reservedMicros: 0 });
  });
  it("rejects bad media before reserving or sending", async () => {
    await save(); expect((await transcribe(randomUUID(), service, Buffer.from("not wave"))).status).toBe(400);
    expect(calls).toHaveLength(0); expect(await ledger()).toHaveLength(0);
  });
  it("keeps debt on timeout/failure across UTC months, lowering budget and removing the key", async () => {
    await save({ monthlyLimitMicros: 100 }); outcome = async () => { throw new Error("provider failure"); };
    expect(await (await transcribe()).json()).toMatchObject({ status: "failed" });
    expect((await ledger())[0].actual_micros).toBeNull(); now = new Date("2027-01-01T00:00:01Z");
    expect(await (await available()).json()).toMatchObject({ reason: "budget" });
    const currentSettings = (await (await settings()).json()).settings;
    expect(currentSettings).toMatchObject({ reservedMicros: 100, spentMicros: 0, period: { start: "2027-01-01T00:00:00.000Z" } });
    await service.handleTranscriptionSettings(request({ version: currentSettings.version }, "DELETE"));
    expect((await (await settings()).json()).settings.reservedMicros).toBe(100); expect(calls).toHaveLength(1);
  });
  it("serializes budget reservations without holding the SQL lock during provider I/O", async () => {
    await save({ monthlyLimitMicros: 100 }); let finish!: () => void, emitted!: () => void;
    const sent = new Promise<void>(resolve => { emitted = resolve; });
    outcome = async () => { emitted(); await new Promise<void>(resolve => { finish = resolve; }); return { text: "First", actualMicros: 20 }; };
    const first = transcribe(); await sent;
    expect((await settings()).status).toBe(200); expect((await transcribe()).status).toBe(409); expect(calls).toHaveLength(1);
    finish(); expect(await (await first).json()).toMatchObject({ status: "complete" });
  });
  it("switches adapters for subsequent calls without changing an emitted call or classification settings", async () => {
    await save(); let finish!: () => void, emitted!: () => void;
    const sent = new Promise<void>(resolve => { emitted = resolve; });
    outcome = async () => { emitted(); await new Promise<void>(resolve => { finish = resolve; }); return { text: "Old model", actualMicros: 20 }; };
    const first = transcribe(); await sent;
    expect((await save({ provider: "two", model: "fixture-two" })).status).toBe(200); finish();
    expect(await (await first).json()).toMatchObject({ status: "complete", text: "Old model" });
    outcome = async () => ({ text: "Second model", actualMicros: 30 });
    expect(await (await transcribe()).json()).toMatchObject({ status: "complete", text: "Second model" });
    expect(calls).toEqual(["one", "two"]); expect(captured?.vocabulary).toEqual([]);
    expect((await (await settings()).json()).settings.spentMicros).toBe(50);
  });
  it("discards late transcripts after draft expiry or vocabulary rights change while settling the charge", async () => {
    for (const change of [() => { current = false; }, () => { folders = []; }]) {
      current = true; folders = [{ id: randomUUID(), name: "Véhicule A", path: [], canCreate: true }]; await save();
      outcome = async () => { change(); return { text: "Private result", actualMicros: 20 }; };
      const result = await (await transcribe()).json(); expect(result.status).toBe("stale"); expect(result.text).toBeUndefined();
    }
    expect((await ledger()).map(row => Number(row.actual_micros))).toEqual([20, 20]);
  });
  it("settles revoked-session calls without revealing their transcript", async () => {
    await save(); outcome = async () => { await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1", [actorId]); return { text: "Private result", actualMicros: 20 }; };
    expect((await transcribe()).status).toBe(401); expect(Number((await ledger())[0].actual_micros)).toBe(20);
  });
  it("does not silently truncate results or forgive overspending", async () => {
    await save(); outcome = async () => ({ text: "x".repeat(2500), actualMicros: 20 });
    expect((await (await transcribe()).json()).text).toHaveLength(2500);
    outcome = async () => ({ text: "x", actualMicros: 101 }); expect(await (await transcribe()).json()).toMatchObject({ status: "failed" });
    expect((await ledger()).some(row => Number(row.actual_micros) === 101)).toBe(true);
  });
  it("times out a hung provider once and preserves its unknown charge", async () => {
    await save(); outcome = () => new Promise(() => {});
    const fast = createTranscriptionService(pool, access, { ...deps, requestTimeoutMs: 20 });
    expect(await (await transcribe(randomUUID(), fast)).json()).toMatchObject({ status: "failed" });
    expect(calls).toHaveLength(1); expect((await ledger())[0].actual_micros).toBeNull();
  });
  it("logs one bounded event per failed call, never on success, preserving known and unknown costs", async () => {
    const sentinel = "SYNTHETIC_PRIVATE_ERROR_TRANSCRIPT";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await save(); expect((await (await transcribe()).json()).status).toBe("complete"); expect(warn).not.toHaveBeenCalled();
      outcome = async () => { throw transcriptionFailure("http", "HTTP_ERROR", 503); };
      const failed = await (await transcribe()).json();
      expect(failed.status).toBe("failed"); expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenLastCalledWith(JSON.stringify({ event: "hestia.transcription.failed", transcriptionId: failed.transcriptionId, stage: "http", reason: "HTTP_ERROR", httpStatus: 503, costKnown: false }));
      expect((await ledger()).find(row => row.id === failed.transcriptionId).actual_micros).toBeNull();
      outcome = async () => ({ text: sentinel + "\u0000", actualMicros: 23 });
      const malformed = await (await transcribe()).json();
      expect(malformed.status).toBe("failed"); expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenLastCalledWith(JSON.stringify({ event: "hestia.transcription.failed", transcriptionId: malformed.transcriptionId, stage: "transcript", reason: "INVALID_TEXT", costKnown: true }));
      expect(Number((await ledger()).find(row => row.id === malformed.transcriptionId).actual_micros)).toBe(23);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel); expect(calls).toHaveLength(3);
      warn.mockImplementation(() => { throw new Error(sentinel); }); outcome = async () => { throw new Error(sentinel); };
      expect((await (await transcribe()).json()).status).toBe("failed"); expect(calls).toHaveLength(4);
      expect((await (await settings()).json()).settings.reservedMicros).toBe(200);
    } finally { warn.mockRestore(); }
  });
});
