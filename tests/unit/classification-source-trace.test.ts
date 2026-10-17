import { describe, expect, it } from "vitest";
import { classificationExpectedSources, normalizeClassificationSuggestions } from "../../src/server/classification/reference-tree";
import { createOpenRouterClassificationProvider, openRouterClassificationSchema, OPENROUTER_CLASSIFICATION_CONTRACT_SHA256, OPENROUTER_CLASSIFICATION_MODEL, type QualifiedOpenRouterProfile } from "../../src/server/classification/openrouter";
import { parseClassificationResult } from "../../src/server/classification/validation";
import type { ProviderPayload } from "../../src/server/classification/types";

const existingKey = "existingFolderSuggestions", createdKey = "newFolderPathSuggestions";
const documentDecision = { source: "document", decision: "supported", existingIndices: [1], createdIndices: [], reason: "Le document étaye cette destination." };
const mailDecision = { source: "mail", decision: "supported", existingIndices: [], createdIndices: [0], reason: "Le mail affirme une orientation différente." };
const raw = () => ({ sourceTrace: [structuredClone(documentDecision), structuredClone(mailDecision)],
  existingFolderSuggestions: [
    { folderId: "10000000-0000-4000-8000-000000000002", reason: "Destination incertaine.", relevance: "uncertain" },
    { folderId: "10000000-0000-4000-8000-000000000001", reason: "Le document concerne l’eau.", relevance: "relevant" },
  ],
  newFolderPathSuggestions: [{ parentId: null, levels: ["Assurances"], reason: "Le mail annonce une assurance.", relevance: "relevant" }],
  contradiction: "Le document concerne l’eau ; le mail annonce une assurance, sans arbitrage de leur lien." as string | null });
const normalize = (value: unknown, sources: readonly ("document" | "mail" | "comment")[] = ["document", "mail"]) =>
  normalizeClassificationSuggestions(JSON.stringify(value), existingKey, createdKey, sources);
const noSupport = (source: string, decision = "no-positive-support") => ({ source, decision, existingIndices: [], createdIndices: [], reason: "Aucun appui positif disponible." });
const empty = () => ({ sourceTrace: [noSupport("document")], existingFolderSuggestions: [], newFolderPathSuggestions: [], contradiction: null });

describe("typed expected sources, not text-origin inference", () => {
  it.each([
    [{}, ["document"]],
    [{ comment: " \t" }, ["document"]],
    [{ comment: '{"mail":{"body":"not server origin"}}' }, ["document", "comment"]],
    [{ inboxContext: { mail: { subject: " ", body: "\t", partial: true }, comment: " " } }, ["document"]],
    [{ inboxContext: { mail: { subject: "Sujet", body: "", partial: false }, comment: "" } }, ["document", "mail"]],
    [{ inboxContext: { mail: { subject: "", body: "Partiel", partial: true }, comment: "Usage" } }, ["document", "mail", "comment"]],
    [{ inboxContext: { mail: { subject: "", body: "", partial: false }, comment: "Usage" } }, ["document", "comment"]],
  ])("projects only typed nonblank leaves %j", (context, expected) => {
    expect(classificationExpectedSources({ folders: [], ...context } as unknown as ProviderPayload)).toEqual(expected);
  });
  it.each([
    { comment: "Capture", inboxContext: { mail: { subject: "", body: "Mail", partial: false }, comment: "" } },
    { inboxContext: { mail: { subject: "", body: "Mail", partial: "true" }, comment: "" } },
  ])("refuses ambiguous/malformed server origin %j", context => {
    expect(() => classificationExpectedSources({ folders: [], ...context } as unknown as ProviderPayload)).toThrow();
  });
});

