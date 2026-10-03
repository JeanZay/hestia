import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";
import { readServerConfig } from "../config";

export async function provisionSyntheticMember(pool: Pool, input: {
  email: string; name: string; password: string;
  role?: "owner" | "admin" | "member"; active?: boolean;
}) {
  const config = readServerConfig();
  const url = new URL(config.databaseUrl);
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(url.pathname)
    || !/^[^@\s]+@[^@\s]+\.invalid$/.test(input.email)) throw new Error("Synthetic provisioning requires an isolated local test database and .invalid email");
  if (input.password.length < 15 || input.password.length > 128) throw new Error("Synthetic password length must be 15–128");
  const id = randomUUID(), password = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    // Check the actual connection, rather than trusting environment labels.
    const target = await client.query("SELECT current_database() AS name, inet_server_addr()::text AS address");
    if (target.rows[0].name !== url.pathname.slice(1) || !["127.0.0.1", "::1"].includes(target.rows[0].address)) {
      // Docker's server address is commonly a private bridge IP; loopback in the
      // configured pool is the boundary, and the actual database must still match.
      const options = pool.options;
      const connection = options.connectionString && new URL(options.connectionString);
      if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)
        || target.rows[0].name !== url.pathname.slice(1)) throw new Error("Unexpected synthetic database target");
    }
    await client.query("BEGIN");
    await client.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())', [id, input.name, input.email.toLowerCase()]);
    await client.query('INSERT INTO account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())', [randomUUID(), id, password]);
    await client.query("INSERT INTO hestia_member(user_id,role,active) VALUES($1,$2,$3)", [id,input.role ?? "member",input.active ?? true]);
    await client.query("COMMIT");
    return id;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
