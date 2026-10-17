import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { observeProviderInvocation, persistProviderObservation } from "../../src/server/classification/provider-observation";

afterEach(() => vi.useRealTimers());
const clock = (...values: bigint[]) => () => values.shift()!;
const observed = { measurementVersion: 1, basis: "SERVER_PROVIDER_INVOCATION_MONOTONIC", clock: "NODE_HRTIME", outcome: "resolved", measurementStatus: "OBSERVED", elapsedUs: 7, timeoutMs: 25000 } as const;
describe("provider invocation observation", () => {
  it("keeps the exact outcome and rounds fractional microseconds upward", async () => {
    const value = { value: "synthetic", actualMicros: 42 };
    const call = observeProviderInvocation(async () => value, 25000, clock(500n, 1501n));
    expect(await call.result).toBe(value);
    expect(call.observation()).toEqual({ ...observed, elapsedUs: 2 });
  });
  it.each([false, true])("preserves rejected and synchronously thrown exceptions (%s)", async synchronous => {
    const error = new Error("synthetic exception");
    const call = observeProviderInvocation(() => { if (synchronous) throw error; return Promise.reject(error); }, 25000, clock(1n, 2001n));
    await expect(call.result).rejects.toBe(error);
    expect(call.observation()).toEqual({ ...observed, outcome: "rejected", elapsedUs: 2 });
  });
  it.each([clock(3n, 2n), clock(-1n, 2n), clock(0n, BigInt(Number.MAX_SAFE_INTEGER) * 1000n + 1n), () => { throw Error("clock"); }, () => undefined as unknown as bigint])("records invalid clocks without substituting zero", async now => {
    const call = observeProviderInvocation(async () => 1, 25000, now);
    expect(await call.result).toBe(1);
    expect(call.observation()).toMatchObject({ measurementStatus: "CLOCK_INVALID", elapsedUs: null });
  });
  it("does not clamp a resolution observed after the nominal timeout", async () => {
    const call = observeProviderInvocation(async () => 1, 25000, clock(0n, 26726000000n));
    await call.result;
    expect(call.observation()).toMatchObject({ outcome: "resolved", elapsedUs: 26726000 });
  });
  it("records the delayed timeout once, aborts once, and ignores a late paid outcome", async () => {
    vi.useFakeTimers(); let complete!: (value: { actualMicros: number }) => void, aborts = 0;
    const call = observeProviderInvocation(signal => { signal.addEventListener("abort", () => aborts++); return new Promise(resolve => { complete = resolve; }); }, 25000, clock(0n, 28000000000n));
    const rejection = expect(call.result).rejects.toThrow("Classification timeout");
    await vi.advanceTimersByTimeAsync(25000); await rejection;
    const first = call.observation(); complete({ actualMicros: 10 }); await Promise.resolve();
    expect(aborts).toBe(1); expect(call.observation()).toBe(first);
    expect(first).toMatchObject({ outcome: "timeout", elapsedUs: 28000000 });
  });
  it("does not include work before invocation or after its resolution", async () => {
    let now = 999000000000n;
    const call = observeProviderInvocation(async () => { now += 3000000n; return 1; }, 25000, () => now);
    await call.result; now += 60000000000n;
    expect(call.observation()?.elapsedUs).toBe(3000);
  });
});

describe("isolated observation persistence", () => {
  it("waits for commit, bounds statements, and never replaces an existing row", async () => {
    const queries: { text: string; values?: unknown[]; query_timeout: number }[] = [], release = vi.fn();
    const pool = { connect: async () => ({ query: async (query: typeof queries[number]) => { queries.push(query); return { rowCount: 1 }; }, release }) } as unknown as Pool;
    expect(await persistProviderObservation(pool, "synthetic-request", "analysis", observed)).toBe(true);
    expect(queries.map(q => q.text.split(" ")[0])).toEqual(["BEGIN", "SET", "INSERT", "COMMIT"]);
    expect(queries.every(q => q.query_timeout === 500)).toBe(true);
    expect(queries[2].text).toContain("settled_at IS NOT NULL");
    expect(queries[2].text).not.toContain("ON CONFLICT");
    expect(queries[2].values).toEqual(["synthetic-request", 1, observed.basis, observed.clock, "analysis", "resolved", "OBSERVED", 7, 25000]);
    expect(release).toHaveBeenCalledWith(false);
  });
  it("contains telemetry failure without retry or financial writes", async () => {
    const query = vi.fn().mockRejectedValue(Error("synthetic failure")), release = vi.fn();
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    expect(await persistProviderObservation(pool, "synthetic-request", "check", observed)).toBe(false);
    expect(query).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledWith(true);
  });
  it("releases late acquisition without issuing SQL and bounds an exhausted pool", async () => {
    vi.useFakeTimers(); let acquire!: (client: PoolClient) => void;
    const query = vi.fn(), release = vi.fn();
    const pool = { connect: () => new Promise(resolve => { acquire = resolve; }) } as unknown as Pool;
    const saved = persistProviderObservation(pool, "synthetic-request", "summary", observed);
    await vi.advanceTimersByTimeAsync(500); expect(await saved).toBe(false);
    acquire({ query, release } as unknown as PoolClient); await Promise.resolve(); await Promise.resolve();
    expect(release).toHaveBeenCalledWith(true); expect(query).not.toHaveBeenCalled();
  });
  it("does not fabricate an observation when no invocation occurred", async () => {
    const connect = vi.fn();
    expect(await persistProviderObservation({ connect } as unknown as Pool, "synthetic-request", "summary", undefined)).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
  it("contains cleanup errors without attempting a second release", async () => {
    const release = vi.fn().mockImplementation(() => { throw Error('Synthetic cleanup failure'); });
    const pool = { connect: async () => ({ query: async () => { throw Error('Synthetic statement failure'); }, release }) } as unknown as Pool;
    expect(await persistProviderObservation(pool, 'synthetic-request', 'summary', observed)).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