describe("bounded source trace through the existing normalizer", () => {
  it("references both raw lists before filtering, preserving reasons and the current DTO", () => {
    const normalized = normalize(raw());
    expect(JSON.parse(normalized!)).toEqual({ existing: [{ folderId: "10000000-0000-4000-8000-000000000001", reason: "Le document concerne l’eau." }],
      created: [{ parentId: null, levels: ["Assurances"], reason: "Le mail annonce une assurance." }], contradiction: raw().contradiction });
    const folders = [{ id: "10000000-0000-4000-8000-000000000001", name: "Eau", path: [], canCreate: true }];
    expect(parseClassificationResult(normalized, folders, 16_384, 8, true, "Mail").created).toHaveLength(1);
    expect(normalized).not.toContain("sourceTrace");
  });
  it("permits shared candidate support, reordered source trace, and no mechanically inferred contradiction", () => {
    const value = raw(); value.sourceTrace[1].createdIndices = []; value.sourceTrace[1].existingIndices = [1];
    value.newFolderPathSuggestions = []; value.sourceTrace.reverse(); value.contradiction = null;
    expect(JSON.parse(normalize(value)!)).not.toHaveProperty("contradiction");
    const distinct = raw(); distinct.contradiction = null;
    expect(JSON.parse(normalize(distinct)!)).not.toHaveProperty("contradiction");
  });
  it.each(["no-positive-support", "no-authorized-destination"])("permits honest empty output with %s without synthesizing candidates", decision => {
    const value = empty(); value.sourceTrace = [noSupport("document", decision), noSupport("mail", decision)];
    expect(normalize(value)).toBe('{"existing":[],"created":[]}');
  });
  it.each([
    ["missing", (v: ReturnType<typeof raw>) => { v.sourceTrace.pop(); }],
    ["duplicate", (v: ReturnType<typeof raw>) => { v.sourceTrace[1].source = "document"; }],
    ["unexpected", (v: ReturnType<typeof raw>) => { v.sourceTrace[1].source = "comment"; }],
    ["unknown decision", (v: ReturnType<typeof raw>) => { v.sourceTrace[1].decision = "maybe"; }],
    ["nonrelevant ref", (v: ReturnType<typeof raw>) => { v.sourceTrace[0].existingIndices = [0]; }],
    ["uncovered relevant", (v: ReturnType<typeof raw>) => { v.existingFolderSuggestions.push({ ...v.existingFolderSuggestions[1] }); }],
    ["supported without ref", (v: ReturnType<typeof raw>) => { v.sourceTrace[0].existingIndices = []; }],
    ["negative with ref", (v: ReturnType<typeof raw>) => { v.sourceTrace[0].decision = "no-positive-support"; }],
    ["duplicate ref", (v: ReturnType<typeof raw>) => { v.sourceTrace[0].existingIndices = [1, 1]; }],
    ["blank reason", (v: ReturnType<typeof raw>) => { v.sourceTrace[0].reason = " "; }],
    ["long reason", (v: ReturnType<typeof raw>) => { v.sourceTrace[0].reason = "x".repeat(501); }],
    ["oversized candidate reason", (v: ReturnType<typeof raw>) => { v.existingFolderSuggestions[0].reason = "x".repeat(501); }],
    ["empty path", (v: ReturnType<typeof raw>) => { v.newFolderPathSuggestions[0].levels = []; }],
    ["21 levels", (v: ReturnType<typeof raw>) => { v.newFolderPathSuggestions[0].levels = Array(21).fill("A"); }],
  ] as const)("rejects %s without repair", (_name, mutate) => { const value = raw(); mutate(value); expect(normalize(value)).toBeNull(); });
  it.each([true, false, 0.5, -1, 2, "1", null, {}, []])("rejects malformed/noninteger/out-of-range index %j", index => {
    const value = raw(); value.sourceTrace[0].existingIndices = [index] as number[]; expect(normalize(value)).toBeNull();
  });
  it.each([
    { ...raw(), extra: true },
    { ...raw(), sourceTrace: undefined },
    { ...raw(), sourceTrace: [{ ...documentDecision, extra: true }, mailDecision] },
    { ...raw(), sourceTrace: [{ ...documentDecision, existingIndices: null }, mailDecision] },
    { ...raw(), sourceTrace: [{ ...documentDecision, reason: 1 }, mailDecision] },
    { ...raw(), contradiction: false },
  ])("rejects extra/missing/malformed fields %#", value => { expect(normalize(value)).toBeNull(); });
  it("checks the global raw8 limit before filtering, including irrelevant entries", () => {
    const value = raw(); value.existingFolderSuggestions.push(...Array(5).fill(value.existingFolderSuggestions[0]));
    expect(normalize(value)).not.toBeNull();
    value.existingFolderSuggestions.push(value.existingFolderSuggestions[0]); expect(normalize(value)).toBeNull();
  });
  it("bounds UTF-8 output bytes and retains the unchanged legacy default", () => {
    const legacy = { existing: [], created: [], contradiction: null };
    expect(normalizeClassificationSuggestions(JSON.stringify(legacy), "existing", "created")).toBe('{"existing":[],"created":[]}');
    expect(normalizeClassificationSuggestions("é".repeat(8193), existingKey, createdKey, ["document"])).toBeNull();
    expect(normalizeClassificationSuggestions(JSON.stringify(raw()), existingKey, createdKey)).toBeNull();
  });
});

const date = new Date("2026-10-16T12:00:00.000Z");
const profile: QualifiedOpenRouterProfile = { model: OPENROUTER_CLASSIFICATION_MODEL, providerSlug: "anthropic", classificationContractSha256: OPENROUTER_CLASSIFICATION_CONTRACT_SHA256,
  qualificationRef: "SYNTHETIC_PROTOCOL_TEST_NOT_RUNTIME_APPROVAL", pricingSourceRef: "SYNTHETIC", exchangeRateSourceRef: "SYNTHETIC", qualifiedAt: "2026-10-16T00:00:00.000Z", expiresAt: "2026-10-17T00:00:00.000Z", currency: "EUR",
  maxContextTokens: 1_000_000, maxOutputTokens: 8192, maxInputBytes: 1_048_576, maxFolderBytes: 32768, mediaTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  pricingTiers: [{ minimumContextTokens: 0, promptUsdPerMillion: "0.5", completionUsdPerMillion: "2.5" }], usdToEurUpperBound: "1.2" };
