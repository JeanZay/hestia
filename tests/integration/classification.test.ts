import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createApplication } from "../../src/server/application";
import { createAuth } from "../../src/server/auth/options";
import { createAccess, HttpError } from "../../src/server/access";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { createClassificationService } from "../../src/server/classification/service";
import { createClassificationCredentialCipher } from "../../src/server/classification/cipher";
import { DEFAULT_CLASSIFICATION_LIMITS, type AnalysisIdentity, type AuthorizedFolder, type ClassificationDependencies, type ProviderOutcome, type ProviderPayload } from "../../src/server/classification/types";

describe("classification SQL budget, admission and write-only configuration", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname) || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw new Error("Owned synthetic integration bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  const app = createApplication(pool, config);
  const access = createAccess(pool, config, createAuth(pool, config));
  const password = "Synthetic classification phrase only!", email = `classification-${randomUUID()}@example.invalid`, memberEmail = `classification-member-${randomUUID()}@example.invalid`;
  let actorId: string, memberId: string, cookie: string, memberCookie: string;
  let captureId: string, artifactId: string, captureVersion: number, now: Date, folders: AuthorizedFolder[], calls: number, checks: number;
  let selectedPayload: ProviderPayload | undefined, afterRead: (() => Promise<void>) | undefined;
  let outcome: (payload: ProviderPayload) => Promise<ProviderOutcome>;
  const bytes = Buffer.from("synthetic adjusted artifact only"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const deps: ClassificationDependencies = {
    ...DEFAULT_CLASSIFICATION_LIMITS, requestTimeoutMs: 2000, clock: async () => now, allowRemote: false,
    credentialCipher: createClassificationCredentialCipher("synthetic-classification-secret-0123456789"),
    readAuthorizedFolders: async () => folders,
    capture: {
      async inspect(client, actor, selected) {
        if (actor.id !== actorId || selected.captureId !== captureId || selected.artifactId !== artifactId || selected.version !== captureVersion) throw new HttpError(404, "NOT_FOUND", "Unavailable");
        const epoch = Number((await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0].epoch);
        return { ...selected, actorId, actorEpoch: epoch, manifestSha256: sha256, sha256, mediaType: "application/pdf", size: bytes.length, expiresAt: "2027-01-08T00:00:00Z" };
      },
      async assertCurrent(client, actor, identity: AnalysisIdentity) {
        const epoch = Number((await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0].epoch);
        if (actor.id !== identity.actorId || identity.version !== captureVersion || identity.actorEpoch !== epoch) throw new HttpError(409, "STALE", "Stale");
      },
      async readBytes() { await afterRead?.(); return bytes; },
    },
    providers: [{ id: "synthetic", mode: "synthetic", models: [{ id: "fixture-v1", label: "Modèle synthétique" }], quote: () => ({ maximumMicros: 100, currency: "EUR" }), quoteCheck: () => ({ maximumMicros: 100, currency: "EUR" }),
      async analyze(_config, payload) { calls++; selectedPayload = payload; return outcome(payload); },
      async check() { checks++; return { status: "accepted", actualMicros: 5 }; } }],
  };
  const service = createClassificationService(pool, access, deps);
  function request(body?: unknown, method = body === undefined ? "GET" : "POST", selectedCookie = cookie) {
    return new Request(`${config.origin}/api/hestia/classification-settings`, { method, headers: { origin: config.origin, cookie: selectedCookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(email: string) {
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const result = await app.handleAuth(new Request(`${config.origin}/api/auth/sign-in/email`, { method: "POST", headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    expect(result.status).toBe(200); return result.headers.getSetCookie().map((value: string) => value.split(";")[0]).join("; ");
  }
  const settings = () => service.handleClassificationSettings(request());
  async function save(extra: Record<string, unknown> = {}) {
    const current = (await (await settings()).json()).settings;
    return service.handleClassificationSettings(request({ version: current.version, provider: "synthetic", model: "fixture-v1", monthlyLimitMicros: 200, enabled: true, apiKey: "synthetic-key-only", ...extra }, "PUT"));
  }
  const analyze = (key = randomUUID(), instance = service, selectedCookie = cookie, extra = {}) => instance.handleCaptureAnalyze(request({ version: captureVersion, artifactId, idempotencyKey: key, ...extra }, "POST", selectedCookie), captureId);
  async function ledger() { return (await pool.query("SELECT *,to_char(month_start,'YYYY-MM-DD') AS month_utc FROM hestia_classification_request ORDER BY created_at,id")).rows; }
  beforeAll(async () => {
    const marker = await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker"); if (!marker.rows[0].marker) throw new Error("Missing bench marker");
    await migrateDatabase(pool, config);
    actorId = await provisionSyntheticMember(pool, { email, name: "Admin Synthétique", password, role: "admin" });
    memberId = await provisionSyntheticMember(pool, { email: memberEmail, name: "Membre Synthétique", password });
    cookie = await login(email); memberCookie = await login(memberEmail);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM hestia_classification_request");
    await pool.query("UPDATE hestia_classification_config SET version=1,provider='',model='',enabled=false,monthly_limit_micros=0,credential_sealed=NULL,key_set_at=NULL WHERE id=1");
    await pool.query("UPDATE hestia_member SET role='admin',active=true,recovering=false WHERE user_id=$1", [actorId]); cookie = await login(email);
    captureId = randomUUID(); artifactId = randomUUID(); captureVersion = 1; now = new Date("2026-12-31T23:59:59Z");
    await pool.query(`INSERT INTO hestia_capture(id,actor_id,actor_epoch,kind,idempotency_key,identity_sha,created_at,expires_at,title,format)
      SELECT $1,$2,epoch,'camera',$3,$4,$5,'2027-01-08T00:00:00Z','Document synthétique','pdf' FROM hestia_member WHERE user_id=$2`,
    [captureId, actorId, randomUUID(), sha256, now]);
    folders = [{ id: randomUUID(), name: "Factures autorisées", path: [], canCreate: true }]; calls = 0; checks = 0; afterRead = undefined; selectedPayload = undefined;
    outcome = async () => ({ value: { existing: [{ folderId: folders[0].id, reason: "Facture synthétique" }], created: [] }, actualMicros: 20 });
  });
  afterAll(async () => { await pool.end(); });
  it("starts disabled and allows only active owner/admin; strict write-only key rotation/deletion", async () => {
    expect((await (await settings()).json()).settings).toMatchObject({ enabled: false, monthlyLimitMicros: 0, keyPresent: false });
    expect((await service.handleClassificationSettings(request(undefined, "GET", memberCookie))).status).toBe(403);
    const saved = await save(); expect(saved.status).toBe(200); expect(await saved.text()).not.toContain("synthetic-key-only");
    const before = (await pool.query("SELECT credential_sealed FROM hestia_classification_config")).rows[0].credential_sealed;
    expect(before).not.toContain("synthetic-key-only"); expect(calls).toBe(0);
    expect((await save({ apiKey: "synthetic-rotation-key" })).status).toBe(200);
    expect((await pool.query("SELECT credential_sealed FROM hestia_classification_config")).rows[0].credential_sealed).not.toBe(before);
    const current = (await (await settings()).json()).settings;
    expect((await service.handleClassificationSettings(request({ version: current.version }, "DELETE"))).status).toBe(200);
    expect((await (await settings()).json()).settings).toMatchObject({ keyPresent: false, enabled: false });
    await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1", [actorId]); expect((await settings()).status).toBe(401);
  });
  it("requires a positive integer monthly cap and refuses stale/extra input", async () => {
    for (const monthlyLimitMicros of [0, -1, 0.5, "20"]) expect((await save({ monthlyLimitMicros })).status).toBe(400);
    expect((await save({ arbitrary: true })).status).toBe(400); expect((await save({ version: 99 })).status).toBe(409);
    expect(calls).toBe(0);
  });
  it("performs one explicit call on adjusted bytes and current authorized names; idempotent GET and POST", async () => {
    await save(); const key = randomUUID(), first = await analyze(key); expect(first.status).toBe(200);
    const dto = await first.json(); expect(dto.status).toBe("complete"); expect(selectedPayload?.bytes).toEqual(bytes); expect(selectedPayload?.folders).toEqual(folders);
    expect(await (await analyze(key)).json()).toEqual(dto); expect(calls).toBe(1);
    expect((await analyze(key, service, cookie, { artifactId: randomUUID() })).status).toBe(409);
    expect((await service.handleCaptureAnalysis(request(undefined, "GET", memberCookie), captureId, dto.analysisId)).status).toBe(404);
    expect((await (await settings()).json()).settings).toMatchObject({ spentMicros: 20, reservedMicros: 0 });
  });
  it("serializes concurrent requests across service instances before emission", async () => {
    await save({ monthlyLimitMicros: 100 });
    let release!: () => void, entered!: () => void; const inCall = new Promise<void>(resolve => { entered = resolve; });
    outcome = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { value: { existing: [], created: [] }, actualMicros: 20 }; };
    const key = randomUUID(), first = analyze(key); await inCall;
    const secondService = createClassificationService(pool, createAccess(pool, config, createAuth(pool, config)), deps);
    expect((await (await analyze(key, secondService)).json()).status).toBe("pending");
    const denied = await analyze(randomUUID(), secondService); expect(denied.status).toBe(409); expect((await denied.json()).error.code).toBe("CLASSIFICATION_BUDGET");
    release(); expect((await first).status).toBe(200); expect(calls).toBe(1);
  });
  it("keeps unknown debt over timeout, rotation, deletion and the month boundary", async () => {
    await save({ monthlyLimitMicros: 100 }); outcome = async () => { throw new Error("Synthetic ambiguous failure"); };
    const key = randomUUID(); expect((await (await analyze(key)).json()).status).toBe("failed");
    now = new Date("2027-01-01T00:00:01Z"); await save({ monthlyLimitMicros: 100, apiKey: "synthetic-other-key" });
    expect((await (await settings()).json()).settings).toMatchObject({ spentMicros: 0, reservedMicros: 100, period: { start: "2027-01-01T00:00:00.000Z" } });
    expect((await analyze()).status).toBe(409); expect(calls).toBe(1);
    const row = (await ledger())[0]; expect(row.actual_micros).toBeNull(); expect(row.month_utc).toBe("2026-12-01");
    const current = (await (await settings()).json()).settings;
    await service.handleClassificationSettings(request({ version: current.version }, "DELETE"));
    expect((await (await settings()).json()).settings.reservedMicros).toBe(100);
  });
  it("settles in-flight calls in their reservation month and blocks lowered cap", async () => {
    await save(); outcome = async () => { now = new Date("2027-01-01T00:00:01Z"); return { value: { existing: [], created: [] }, actualMicros: 70 }; };
    await analyze(); expect((await (await settings()).json()).settings).toMatchObject({ spentMicros: 0, reservedMicros: 0 });
    now = new Date("2026-12-31T23:59:59Z"); await save({ monthlyLimitMicros: 50 }); expect((await analyze()).status).toBe(409); expect(calls).toBe(1);
  });
  it("refuses changed selection or revoked session after byte read before emission", async () => {
    await save(); afterRead = async () => { captureVersion++; }; expect((await analyze()).status).toBe(409); expect(calls).toBe(0);
    afterRead = async () => { await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1", [actorId]); };
    expect((await analyze()).status).toBe(401); expect(calls).toBe(0);
  });
  it("settles charged calls but withholds stale result after selection, rights or config change", async () => {
    await save(); outcome = async () => { captureVersion++; return { value: { existing: [], created: [] }, actualMicros: 20 }; };
    expect((await (await analyze()).json()).status).toBe("stale"); expect((await ledger())[0].actual_micros).toBe("20");
    await save(); outcome = async () => { folders = []; return { value: { existing: [], created: [] }, actualMicros: 20 }; };
    expect((await (await analyze()).json()).status).toBe("stale");
  });
  it("rejects hostile output, records known cost and never executes tools", async () => {
    await save(); outcome = async () => ({ value: { tools: [{ name: "delete_document" }], existing: [], created: [] }, actualMicros: 20 });
    expect((await (await analyze()).json()).status).toBe("failed"); expect((await ledger())[0].actual_micros).toBe("20");
  });
  it("settles cost after admission revocation without exposing a result", async () => {
    await save(); outcome = async () => {
      await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1", [actorId]);
      return { value: { existing: [], created: [] }, actualMicros: 20 };
    };
    expect((await analyze()).status).toBe(401); expect((await ledger())[0].actual_micros).toBe("20");
  });
  it("invalidates provider rotation during byte read and rejects cost overruns without losing known spend", async () => {
    await save(); afterRead = async () => { await save({ apiKey: "synthetic-rotated-key" }); };
    expect((await analyze()).status).toBe(409); expect(calls).toBe(0);
    afterRead = undefined; outcome = async () => ({ value: { existing: [], created: [] }, actualMicros: 150 });
    expect((await (await analyze()).json()).status).toBe("failed"); expect((await ledger())[0].actual_micros).toBe("150");
  });
  it("times out once with full debt and never retries on polling or replay", async () => {
    await save(); outcome = async () => new Promise<ProviderOutcome>(() => undefined);
    const fast = createClassificationService(pool, access, { ...deps, requestTimeoutMs: 20 }), key = randomUUID();
    const dto = await (await analyze(key, fast)).json(); expect(dto.status).toBe("failed");
    expect((await ledger())[0].actual_micros).toBeNull();
    expect((await (await analyze(key, fast)).json()).status).toBe("failed"); expect(calls).toBe(1);
  });
  it("purges expired derived content without releasing ambiguous financial debt", async () => {
    await save(); outcome = async () => ({ value: { existing: [{ folderId: folders[0].id, reason: "Synthetic private reason" }], created: [] }, actualMicros: null });
    const dto = await (await analyze()).json(); now = new Date("2027-01-08T00:00:00Z");
    expect(await service.cleanupClassification()).toEqual({ cleaned: 1 });
    const row = (await ledger())[0]; expect(row).toMatchObject({ identity: null, folders: null, result: null, actual_micros: null, reserved_micros: "100", status: "stale" });
    expect((await service.handleCaptureAnalysis(request(), captureId, dto.analysisId)).status).toBe(404);
  });
  it.each(["finalized", "abandoned", "expired", "departed"])("purges analysis content for %s while preserving the financial ledger", async state => {
    await save(); await analyze();
    if (state === "departed") await pool.query("UPDATE hestia_member SET active=false WHERE user_id=$1", [actorId]);
    else await pool.query("UPDATE hestia_capture SET state=$2 WHERE id=$1", [captureId, state]);
    expect(await service.cleanupClassification(1)).toEqual({ cleaned: 1 });
    expect((await ledger())[0]).toMatchObject({ status: "stale", identity: null, result: null, folders: null, actual_micros: "20" });
  });
  it("never emits for a disabled remote provider or unbounded currency quote", async () => {
    await save(); const remote = createClassificationService(pool, access, { ...deps, providers: [{ ...deps.providers[0], mode: "remote" }] });
    expect((await analyze(randomUUID(), remote)).status).toBe(409); expect(calls).toBe(0);
    const usd = createClassificationService(pool, access, { ...deps, providers: [{ ...deps.providers[0], quote: () => ({ currency: "USD", maximumMicros: 1 }) }] });
    expect((await analyze(randomUUID(), usd)).status).toBe(409); expect(calls).toBe(0);
  });
  it("checks credentials only on explicit owner/admin POST and charges at most once", async () => {
    await save(); const current = (await (await settings()).json()).settings, input = { version: current.version, idempotencyKey: randomUUID() };
    expect((await service.handleClassificationCheck(request(input, "POST", memberCookie))).status).toBe(403);
    expect(await (await service.handleClassificationCheck(request(input))).json()).toEqual({ status: "accepted" });
    expect(await (await service.handleClassificationCheck(request(input))).json()).toEqual({ status: "accepted" });
    expect(checks).toBe(1); expect((await (await settings()).json()).settings.spentMicros).toBe(5);
    await pool.query("UPDATE hestia_member SET role='member' WHERE user_id=$1", [actorId]); expect((await settings()).status).toBe(403);
    expect(memberId).toBeTruthy();
  });
});
