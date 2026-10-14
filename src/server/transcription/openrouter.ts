import { createHash } from "node:crypto";
import type { TranscriptionProvider } from "./types";
import { inspectDictationWav, transcriptText } from "./validation";
import { transcriptionFailure } from "./diagnostics";

export const OPENROUTER_TRANSCRIPTION_MODEL = "microsoft/mai-transcribe-2";
const contract = { model: OPENROUTER_TRANSCRIPTION_MODEL, format: "wav-pcm16-mono-16000", maximumSeconds: 120,
  privacy: { zdr: true, data_collection: "deny" }, options: { azure: { enhancedMode: { enabled: true, model: "MAI-Transcribe-2", modelOptions: { transcribeStyle: "verbatim" } } } },
  vocabulary: { field: "provider.options.azure.phraseList.phrases", maximumTerms: 64, maximumBytes: 2048 }, responseFormat: "json" };
export const OPENROUTER_TRANSCRIPTION_CONTRACT_SHA256 = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
/** No credential. Each referenced qualification must cover the exact contract,
 * WAV decoding, vocabulary, privacy and the total hourly price including fees. */
export type QualifiedTranscriptionProfile = Readonly<{
  model: typeof OPENROUTER_TRANSCRIPTION_MODEL; contractSha256: string;
  qualificationRef: string; pricingSourceRef: string; exchangeRateSourceRef: string; privacySourceRef: string;
  qualifiedAt: string; expiresAt: string; currency: "EUR"; usdPerHour: string; usdToEurUpperBound: string;
}>;
const scale = 1_000_000_000_000n;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function decimal(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,6})(\.\d{1,12})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0")); return result > 0n ? result : null;
}
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
function maximumMicros(profile: QualifiedTranscriptionProfile) {
  return Number(ceil(120n * decimal(profile.usdPerHour)! * decimal(profile.usdToEurUpperBound)! * 1_000_000n, 3600n * scale * scale));
}
export function parseQualifiedTranscriptionProfile(value: unknown, now = new Date()): QualifiedTranscriptionProfile | null {
  if (!record(value)) return null;
  const keys = ["model", "contractSha256", "qualificationRef", "pricingSourceRef", "exchangeRateSourceRef", "privacySourceRef", "qualifiedAt", "expiresAt", "currency", "usdPerHour", "usdToEurUpperBound"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || value.model !== OPENROUTER_TRANSCRIPTION_MODEL || value.contractSha256 !== OPENROUTER_TRANSCRIPTION_CONTRACT_SHA256 || value.currency !== "EUR") return null;
  if (![value.qualificationRef, value.pricingSourceRef, value.exchangeRateSourceRef, value.privacySourceRef]
    .every(item => typeof item === "string" && item.trim() === item && item.length > 0 && item.length <= 512 && !/[\u0000-\u001f]/u.test(item))) return null;
  if (![value.qualifiedAt, value.expiresAt].every(item => typeof item === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(item))) return null;
  const start = Date.parse(value.qualifiedAt as string), end = Date.parse(value.expiresAt as string), current = now.getTime();
  if (![start, end, current].every(Number.isFinite) || start > current || current >= end || end <= start || end - start > 31 * 86_400_000
    || new Date(start).toISOString() !== (value.qualifiedAt as string).replace(/(?<!\.\d{3})Z$/u, ".000Z")
    || new Date(end).toISOString() !== (value.expiresAt as string).replace(/(?<!\.\d{3})Z$/u, ".000Z")
    || decimal(value.usdPerHour) === null || decimal(value.usdToEurUpperBound) === null) return null;
  const result = value as QualifiedTranscriptionProfile, maximum = maximumMicros(result);
  return Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 1_000_000_000_000 ? Object.freeze({ ...result }) : null;
}
function actualMicros(usage: unknown, profile: QualifiedTranscriptionProfile): number | null {
  if (!record(usage) || typeof usage.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/u.exec(String(usage.cost)); if (!match) return null;
  const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0) - fraction.length;
  let numerator = BigInt(match[1] + fraction) * decimal(profile.usdToEurUpperBound)! * 1_000_000n, denominator = scale;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent); else denominator *= 10n ** BigInt(-exponent);
  const cost = ceil(numerator, denominator); return cost <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cost) : null;
}
async function readResponse(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader(); if (!reader) throw transcriptionFailure("response", "EMPTY_BODY");
  const buffers: Uint8Array[] = []; let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw transcriptionFailure("timeout", "TIMEOUT");
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await reader.read(); } catch { throw transcriptionFailure(signal.aborted ? "timeout" : "response", signal.aborted ? "TIMEOUT" : "READ_FAILED"); }
      if (signal.aborted) throw transcriptionFailure("timeout", "TIMEOUT"); if (part.done) break;
      total += part.value.byteLength; if (total > 131_072) {
        try { await reader.cancel(); } catch { /* Preserve the bounded size diagnosis. */ }
        throw transcriptionFailure("response", "TOO_LARGE");
      }
      buffers.push(part.value);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(buffers).toString("utf8")); } catch { throw transcriptionFailure("response", "INVALID_JSON"); }
    if (!record(value)) throw transcriptionFailure("response", "INVALID_SHAPE"); return value;
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
export function createOpenRouterTranscriptionProvider(profiles: readonly QualifiedTranscriptionProfile[], transport: typeof fetch = fetch, now: () => Date = () => new Date()): TranscriptionProvider {
  const qualified = profiles.map(profile => parseQualifiedTranscriptionProfile(profile, now())).filter((profile): profile is QualifiedTranscriptionProfile => profile !== null);
  const current = (model: string) => qualified.find(profile => profile.model === model && parseQualifiedTranscriptionProfile(profile, now()));
  return {
    id: "openrouter", mode: "remote", label: "OpenRouter",
    get models() { return qualified.filter(profile => current(profile.model)).map(profile => ({ id: profile.model, label: "MAI-Transcribe 2", vocabularySupported: true })); },
    quote(config) { const profile = current(config.model); return profile ? { maximumMicros: maximumMicros(profile), currency: "EUR" } : null; },
    async transcribe(config, payload, credential, signal) {
      const profile = current(config.model); if (!profile || signal.aborted) throw transcriptionFailure("preflight", "UNAVAILABLE");
      try {
        if (payload.mediaType !== "audio/wav" || inspectDictationWav(payload.bytes) !== payload.durationMs) throw new Error();
      } catch { throw transcriptionFailure("preflight", "INVALID_AUDIO"); }
      if (payload.vocabulary.length > 64 || payload.vocabulary.reduce((sum, term) => sum + Buffer.byteLength(term), 0) > 2048) throw transcriptionFailure("preflight", "INVALID_VOCABULARY");
      // No generic prompt, fallback model or automatic retry. The STT API ignores
      // provider.order/only, so qualification covers this model's ZDR endpoint.
      let result: Response;
      try { result = await transport("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST", redirect: "error", headers: { "Authorization": `Bearer ${credential}`, "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ model: profile.model, input_audio: { data: Buffer.from(payload.bytes).toString("base64"), format: "wav" }, response_format: "json",
          provider: { ...contract.privacy, options: { azure: { ...contract.options.azure, phraseList: { phrases: payload.vocabulary } } } } }),
      }); } catch { throw transcriptionFailure(signal.aborted ? "timeout" : "transport", signal.aborted ? "TIMEOUT" : "REQUEST_FAILED"); }
      if (!result.ok) {
        try { await result.body?.cancel(); } catch { /* Do not read the provider error body. */ }
        throw transcriptionFailure("http", "HTTP_ERROR", result.status);
      }
      const body = await readResponse(result, signal);
      // Preserve cost even when the transcript is malformed; the common service
      // validates the text after it has received this accounting observation.
      return { text: body.text as string, actualMicros: actualMicros(body.usage, profile) };
    },
  };
}

/** Shared by qualification callers without changing the production adapter. */
export const validateTranscriptionText = transcriptText;
