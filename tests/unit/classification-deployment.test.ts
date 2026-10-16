import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Access, Actor } from "../../src/server/access";
import { OPENROUTER_CLASSIFICATION_CONTRACT_SHA256 } from "../../src/server/classification/openrouter";
import { readClassificationDeployment, DEV_CLASSIFICATION_CEILING_MICROS, PRODUCTION_CLASSIFICATION_CEILING_MICROS } from "../../src/server/classification/deployment";
import { createClassificationService } from "../../src/server/classification/service";
import { DEFAULT_CLASSIFICATION_LIMITS, type ClassificationDependencies } from "../../src/server/classification/types";

const environments = ["dev", "production"] as const;
const activation = { dev: "openrouter-haiku-dev", production: "openrouter-haiku-production" };
const instant = () => new Date("2026-10-10T12:00:00Z");
const profile = { classificationContractSha256: OPENROUTER_CLASSIFICATION_CONTRACT_SHA256, model: "anthropic/claude-haiku-5.5", providerSlug: "anthropic",
  qualificationRef: "synthetic-only", pricingSourceRef: "synthetic-prices", exchangeRateSourceRef: "synthetic-fx",
  qualifiedAt: "2026-10-10T00:00:00Z", expiresAt: "2026-10-11T00:00:00Z", currency: "EUR",
  maxContextTokens: 1_000_000, maxOutputTokens: 2048, maxInputBytes: 4096, maxFolderBytes: 32768,
  mediaTypes: ["application/pdf", "image/png"], pricingTiers: [
    { minimumContextTokens: 0, promptUsdPerMillion: "0.1", completionUsdPerMillion: "0.5" },
    { minimumContextTokens: 100000, promptUsdPerMillion: "0.5", completionUsdPerMillion: "2.5" }], usdToEurUpperBound: "1.2" };
const qualifiedEnv = (environment: typeof environments[number]) => ({
  HESTIA_CLASSIFICATION_REMOTE: activation[environment], HESTIA_OPENROUTER_PROFILE: JSON.stringify(profile),
});
const disabled = { providers: [], allowRemote: false, deploymentLimitMicros: 50_000_000 };

