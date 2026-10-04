import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { readServerConfig } from "../../src/server/config";

describe("upgrade of existing family records", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || new URL(config.databaseUrl).hostname !== "127.0.0.1"
    || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)) {
    throw new Error("Owned ephemeral PostgreSQL only");
  }
  const pool = new Pool({ connectionString: config.databaseUrl });
  afterAll(() => pool.end());
  const sql = (id: string) => readFile(new URL(`../../src/server/db/migrations/${id}.sql`, import.meta.url), "utf8");

  it("backfills live and departed references without changing historic grants, and closes an existing installation", async () => {
    const client = await pool.connect();
    const schema = `upgrade_${randomUUID().replaceAll("-", "")}`;
    const liveFolder = randomUUID(), vacantFolder = randomUUID();
    const liveReference = randomUUID(), oldReference = randomUUID();
    try {
      await client.query("BEGIN");
      // All DDL and fixtures are rolled back. No shared application rows change.
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      // Migrations 001–006 reference only these Better Auth primary keys;
      // complete Better Auth credential/session behavior is tested separately.
      await client.query('CREATE TABLE "user"(id text PRIMARY KEY); CREATE TABLE session(id text PRIMARY KEY)');
      for (const id of ["001-folders", "002-documents", "003-access", "004-trash"]) await client.query(await sql(id));
      await client.query('INSERT INTO "user"(id) VALUES(\'owner\'),(\'departed\')');
      await client.query("INSERT INTO hestia_member(user_id,role) VALUES('owner','owner'),('departed','admin')");
      await client.query("INSERT INTO hestia_folder(id,name,created_by) VALUES($1,'Dossier actif','owner'),($2,'Dossier conservé','departed')", [liveFolder, vacantFolder]);
      await client.query(`INSERT INTO hestia_grant(id,folder_id,user_id,author_id,batch_id,kind,capability,transmit,expires_at)
        VALUES($1,$2,'owner','owner',$2,'reference','administrer',ARRAY['consulter','partager'],clock_timestamp()+interval '2 days'),
              ($3,$4,'departed','departed',$4,'reference','administrer',ARRAY['consulter'],clock_timestamp()+interval '1 day')`,
      [liveReference, liveFolder, oldReference, vacantFolder]);
      await client.query("UPDATE hestia_member SET active=false WHERE user_id='departed'");
      const before = (await client.query("SELECT * FROM hestia_grant ORDER BY id")).rows;
      await client.query("SAVEPOINT invalid_legacy");
      await client.query("UPDATE hestia_grant SET origin='unattested' WHERE id=$1", [oldReference]);
      await expect(client.query(await sql("005-family-members"))).rejects.toThrow("Inconsistent existing folder reference");
      await client.query("ROLLBACK TO SAVEPOINT invalid_legacy");
      await client.query(await sql("005-family-members"));
      await client.query(await sql("006-family-identity"));
      const after = (await client.query("SELECT * FROM hestia_grant ORDER BY id")).rows;
      expect(after.map(({ replaces_reference_id, ...row }) => { expect(replaces_reference_id).toBeNull(); return row; })).toEqual(before);
      const folders = (await client.query("SELECT id,reference_grant_id,governance_kind,admin_reference FROM hestia_folder")).rows;
      expect(folders.find(f => f.id === liveFolder)).toMatchObject({ reference_grant_id: liveReference, governance_kind: "shared" });
      expect(folders.find(f => f.id === vacantFolder)).toMatchObject({ reference_grant_id: oldReference, governance_kind: "shared" });
      expect(new Set(folders.map(f => f.admin_reference)).size).toBe(2);
      expect((await client.query("SELECT initialized_at,owner_id FROM hestia_installation")).rows[0]).toMatchObject({ owner_id: "owner", initialized_at: expect.any(Date) });
      await client.query("UPDATE hestia_member SET active=true,role='member' WHERE user_id='departed'");
      expect((await client.query("SELECT membership_version,departure_epoch FROM hestia_member WHERE user_id='departed'")).rows[0]).toEqual({ membership_version: "2", departure_epoch: 1 });
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("SAVEPOINT immutable_probe");
      await expect(client.query("UPDATE hestia_grant SET revoked_at=NULL WHERE id=$1", [oldReference])).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT immutable_probe");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
