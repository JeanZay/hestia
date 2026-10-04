import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import type { Pool } from "pg";
import { authOptions } from "../auth/options";
import type { ServerConfig } from "../config";

// Explicit provisioning command only: never run migrations on a web request.
export async function migrateDatabase(pool: Pool, config: ServerConfig) {
  await (await getMigrations(authOptions(pool, config))).runMigrations();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(480517001)");
    await client.query("CREATE TABLE IF NOT EXISTS hestia_migration (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const id of ["001-folders", "002-documents", "003-access", "004-trash", "005-family-members", "006-family-identity"]) {
      const sql = await readFile(new URL(`./migrations/${id}.sql`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM hestia_migration WHERE id=$1", [id]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error("Applied migration checksum changed");
      } else {
        await client.query(sql);
        await client.query("INSERT INTO hestia_migration(id,checksum) VALUES($1,$2)", [id,checksum]);
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
