import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { TRANSCRIPTION_MAX_AUDIO_BYTES, TRANSCRIPTION_MAX_DURATION_MS, type TranscriptionAvailabilityDto, type TranscriptionResultDto, type TranscriptionSettingsDto } from "../../shared/transcription-contract";
import { bodyBytes, guarded, HttpError, invalid, isUuid, json, response, textField, type Access, type Actor } from "../access";
import { micros, utcMonth, version } from "../classification/validation";
import type { TranscriptionConfiguration, TranscriptionDependencies, TranscriptionIdentity, TranscriptionPayload } from "./types";
import { dictationVocabulary, inspectDictationWav, transcriptText } from "./validation";
import { reportTranscriptionFailure, transcriptionFailure } from "./diagnostics";

type ConfigRow = { version: string; provider: string; model: string; enabled: boolean; monthly_limit_micros: string; credential_sealed: string | null; key_set_at: Date | null };
type Receipt = { id: string; actor_epoch: string; identity_hash: string; status: TranscriptionResultDto["status"] };
const stale = () => new HttpError(409, "TRANSCRIPTION_STALE", "La préparation a changé. Dictez à nouveau si nécessaire.");
const disabled = () => new HttpError(409, "TRANSCRIPTION_DISABLED", "La dictée est indisponible. L’écriture au clavier reste possible.");
const budgetError = () => new HttpError(409, "TRANSCRIPTION_BUDGET", "Le plafond mensuel de la dictée est atteint. L’écriture au clavier reste possible.");
const aad = (provider: string) => `hestia-transcription:1:${provider}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const configured = (row: ConfigRow): TranscriptionConfiguration => ({ version: Number(row.version), provider: row.provider, model: row.model, enabled: row.enabled, monthlyLimitMicros: Number(row.monthly_limit_micros), currency: "EUR" });

export function createTranscriptionService(_pool: Pool, access: Access, deps: TranscriptionDependencies) {
  if (!Number.isSafeInteger(deps.requestTimeoutMs) || deps.requestTimeoutMs <= 0 || deps.requestTimeoutMs > 120_000) throw new Error("Invalid transcription timeout");
  const ceiling = deps.deploymentLimitMicros === undefined ? 1_000_000_000_000 : micros(deps.deploymentLimitMicros, true);
  const limit = (row: ConfigRow) => Math.min(ceiling, micros(Number(row.monthly_limit_micros)));
  // Admission, not a global waiting queue: unrelated UI requests never wait for STT.
  let active = 0;
  async function config(client: PoolClient) {
    const row = (await client.query<ConfigRow>("SELECT * FROM hestia_transcription_config WHERE id=1 FOR UPDATE")).rows[0];
    if (!row) throw disabled(); return row;
  }
  async function manager(client: PoolClient, actor: Actor) {
    const member = (await client.query("SELECT role,active,recovering FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0];
    if (!member?.active || member.recovering || !["owner", "admin"].includes(member.role)) throw new HttpError(403, "FORBIDDEN", "Configuration réservée au Propriétaire et aux Administrateurs actifs.");
  }
  async function usage(client: PoolClient) {
    const period = utcMonth(await deps.clock(client));
    const row = (await client.query(`SELECT COALESCE(SUM(actual_micros) FILTER(WHERE month_start=$1::date),0)::text AS spent,
      COALESCE(SUM(reserved_micros) FILTER(WHERE actual_micros IS NULL),0)::text AS reserved FROM hestia_transcription_request`, [period.start])).rows[0];
    const spentMicros = Number(row.spent), reservedMicros = Number(row.reserved);
    if (![spentMicros, reservedMicros].every(value => Number.isSafeInteger(value) && value >= 0)) throw disabled();
    return { period, spentMicros, reservedMicros };
  }
  function provider(row: ConfigRow) {
    const selected = deps.providers.find(item => item.id === row.provider && (item.mode !== "remote" || deps.allowRemote));
    if (!row.enabled || !row.credential_sealed || !selected?.models.some(item => item.id === row.model)) throw disabled();
    return selected;
  }
  function quote(row: ConfigRow) {
    const selected = provider(row), price = selected.quote(configured(row));
    if (!price || price.currency !== "EUR") throw disabled();
    return { selected, maximum: micros(price.maximumMicros, true) };
  }
  async function settings(client: PoolClient, row: ConfigRow): Promise<TranscriptionSettingsDto> {
    return { ...configured(row), monthlyLimitMicros: limit(row), keyPresent: !!row.credential_sealed, keySetAt: row.key_set_at?.toISOString() ?? null,
      ...await usage(client), availableProviders: deps.providers.filter(item => item.mode !== "remote" || deps.allowRemote)
        .filter(item => item.models.length).map(item => ({ id: item.id, label: item.label, models: [...item.models] })) };
  }
  async function handleTranscriptionSettings(request: Request) {
    return guarded(async () => {
      if (!["GET", "PUT", "DELETE"].includes(request.method)) throw invalid();
      if (request.method !== "GET") access.origin(request);
      const body = request.method === "GET" ? null : await json(request, request.method === "DELETE" ? ["version"] : ["version", "provider", "model", "enabled", "monthlyLimitMicros", "apiKey"]);
      return access.withActor(request, async (client, actor) => {
        await manager(client, actor); let row = await config(client);
        if (body) {
          if (version(body.version) !== Number(row.version)) throw stale();
          if (request.method === "DELETE") row = (await client.query<ConfigRow>("UPDATE hestia_transcription_config SET credential_sealed=NULL,key_set_at=NULL,enabled=false,version=version+1 WHERE id=1 RETURNING *")).rows[0];
          else {
            const name = textField(body.provider, 80), model = textField(body.model, 160), monthly = micros(body.monthlyLimitMicros, body.enabled === true);
            if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(model) || typeof body.enabled !== "boolean") throw invalid();
            if (monthly > ceiling) throw new HttpError(400, "TRANSCRIPTION_LIMIT", "Le plafond demandé dépasse le maximum autorisé pour cet environnement.");
            let sealed = row.credential_sealed, setAt = row.key_set_at;
            if (body.apiKey !== undefined) {
              if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 2048 || /\s/u.test(body.apiKey)) throw invalid();
              sealed = deps.credentialCipher.seal(body.apiKey, aad(name)); setAt = await deps.clock(client);
            } else if (name !== row.provider) { sealed = null; setAt = null; }
            const candidate: ConfigRow = { ...row, provider: name, model, enabled: body.enabled, monthly_limit_micros: String(monthly), credential_sealed: sealed };
            if (body.enabled) quote(candidate);
            row = (await client.query<ConfigRow>(`UPDATE hestia_transcription_config SET provider=$1,model=$2,enabled=$3,monthly_limit_micros=$4,
              credential_sealed=$5,key_set_at=$6,version=version+1 WHERE id=1 RETURNING *`, [name, model, body.enabled, monthly, sealed, setAt])).rows[0];
          }
        }
        return response({ settings: await settings(client, row) });
      });
    });
  }
  async function assertSame(client: PoolClient, actor: Actor, identity: TranscriptionIdentity) {
    if (typeof identity.agendaFormSessionId === "string") {
      if (!deps.agenda) throw stale();
      const current = await deps.agenda.assertAvailable(client, actor, identity.agendaFormSessionId, identity.field, identity.cardId, identity.baseRevision);
      if (current.actorId !== identity.actorId || current.actorEpoch !== identity.actorEpoch || current.departureEpoch !== identity.departureEpoch
        || current.agendaFormSessionId !== identity.agendaFormSessionId || current.field !== identity.field
        || current.cardId !== identity.cardId || current.baseRevision !== identity.baseRevision || current.revision !== identity.revision) throw stale();
      return current;
    } else if (typeof identity.outgoingDraftId === 'string') {
      if (!deps.outgoing) throw stale();
      const current = await deps.outgoing.assertAvailable(client, actor, identity.outgoingDraftId, identity.field, identity.baseRevision);
      if (current.outgoingDraftId !== identity.outgoingDraftId || current.actorId !== identity.actorId || current.actorEpoch !== identity.actorEpoch
        || current.departureEpoch !== identity.departureEpoch || current.field !== identity.field || current.revision < identity.revision
        || current.consumedRevision !== identity.consumedRevision) throw stale();
      return current;
    } else if (typeof identity.inboxAttachmentId === 'string') {
      if (!deps.inbox) throw stale();
      const current=await deps.inbox.assertAvailable(client,actor,identity.inboxAttachmentId);
      if (current.inboxAttachmentId!==identity.inboxAttachmentId || current.actorId!==identity.actorId || current.actorEpoch!==identity.actorEpoch
        || current.departureEpoch!==identity.departureEpoch || current.attachmentVersion!==identity.attachmentVersion || current.commentVersion!==identity.commentVersion) throw stale();
      return current;
    } else {
      const current = await deps.capture.assertAvailable(client, actor, identity.captureId);
      if (current.actorId !== identity.actorId || current.actorEpoch !== identity.actorEpoch || current.expiresAt !== identity.expiresAt) throw stale();
      return current;
    }
  }
  async function availability(client: PoolClient, row: ConfigRow, outgoing = false): Promise<TranscriptionAvailabilityDto> {
    const base = { enabled: row.enabled, available: false, maxDurationMs: TRANSCRIPTION_MAX_DURATION_MS,
      maxAudioBytes: TRANSCRIPTION_MAX_AUDIO_BYTES, mediaTypes: ["audio/wav" as const], vocabularySupported: false };
    if (!row.enabled) return { ...base, reason: "disabled" };
    let selected, maximum: number;
    try { ({ selected, maximum } = quote(row)); } catch { return { ...base, reason: "model-unavailable" }; }
    const totals = await usage(client);
    if (BigInt(totals.spentMicros) + BigInt(totals.reservedMicros) + BigInt(maximum) > BigInt(limit(row))) return { ...base, reason: "budget" };
    return { ...base, available: true, vocabularySupported: !outgoing && !!selected.models.find(item => item.id === row.model)?.vocabularySupported };
  }
  async function settle(id: string, actual: unknown, status: "complete" | "failed") {
    return access.transaction(async client => {
      await config(client);
      const cost = typeof actual === "number" && Number.isSafeInteger(actual) && actual >= 0 ? actual : null;
      const row = (await client.query<{ status: TranscriptionResultDto["status"] }>(`UPDATE hestia_transcription_request SET actual_micros=$2,
        status=CASE WHEN $2::bigint>reserved_micros THEN 'failed' ELSE $3 END,settled_at=$4 WHERE id=$1 AND settled_at IS NULL RETURNING status`,
      [id, cost, status, await deps.clock(client)])).rows[0];
      return row?.status ?? "failed";
    });
  }
  async function bounded<T>(action: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([action(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(transcriptionFailure("timeout", "TIMEOUT")); }, deps.requestTimeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  async function handleTranscriptions(request: Request) {
    let responseActor: string | undefined;
    const withActor = <T>(action: (client: PoolClient, actor: Actor) => Promise<T>, touch = true) =>
      access.withActor(request, (client, actor) => { responseActor = actor.id; return action(client, actor); }, touch);
    const result = await guarded(async () => {
      const params = new URL(request.url).searchParams, captureId = params.get("captureId"), inboxAttachmentId=params.get('inboxAttachmentId'), key = params.get("idempotencyKey");
      const outgoingDraftId = params.get("outgoingDraftId"), field = params.get("field"), revision = params.get("baseRevision");
      const agendaFormSessionId = params.get("agendaFormSessionId"), agendaCardId = params.get("agendaCardId");
      const allowed = ["captureId", "inboxAttachmentId", "outgoingDraftId", "agendaFormSessionId", "agendaCardId", "field", "baseRevision", "idempotencyKey"];
      if ([captureId, inboxAttachmentId, outgoingDraftId, agendaFormSessionId].filter(value => value !== null).length !== 1
        || !isUuid(captureId ?? inboxAttachmentId ?? outgoingDraftId ?? agendaFormSessionId) || !["GET", "POST"].includes(request.method)
        || [...params.keys()].some(name => !allowed.includes(name)) || allowed.some(name => params.getAll(name).length > 1)) throw invalid();
      if (agendaFormSessionId !== null) {
        if (!["title", "description"].includes(field ?? "") || (agendaCardId === null ? revision !== null : !isUuid(agendaCardId) || revision === null)) throw invalid();
      } else {
        if (agendaCardId !== null || (outgoingDraftId !== null ? !["subject", "message"].includes(field ?? "")
          || request.method === "POST" && revision === null : field !== null || revision !== null)) throw invalid();
      }
      if (revision !== null && (!/^[1-9]\d{0,9}$/.test(revision) || Number(revision) >= 2147483647)) throw invalid();
      const assertSource=async(client:PoolClient,actor:Actor):Promise<TranscriptionIdentity>=>{
        if (agendaFormSessionId !== null) {
          if (!deps.agenda) throw stale();
          return deps.agenda.assertAvailable(client, actor, agendaFormSessionId, field as "title" | "description", agendaCardId, revision === null ? null : Number(revision));
        }
        if (outgoingDraftId !== null) {
          if (!deps.outgoing) throw stale();
          return deps.outgoing.assertAvailable(client, actor, outgoingDraftId, field as "subject" | "message", revision === null ? undefined : Number(revision));
        }
        if(inboxAttachmentId!==null){if(!deps.inbox)throw stale();return deps.inbox.assertAvailable(client,actor,inboxAttachmentId);}
        return deps.capture.assertAvailable(client,actor,captureId!);
      };
      if (request.method === "GET") return withActor(async (client, actor) => {
        await assertSource(client,actor); return response(await availability(client, await config(client), outgoingDraftId !== null || agendaFormSessionId !== null));
      }, false);
      access.origin(request);
      if (!isUuid(key) || request.headers.get("content-type")?.split(";")[0] !== "audio/wav") throw invalid();
      // Reject unauthenticated/disabled/idempotent calls before buffering audio.
      const initial = await withActor(async (client, actor) => {
        const identity=await assertSource(client,actor);
        const identityHash=typeof identity.agendaFormSessionId === 'string'
          ? hash({source:'agenda',formSessionId:identity.agendaFormSessionId,field:identity.field,cardId:identity.cardId,
            baseRevision:identity.baseRevision,epoch:identity.actorEpoch,departureEpoch:identity.departureEpoch})
          : typeof identity.outgoingDraftId === 'string'
          ? hash({source:'outgoing', draftId:identity.outgoingDraftId, field:identity.field, baseRevision:identity.baseRevision,
            epoch:identity.actorEpoch, departureEpoch:identity.departureEpoch, consumedRevision:identity.consumedRevision})
          : typeof identity.inboxAttachmentId==='string'
          ? hash({source:'inbox',inboxAttachmentId:identity.inboxAttachmentId,epoch:identity.actorEpoch,departureEpoch:identity.departureEpoch,
            attachmentVersion:identity.attachmentVersion,commentVersion:identity.commentVersion})
          : hash({captureId:identity.captureId,epoch:identity.actorEpoch});
        const old = (await client.query<Receipt>("SELECT * FROM hestia_transcription_request WHERE actor_id=$1 AND idempotency_key=$2", [actor.id, key])).rows[0];
        if (old) {
          if (old.identity_hash !== identityHash || Number(old.actor_epoch) !== identity.actorEpoch) throw stale();
          // Audio/transcript are never persisted for replay; no second paid call.
          return { reply: { transcriptionId: old.id, status: old.status === "pending" ? "pending" as const : "stale" as const } };
        }
        const row = await config(client); quote(row);
        return { identity, identityHash, version: row.version };
      });
      if (initial.reply) return response(initial.reply);
      if (active >= 2) throw new HttpError(429, "TRANSCRIPTION_BUSY", "La dictée est occupée. Réessayez dans un instant.");
      active++; let bytes: Buffer | undefined;
      try {
        bytes = await bodyBytes(request, TRANSCRIPTION_MAX_AUDIO_BYTES);
        const durationMs = inspectDictationWav(bytes), identity = initial.identity!;
        const reservation = await withActor(async (client, actor) => {
          await assertSame(client, actor, identity);
          const row = await config(client); if (row.version !== initial.version) throw stale();
          const { selected, maximum } = quote(row);
          // Recheck after buffering: a concurrent retry may have reserved meanwhile.
          const old = (await client.query<Receipt>("SELECT * FROM hestia_transcription_request WHERE actor_id=$1 AND idempotency_key=$2", [actor.id, key])).rows[0];
          if (old) {
            if (old.identity_hash !== initial.identityHash || Number(old.actor_epoch) !== identity.actorEpoch) throw stale();
            return { reply: { transcriptionId: old.id, status: old.status === "pending" ? "pending" as const : "stale" as const } };
          }
          const totals = await usage(client);
          if (BigInt(totals.spentMicros) + BigInt(totals.reservedMicros) + BigInt(maximum) > BigInt(limit(row))) throw budgetError();
          const vocabularySupported = outgoingDraftId === null && agendaFormSessionId === null && !!selected.models.find(item => item.id === row.model)?.vocabularySupported;
          const vocabulary = vocabularySupported ? dictationVocabulary(await deps.readAuthorizedFolders(client, actor)) : [];
          const id = randomUUID();
          await client.query(`INSERT INTO hestia_transcription_request(id,actor_id,actor_epoch,idempotency_key,identity_hash,config_version,month_start,reserved_micros,created_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, actor.id, identity.actorEpoch, key, initial.identityHash, row.version, totals.period.start, maximum, await deps.clock(client)]);
          return { id, row, selected, vocabulary, vocabularySupported };
        });
        if (reservation.reply) return response(reservation.reply);
        const { id, row, selected, vocabulary, vocabularySupported } = reservation;
        let credential: string;
        try {
          credential = await withActor(async (client, actor) => {
            await assertSame(client, actor, identity);
            const current = await config(client);
            if (current.version !== row.version) throw stale(); quote(current);
            if (vocabularySupported && hash(dictationVocabulary(await deps.readAuthorizedFolders(client, actor))) !== hash(vocabulary)) throw stale();
            const value = deps.credentialCipher.open(row.credential_sealed!, aad(row.provider));
            await client.query("UPDATE hestia_transcription_request SET sent_at=$2 WHERE id=$1", [id, await deps.clock(client)]);
            return value;
          });
        } catch (error) { reportTranscriptionFailure(id, error, 0); await settle(id, 0, "failed"); throw error; }
        let actual: unknown = null, text: string | undefined, status: TranscriptionResultDto["status"] = "failed";
        try {
          const payload: TranscriptionPayload = { bytes, mediaType: "audio/wav", durationMs, vocabulary };
          const outcome = await bounded(signal => selected.transcribe(configured(row), payload, credential, signal));
          actual = outcome.actualMicros;
          try { text = transcriptText(outcome.text, agendaFormSessionId !== null ? "agenda" : outgoingDraftId !== null ? "outgoing" : undefined); } catch { throw transcriptionFailure("transcript", "INVALID_TEXT"); }
          status = await settle(id, actual, "complete");
          if (status === "failed") reportTranscriptionFailure(id, transcriptionFailure("service", "SETTLEMENT_FAILED"), actual);
        } catch (error) { reportTranscriptionFailure(id, error, actual); status = await settle(id, actual, "failed"); }
        // Configuration changes affect subsequent calls only. Rights and lifetime
        // are authoritative again after provider I/O; no transaction spans I/O.
        return withActor(async (client, actor) => {
          let current: TranscriptionIdentity;
          try {
            current = await assertSame(client, actor, identity);
            if (vocabularySupported && hash(dictationVocabulary(await deps.readAuthorizedFolders(client, actor))) !== hash(vocabulary)) throw stale();
          } catch (error) {
            if (error instanceof HttpError) return response({ transcriptionId: id, status: "stale" } satisfies TranscriptionResultDto);
            throw error;
          }
          return response({ transcriptionId: id, status, ...(status === "complete" ? { text,
            ...(typeof current.agendaFormSessionId === "string" ? { agenda: { formSessionId: current.agendaFormSessionId,
              field: current.field, cardId: current.cardId, baseRevision: current.baseRevision, revision: current.revision } } : {}),
            ...(typeof current.outgoingDraftId === "string" ? { outgoing: { draftId: current.outgoingDraftId, field: current.field,
              baseRevision: current.baseRevision, revision: current.revision } } : {}) } : {}) } satisfies TranscriptionResultDto);
        }, false);
      } finally { bytes?.fill(0); active--; }
    });
    if (responseActor && new URL(request.url).searchParams.has("agendaFormSessionId")) result.headers.set("X-Hestia-Actor", encodeURIComponent(responseActor));
    return result;
  }
  return { handleTranscriptionSettings, handleTranscriptions };
}
