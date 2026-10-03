import { describe, expect, it } from "vitest";
import { readServerConfig } from "../../src/server/config";

describe("document PostgreSQL session affinity", () => {
  const env = { HESTIA_ENVIRONMENT:"dev", AUTH_BASE_URL:"https://hestia.example.invalid", AUTH_SECRET:"synthetic-config-only-value-32-characters", NODE_ENV:"test" as const };
  it("accepts a direct PostgreSQL endpoint", () => {
    expect(readServerConfig({...env,DATABASE_URL:"postgresql://synthetic:synthetic@ep-example.eu-central-1.aws.neon.tech/hestia"}).environment).toBe("dev");
  });
  it("rejects a Neon transaction pooler that cannot preserve upload advisory locks", () => {
    expect(() => readServerConfig({...env,DATABASE_URL:"postgresql://synthetic:synthetic@ep-example-pooler.eu-central-1.aws.neon.tech/hestia"})).toThrow("direct PostgreSQL endpoint");
  });
});
