import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { identityCrypto } from "./crypto";
import { MailDeliveryError } from "./mail-error";

type Crypto = ReturnType<typeof identityCrypto>;
export type IdentityMail = { email:string; otp?:string; url?:string };
export type MailTransport = (message:{id:string;template:string;parameters:IdentityMail;bindPayload:(payload:string)=>Promise<boolean>})=>Promise<void>;
export type MailDispatchResult = { state:"transport-unavailable"|"idle"|"cancelled"|"sent"|"failed" };
const aad=(id:string,template:string,flowId:string,version:number)=>`${id}|${template}|${flowId}|${version}`;
export async function enqueue(client:PoolClient,crypto:Crypto,flow:{id:string;version:number},template:string,parameters:IdentityMail,proofId?:string) {
  const id=randomUUID();
  await client.query("INSERT INTO hestia_mail_outbox(id,flow_id,version,template,ciphertext,proof_id) VALUES($1,$2,$3,$4,$5,$6)",
    [id,flow.id,flow.version,template,crypto.seal(parameters,aad(id,template,flow.id,flow.version)),proofId??null]);
}

// The same predicate is evaluated at claim and again immediately before network.
// Recovery aliases remain valid: current email means the flow/proof email, not
// necessarily the old credential email while recovery is in progress.
const validFlow=`EXISTS(SELECT 1 FROM hestia_identity_flow f WHERE f.id=o.flow_id
  AND o.version=f.version AND f.expires_at>clock_timestamp() AND f.status<>'revoked'
  AND (f.status<>'completed' OR o.template='email-changed')
  AND (f.actor_id IS NULL OR EXISTS(SELECT 1 FROM hestia_member m WHERE m.user_id=f.actor_id
    AND m.active AND NOT m.recovering AND m.epoch=f.actor_epoch AND m.role IN ('owner','admin')
    AND (f.actor_role<>'owner' OR m.role='owner')))
  AND (f.target_id IS NULL OR EXISTS(SELECT 1 FROM hestia_member m WHERE m.user_id=f.target_id
    AND m.epoch=f.target_epoch AND ((f.kind='readmit' AND NOT m.active) OR (f.kind<>'readmit' AND m.active))))
  AND (o.template<>'otp' OR EXISTS(SELECT 1 FROM hestia_identity_proof p WHERE p.id=o.proof_id
    AND p.flow_id=f.id AND p.version=f.version AND p.email=f.email AND p.consumed_at IS NULL
    AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp() AND p.attempts<5)))`;
const withinWindow="o.first_attempt_at>clock_timestamp()-interval '23 hours'";

// One row per call; transactions and locks end before any provider request.
export async function dispatchIdentityMail(pool:Pool,crypto:Crypto,transport?:MailTransport):Promise<MailDispatchResult> {
  if(!transport) return {state:"transport-unavailable"};
  const client=await pool.connect(),lease=randomUUID();
  let row;
  try {
    await client.query("BEGIN");
    row=(await client.query(`SELECT o.*,${validFlow} AS valid,
      (o.first_attempt_at IS NULL OR ${withinWindow}) AS within_window
      FROM hestia_mail_outbox o WHERE o.ciphertext IS NOT NULL
      AND ((o.state IN ('pending','failed') AND (o.next_attempt<=clock_timestamp() OR o.attempts>=5
        OR o.first_attempt_at<=clock_timestamp()-interval '23 hours'))
        OR (o.state='sending' AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())))
      ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1`)).rows[0];
    if(row) {
      if(!row.valid||!row.within_window||row.attempts>=5) {
        const state=!row.valid?"cancelled":"failed";
        await client.query("UPDATE hestia_mail_outbox SET state=$2,ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE id=$1",[row.id,state]);
        await client.query("COMMIT");
        return {state};
      }
      row=(await client.query(`UPDATE hestia_mail_outbox SET state='sending',lease_id=$2,
        lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1,
        first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()) WHERE id=$1 RETURNING *`,[row.id,lease])).rows[0];
    }
    await client.query("COMMIT");
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
  if(!row) return {state:"idle"};
  try {
    let parameters:IdentityMail;
    try {parameters=crypto.open<IdentityMail>(row.ciphertext,aad(row.id,row.template,row.flow_id,row.version));}
    catch {throw new MailDeliveryError(false);}
    const current=(await pool.query(`SELECT ${validFlow} AS valid,${withinWindow} AS within_window,
      o.lease_until>clock_timestamp() AS leased FROM hestia_mail_outbox o
      WHERE o.id=$1 AND o.lease_id=$2 AND o.state='sending'`,[row.id,lease])).rows[0];
    if(!current) return {state:"cancelled"};
    if(!current.valid||!current.within_window||!current.leased) {
      const state=!current.valid?"cancelled":"failed";
      await pool.query(`UPDATE hestia_mail_outbox SET state=$3,ciphertext=NULL,lease_id=NULL,lease_until=NULL
        WHERE id=$1 AND lease_id=$2 AND state='sending'`,[row.id,lease,state]);
      return {state};
    }
    // Cancellation after this recheck can send a now-invalid token; no recall
    // is claimed. Provider idempotency identity and ciphertext never change.
    await transport({id:row.id,template:row.template,parameters,bindPayload:async(payload:string)=>{
      // HMAC prevents an outbox reader from brute-forcing six-digit OTPs from
      // the stored fingerprint. Bind before network, across processes/restarts.
      const digest=crypto.digest("mail-payload",row.id,payload);
      const bound=await pool.query(`UPDATE hestia_mail_outbox o SET payload_digest=$3
        WHERE o.id=$1 AND o.lease_id=$2 AND o.state='sending' AND o.lease_until>clock_timestamp()
        AND ${validFlow} AND ${withinWindow} AND (o.payload_digest IS NULL OR o.payload_digest=$3)`,[row.id,lease,digest]);
      return bound.rowCount===1;
    }});
    const result=await pool.query(`UPDATE hestia_mail_outbox SET state='sent',ciphertext=NULL,lease_until=NULL,lease_id=NULL
      WHERE id=$1 AND lease_id=$2 AND state='sending'`,[row.id,lease]);
    return {state:result.rowCount?"sent":"cancelled"};
  } catch(error) {
    const retryable=!(error instanceof MailDeliveryError)||error.retryable;
    const delay=Math.max(60,error instanceof MailDeliveryError?error.retryAfterSeconds??0:0);
    const result=await pool.query(`UPDATE hestia_mail_outbox o SET state='failed',
      ciphertext=CASE WHEN $3 AND o.attempts<5 AND ${withinWindow} THEN ciphertext ELSE NULL END,
      next_attempt=clock_timestamp()+make_interval(secs=>$4),lease_until=NULL,lease_id=NULL
      WHERE id=$1 AND lease_id=$2 AND state='sending'`,[row.id,lease,retryable,delay]);
    return {state:result.rowCount?"failed":"cancelled"};
  }
}
