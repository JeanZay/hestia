import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { HttpError, guarded, invalid, isUuid, json, response, textField, unavailable, type Access, type Actor } from "../access";
import type { ClassificationAnalysisDto, ClassificationSettingsDto } from "../../shared/capture-contract";
import type { AnalysisIdentity, AuthorizedFolder, ClassificationConfiguration, ClassificationDependencies, ProviderCost, ProviderPayload } from "./types";
import { micros, parseClassificationResult, utcMonth, version } from "./validation";

type ConfigRow = { version: string; provider: string; model: string; enabled: boolean; monthly_limit_micros: string; currency: string; credential_sealed: string | null; key_set_at: Date | null };
type RequestRow = { id: string; actor_id: string; actor_epoch: string; identity_hash: string; identity: AnalysisIdentity | null; folders: AuthorizedFolder[] | null; config_version: string; status: ClassificationAnalysisDto["status"]; result: unknown; reserved_micros: string; sent_at: Date | null; settled_at: Date | null; kind: "analysis" | "check" };
const conflict = () => new HttpError(409, "CLASSIFICATION_STALE", "La sélection ou la configuration a changé. Relancez explicitement l’analyse.");
const disabled = () => new HttpError(409, "CLASSIFICATION_DISABLED", "L’analyse est indisponible. Le classement manuel reste disponible.");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const associatedData = (provider: string) => `hestia-classification:1:${provider}`;
const configured = (row: ConfigRow): ClassificationConfiguration => ({ version: Number(row.version), provider: row.provider, model: row.model, enabled: row.enabled, monthlyLimitMicros: Number(row.monthly_limit_micros), currency: row.currency });

