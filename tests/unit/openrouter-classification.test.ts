import { describe, expect, it, vi } from "vitest";
import { createOpenRouterClassificationProvider, OPENROUTER_CLASSIFICATION_MODEL, parseQualifiedOpenRouterProfile, type QualifiedOpenRouterProfile } from "../../src/server/classification/openrouter";
import { parseClassificationResult } from "../../src/server/classification/validation";

const date = new Date("2026-10-10T12:00:00.000Z");
const profile: QualifiedOpenRouterProfile = {
  model: OPENROUTER_CLASSIFICATION_MODEL, providerSlug: "anthropic", currency: "EUR",
  qualificationRef: "synthetic-qualification-only", pricingSourceRef: "synthetic-prices-only", exchangeRateSourceRef: "synthetic-fx-only",
  qualifiedAt: "2026-10-10T00:00:00.000Z", expiresAt: "2026-10-11T00:00:00.000Z",
  maxContextTokens: 1_000_000, maxOutputTokens: 2048, maxInputBytes: 1024, maxFolderBytes: 4096,
  mediaTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"], usdToEurUpperBound: "1.1",
  pricingTiers: [{ minimumContextTokens: 0, promptUsdPerMillion: "0.1", completionUsdPerMillion: "0.5" },
    { minimumContextTokens: 100_001, promptUsdPerMillion: "0.5", completionUsdPerMillion: "2.5" }],
};
const config = { provider: "openrouter", model: OPENROUTER_CLASSIFICATION_MODEL, enabled: true, version: 1, monthlyLimitMicros: 50_000_000, currency: "EUR" };
const folder = { id: "10000000-0000-4000-8000-000000000001", name: "Factures synthétiques", path: [], canCreate: true };
const payload = { bytes: Buffer.from("synthetic selected document"), mediaType: "application/pdf" as const, folders: [folder] };
const suggestions = { existing: [{ folderId: folder.id, reason: "Facture synthétique" }], created: [] };
const signal = () => new AbortController().signal;
function body(content = JSON.stringify(suggestions), usage: unknown = { cost: 0.000001, cost_details: { upstream_inference_cost: 90 } }) {
  return { model: OPENROUTER_CLASSIFICATION_MODEL, choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage };
}
function setup(value: unknown = body(), selected = profile) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
  return { transport, provider: createOpenRouterClassificationProvider([selected], transport, () => date) };
}

