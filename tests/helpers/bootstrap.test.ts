import { test, expect } from "vitest";
import pg from "pg";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";

test("provision only the isolated browser test database", async () => {
  const config = readServerConfig();
  expect(config.environment).toBe("local");
  expect(new URL(config.databaseUrl).pathname).toMatch(/^\/hestia_test_/);
  const password = process.env.HESTIA_TEST_PASSWORD;
  if (!password) throw new Error("Ephemeral test password missing");
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    await migrateDatabase(pool, config);
    for (const [name, role] of [["Camille", "member"], ["Alex", "admin"]] as const) {
      await provisionSyntheticMember(pool, { name, role, email: `${name.toLowerCase()}@hestia.invalid`, password });
    }
  } finally { await pool.end(); }
});
