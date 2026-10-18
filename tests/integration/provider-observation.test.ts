import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { persistProviderObservation } from "../../src/server/classification/provider-observation";

describe("provider observations on an owned synthetic PostgreSQL database", () => {
  const parent = readServerConfig(), url = new URL(parent.databaseUrl);
  if (parent.environment !== "local" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/hestia_test_[a-f0-9]{16}$/.test(url.pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw Error("Owned synthetic local bench required");
  const database = url.pathname.slice(1) + "_observation"; url.pathname = "/" + database;
  const config = { ...parent, databaseUrl: url.toString() };
  const admin = new Pool({ connectionString: parent.databaseUrl, max: 1 }), pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  let actor: string;
  const observation = { measurementVersion: 1, basis: "SERVER_PROVIDER_INVOCATION_MONOTONIC", clock: "NODE_HRTIME", outcome: "resolved", measurementStatus: "OBSERVED", elapsedUs: 26726000, timeoutMs: 25000 } as const;
  async function ledger(settled = true, actual: number | null = 42) {
    const id = randomUUID();
    await pool.query(`INSERT INTO hestia_classification_request
      (id,actor_id,actor_epoch,idempotency_key,kind,identity_hash,config_version,month_start,reserved_micros,actual_micros,status,created_at,sent_at,settled_at)
      VALUES($1,$2,0,$1,'check',repeat('a',64),1,'2026-10-01',100,$3,'complete',clock_timestamp(),clock_timestamp(),CASE WHEN $4 THEN clock_timestamp() ELSE NULL END)`, [id, actor, actual, settled]);
    return id;
  }
  const rows = () => pool.query("SELECT row_to_json(r) AS value FROM hestia_classification_request r ORDER BY id");
  beforeAll(async () => {
    expect((await admin.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();
    await admin.query(`CREATE DATABASE "${database}"`); await migrateDatabase(pool, config);
    const previous = process.env.DATABASE_URL;
    try { process.env.DATABASE_URL = config.databaseUrl; actor = await provisionSyntheticMember(pool, { email: `observation-${randomUUID()}@example.invalid`, name: "Synthetic observation", password: "Synthetic observation password!" }); }
    finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
  });
  afterAll(async () => { await pool.end(); await admin.end(); });
  it("adds only019, preserves historical rows/debt and all other checksums, and reruns idempotently", async () => {
    await pool.query("DROP TABLE hestia_provider_invocation_observation");
    await pool.query("DELETE FROM hestia_migration WHERE id='019-provider-invocation-observation'");
    await ledger(); await ledger(true, null);
    const before = (await rows()).rows, checksums = (await pool.query("SELECT id,checksum FROM hestia_migration ORDER BY id")).rows;
    expect(checksums.filter(({ id }) => Number(id.slice(0, 3)) <= 18)).toHaveLength(18);
    expect(checksums.some(({ id }) => id === "020-systematic-summaries")).toBe(true);
    await migrateDatabase(pool, config); await migrateDatabase(pool, config);
    expect((await rows()).rows).toEqual(before);
    expect((await pool.query("SELECT id,checksum FROM hestia_migration WHERE id<>'019-provider-invocation-observation' ORDER BY id")).rows).toEqual(checksums);
    expect((await pool.query("SELECT * FROM hestia_provider_invocation_observation")).rows).toEqual([]);
  });
  it("creates once for the exact settled request, keeps >25s honest and never changes its cost", async () => {
    const id = await ledger(), before = (await rows()).rows;
    expect(await persistProviderObservation(pool, id, "check", observation)).toBe(true);
    expect(await persistProviderObservation(pool, id, "check", { ...observation, elapsedUs: 1 })).toBe(false);
    expect((await pool.query("SELECT elapsed_us,operation FROM hestia_provider_invocation_observation WHERE request_id=$1", [id])).rows).toEqual([{ elapsed_us: "26726000", operation: "check" }]);
    expect((await rows()).rows).toEqual(before);
  });
  it("does not create for a missing or uncommitted ledger and keeps unknown cost unknown", async () => {
    expect(await persistProviderObservation(pool, randomUUID(), "summary", observation)).toBe(false);
    const pending = await ledger(false);
    expect(await persistProviderObservation(pool, pending, "analysis", observation)).toBe(false);
    const unknown = await ledger(true, null), before = (await rows()).rows;
    expect(await persistProviderObservation(pool, unknown, "inbox_analysis", { ...observation, outcome: "timeout" })).toBe(true);
    expect((await rows()).rows).toEqual(before);
    expect((await pool.query("SELECT actual_micros,reserved_micros FROM hestia_classification_request WHERE id=$1", [unknown])).rows).toEqual([{ actual_micros: null, reserved_micros: "100" }]);
  });
  it("enforces clock status and FK constraints without changing existing measurements", async () => {
    const id = await ledger();
    expect(await persistProviderObservation(pool, id, "analysis", { ...observation, measurementStatus: "CLOCK_INVALID", elapsedUs: null })).toBe(true);
    await expect(pool.query("UPDATE hestia_provider_invocation_observation SET elapsed_us=1 WHERE request_id=$1", [id])).rejects.toThrow();
    await expect(pool.query("UPDATE hestia_provider_invocation_observation SET measurement_status='OBSERVED',elapsed_us=-1 WHERE request_id=$1", [id])).rejects.toThrow();
  });
  it("contains a real observation INSERT rejection after financial commit", async () => {
    const id = await ledger(), before = (await rows()).rows;
    await pool.query("ALTER TABLE hestia_provider_invocation_observation ADD CONSTRAINT synthetic_reject CHECK (operation <> 'summary')");
    try { expect(await persistProviderObservation(pool, id, "summary", observation)).toBe(false); }
    finally { await pool.query("ALTER TABLE hestia_provider_invocation_observation DROP CONSTRAINT synthetic_reject"); }
    expect((await rows()).rows).toEqual(before);
    expect((await pool.query("SELECT * FROM hestia_provider_invocation_observation WHERE request_id=$1", [id])).rows).toEqual([]);
  });
});