describe("OpenRouter qualified profile gate", () => {
  it("has no defaults or transport when qualification is missing", async () => {
    const transport = vi.fn<typeof fetch>(), provider = createOpenRouterClassificationProvider([], transport, () => date);
    expect(provider.models).toEqual([]); expect(provider.quote(config, payload)).toBeNull(); expect(provider.quoteCheck(config)).toBeNull();
    await expect(provider.analyze(config, payload, "synthetic-credential", signal())).rejects.toThrow("Unqualified");
    await expect(provider.check(config, "synthetic-credential", signal())).rejects.toThrow("Unqualified");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, { ...profile, unexpected: true }, { ...profile, model: "another-model" }, { ...profile, currency: "USD" },
    { ...profile, qualificationRef: " " }, { ...profile, pricingSourceRef: "" }, { ...profile, exchangeRateSourceRef: "" },
    { ...profile, providerSlug: "anthropic,other" }, { ...profile, providerSlug: "https://example.test" },
    { ...profile, qualifiedAt: "2026-10-10T13:00:00.000Z" }, { ...profile, expiresAt: "2026-10-10T12:00:00.000Z" },
    { ...profile, expiresAt: "2027-10-10T12:00:00.000Z" }, { ...profile, expiresAt: "not-a-date" },
    { ...profile, maxContextTokens: 0 }, { ...profile, maxOutputTokens: -1 }, { ...profile, maxOutputTokens: 32_769 },
    { ...profile, maxContextTokens: 2048 }, { ...profile, maxInputBytes: 20 * 1024 * 1024 + 1 }, { ...profile, maxFolderBytes: 1_048_577 },
    { ...profile, mediaTypes: ["image/heic"] }, { ...profile, mediaTypes: [] }, { ...profile, mediaTypes: ["image/png", "image/png"] },
    { ...profile, usdToEurUpperBound: "-1" }, { ...profile, usdToEurUpperBound: 1.1 }, { ...profile, usdToEurUpperBound: "Infinity" },
    { ...profile, usdToEurUpperBound: "0" }, { ...profile, usdToEurUpperBound: "1.0000000000001" },
    { ...profile, pricingTiers: [] }, { ...profile, pricingTiers: [{ minimumContextTokens: 1, promptUsdPerMillion: "0.1", completionUsdPerMillion: "0.5" }] },
    { ...profile, pricingTiers: [{ minimumContextTokens: 0, promptUsdPerMillion: "-0.1", completionUsdPerMillion: "0.5" }] },
    { ...profile, pricingTiers: [profile.pricingTiers[0], profile.pricingTiers[0]] },
  ])("rejects invalid profile %# without emission", async value => {
    expect(parseQualifiedOpenRouterProfile(value, date)).toBeNull();
    const transport = vi.fn<typeof fetch>();
    const provider = createOpenRouterClassificationProvider([value as QualifiedOpenRouterProfile], transport, () => date);
    expect(provider.quote(config, payload)).toBeNull();
    await expect(provider.analyze(config, payload, "synthetic", signal())).rejects.toThrow("Unqualified");
    expect(transport).not.toHaveBeenCalled();
  });
  it("revalidates expiry at emission and prevents mutable or ambiguous profile changes", async () => {
    let current = date;
    const mutable = structuredClone(profile), transport = vi.fn<typeof fetch>();
    const provider = createOpenRouterClassificationProvider([mutable], transport, () => current);
    expect(provider.quote(config, payload)?.maximumMicros).toBe(555_632);
    Object.assign(mutable, { usdToEurUpperBound: "100" });
    expect(provider.quote(config, payload)?.maximumMicros).toBe(555_632);
    current = new Date(profile.expiresAt);
    expect(provider.quoteCheck(config)).toBeNull(); expect(provider.models).toEqual([]);
    await expect(provider.analyze(config, payload, "synthetic", signal())).rejects.toThrow("Unqualified");
    expect(createOpenRouterClassificationProvider([profile, profile], transport, () => date).quote(config, payload)).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects normalized impossible calendar dates", () => {
    expect(parseQualifiedOpenRouterProfile({ ...profile, qualifiedAt: "2026-02-30T00:00:00Z", expiresAt: "2026-03-03T00:00:00Z" }, new Date("2026-03-02T12:00:00Z"))).toBeNull();
    expect(parseQualifiedOpenRouterProfile({ ...profile, qualifiedAt: "2026-10-10T00:00:00Z", expiresAt: "2026-10-11T00:00:00Z" }, date)).not.toBeNull();
  });
  it("reserves the entire context at the highest tiers, and rounds fractional micros upward", () => {
    const { provider } = setup();
    expect(provider.quote(config, payload)).toEqual({ maximumMicros: 555_632, currency: "EUR" });
    expect(provider.quoteCheck(config)).toEqual(provider.quote(config, payload));
    const precise = { ...profile, usdToEurUpperBound: "1.100000000001" };
    expect(setup(body(), precise).provider.quote(config, payload)?.maximumMicros).toBe(555_633);
  });
  it("blocks wrong configuration, media, empty and excessive document/catalogue sizes", async () => {
    const { provider, transport } = setup();
    for (const change of [{ provider: "openai" }, { model: "another-model" }, { currency: "USD" }]) expect(provider.quote({ ...config, ...change }, payload)).toBeNull();
    for (const changed of [{ ...payload, bytes: Buffer.alloc(0) }, { ...payload, bytes: Buffer.alloc(1025) }, { ...payload, mediaType: "image/heic" as const }, { ...payload, folders: [{ ...folder, name: "x".repeat(4097) }] }]) {
      expect(provider.quote(config, changed)).toBeNull();
      await expect(provider.analyze(config, changed, "synthetic", signal())).rejects.toThrow("Unqualified");
    }
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("OpenRouter fixed one-call multimodal transport, entirely synthetic", () => {
  it.each(["application/pdf", "image/png", "image/jpeg", "image/webp"] as const)("sends only selected %s and authorized catalogue with pinned routing", async mediaType => {
    const { provider, transport } = setup(); const requestSignal = signal();
    expect(await provider.analyze(config, { ...payload, mediaType }, "synthetic-credential-only", requestSignal)).toEqual({ value: JSON.stringify(suggestions), actualMicros: 2 });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options).toMatchObject({ method: "POST", redirect: "error", signal: requestSignal, headers: { Authorization: "Bearer synthetic-credential-only", "Content-Type": "application/json" } });
    const request = JSON.parse(String(options?.body));
    expect(request.model).toBe(OPENROUTER_CLASSIFICATION_MODEL); expect(request.models).toBeUndefined();
    expect(request.provider).toEqual({ only: ["anthropic"], order: ["anthropic"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", max_price: { prompt: 0.5, completion: 2.5 } });
    expect(request.tools).toEqual([]); expect(request.tool_choice).toBe("none"); expect(request.reasoning).toEqual({ enabled: false });
    expect(request.max_tokens).toBe(2048); expect(request.stream).toBe(false); expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.messages).toHaveLength(2); expect(request.messages[1].content).toHaveLength(2);
    expect(request.messages[1].content[0]).toEqual({ type: "text", text: JSON.stringify({ folders: [folder] }) });
    const encoded = `data:${mediaType};base64,${payload.bytes.toString("base64")}`;
    expect(request.messages[1].content[1]).toEqual(mediaType === "application/pdf" ? { type: "file", file: { filename: "selected-document.pdf", file_data: encoded } } : { type: "image_url", image_url: { url: encoded } });
    expect(request.plugins).toEqual(mediaType === "application/pdf" ? [{ id: "file-parser", pdf: { engine: "native" } }] : []);
    expect(JSON.stringify(request)).not.toContain("synthetic-credential-only"); expect(JSON.stringify(request)).not.toContain("cache_control");
  });
  it.each([301, 401, 403, 429, 500, 503])("never retries HTTP %s or discloses its body", async status => {
    const { provider, transport } = setup();
    transport.mockImplementation(async () => new Response("synthetic-sensitive-provider-body", { status }));
    await expect(provider.analyze(config, payload, "synthetic-sensitive-credential", signal())).rejects.toThrow(/^Classification provider unavailable$/u);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await provider.check(config, "synthetic-sensitive-credential", signal())).toEqual({ status: status === 401 || status === 403 ? "invalid" : "unreachable", actualMicros: null });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("sanitizes fetch exceptions and pre-aborted requests without retry", async () => {
    const { provider, transport } = setup();
    transport.mockRejectedValue(new Error("synthetic-sensitive-credential and document"));
    await expect(provider.analyze(config, payload, "synthetic", signal())).rejects.toThrow(/^Classification provider unavailable$/u);
    await expect(provider.check(config, "synthetic", signal())).rejects.toThrow(/^Classification provider unavailable$/u);
    expect(transport).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort(new Error("synthetic-sensitive-reason"));
    await expect(provider.analyze(config, payload, "synthetic", controller.signal)).rejects.toThrow(/^Classification provider unavailable$/u);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("passes timeout abort to the only request", async () => {
    const { provider, transport } = setup(); const controller = new AbortController();
    transport.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("synthetic-sensitive-timeout")), { once: true });
    }));
    const pending = provider.analyze(config, payload, "synthetic", controller.signal); controller.abort();
    await expect(pending).rejects.toThrow(/^Classification provider unavailable$/u); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["not-json synthetic-sensitive", "x".repeat(65_537), "null", "[]"])("bounds and sanitizes malformed response %#", async text => {
    const { provider, transport } = setup(); transport.mockResolvedValue(new Response(text));
    await expect(provider.analyze(config, payload, "synthetic", signal())).rejects.toThrow(/^Classification provider unavailable$/u);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("cancels a hanging response body on abort", async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const { provider, transport } = setup(); transport.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = provider.analyze(config, payload, "synthetic", controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toThrow(/^Classification provider unavailable$/u);
    expect(cancel).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("OpenRouter cost settlement and unusable suggestions", () => {
  it.each([undefined, null, "0.001", -1, {}, false])("retains debt for invalid cost %#", async cost => {
    expect((await setup(body(undefined, { cost })).provider.analyze(config, payload, "synthetic", signal())).actualMicros).toBeNull();
  });
  it.each([[0, 0], [0.000001, 2], [1e-8, 1], [0.00001, 11], [1, 1_100_000], [123456789, 135_802_467_900_000]])("rounds total USD %s to EUR micros %s, including unclamped overruns", async (cost, expected) => {
    expect((await setup(body(undefined, { cost, cost_details: { upstream_inference_cost: 90 } })).provider.analyze(config, payload, "synthetic", signal())).actualMicros).toBe(expected);
  });
  it("does not reconcile from upstream cost when total account cost is absent", async () => {
    const outcome = await setup(body(undefined, { cost_details: { upstream_inference_cost: 0.01 } })).provider.analyze(config, payload, "synthetic", signal());
    expect(outcome.actualMicros).toBeNull();
  });
  it.each([
    { choices: [] }, { choices: [{ finish_reason: "length", message: { role: "assistant", content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { role: "assistant", refusal: "synthetic refusal", content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { role: "assistant", tool_calls: [{ function: "do-something" }], content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "x".repeat(16_385) } }] },
    { choices: [{ finish_reason: "stop", message: { role: "tool", content: "{}" } }] },
    { choices: [body().choices[0], body().choices[0]] }, { error: { message: "synthetic-sensitive-provider-error" } },
    { model: "another-model", choices: body().choices }, { model: null, choices: body().choices },
  ])("rejects unusable result %# while preserving known cost", async value => {
    const outcome = await setup({ model: OPENROUTER_CLASSIFICATION_MODEL, ...value, usage: { cost: 0.000001 } }).provider.analyze(config, payload, "synthetic", signal());
    expect(outcome).toEqual({ value: null, actualMicros: 2 });
  });
  it("preserves cost for JSON/schema failure until existing service validation rejects it", async () => {
    for (const content of ["not-json", '{"existing":[],"created":[],"tools":["delete"]}']) {
      const outcome = await setup(body(content)).provider.analyze(config, payload, "synthetic", signal());
      expect(outcome.actualMicros).toBe(2); expect(() => parseClassificationResult(outcome.value, [folder], 16_384, 8)).toThrow();
    }
  });
  it("checks with a bounded strict JSON call and no document, and rejects overruns", async () => {
    const { provider, transport } = setup(body('{"existing":[],"created":[]}'));
    expect(await provider.check(config, "synthetic", signal())).toEqual({ status: "accepted", actualMicros: 2 });
    const request = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(request.messages).toEqual([{ role: "user", content: 'Retourne uniquement {"existing":[],"created":[]}.' }]);
    expect(request.plugins).toEqual([]); expect(request.max_tokens).toBe(profile.maxOutputTokens);
    expect(await setup(body('{"existing":[],"created":[]}', { cost: 1 })).provider.check(config, "synthetic", signal())).toEqual({ status: "unreachable", actualMicros: 1_100_000 });
    expect((await setup(body("OK")).provider.check(config, "synthetic", signal())).status).toBe("unreachable");
  });
});