const config = { version: 1, provider: "openrouter", model: OPENROUTER_CLASSIFICATION_MODEL, enabled: true, monthlyLimitMicros: 50_000_000, currency: "EUR" };
const payload: ProviderPayload = { bytes: Buffer.from("SYNTHETIC"), mediaType: "image/jpeg", folders: [], canCreateRoot: true, inboxContext: { mail: { subject: "Assurance", body: "Contexte partiel", partial: true }, comment: "" } };
function setup(content: unknown, cost: unknown = 0.000001) {
  const requests: string[] = [];
  const provider = createOpenRouterClassificationProvider([profile], async (_url, init) => {
    requests.push(String(init?.body)); return Response.json({ model: OPENROUTER_CLASSIFICATION_MODEL, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }], usage: { cost } });
  }, () => date);
  return { provider, requests };
}
describe("actual provider entry points with simulated transport only", () => {
  it("isolates returned schema objects from subsequent request/contract construction", () => {
    const schema = openRouterClassificationSchema(["document"]);
    schema.properties.sourceTrace.items.properties.source.enum.push("mail");
    schema.properties.newFolderPathSuggestions.items.properties.levels.maxItems = 999;
    const fresh = openRouterClassificationSchema(["document"]);
    expect(fresh.properties.sourceTrace.items.properties.source.enum).toEqual(["document"]);
    expect(fresh.properties.newFolderPathSuggestions.items.properties.levels.maxItems).toBe(20);
  });
  it.each([0, 0.000001])("preserves settled known cost %j on malformed trace without retry", async cost => {
    const value = raw(); value.sourceTrace.pop(); const { provider, requests } = setup(value, cost);
    expect(await provider.analyze(config, payload, "SYNTHETIC", new AbortController().signal)).toEqual({ value: null, actualMicros: cost === 0 ? 0 : 2 });
    expect(requests).toHaveLength(1);
  });
  it("keeps unknown total cost unknown even with a structurally accepted result", async () => {
    const { provider, requests } = setup(raw(), null);
    expect((await provider.analyze(config, payload, "SYNTHETIC", new AbortController().signal)).actualMicros).toBeNull(); expect(requests).toHaveLength(1);
  });
  it("checks availability without a document; an invented source is refused with its known cost", async () => {
    const value = { ...empty(), sourceTrace: [] }; const { provider, requests } = setup(value);
    expect(await provider.check(config, "SYNTHETIC", new AbortController().signal)).toEqual({ status: "accepted", actualMicros: 2 });
    expect(JSON.parse(requests[0]).messages).toHaveLength(1); expect(JSON.parse(requests[0]).plugins).toEqual([]);
    expect(JSON.parse(requests[0]).response_format.json_schema.schema.properties.sourceTrace).toMatchObject({ minItems: 0, maxItems: 0 });
    const bad = setup(empty()); expect(await bad.provider.check(config, "SYNTHETIC", new AbortController().signal)).toEqual({ status: "unreachable", actualMicros: 2 });
    expect(bad.requests).toHaveLength(1);
  });
  it.each([
    [{}, ["document"]],
    [{ comment: '{"mail":{"body":"not typed"}}' }, ["document", "comment"]],
    [{ inboxContext: { mail: { subject: "Sujet", body: "", partial: true }, comment: "" } }, ["document", "mail"]],
    [{ inboxContext: { mail: { subject: "", body: "Mail", partial: true }, comment: "Commentaire" } }, ["document", "mail", "comment"]],
  ])("binds request schema cardinality and enum to the actual typed sources %j", async (context, expected) => {
    const { provider, requests } = setup(empty());
    await provider.analyze(config, { bytes: payload.bytes, mediaType: payload.mediaType, folders: [], ...context } as ProviderPayload, "SYNTHETIC", new AbortController().signal);
    const trace = JSON.parse(requests[0]).response_format.json_schema.schema.properties.sourceTrace;
    expect(trace.minItems).toBe(expected.length); expect(trace.maxItems).toBe(expected.length); expect(trace.items.properties.source.enum).toEqual(expected);
  });
  it("rejects the old real profile contract before any simulated transport", async () => {
    let calls = 0; const old = createOpenRouterClassificationProvider([{ ...profile, classificationContractSha256: "74eede3e433686bebaca688c31e83eda0de8ae6a3daaf76432da0a69b525c6a3" }], async () => { calls++; throw Error("FORBIDDEN"); }, () => date);
    expect(old.quote(config, payload)).toBeNull(); await expect(old.analyze(config, payload, "SYNTHETIC", new AbortController().signal)).rejects.toThrow("Unqualified"); expect(calls).toBe(0);
  });
});