export function createClassificationService(_pool: Pool, access: Access, deps: ClassificationDependencies) {
  if (![deps.requestTimeoutMs, deps.maxResultBytes, deps.maxSuggestions].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid classification limits");
  async function config(client: PoolClient) {
    const row = (await client.query<ConfigRow>("SELECT * FROM hestia_classification_config WHERE id=1 FOR UPDATE")).rows[0];
    if (!row) throw disabled(); return row;
  }
  async function manager(client: PoolClient, actor: Actor) {
    const row = (await client.query("SELECT role,active,recovering FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0];
    if (!row?.active || row.recovering || !["owner", "admin"].includes(row.role)) throw new HttpError(403, "FORBIDDEN", "Configuration réservée au Propriétaire et aux Administrateurs actifs.");
  }
  async function usage(client: PoolClient, now: Date) {
    const period = utcMonth(now);
    // Known spend belongs to its reservation month. Every unsettled debt stays
    // reserved across month rollover; it is never silently forgiven.
    const row = (await client.query(`SELECT
      COALESCE(SUM(actual_micros) FILTER(WHERE month_start=$1::date),0)::text AS spent,
      COALESCE(SUM(reserved_micros) FILTER(WHERE actual_micros IS NULL),0)::text AS reserved
      FROM hestia_classification_request`, [period.start])).rows[0];
    const spentMicros = Number(row.spent), reservedMicros = Number(row.reserved);
    if (!Number.isSafeInteger(spentMicros) || !Number.isSafeInteger(reservedMicros)) throw disabled();
    return { period, spentMicros, reservedMicros };
  }
  async function settings(client: PoolClient, row: ConfigRow): Promise<ClassificationSettingsDto> {
    const availableProviders = deps.providers.filter(item => item.mode !== "remote" || deps.allowRemote)
      .filter(item => item.models?.length).map(item => ({ id: item.id, label: item.label ?? item.id, models: [...item.models!] }));
    return { ...configured(row), currency: "EUR", keyPresent: !!row.credential_sealed, keySetAt: row.key_set_at?.toISOString() ?? null, availableProviders, ...await usage(client, await deps.clock(client)) };
  }
  function provider(row: ConfigRow) {
    const found = deps.providers.find(item => item.id === row.provider);
    if (!row.enabled || !row.credential_sealed || !found || (found.mode === "remote" && !deps.allowRemote)) throw disabled();
    if (!found.models?.some(item => item.id === row.model)) throw disabled();
    return found;
  }
  async function reserve(client: PoolClient, actor: Actor, row: ConfigRow, key: string, kind: "analysis" | "check", identityHash: string, identity: AnalysisIdentity | null, quote: ProviderCost | null) {
    const epoch = (await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0].epoch;
    const old = (await client.query<RequestRow>("SELECT * FROM hestia_classification_request WHERE actor_id=$1 AND idempotency_key=$2", [actor.id, key])).rows[0];
    if (old) {
      if (old.identity_hash !== identityHash || old.kind !== kind || Number(old.actor_epoch) !== Number(epoch)) throw conflict();
      return { row: old, fresh: false };
    }
    if (!quote || quote.currency !== "EUR") throw disabled();
    const maximum = micros(quote.maximumMicros), now = await deps.clock(client), budget = await usage(client, now);
    const committed = BigInt(budget.spentMicros) + BigInt(budget.reservedMicros);
    if (committed >= BigInt(row.monthly_limit_micros) || committed + BigInt(maximum) > BigInt(row.monthly_limit_micros)) throw new HttpError(409, "CLASSIFICATION_BUDGET", "Le plafond mensuel est atteint. Le classement manuel reste disponible.");
    const inserted = (await client.query<RequestRow>(`INSERT INTO hestia_classification_request
      (id,actor_id,actor_epoch,idempotency_key,kind,identity_hash,identity,config_version,month_start,reserved_micros,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [randomUUID(), actor.id, epoch, key, kind, identityHash, identity, row.version, budget.period.start, maximum, now])).rows[0];
    return { row: inserted, fresh: true };
  }
  async function settle(id: string, actual: unknown, result: unknown, status: "complete" | "failed") {
    // Cost settlement must not depend on the actor retaining admission.
    await access.transaction(async client => {
      await config(client);
      const cost = typeof actual === "number" && Number.isSafeInteger(actual) && actual >= 0 ? actual : null;
      await client.query(`UPDATE hestia_classification_request SET actual_micros=$2,
        result=CASE WHEN (kind='analysis' AND identity IS NULL) OR $2::bigint>reserved_micros THEN NULL ELSE $3::jsonb END,
        status=CASE WHEN kind='analysis' AND identity IS NULL THEN 'stale' WHEN $2::bigint>reserved_micros THEN 'failed' ELSE $4 END,settled_at=$5
        WHERE id=$1 AND settled_at IS NULL`, [id, cost, JSON.stringify(result), status, await deps.clock(client)]);
    });
  }
  async function bounded<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([action(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Classification timeout")); }, deps.requestTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function visible(client: PoolClient, actor: Actor, row: RequestRow): Promise<ClassificationAnalysisDto> {
    if (row.actor_id !== actor.id || row.kind !== "analysis" || !row.identity) throw unavailable();
    const basic = { analysisId: row.id, status: row.status };
    try {
      await deps.capture.assertCurrent(client, actor, row.identity);
      const current = await config(client);
      if (Number(current.version) !== Number(row.config_version) || !current.enabled) return { ...basic, status: "stale" };
      if (row.status !== "complete") return basic;
      const folders = await deps.readAuthorizedFolders(client, actor);
      // Reasons and summary are free text. A vanished catalogue entry may also
      // occur in that text, so invalidate the whole response when it changes.
      if (hash(folders) !== hash(row.folders)) return { ...basic, status: "stale" };
      const result = parseClassificationResult(row.result, folders, deps.maxResultBytes, deps.maxSuggestions);
      // If a former destination disappeared, keep surviving suggestions only.
      return { ...basic, result };
    } catch (error) {
      if (error instanceof HttpError) return { ...basic, status: "stale" };
      throw error;
    }
  }
  async function handleClassificationSettings(request: Request) {
    return guarded(async () => {
      if (!["GET", "PUT", "DELETE"].includes(request.method)) throw invalid();
      if (request.method !== "GET") access.origin(request);
      const body = request.method === "GET" ? null : await json(request, request.method === "DELETE" ? ["version"] : ["version", "provider", "model", "monthlyLimitMicros", "enabled", "apiKey"]);
      return access.withActor(request, async (client, actor) => {
        await manager(client, actor); let row = await config(client);
        if (body) {
          if (version(body.version) !== Number(row.version)) throw conflict();
          if (request.method === "DELETE") {
            row = (await client.query<ConfigRow>("UPDATE hestia_classification_config SET credential_sealed=NULL,key_set_at=NULL,enabled=false,version=version+1 WHERE id=1 RETURNING *")).rows[0];
          } else {
            const name = textField(body.provider, 80), model = textField(body.model, 160), limit = micros(body.monthlyLimitMicros, true);
            if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(model) || typeof body.enabled !== "boolean") throw invalid();
            let sealed = row.credential_sealed, setAt = row.key_set_at;
            if (body.apiKey !== undefined) {
              if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 2048 || /\s/u.test(body.apiKey)) throw invalid();
              sealed = deps.credentialCipher.seal(body.apiKey, associatedData(name)); setAt = await deps.clock(client);
            } else if (name !== row.provider) { sealed = null; setAt = null; }
            if (body.enabled && !sealed) throw invalid();
            if (body.enabled) {
              const available = deps.providers.find(item => item.id === name);
              if (!available || (available.mode === "remote" && !deps.allowRemote) || !available.models?.some(item => item.id === model)) throw disabled();
            }
            row = (await client.query<ConfigRow>(`UPDATE hestia_classification_config SET provider=$1,model=$2,
              monthly_limit_micros=$3,enabled=$4,credential_sealed=$5,key_set_at=$6,version=version+1 WHERE id=1 RETURNING *`,
            [name, model, limit, body.enabled, sealed, setAt])).rows[0];
          }
        }
        return response({ settings: await settings(client, row) });
      });
    });
  }
  async function handleCaptureAnalysis(request: Request, captureId: string, analysisId: string) {
    return guarded(async () => {
      if (request.method !== "GET" || !isUuid(captureId) || !isUuid(analysisId)) throw invalid();
      return access.withActor(request, async (client, actor) => {
        const row = (await client.query<RequestRow>("SELECT * FROM hestia_classification_request WHERE id=$1 AND actor_id=$2", [analysisId, actor.id])).rows[0];
        if (!row || row.identity?.captureId !== captureId) throw unavailable();
        return response(await visible(client, actor, row));
      });
    });
  }
  async function handleCaptureAnalyze(request: Request, captureId: string) {
    return guarded(async () => {
      if (request.method !== "POST" || !isUuid(captureId)) throw invalid(); access.origin(request);
      const body = await json(request, ["version", "artifactId", "idempotencyKey"]);
      if (!isUuid(body.artifactId) || !isUuid(body.idempotencyKey)) throw invalid();
      const selection = { captureId, version: version(body.version), artifactId: body.artifactId }, key = body.idempotencyKey;
      const identityHash = hash(selection);
      const initial = await access.withActor(request, async (client, actor) => {
        const old = (await client.query<RequestRow>("SELECT * FROM hestia_classification_request WHERE actor_id=$1 AND idempotency_key=$2", [actor.id, key])).rows[0];
        if (old) {
          if (old.identity_hash !== identityHash || old.kind !== "analysis") throw conflict();
          return { reply: await visible(client, actor, old) };
        }
        const row = await config(client); provider(row);
        return { identity: await deps.capture.inspect(client, actor, selection), configVersion: row.version };
      });
      if (initial.reply) return response(initial.reply);
      const identity = initial.identity!;
      const bytes = await deps.capture.readBytes(request, identity);
      if (bytes.byteLength !== identity.size || bytes.byteLength > 20 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== identity.sha256) throw conflict();
      const reservation = await access.withActor(request, async (client, actor) => {
        await deps.capture.assertCurrent(client, actor, identity);
        const row = await config(client), selected = provider(row), folders = await deps.readAuthorizedFolders(client, actor);
        if (row.version !== initial.configVersion) throw conflict();
        const payload: ProviderPayload = { bytes, mediaType: identity.mediaType, folders };
        const saved = await reserve(client, actor, row, key, "analysis", identityHash, identity, selected.quote(configured(row), payload));
        if (saved.fresh) await client.query("UPDATE hestia_classification_request SET folders=$2 WHERE id=$1", [saved.row.id, JSON.stringify(folders)]);
        return { ...saved, config: row, selected, payload };
      });
      if (!reservation.fresh) return handleCaptureAnalysis(new Request(request.url, { headers: request.headers }), captureId, reservation.row.id);
      let credential: string;
      try {
        credential = await access.withActor(request, async (client, actor) => {
          await deps.capture.assertCurrent(client, actor, identity);
          const row = await config(client); provider(row);
          const folders = await deps.readAuthorizedFolders(client, actor);
          if (row.version !== reservation.config.version || hash(folders) !== hash(reservation.payload.folders)) throw conflict();
          const value = deps.credentialCipher.open(row.credential_sealed!, associatedData(row.provider));
          await client.query("UPDATE hestia_classification_request SET sent_at=$2 WHERE id=$1", [reservation.row.id, await deps.clock(client)]);
          return value;
        });
      } catch (error) { await settle(reservation.row.id, 0, null, "failed"); throw error; }
      let actual: unknown = null;
      try {
        const outcome = await bounded(signal => reservation.selected.analyze(configured(reservation.config), reservation.payload, credential, signal));
        actual = outcome.actualMicros;
        const result = parseClassificationResult(outcome.value, reservation.payload.folders, deps.maxResultBytes, deps.maxSuggestions);
        await settle(reservation.row.id, actual, result, "complete");
      } catch { await settle(reservation.row.id, actual, null, "failed"); }
      return handleCaptureAnalysis(new Request(request.url, { headers: request.headers }), captureId, reservation.row.id);
    });
  }
  async function handleClassificationCheck(request: Request) {
    return guarded(async () => {
      if (request.method !== "POST") throw invalid(); access.origin(request);
      const body = await json(request, ["version", "idempotencyKey"]);
      if (!isUuid(body.idempotencyKey)) throw invalid(); const expected = version(body.version), key = body.idempotencyKey;
      const reservation = await access.withActor(request, async (client, actor) => {
        await manager(client, actor); const row = await config(client);
        if (Number(row.version) !== expected) throw conflict();
        const selected = deps.providers.find(item => item.id === row.provider);
        if (!row.enabled || !row.credential_sealed || !selected || (selected.mode === "remote" && !deps.allowRemote)) return null;
        const saved = await reserve(client, actor, row, key, "check", hash({ kind: "check", version: expected }), null, selected.quoteCheck(configured(row)));
        return { ...saved, config: row, selected };
      });
      if (!reservation) return response({ status: "disabled" });
      if (!reservation.fresh) return response({ status: reservation.row.result ?? (reservation.row.status === "pending" ? "pending" : "unreachable") });
      let credential: string;
      try {
        credential = await access.withActor(request, async (client, actor) => {
          await manager(client, actor); const row = await config(client); provider(row);
          if (Number(row.version) !== expected) throw conflict();
          const value = deps.credentialCipher.open(row.credential_sealed!, associatedData(row.provider));
          await client.query("UPDATE hestia_classification_request SET sent_at=$2 WHERE id=$1", [reservation.row.id, await deps.clock(client)]);
          return value;
        });
      } catch (error) { await settle(reservation.row.id, 0, null, "failed"); throw error; }
      let status: "accepted" | "invalid" | "unreachable" = "unreachable", actual: unknown = null;
      try {
        const outcome = await bounded(signal => reservation.selected.check(configured(reservation.config), credential, signal));
        if (["accepted", "invalid", "unreachable"].includes(outcome.status)) status = outcome.status;
        actual = outcome.actualMicros;
      } catch { /* Ambiguous network failure retains its complete reservation. */ }
      await settle(reservation.row.id, actual, status, status === "accepted" ? "complete" : "failed");
      return access.withActor(request, async (client, actor) => {
        await manager(client, actor); const row = await config(client);
        if (Number(row.version) !== expected) throw conflict();
        const saved = (await client.query<RequestRow>("SELECT * FROM hestia_classification_request WHERE id=$1", [reservation.row.id])).rows[0];
        return response({ status: saved.result ?? "unreachable" });
      });
    });
  }
  async function cleanupClassification(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw invalid();
    return access.transaction(async client => {
      await config(client);
      const cleaned = await client.query(`UPDATE hestia_classification_request SET identity=NULL,folders=NULL,result=NULL,status='stale'
        WHERE id IN (SELECT r.id FROM hestia_classification_request r WHERE r.kind='analysis' AND r.identity IS NOT NULL
          AND ((r.identity->>'expiresAt')::timestamptz <= $1
            OR NOT EXISTS (SELECT 1 FROM hestia_capture c WHERE c.id=(r.identity->>'captureId')::uuid
              AND c.state IN ('open','preparing') AND c.expires_at>$1 AND c.actor_epoch=r.actor_epoch)
            OR NOT EXISTS (SELECT 1 FROM hestia_member m WHERE m.user_id=r.actor_id
              AND m.active AND NOT m.recovering AND m.epoch=r.actor_epoch))
          ORDER BY r.created_at,r.id LIMIT $2 FOR UPDATE)`, [await deps.clock(client), limit]);
      return { cleaned: cleaned.rowCount ?? 0 };
    });
  }
  return { handleClassificationSettings, handleCaptureAnalyze, handleCaptureAnalysis, handleClassificationCheck, cleanupClassification };
}
