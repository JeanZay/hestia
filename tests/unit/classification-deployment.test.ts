import { describe, expect, it } from "vitest";
import { readClassificationDeployment, DEV_CLASSIFICATION_CEILING_MICROS } from "../../src/server/classification/deployment";

describe("classification deployment gate", () => {
  const profile = { model: "anthropic/claude-haiku-5.5", providerSlug: "anthropic",
    qualificationRef: "synthetic-only", pricingSourceRef: "synthetic-prices", exchangeRateSourceRef: "synthetic-fx",
    qualifiedAt: "2026-10-10T00:00:00Z", expiresAt: "2026-10-11T00:00:00Z", currency: "EUR",
    maxContextTokens: 1_000_000, maxOutputTokens: 2048, maxInputBytes: 4096, maxFolderBytes: 4096,
    mediaTypes: ["application/pdf", "image/png"], pricingTiers: [
      { minimumContextTokens: 0, promptUsdPerMillion: "0.1", completionUsdPerMillion: "0.5" },
      { minimumContextTokens: 100000, promptUsdPerMillion: "0.5", completionUsdPerMillion: "2.5" }], usdToEurUpperBound: "1.2" };
  it("keeps remote calls off by default and caps Dev independently of household settings", () => {
    expect(readClassificationDeployment("dev", {})).toEqual({ providers: [], allowRemote: false, deploymentLimitMicros: 50_000_000 });
    expect(DEV_CLASSIFICATION_CEILING_MICROS).toBe(50_000_000);
  });
  it.each(["local", "production"] as const)("never enables remote classification in %s from Dev variables", environment => {
    expect(readClassificationDeployment(environment, { HESTIA_CLASSIFICATION_REMOTE: "openrouter-haiku-dev", HESTIA_OPENROUTER_PROFILE: "{}" }))
      .toEqual({ providers: [], allowRemote: false });
  });
  it.each([undefined, "", "{", "null", "{}", "[]", "x".repeat(16_385)])("fails closed on absent, malformed or unqualified deployment profile %#", profile => {
    const result = readClassificationDeployment("dev", { HESTIA_CLASSIFICATION_REMOTE: "openrouter-haiku-dev", HESTIA_OPENROUTER_PROFILE: profile });
    expect(result).toEqual({ providers: [], allowRemote: false, deploymentLimitMicros: 50_000_000 });
  });
  it("exposes only the qualified model under the explicit Dev gate and rechecks expiry", () => {
    const env = { HESTIA_CLASSIFICATION_REMOTE: "openrouter-haiku-dev", HESTIA_OPENROUTER_PROFILE: JSON.stringify(profile) };
    let time = new Date("2026-10-10T12:00:00Z");
    const disabled = readClassificationDeployment("dev", { ...env, HESTIA_CLASSIFICATION_REMOTE: "true" }, () => time);
    expect(disabled.allowRemote).toBe(false);
    const active = readClassificationDeployment("dev", env, () => time);
    expect(active.allowRemote).toBe(true); expect(active.providers).toHaveLength(1);
    expect(active.providers?.[0].models?.[0].id).toBe(profile.model);
    const config = { provider: "openrouter", model: profile.model, enabled: true, version: 1, monthlyLimitMicros: 50_000_000, currency: "EUR" };
    expect(active.providers?.[0].quoteCheck(config)).toEqual({ maximumMicros: 606144, currency: "EUR" });
    time = new Date("2026-10-11T00:00:00Z");
    expect(active.providers?.[0].quoteCheck(config)).toBeNull();
    expect(readClassificationDeployment("dev", env, () => time).allowRemote).toBe(false);
  });
});
