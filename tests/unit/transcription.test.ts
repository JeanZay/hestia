import { describe, expect, it, vi } from "vitest";
import { dictationVocabulary, inspectDictationWav, transcriptText } from "../../src/server/transcription/validation";
import { createOpenRouterTranscriptionProvider, OPENROUTER_TRANSCRIPTION_CONTRACT_SHA256, OPENROUTER_TRANSCRIPTION_MODEL, parseQualifiedTranscriptionProfile, type QualifiedTranscriptionProfile } from "../../src/server/transcription/openrouter";
import { readTranscriptionDeployment } from "../../src/server/transcription/deployment";
import { reportTranscriptionFailure, transcriptionFailure, transcriptionFailureMetadata } from "../../src/server/transcription/diagnostics";

function wav(seconds = 1) {
  const value = Buffer.alloc(44 + seconds * 32_000);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVEfmt ", 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write("data", 36); value.writeUInt32LE(value.length - 44, 40);
  return value;
}
const now = new Date("2026-10-14T12:00:00.000Z");
const profile: QualifiedTranscriptionProfile = { model: OPENROUTER_TRANSCRIPTION_MODEL, contractSha256: OPENROUTER_TRANSCRIPTION_CONTRACT_SHA256,
  qualificationRef: "synthetic-contract-test", pricingSourceRef: "synthetic-price", exchangeRateSourceRef: "synthetic-fx", privacySourceRef: "synthetic-privacy",
  qualifiedAt: "2026-10-14T00:00:00.000Z", expiresAt: "2026-10-20T00:00:00.000Z", currency: "EUR", usdPerHour: "0.1", usdToEurUpperBound: "1.01" };
const config = { version: 1, provider: "openrouter", model: OPENROUTER_TRANSCRIPTION_MODEL, enabled: true, monthlyLimitMicros: 1_000_000, currency: "EUR" as const };

describe("dictation input and vocabulary boundaries", () => {
  it("computes duration from canonical PCM samples, rejecting spoofed/oversized/other-format audio", () => {
    expect(inspectDictationWav(wav(120))).toBe(120_000);
    expect(() => inspectDictationWav(wav(121))).toThrow();
    expect(() => inspectDictationWav(wav(0))).toThrow();
    for (const offset of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
      const changed = wav(); changed[offset] ^= 1; expect(() => inspectDictationWav(changed)).toThrow();
    }
    expect(() => inspectDictationWav(Buffer.concat([wav(), Buffer.from("hidden metadata")]))).toThrow();
  });
  it("uses only eligible folder names, deduplicates accents/case, bounds work sent, never ancestor paths", () => {
    const folders = ["Café", "Cafe\u0301", "CAFÉ", "Véhicule-A", "\u0000Hidden", "x".repeat(65), ...Array.from({ length: 300 }, (_, i) => `Dossier ${i}`)]
      .map((name, index) => ({ id: String(index), name, path: [{ id: "hidden", name: "Ancestor secret" }], canCreate: true }));
    const vocabulary = dictationVocabulary(folders);
    expect(vocabulary.slice(0, 2)).toEqual(["Café", "Véhicule-A"]); expect(vocabulary.length).toBe(64);
    expect(vocabulary.join()).not.toContain("Ancestor"); expect(vocabulary.reduce((sum, item) => sum + Buffer.byteLength(item), 0)).toBeLessThanOrEqual(2048);
  });
  it("returns overlong text without truncating so it can be corrected, but rejects unbounded/invalid output", () => {
    const long = "é".repeat(2500); expect(transcriptText(long)).toBe(long); expect(transcriptText("   ")).toBe("");
    expect(() => transcriptText("x".repeat(16385))).toThrow(); expect(() => transcriptText("bad\u0000text")).toThrow();
  });
  it("bounds outgoing proposals separately while leaving existing sources strict", () => {
    for (const value of ["x".repeat(20_001), "x".repeat(32_768), "bad\u0000text", "bad\u000ctext"])
      expect(transcriptText(value, "outgoing")).toBe(value);
    expect(() => transcriptText("x".repeat(32_769), "outgoing")).toThrow();
    expect(() => transcriptText("é".repeat(32_769), "outgoing")).toThrow();
    expect(() => transcriptText("bad\u0000text")).toThrow();
    expect(() => transcriptText("x".repeat(20_001))).toThrow();
  });
  it("excludes whole terms over 50 UTF8 bytes after normalization and keeps eligible Unicode intact", () => {
    const names = ["a".repeat(51), "a".repeat(50), "é".repeat(26), "  " + "e\u0301".repeat(25) + "  ",
      "é".repeat(25), "😀".repeat(13), "😀".repeat(12), "Véhicule-B", "Maëlys"];
    const folders = names.map((name, index) => ({ id: String(index), name, path: [], canCreate: true }));
    expect(dictationVocabulary(folders)).toEqual(["a".repeat(50), "é".repeat(25), "😀".repeat(12), "Véhicule-B", "Maëlys"]);
    expect(folders.map(folder => folder.name)).toEqual(names);
    expect(dictationVocabulary(folders.filter(folder => Buffer.byteLength(folder.name.normalize("NFC").trim()) > 50))).toEqual([]);
  });
  it("keeps the 2048 byte total budget and continues past an oversized remaining term", () => {
    const names = [...Array.from({ length: 40 }, (_, i) => String(i).padStart(2, "0") + "a".repeat(48)), "b".repeat(49), "c".repeat(48), "d"];
    const vocabulary = dictationVocabulary(names.map((name, index) => ({ id: String(index), name, path: [], canCreate: true })));
    expect(vocabulary).toEqual([...names.slice(0, 40), "c".repeat(48)]);
    expect(vocabulary.reduce((sum, term) => sum + Buffer.byteLength(term), 0)).toBe(2048);
  });
});

