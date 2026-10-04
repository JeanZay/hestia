import type { PoolClient } from "pg";
import { setPassword } from "./auth-record";

export async function revokeFlows(client:PoolClient,memberId:string,except?:string) {
  await client.query(`UPDATE hestia_identity_flow SET status='revoked',capability_digest=NULL,browser_digest=NULL,
    prepared_password_hash=NULL,prepared_ciphertext=NULL WHERE target_id=$1 AND ($2::uuid IS NULL OR id<>$2)
    AND status<>'revoked'`,[memberId,except??null]);
  await client.query(`UPDATE hestia_identity_proof p SET revoked_at=clock_timestamp() FROM hestia_identity_flow f
    WHERE p.flow_id=f.id AND f.target_id=$1 AND ($2::uuid IS NULL OR f.id<>$2)`,[memberId,except??null]);
  await client.query(`UPDATE hestia_mail_outbox o SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL
    FROM hestia_identity_flow f WHERE o.flow_id=f.id AND f.target_id=$1 AND ($2::uuid IS NULL OR f.id<>$2)
    AND o.state IN ('pending','sending','failed')`,[memberId,except??null]);
}
export async function revokeIdentityArtifacts(client:PoolClient,memberId:string,departureEpoch:number) {
  const member=(await client.query("SELECT departure_epoch FROM hestia_member WHERE user_id=$1 AND NOT active FOR UPDATE",[memberId])).rows[0];
  if(!member || member.departure_epoch!==departureEpoch) throw new Error("IDENTITY_DEPARTURE_MISMATCH");
  await revokeFlows(client,memberId);
  await client.query(`UPDATE hestia_identity_flow SET status='revoked',capability_digest=NULL,browser_digest=NULL,
    prepared_password_hash=NULL,prepared_ciphertext=NULL WHERE actor_id=$1 AND status NOT IN ('completed','revoked')`,[memberId]);
  await client.query(`UPDATE hestia_mail_outbox o SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL
    FROM hestia_identity_flow f WHERE o.flow_id=f.id AND f.actor_id=$1 AND o.state IN ('pending','sending','failed')`,[memberId]);
  await client.query("UPDATE hestia_recovery_code SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1",[memberId]);
  await client.query("DELETE FROM hestia_identity_confirmation WHERE target_id=$1 OR actor_id=$1",[memberId]);
  await setPassword(client,memberId,null);
  await client.query("UPDATE hestia_member SET recovering=false WHERE user_id=$1",[memberId]);
}