describe("classification deployment gate", () => {
  const transport = vi.fn<typeof fetch>();
  beforeEach(() => { transport.mockReset(); vi.stubGlobal("fetch", transport); });
  afterEach(() => { expect(transport).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it.each(environments)("keeps %s off by default with an independent server ceiling", environment => {
    expect(readClassificationDeployment(environment, {}, instant)).toEqual(disabled);
    expect(DEV_CLASSIFICATION_CEILING_MICROS).toBe(50_000_000);
    expect(PRODUCTION_CLASSIFICATION_CEILING_MICROS).toBe(50_000_000);
  });
  it.each(environments)("refuses absent, unknown and cross-environment tokens in %s with a valid profile", environment => {
    const other = environment === "dev" ? "production" : "dev";
    for (const token of [undefined, "", "true", "openrouter-haiku", activation[other], ` ${activation[environment]}`]) {
      expect(readClassificationDeployment(environment, { ...qualifiedEnv(environment), HESTIA_CLASSIFICATION_REMOTE: token }, instant)).toEqual(disabled);
    }
  });
  it.each(environments)("never enables local classification from a valid %s token and profile", environment => {
    expect(readClassificationDeployment("local", qualifiedEnv(environment), instant)).toEqual({ providers: [], allowRemote: false });
  });
  it("refuses unexpected runtime environments even with valid activation variables", () => {
    for (const environment of ["staging", "Dev", "", undefined]) {
      for (const configured of environments) {
        expect(readClassificationDeployment(environment as Parameters<typeof readClassificationDeployment>[0], qualifiedEnv(configured), instant))
          .toEqual({ providers: [], allowRemote: false });
      }
    }
  });
  it.each(environments)("fails closed on absent, malformed, oversized or unqualified profiles in %s", environment => {
    for (const source of [undefined, "", "{", "null", "{}", "[]", "x".repeat(16_385), JSON.stringify({ ...profile, qualificationRef: "" })]) {
      expect(readClassificationDeployment(environment, { ...qualifiedEnv(environment), HESTIA_OPENROUTER_PROFILE: source }, instant)).toEqual(disabled);
    }
  });
  it.each(environments)("exposes only qualified Haiku in %s and refuses expiry after loading without transport", async environment => {
    const env = qualifiedEnv(environment);
    let time = instant();
    const active = readClassificationDeployment(environment, env, () => time);
    expect(active).toMatchObject({ allowRemote: true, deploymentLimitMicros: 50_000_000 });
    expect(active.providers).toHaveLength(1);
    expect(active.providers?.[0]).toMatchObject({ id: "openrouter", mode: "remote", models: [{ id: profile.model }] });
    const config = { provider: "openrouter", model: profile.model, enabled: true, version: 1, monthlyLimitMicros: 50_000_000, currency: "EUR" };
    const payload = { bytes: Buffer.from("synthetic-pdf"), mediaType: "application/pdf" as const, folders: [] };
    expect(active.providers?.[0].quoteCheck(config)).toEqual({ maximumMicros: 606144, currency: "EUR" });
    time = new Date("2026-10-11T00:00:00Z");
    const provider = active.providers![0];
    expect(provider.quoteCheck(config)).toBeNull(); expect(provider.quote(config, payload)).toBeNull();
    await expect(provider.check(config, "synthetic-only", new AbortController().signal)).rejects.toThrow();
    await expect(provider.analyze(config, payload, "synthetic-only", new AbortController().signal)).rejects.toThrow();
    expect(readClassificationDeployment(environment, env, () => time)).toEqual(disabled);
    expect(readClassificationDeployment(environment, env, () => new Date("2026-10-09T23:59:59Z"))).toEqual(disabled);
  });
  it.each(environments)("refuses former contract qualifications in %s", environment => {
    for (const classificationContractSha256 of [undefined, "old-contract", "5c21bfa469a581f671af65b462a2596d4e137143789a394ddb3ebcddd1ce3013"]) {
      expect(readClassificationDeployment(environment, {
        ...qualifiedEnv(environment), HESTIA_OPENROUTER_PROFILE: JSON.stringify({ ...profile, classificationContractSha256 }),
      }, instant)).toEqual(disabled);
    }
  });
});

// SQL is replaced entirely: these tests prove deployment/service wiring,
// not PostgreSQL locking, persistence, admission or concurrency.
function budgetFixture(environment: typeof environments[number], householdLimit: number, spent = 0, reserved = 0) {
  const row = { version: "1", provider: "openrouter", model: profile.model, enabled: true,
    monthly_limit_micros: String(householdLimit), currency: "EUR", credential_sealed: "synthetic-sealed", key_set_at: null };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM hestia_classification_config")) return { rows: [row] };
    if (sql.startsWith("UPDATE hestia_classification_config SET provider=")) return { rows: [{ ...row, version: "2" }] };
    if (sql.includes("FROM hestia_member")) return { rows: [{ role: "owner", active: true, recovering: false, epoch: "1" }] };
    if (sql.includes("SUM(actual_micros)")) return { rows: [{ spent: String(spent), reserved: String(reserved) }] };
    if (sql.includes("WHERE actor_id=$1 AND idempotency_key=$2")) return { rows: [] };
    throw new Error("Unexpected synthetic SQL");
  });
  const client = { query } as unknown as PoolClient;
  const actor = { id: "10000000-0000-4000-8000-000000000001", name: "Synthétique", email: "synthetic@example.invalid" };
  const access = { origin: vi.fn(), withActor: async (_request: Request, action: (client: PoolClient, actor: Actor) => Promise<unknown>) => action(client, actor) } as unknown as Access;
  const deployment = readClassificationDeployment(environment, qualifiedEnv(environment), instant);
  const deps: ClassificationDependencies = { ...DEFAULT_CLASSIFICATION_LIMITS, ...deployment,
    providers: deployment.providers!, allowRemote: deployment.allowRemote!, clock: async () => instant(),
    capture: { inspect: vi.fn(), assertCurrent: vi.fn(), readBytes: vi.fn() }, readAuthorizedFolders: vi.fn(),
    credentialCipher: { seal: vi.fn(), open: vi.fn() } };
  const service = createClassificationService({} as Pool, access, deps);
  return { service, query, cipher: deps.credentialCipher };
}
const request = (method = "GET", body?: unknown) => new Request("https://synthetic.example.invalid/api/classification/settings", {
  method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("deployment ceiling wired into the budget service with SQL replaced", () => {
  const transport = vi.fn<typeof fetch>();
  beforeEach(() => { transport.mockReset(); vi.stubGlobal("fetch", transport); });
  afterEach(() => { expect(transport).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it.each(environments)("caps existing high settings and rejects raising the %s ceiling before any write or credential access", async environment => {
    const { service, query, cipher } = budgetFixture(environment, 100_000_000);
    const response = await service.handleClassificationSettings(request());
    expect(response.status).toBe(200);
    expect((await response.json()).settings.monthlyLimitMicros).toBe(50_000_000);
    const denied = await service.handleClassificationSettings(request("PUT", {
      version: 1, provider: "openrouter", model: profile.model, monthlyLimitMicros: 50_000_001, enabled: true,
    }));
    expect(denied.status).toBe(400); expect((await denied.json()).error.code).toBe("CLASSIFICATION_LIMIT");
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b/u.test(sql))).toBe(false);
    expect(cipher.seal).not.toHaveBeenCalled(); expect(cipher.open).not.toHaveBeenCalled();
  });
  it.each(environments)("keeps a smaller household limit in %s", async environment => {
    const { service } = budgetFixture(environment, 10_000_000);
    expect((await (await service.handleClassificationSettings(request())).json()).settings.monthlyLimitMicros).toBe(10_000_000);
  });
  it.each(environments)("saves enabled settings in %s without contacting the provider or opening the credential", async environment => {
    const { service, query, cipher } = budgetFixture(environment, 50_000_000);
    const saved = await service.handleClassificationSettings(request("PUT", {
      version: 1, provider: "openrouter", model: profile.model, monthlyLimitMicros: 50_000_000, enabled: true,
    }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).settings).toMatchObject({ enabled: true, version: 2, monthlyLimitMicros: 50_000_000 });
    expect(query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)\b/u.test(sql))).toHaveLength(1);
    expect(cipher.seal).not.toHaveBeenCalled(); expect(cipher.open).not.toHaveBeenCalled();
  });
  it.each(environments)("refuses a check exceeding the %s effective limit with spent and outstanding reservations", async environment => {
    const { service, query, cipher } = budgetFixture(environment, 100_000_000, 49_000_000, 500_000);
    const denied = await service.handleClassificationCheck(request("POST", {
      version: 1, idempotencyKey: "10000000-0000-4000-8000-000000000002",
    }));
    expect(denied.status).toBe(409); expect((await denied.json()).error.code).toBe("CLASSIFICATION_BUDGET");
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b/u.test(sql))).toBe(false);
    expect(cipher.open).not.toHaveBeenCalled();
  });
  it("reads Production and Dev accounting independently while sharing the same provider profile", async () => {
    const production = budgetFixture("production", 100_000_000, 49_000_000, 500_000);
    const dev = budgetFixture("dev", 100_000_000);
    const productionSettings = (await (await production.service.handleClassificationSettings(request())).json()).settings;
    const devSettings = (await (await dev.service.handleClassificationSettings(request())).json()).settings;
    expect(productionSettings).toMatchObject({ monthlyLimitMicros: 50_000_000, spentMicros: 49_000_000, reservedMicros: 500_000 });
    expect(devSettings).toMatchObject({ monthlyLimitMicros: 50_000_000, spentMicros: 0, reservedMicros: 0 });
  });
});