describe("content-free transcription failure diagnostics", () => {
  const sentinel = "SYNTHETIC_SECRET_DO_NOT_LOG";
  const payload = () => ({ bytes: wav(), durationMs: 1000, mediaType: "audio/wav" as const, vocabulary: [sentinel] });
  async function failure(transport: typeof fetch) {
    const provider = createOpenRouterTranscriptionProvider([profile], transport, () => now);
    try { await provider.transcribe(config, payload(), sentinel, new AbortController().signal); }
    catch (error) { return error; }
    throw new Error("Expected failure");
  }
  it.each([400, 401, 429, 500, 503])("records HTTP %i without reading its body or headers and without retry", async status => {
    const body = new ReadableStream({ pull() { throw new Error(sentinel); } });
    const transport = vi.fn(async () => new Response(body, { status, headers: { "x-private": sentinel } }));
    const error = await failure(transport);
    expect(transcriptionFailureMetadata(error)).toEqual({ stage: "http", reason: "HTTP_ERROR", httpStatus: status });
    expect(transport).toHaveBeenCalledTimes(1); expect(String(error)).not.toContain(sentinel);
  });
  it("distinguishes transport, response structure and bounded read failures without arbitrary error strings", async () => {
    const cases: [typeof fetch, string][] = [
      [async () => { throw new Error(sentinel); }, "REQUEST_FAILED"],
      [async () => new Response(null), "EMPTY_BODY"],
      [async () => new Response(sentinel), "INVALID_JSON"],
      [async () => Response.json([sentinel]), "INVALID_SHAPE"],
      [async () => new Response("x".repeat(131073)), "TOO_LARGE"],
      [async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(sentinel)); } })), "READ_FAILED"],
    ];
    for (const [transport, reason] of cases) {
      const error = await failure(transport); expect(transcriptionFailureMetadata(error).reason).toBe(reason);
      expect(String(error)).not.toContain(sentinel);
    }
  });
  it("marks abort and preflight locally without an extra request", async () => {
    const controller = new AbortController();
    const transport = vi.fn(async () => { controller.abort(); throw new Error(sentinel); });
    const provider = createOpenRouterTranscriptionProvider([profile], transport, () => now);
    let caught: unknown;
    try { await provider.transcribe(config, payload(), sentinel, controller.signal); } catch (error) { caught = error; }
    expect(transcriptionFailureMetadata(caught)).toEqual({ stage: "timeout", reason: "TIMEOUT" });
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(provider.transcribe(config, { ...payload(), durationMs: 2000 }, sentinel, new AbortController().signal)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("cannot forge metadata with error properties, never inspects getters and ignores logger failure", () => {
    const id = "ea97a430-a9bf-4ae5-8aca-697cbb288e7f";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hostile = { get message() { throw new Error(sentinel); }, stage: sentinel, reason: sentinel, httpStatus: 401, cause: sentinel, stack: sentinel };
      reportTranscriptionFailure(id, hostile, null);
      expect(warn).toHaveBeenLastCalledWith(JSON.stringify({ event: "hestia.transcription.failed", transcriptionId: id, stage: "service", reason: "UNEXPECTED_FAILURE", costKnown: false }));
      reportTranscriptionFailure(id, transcriptionFailure("http", "HTTP_ERROR", 429), 17);
      expect(warn).toHaveBeenLastCalledWith(JSON.stringify({ event: "hestia.transcription.failed", transcriptionId: id, stage: "http", reason: "HTTP_ERROR", httpStatus: 429, costKnown: true }));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel);
      warn.mockImplementation(() => { throw new Error(sentinel); });
      expect(() => reportTranscriptionFailure(id, hostile, null)).not.toThrow();
    } finally { warn.mockRestore(); }
  });
});

