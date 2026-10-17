import type { Pool, PoolClient } from "pg";

export type ProviderObservation = Readonly<{
  measurementVersion: 1; basis: "SERVER_PROVIDER_INVOCATION_MONOTONIC"; clock: "NODE_HRTIME";
  outcome: "resolved" | "rejected" | "timeout";
  measurementStatus: "OBSERVED" | "CLOCK_INVALID"; elapsedUs: number | null; timeoutMs: number;
}>;
export type ProviderOperation = "summary" | "inbox_analysis" | "analysis" | "check";

/** Measures the adapter, including its parsing, but neither reservation nor settlement SQL. */
export function observeProviderInvocation<T>(action: (signal: AbortSignal) => Promise<T>, timeoutMs: number,
  monotonicNowNs: () => bigint = () => process.hrtime.bigint(), timeoutMessage = "Classification timeout") {
  const controller = new AbortController();
  let observation: ProviderObservation | undefined, finished = false;
  function sample(): bigint | null {
    try { const value = monotonicNowNs(); return typeof value === "bigint" && value >= 0n ? value : null; }
    catch { return null; }
  }
  const result = new Promise<T>((resolve, reject) => {
    let start: bigint | null = null;
    const finish = (outcome: ProviderObservation["outcome"], value: T | unknown) => {
      if (finished) return;
      finished = true;
      const end = sample(), elapsed = start !== null && end !== null && end >= start ? (end - start + 999n) / 1000n : null;
      const elapsedUs = elapsed !== null && elapsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(elapsed) : null;
      observation = { measurementVersion: 1, basis: "SERVER_PROVIDER_INVOCATION_MONOTONIC", clock: "NODE_HRTIME",
        outcome, measurementStatus: elapsedUs === null ? "CLOCK_INVALID" : "OBSERVED", elapsedUs, timeoutMs };
      clearTimeout(timer);
      if (outcome === "timeout") controller.abort();
      if (outcome === "resolved") resolve(value as T); else reject(value);
    };
    const timer = setTimeout(() => finish("timeout", new Error(timeoutMessage)), timeoutMs);
    start = sample();
    try { Promise.resolve(action(controller.signal)).then(value => finish("resolved", value), error => finish("rejected", error)); }
    catch (error) { finish("rejected", error); }
  });
  return { result, observation: () => observation };
}

/** Best effort, separate from the already committed financial/business transaction.
 * Acquisition is bounded, late acquisitions are destroyed; every statement and lock wait is bounded.
 * No retries or upsert: an existing observation can never be replaced.
 */
export async function persistProviderObservation(pool: Pick<Pool, "connect">, requestId: string,
  operation: ProviderOperation, observation: ProviderObservation | undefined): Promise<boolean> {
  if (!observation) return false;
  let client: PoolClient | undefined, timer: ReturnType<typeof setTimeout> | undefined, expired = false;
  function release(destroy = false) {
    const connection = client; client = undefined;
    try { connection?.release(destroy); } catch { /* Cleanup cannot change an already committed business result. */ }
  }
  try {
    client = await Promise.race([
      pool.connect().then(connection => { if (expired) { connection.release(true); throw new Error("Observation acquisition expired"); } return connection; }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("Observation acquisition expired")); }, 500); }),
    ]);
    clearTimeout(timer);
    const query = (text: string, values?: unknown[]) => {
      const config = { text, values, query_timeout: 500 };
      return client!.query(config);
    };
    await query("BEGIN");
    await query("SET LOCAL statement_timeout='500ms'; SET LOCAL lock_timeout='250ms'");
    const inserted = await query(`INSERT INTO hestia_provider_invocation_observation
      (request_id,measurement_version,basis,clock,operation,outcome,measurement_status,elapsed_us,timeout_ms)
      SELECT id,$2,$3,$4,$5,$6,$7,$8,$9 FROM hestia_classification_request WHERE id=$1 AND settled_at IS NOT NULL`,
    [requestId, observation.measurementVersion, observation.basis, observation.clock, operation, observation.outcome,
      observation.measurementStatus, observation.elapsedUs, observation.timeoutMs]);
    if (inserted.rowCount !== 1) throw new Error("Observation requires a settled request");
    await query("COMMIT");
    release();
    return true;
  } catch {
    // Destroying an uncertain telemetry connection rolls back only its own transaction.
    // Never log adapter errors, credentials, payloads or SQL parameters.
    release(true);
    return false;
  } finally { clearTimeout(timer); }
}
