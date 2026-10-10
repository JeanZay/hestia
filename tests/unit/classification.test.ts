import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createClassificationCredentialCipher } from "../../src/server/classification/cipher";
import { micros, parseClassificationResult, utcMonth } from "../../src/server/classification/validation";
import { createOpenAIClassificationProvider, type QualifiedOpenAIProfile } from "../../src/server/classification/openai";

const folder = { id: randomUUID(), name: "Factures", path: [], canCreate: true };
const result = { existing: [{ folderId: folder.id, reason: "Facture synthétique" }], created: [] };
describe("classification boundaries", () => {
  it("encrypts with randomized authenticated ciphertext bound to provider and server secret", () => {
    const cipher = createClassificationCredentialCipher("synthetic-server-secret-never-live-0123456789");
    const one = cipher.seal("synthetic-key-only", "provider-a"), two = cipher.seal("synthetic-key-only", "provider-a");
    expect(one).not.toBe(two); expect(one).not.toContain("synthetic-key-only");
    expect(cipher.open(one, "provider-a")).toBe("synthetic-key-only");
    expect(() => cipher.open(one, "provider-b")).toThrow();
    expect(() => cipher.open(one.slice(0, -3) + "abc", "provider-a")).toThrow();
    expect(() => createClassificationCredentialCipher("other-synthetic-server-secret-0123456789").open(one, "provider-a")).toThrow();
    expect(() => createClassificationCredentialCipher("short")).toThrow();
  });
  it("accepts only integer money and UTC calendar periods", () => {
    for (const value of [NaN, Infinity, -1, 1.1, "1", Number.MAX_SAFE_INTEGER]) expect(() => micros(value)).toThrow();
    expect(() => micros(0, true)).toThrow(); expect(micros(1, true)).toBe(1);
    expect(utcMonth(new Date("2026-12-31T23:59:59.999Z"))).toEqual({ start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z", timeZone: "UTC" });
  });
  it("filters unauthorized IDs, duplicate suggestions and parents without modifier", () => {
    expect(parseClassificationResult({ existing: [...result.existing, ...result.existing, { folderId: randomUUID(), reason: "Forbidden" }], created: [{ parentId: folder.id, levels: ["2026"], reason: "Nouveau" }] }, [{ ...folder, canCreate: false }], 4096, 8)).toEqual(result);
  });
  it.each([
    { ...result, tools: [{ name: "delete" }] },
    { ...result, existing: [{ folderId: folder.id, reason: "<script>bad</script>" }] },
    { ...result, created: [{ parentId: folder.id, levels: ["../bad"], reason: "bad" }] },
    { ...result, created: [{ parentId: folder.id, levels: ["a", "b", "c", "d", "e"], reason: "bad" }] },
    { ...result, summary: "x".repeat(1001) },
    "not json", null,
  ])("rejects hostile or unbounded responses %#", value => {
    expect(() => parseClassificationResult(value, [folder], 4096, 8)).toThrow();
  });
  it("enforces total byte and suggestion bounds", () => {
    expect(() => parseClassificationResult(result, [folder], 20, 8)).toThrow();
    expect(() => parseClassificationResult({ existing: Array(9).fill(result.existing[0]), created: [] }, [folder], 4096, 8)).toThrow();
  });
});

describe("dormant OpenAI adapter, transport replaced entirely", () => {
  const config = { provider: "openai", model: "synthetic-model", enabled: true, version: 1, monthlyLimitMicros: 100, currency: "EUR" };
  const payload = { bytes: Buffer.from("synthetic selected bytes"), mediaType: "application/pdf" as const, folders: [folder] };
  const profile: QualifiedOpenAIProfile = { model: "synthetic-model", qualificationRef: "synthetic-test-only", currency: "EUR", maximumMicros: 10, maxInputBytes: 1024, maxFolderBytes: 4096, maxOutputTokens: 256, mediaTypes: ["application/pdf", "image/png"], actualCost: () => 3 };
  it("refuses absent qualification, unknown model, oversized input and unsupported media before transport", async () => {
    const transport = vi.fn<typeof fetch>(); const provider = createOpenAIClassificationProvider([], transport);
    expect(provider.quote(config, payload)).toBeNull(); expect(provider.quoteCheck(config)).toBeNull();
    await expect(provider.analyze(config, payload, "synthetic", new AbortController().signal)).rejects.toThrow();
    const qualified = createOpenAIClassificationProvider([profile], transport);
    expect(qualified.quote({ ...config, model: "unknown" }, payload)).toBeNull();
    expect(qualified.quote(config, { ...payload, bytes: Buffer.alloc(1025) })).toBeNull();
    expect(qualified.quote(config, { ...payload, mediaType: "image/heic" })).toBeNull();
    expect(qualified.quote({ ...config, currency: "USD" }, payload)).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["application/pdf", "image/png"] as const)("sends only bounded selected %s and folders, no tools or stored response", async mediaType => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "completed", usage: { synthetic: true }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] }));
    const provider = createOpenAIClassificationProvider([profile], transport);
    expect(await provider.analyze(config, { ...payload, mediaType }, "synthetic-credential", new AbortController().signal)).toEqual({ value: JSON.stringify(result), actualMicros: 3 });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0]; expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(options?.body)); expect(body.tools).toEqual([]); expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true);
    expect(JSON.stringify(body)).not.toContain("synthetic-credential"); expect(body.input[0].content[0].text).toBe(JSON.stringify({ folders: [folder] }));
    expect(body.input[0].content[1].type).toBe(mediaType === "application/pdf" ? "input_file" : "input_image");
  });
  it("does not retry errors and bounds response bytes", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 401 }));
    const provider = createOpenAIClassificationProvider([profile], transport);
    expect(await provider.check(config, "synthetic", new AbortController().signal)).toEqual({ status: "invalid", actualMicros: null });
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue(new Response("x".repeat(65_537)));
    await expect(provider.analyze(config, payload, "synthetic", new AbortController().signal)).rejects.toThrow("too large");
  });
});