describe("qualified MAI adapter", () => {
  it("requires complete, fresh qualification bound to this exact contract", () => {
    expect(parseQualifiedTranscriptionProfile(profile, now)).not.toBeNull();
    const priorContractSha256 = "77e90e14ae29a176cbd2dfd0f2d2d49afcd17c2332ded597b79af2909200dd0f";
    expect(OPENROUTER_TRANSCRIPTION_CONTRACT_SHA256).not.toBe(priorContractSha256);
    expect(parseQualifiedTranscriptionProfile({ ...profile, contractSha256: priorContractSha256 }, now)).toBeNull();
    for (const change of [{ model: "other/model" }, { contractSha256: "0".repeat(64) }, { currency: "USD" }, { usdPerHour: "0" }, { extra: true },
      { qualifiedAt: "2026-10-15T00:00:00.000Z" }, { expiresAt: "2026-10-13T00:00:00.000Z" }, { expiresAt: "2027-10-20T00:00:00.000Z" }, { privacySourceRef: "" }]) {
      expect(parseQualifiedTranscriptionProfile({ ...profile, ...change }, now)).toBeNull();
    }
    expect(readTranscriptionDeployment("production", {}, () => now).allowRemote).toBe(false);
    const env = { HESTIA_TRANSCRIPTION_REMOTE: "openrouter-stt-production", HESTIA_TRANSCRIPTION_PROFILES: JSON.stringify([profile]) };
    expect(readTranscriptionDeployment("production", env, () => now).allowRemote).toBe(true);
    expect(readTranscriptionDeployment("dev", env, () => now).allowRemote).toBe(false);
  });
  it.each(["a".repeat(51), "é".repeat(26), "😀".repeat(13)])("rejects an overlong term before any provider request", async term => {
    const transport = vi.fn(async () => Response.json({ text: "Texte synthétique", usage: { cost: 0.0001 } }));
    const provider = createOpenRouterTranscriptionProvider([profile], transport, () => now);
    let caught: unknown;
    try { await provider.transcribe(config, { bytes: wav(), durationMs: 1000, mediaType: "audio/wav", vocabulary: ["Court", term] }, "synthetic-key", new AbortController().signal); }
    catch (error) { caught = error; }
    expect(transcriptionFailureMetadata(caught)).toEqual({ stage: "preflight", reason: "INVALID_VOCABULARY" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("sends normalized boundary terms unchanged and also accepts empty optional vocabulary", async () => {
    const transport = vi.fn(async () => Response.json({ text: "Texte synthétique", usage: { cost: 0.0001 } }));
    const provider = createOpenRouterTranscriptionProvider([profile], transport, () => now);
    for (const vocabulary of [["a".repeat(50), "é".repeat(25), "😀".repeat(12)], []]) {
      await provider.transcribe(config, { bytes: wav(), durationMs: 1000, mediaType: "audio/wav", vocabulary }, "synthetic-key", new AbortController().signal);
      const call = transport.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(JSON.parse(String(call[1].body)).provider.options.azure.phraseList.phrases).toEqual(vocabulary);
    }
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("sends one bounded WAV and vocabulary with mandatory privacy and verbatim options; reserves full duration with exact rounding", async () => {
    const transport = vi.fn(async () => Response.json({ text: "Non, véhicule B, pas A.", usage: { cost: 0.0001 } }));
    const provider = createOpenRouterTranscriptionProvider([profile], transport, () => now), bytes = wav();
    expect(provider.quote(config)).toEqual({ maximumMicros: 3367, currency: "EUR" });
    const result = await provider.transcribe(config, { bytes, durationMs: 1000, mediaType: "audio/wav", vocabulary: ["Véhicule-B"] }, "synthetic-key", new AbortController().signal);
    expect(result).toEqual({ text: "Non, véhicule B, pas A.", actualMicros: 101 }); expect(transport).toHaveBeenCalledTimes(1);
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(call[1].redirect).toBe("error");
    const body = JSON.parse(String(call[1].body)); expect(body).toMatchObject({ model: OPENROUTER_TRANSCRIPTION_MODEL, response_format: "json", provider: {
      zdr: true, data_collection: "deny", options: { azure: { phraseList: { phrases: ["Véhicule-B"] }, enhancedMode: { enabled: true, model: "MAI-Transcribe-2", modelOptions: { transcribeStyle: "verbatim" } } } } } });
    expect(body.prompt).toBeUndefined(); expect(body.models).toBeUndefined(); expect(body.provider.only).toBeUndefined();
    expect(Buffer.from(body.input_audio.data, "base64")).toEqual(bytes);
  });
  it("retains unknown costs and never retries failed service calls", async () => {
    const transport = vi.fn(async () => new Response("error", { status: 503 }));
    const provider = createOpenRouterTranscriptionProvider([profile], transport, () => now);
    await expect(provider.transcribe(config, { bytes: wav(), durationMs: 1000, mediaType: "audio/wav", vocabulary: [] }, "synthetic-key", new AbortController().signal)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const noCost = createOpenRouterTranscriptionProvider([profile], async () => Response.json({ text: "Texte" }), () => now);
    expect((await noCost.transcribe(config, { bytes: wav(), durationMs: 1000, mediaType: "audio/wav", vocabulary: [] }, "synthetic-key", new AbortController().signal)).actualMicros).toBeNull();
  });
  it("expires the usable catalogue without a process restart", () => {
    let clock = now; const provider = createOpenRouterTranscriptionProvider([profile], fetch, () => clock);
    expect(provider.models).toHaveLength(1); clock = new Date(profile.expiresAt);
    expect(provider.models).toHaveLength(0); expect(provider.quote(config)).toBeNull();
  });
});
