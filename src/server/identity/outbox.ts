import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { identityCrypto } from "./crypto";

type Crypto = ReturnType<typeof identityCrypto>;
export type IdentityMail = { email:string; otp?:string; url?:string };
export type MailTransport = (message:{id:string;template:string;parameters:IdentityMail})=>Promise<void>;
const aad=(id:string,template:string,flowId:string,version:number)=>`${id}|${template}|${flowId}|${version}`;
export async function enqueue(client:PoolClient,crypto:Crypto,flow:{id:string;version:number},template:string,parameters:IdentityMail) {
  const id=randomUUID();
  await client.query("INSERT INTO hestia_mail_outbox(id,flow_id,version,template,ciphertext) VALUES($1,$2,$3,$4,$5)",
    [id,flow.id,flow.version,template,crypto.seal(parameters,aad(id,template,flow.id,flow.version))]);
}
// No network default. A missing transport never reports mail as delivered.
export async function dispatchIdentityMail(pool:Pool,crypto:Crypto,transport?:MailTransport) {
  if(!transport) return {state:"transport-unavailable"};
  const client=await pool.connect(); let row;
  const lease=randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE hestia_mail_outbox o SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL
      FROM hestia_identity_flow f WHERE o.flow_id=f.id AND o.state IN ('pending','sending','failed')
      AND (o.version<>f.version OR (f.status IN ('revoked','completed') AND o.template<>'email-changed') OR f.expires_at<=clock_timestamp()
        OR (f.actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hestia_member m WHERE m.user_id=f.actor_id AND m.active AND NOT m.recovering
          AND m.epoch=f.actor_epoch AND m.role IN ('owner','admin') AND (f.actor_role<>'owner' OR m.role='owner'))))`);
    row=(await client.query(`SELECT o.* FROM hestia_mail_outbox o WHERE o.ciphertext IS NOT NULL AND o.attempts<5
      AND o.next_attempt<=clock_timestamp() AND (o.state IN ('pending','failed') OR (o.state='sending' AND o.lease_until<=clock_timestamp()))
      ORDER BY o.created_at,o.id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if(row) await client.query("UPDATE hestia_mail_outbox SET state='sending',lease_id=$2,lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 WHERE id=$1",[row.id,lease]);
    await client.query("COMMIT");
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
  if(!row) return {state:"idle"};
  const current=await pool.query(`SELECT 1 FROM hestia_mail_outbox o JOIN hestia_identity_flow f ON f.id=o.flow_id
    WHERE o.id=$1 AND o.lease_id=$2 AND o.state='sending' AND o.version=f.version AND f.expires_at>clock_timestamp()
    AND (f.status NOT IN ('revoked','completed') OR o.template='email-changed')
    AND (f.actor_id IS NULL OR EXISTS(SELECT 1 FROM hestia_member m WHERE m.user_id=f.actor_id AND m.active AND NOT m.recovering
      AND m.epoch=f.actor_epoch AND m.role IN ('owner','admin') AND (f.actor_role<>'owner' OR m.role='owner')))`,[row.id,lease]);
  if(!current.rowCount) return {state:"cancelled"};
  try {
    const parameters=crypto.open<IdentityMail>(row.ciphertext,aad(row.id,row.template,row.flow_id,row.version));
    // Provider idempotency key is stable across ambiguous retries. Cancellation
    // after this recheck can still send a now-invalid token; no recall is claimed.
    await transport({id:row.id,template:row.template,parameters});
    await pool.query("UPDATE hestia_mail_outbox SET state='sent',ciphertext=NULL,lease_until=NULL,lease_id=NULL WHERE id=$1 AND lease_id=$2",[row.id,lease]);
    return {state:"sent"};
  } catch {
    await pool.query("UPDATE hestia_mail_outbox SET state='failed',next_attempt=clock_timestamp()+interval '1 minute',lease_until=NULL,lease_id=NULL WHERE id=$1 AND lease_id=$2",[row.id,lease]);
    return {state:"failed"};
  }
}
