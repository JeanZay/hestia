import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

// Better Auth 1.7.6 schema boundary; every write uses the caller's transaction.
export async function credential(client: PoolClient, userId: string) {
  const rows=await client.query('SELECT id,password,"accountId" FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',[userId]);
  if(rows.rowCount!==1 || rows.rows[0].accountId!==userId) throw new Error("IDENTITY_CREDENTIAL_SHAPE");
  return rows.rows[0] as {id:string;password:string|null};
}
export async function setPassword(client: PoolClient,userId:string,hash:string|null) {
  const row=await credential(client,userId);
  await client.query('UPDATE account SET password=$1,"updatedAt"=clock_timestamp() WHERE id=$2',[hash,row.id]);
  await client.query('DELETE FROM session WHERE "userId"=$1',[userId]);
}
export async function createCredential(client:PoolClient,id:string,email:string,name:string,hash:string) {
  await client.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,clock_timestamp(),clock_timestamp())',[id,name,email]);
  await client.query('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,clock_timestamp(),clock_timestamp())',[randomUUID(),id,hash]);
}
