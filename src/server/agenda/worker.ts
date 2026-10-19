import { createHmac,randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { MailDeliveryError } from '../identity/mail-error';
import type { AgendaMailTransport } from './transport';

export type AgendaDispatchResult={state:'transport-unavailable'|'idle'|'sent'|'failed'|'cancelled'|'quota-deferred'};
type Row={id:string;card_id:string;reminder_id:string;reminder_generation:number;recipient_id:string;recipient_departure_epoch:number;eligibility_token:string;eligible_since:Date;due_at:Date;cutoff_at:Date;state:string;lease_token:string|null;fence:string|number;lease_until:Date|null;attempts:number;first_attempt_at:Date|null;payload_binding:string|null;title:string;start_date:string;start_time:string|null;email:string;valid:boolean};
const joined=`FROM hestia_agenda_delivery d
 JOIN hestia_agenda_card c ON c.id=d.card_id
 JOIN hestia_agenda_reminder r ON r.card_id=d.card_id AND r.id=d.reminder_id
 JOIN hestia_member creator ON creator.user_id=c.creator_id
 JOIN hestia_member m ON m.user_id=d.recipient_id
 JOIN "user" u ON u.id=m.user_id
 LEFT JOIN hestia_agenda_access a ON a.card_id=d.card_id AND a.user_id=d.recipient_id`;
const valid=`c.archived_at IS NULL AND c.creator_departed_at IS NULL
 AND creator.active AND creator.departure_epoch=c.creator_departure_epoch
 AND m.active AND NOT m.recovering AND m.departure_epoch=d.recipient_departure_epoch AND u."emailVerified"
 AND a.active AND a.subject_departure_epoch=m.departure_epoch AND a.eligibility_token=d.eligibility_token
 AND a.eligible_since=d.eligible_since AND a.eligible_since<=d.due_at
 AND r.removed_at IS NULL AND r.configuration_state='scheduled' AND r.generation=d.reminder_generation
 AND r.due_at=d.due_at AND r.cutoff_at=d.cutoff_at AND r.configured_at<d.due_at AND d.due_at<=$1 AND d.cutoff_at>$1`;
const projection=`d.*,c.title,c.start_date::text AS start_date,to_char(c.start_time,'HH24:MI') AS start_time,u.email,(${valid}) AS valid`;
async function transaction<T>(pool:Pool,action:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(480519001)');const value=await action(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
/** Agenda's own counters are durable. Other senders' retained history is only a
 * supplementary admission guard, never proof of the provider's remaining quota. */
async function hasBudget(client:PoolClient,now:Date){
  const result=await client.query<{day:number;month:number;agenda_day:number;agenda_month:number}>(`WITH usage AS (
    SELECT first_attempt_at AS at,1::bigint AS n,'agenda' AS kind FROM hestia_agenda_delivery WHERE first_attempt_at IS NOT NULL
    UNION ALL SELECT first_attempt_at,1,'identity' FROM hestia_mail_outbox WHERE first_attempt_at IS NOT NULL
    UNION ALL SELECT first_attempt_at,1,'inbox' FROM hestia_inbox_ack WHERE first_attempt_at IS NOT NULL
    UNION ALL SELECT created_at,recipients,'outgoing' FROM hestia_outgoing_admission
  ) SELECT COALESCE(sum(n) FILTER(WHERE at>=$1::timestamptz-interval '24 hours'),0)::int AS day,
    COALESCE(sum(n) FILTER(WHERE at>=date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int AS month,
    COALESCE(sum(n) FILTER(WHERE kind='agenda' AND at>=$1::timestamptz-interval '24 hours'),0)::int AS agenda_day,
    COALESCE(sum(n) FILTER(WHERE kind='agenda' AND at>=date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int AS agenda_month
    FROM usage`,[now]);
  const row=result.rows[0];return row.day<80&&row.month<2800&&row.agenda_day<50&&row.agenda_month<500;
}
/** Durable intention per reminder generation/recipient admission. No network under SQL locks. */
export async function dispatchAgendaMail(pool:Pool,secret:string,transport?:AgendaMailTransport,options:{now?:()=>Date;barrier?:(stage:'claimed'|'marked',id:string)=>Promise<void>}={}):Promise<AgendaDispatchResult>{
  if(!transport)return{state:'transport-unavailable'};
  const now=()=>options.now?.()??new Date(),lease=randomUUID();
  const claimed=await transaction(pool,async client=>{
    const stamp=now();
    await client.query(`INSERT INTO hestia_agenda_delivery(id,card_id,reminder_id,reminder_generation,recipient_id,recipient_departure_epoch,eligibility_token,eligible_since,due_at,cutoff_at,state,next_attempt_at)
      SELECT gen_random_uuid(),c.id,r.id,r.generation,a.user_id,a.subject_departure_epoch,a.eligibility_token,a.eligible_since,r.due_at,r.cutoff_at,'pending',$1
      FROM hestia_agenda_reminder r JOIN hestia_agenda_card c ON c.id=r.card_id JOIN hestia_agenda_access a ON a.card_id=c.id
      JOIN hestia_member creator ON creator.user_id=c.creator_id JOIN hestia_member m ON m.user_id=a.user_id JOIN "user" u ON u.id=m.user_id
      WHERE c.archived_at IS NULL AND c.creator_departed_at IS NULL AND creator.active AND creator.departure_epoch=c.creator_departure_epoch
        AND a.active AND m.active AND NOT m.recovering AND m.departure_epoch=a.subject_departure_epoch AND u."emailVerified"
        AND r.removed_at IS NULL AND r.configuration_state='scheduled' AND r.due_at<=$1 AND r.cutoff_at>$1
        AND r.configured_at<r.due_at AND a.eligible_since<=r.due_at
        AND NOT EXISTS(SELECT 1 FROM hestia_agenda_delivery previous WHERE previous.card_id=c.id AND previous.reminder_id=r.id AND previous.reminder_generation=r.generation AND previous.recipient_id=a.user_id AND previous.recipient_departure_epoch=a.subject_departure_epoch)
      ORDER BY r.due_at,c.id,a.user_id LIMIT 100
      ON CONFLICT(card_id,reminder_id,reminder_generation,recipient_id,recipient_departure_epoch) DO NOTHING`,[stamp]);
    const row=(await client.query<Row>(`SELECT ${projection} ${joined}
      WHERE (d.state IN ('pending','failed') AND d.next_attempt_at<=$1 OR d.state IN ('claimed','marked') AND d.lease_until<=$1)
      ORDER BY d.due_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`,[stamp])).rows[0];
    if(!row)return{result:{state:'idle'} as AgendaDispatchResult};
    const within=!row.first_attempt_at||stamp.getTime()-row.first_attempt_at.getTime()<23*3600000;
    if(!row.valid||!within||row.attempts>=5){
      // A marked attempt may already have been accepted despite a lost response.
      const state=row.first_attempt_at?'uncertain':row.cutoff_at<=stamp?'expired':!row.valid?'cancelled':'failed';
      await client.query(`UPDATE hestia_agenda_delivery SET state=$2,lease_token=NULL,lease_until=NULL,fence=fence+1,error_code=$3 WHERE id=$1`,[row.id,state,state]);
      return{result:{state:state==='failed'||state==='uncertain'?'failed':'cancelled'} as AgendaDispatchResult};
    }
    if(!row.first_attempt_at&&!await hasBudget(client,stamp)){
      await client.query(`UPDATE hestia_agenda_delivery SET state='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=$2::timestamptz+interval '15 minutes',error_code='quota-deferred' WHERE id=$1`,[row.id,stamp]);
      return{result:{state:'quota-deferred'} as AgendaDispatchResult};
    }
    const update=(await client.query<{fence:string|number}>(`UPDATE hestia_agenda_delivery SET state='claimed',lease_token=$2,lease_until=$3::timestamptz+interval '1 minute',fence=fence+1,attempts=attempts+1 WHERE id=$1 RETURNING fence`,[row.id,lease,stamp])).rows[0];
    return{row:{...row,fence:update.fence,attempts:row.attempts+1}};
  });
  if(claimed.result)return claimed.result;
  const row=claimed.row!;
  let declined:'quota-deferred'|'cancelled'|undefined;
  try{
    await options.barrier?.('claimed',row.id);
    const result=await transport({id:row.id,email:row.email,title:row.title,date:row.start_date+(row.start_time?` à ${row.start_time}`:''),cardId:row.card_id,bindPayload:async payload=>transaction(pool,async client=>{
      const stamp=now();
      const current=(await client.query<Row>(`SELECT ${projection} ${joined} WHERE d.id=$2 AND d.lease_token=$3 AND d.fence=$4 AND d.state='claimed' AND d.lease_until>$1 FOR UPDATE OF d`,[stamp,row.id,lease,row.fence])).rows[0];
      if(!current)return false;
      const digest=createHmac('sha256',secret).update(JSON.stringify(['hestia.agenda-mail.v1',row.id,payload])).digest('hex');
      const unchanged=current.title===row.title&&current.email===row.email&&current.start_date===row.start_date&&current.start_time===row.start_time;
      const within=!current.first_attempt_at||stamp.getTime()-current.first_attempt_at.getTime()<23*3600000;
      if(current.valid&&!unchanged&&!current.first_attempt_at){
        await client.query(`UPDATE hestia_agenda_delivery SET state='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=$2,error_code=NULL WHERE id=$1`,[row.id,stamp]);declined='cancelled';return false;
      }
      if(!current.valid||!unchanged||!within||current.payload_binding&&current.payload_binding!==digest){
        await client.query(`UPDATE hestia_agenda_delivery SET state=$2,lease_token=NULL,lease_until=NULL,fence=fence+1,error_code='revalidation' WHERE id=$1`,[row.id,current.first_attempt_at?'uncertain':'cancelled']);return false;
      }
      if(!current.first_attempt_at&&!await hasBudget(client,stamp)){
        await client.query(`UPDATE hestia_agenda_delivery SET state='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=$2::timestamptz+interval '15 minutes',error_code='quota-deferred' WHERE id=$1`,[row.id,stamp]);declined='quota-deferred';return false;
      }
      await client.query(`UPDATE hestia_agenda_delivery SET state='marked',payload_binding=$2,first_attempt_at=COALESCE(first_attempt_at,$3),marked_at=$3,error_code=NULL WHERE id=$1`,[row.id,digest,stamp]);
      return true;
    })});
    await options.barrier?.('marked',row.id);
    const accepted=await pool.query(`UPDATE hestia_agenda_delivery SET state='accepted',accepted_at=$4,provider_id=$5,lease_token=NULL,lease_until=NULL,error_code=NULL
      WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state='marked'`,[row.id,lease,row.fence,now(),result.providerId]);
    return{state:accepted.rowCount?'sent':'cancelled'};
  }catch(error){
    if(declined)return{state:declined};
    const retryable=!(error instanceof MailDeliveryError)||error.retryable;
    const delay=Math.max([60,300,900,3600,3600][Math.min(row.attempts-1,4)],error instanceof MailDeliveryError?error.retryAfterSeconds??0:0);
    const stamp=now();
    const result=await pool.query(`UPDATE hestia_agenda_delivery SET state=CASE WHEN $4 AND attempts<5 AND (first_attempt_at IS NULL OR first_attempt_at>$5::timestamptz-interval '23 hours') AND cutoff_at>$5 THEN 'failed' ELSE CASE WHEN first_attempt_at IS NULL THEN 'failed' ELSE 'uncertain' END END,
      next_attempt_at=CASE WHEN $4 AND attempts<5 THEN $5::timestamptz+make_interval(secs=>$6) ELSE 'infinity'::timestamptz END,
      error_code=CASE WHEN $4 THEN 'temporary' ELSE 'permanent' END,lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state IN ('claimed','marked')`,[row.id,lease,row.fence,retryable,stamp,delay]);
    return{state:result.rowCount?'failed':'cancelled'};
  }
}

export async function runAgendaMailBatch(dispatch:()=>Promise<AgendaDispatchResult>,until=Date.now()+20000){
  const counts={sent:0,failed:0,cancelled:0,deferred:0,available:true};
  for(let n=0;n<4&&Date.now()<until;n++){
    const result=await dispatch();
    if(result.state==='transport-unavailable'){counts.available=false;break;}
    if(result.state==='idle')break;
    if(result.state==='quota-deferred'){counts.deferred++;break;}
    counts[result.state]++;
  }
  return counts;
}
