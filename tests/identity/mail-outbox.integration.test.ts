import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { identityCrypto } from "../../src/server/identity/crypto";
import { dispatchIdentityMail, enqueue, type MailTransport } from "../../src/server/identity/outbox";
import { MailDeliveryError } from "../../src/server/identity/mail-error";

describe("durable mail leases, proof binding and retry limits",()=>{
  const config=readServerConfig();
  if(config.environment!=="local"||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname))throw Error("Synthetic database required");
  const pool=new Pool({connectionString:config.databaseUrl,max:5}),other=new Pool({connectionString:config.databaseUrl,max:3});
  const crypto=identityCrypto(config.secret);
  beforeAll(async()=>{await migrateDatabase(pool,config);});
  beforeEach(async()=>{
    // Suites run serially in an isolated synthetic database; discard previous
    // tests' queued work so each test observes only its own fixture.
    await pool.query("UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE state IN ('pending','failed','sending')");
  });
  afterAll(async()=>{await pool.end();await other.end();});
  async function fixture(template="invitation") {
    const flowId=randomUUID(),proofId=randomUUID(),email=`mail-${flowId}@example.invalid`;
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO hestia_identity_flow(id,kind,email) VALUES($1,'invite',$2)",[flowId,email]);
      if(template==="otp")await client.query("INSERT INTO hestia_identity_proof(id,flow_id,version,email,purpose,digest) VALUES($1,$2,1,$3,'activation','synthetic')",[proofId,flowId,email]);
      await enqueue(client,crypto,{id:flowId,version:1},template,{email,...(template==="otp"?{otp:"123456"}:{url:`${config.origin}/?flowId=${flowId}`})},template==="otp"?proofId:undefined);
      await client.query("COMMIT");
    } finally {client.release();}
    const id=(await pool.query("SELECT id FROM hestia_mail_outbox WHERE flow_id=$1",[flowId])).rows[0].id as string;
    return {id,flowId,proofId,email};
  }
  const row=async(id:string)=>(await pool.query("SELECT * FROM hestia_mail_outbox WHERE id=$1",[id])).rows[0];
  const due=async(id:string)=>{await pool.query("UPDATE hestia_mail_outbox SET next_attempt=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);};
  function beforeFinalCheck(change:()=>Promise<void>) {
    let changed=false;
    return {connect:pool.connect.bind(pool),query:async(sql:string,values:unknown[])=>{
      if(!changed){changed=true;await change();}
      return pool.query(sql,values);
    }} as unknown as Pool;
  }

  it("does not claim without a transport and sends a committed active OTP",async()=>{
    const f=await fixture("otp"),send=vi.fn<MailTransport>().mockResolvedValue();
    expect(await dispatchIdentityMail(pool,crypto)).toEqual({state:"transport-unavailable"});
    expect((await row(f.id)).attempts).toBe(0);
    expect(await dispatchIdentityMail(pool,crypto,send)).toEqual({state:"sent"});
    expect(send.mock.calls[0][0]).toMatchObject({id:f.id,template:"otp",parameters:{email:f.email,otp:"123456"}});
    expect(await row(f.id)).toMatchObject({state:"sent",ciphertext:null,proof_id:f.proofId,attempts:1,lease_id:null});
  });
  it.each(["expired","consumed","revoked","email","version","exhausted","unbound"])("cancels an OTP whose proof is %s without sending",async(mode)=>{
    const f=await fixture("otp"),send=vi.fn<MailTransport>();
    const updates:Record<string,string>={expired:"expires_at=clock_timestamp()-interval '1 second'",consumed:"consumed_at=clock_timestamp()",revoked:"revoked_at=clock_timestamp()",email:"email='different@example.invalid'",version:"version=2",exhausted:"attempts=5"};
    if(mode==="unbound")await pool.query("UPDATE hestia_mail_outbox SET proof_id=NULL WHERE id=$1",[f.id]);
    else await pool.query(`UPDATE hestia_identity_proof SET ${updates[mode]} WHERE id=$1`,[f.proofId]);
    expect(await dispatchIdentityMail(pool,crypto,send)).toEqual({state:"cancelled"});
    expect(send).not.toHaveBeenCalled();expect(await row(f.id)).toMatchObject({state:"cancelled",ciphertext:null,attempts:0});
  });
  it.each(["revoked","expired","version","email"])("rechecks %s after claim and before network",async(mode)=>{
    const f=await fixture("otp"),send=vi.fn<MailTransport>();
    const updates:Record<string,string>={revoked:"status='revoked'",expired:"expires_at=clock_timestamp()-interval '1 second'",version:"version=2",email:"email='changed@example.invalid'"};
    const checked=beforeFinalCheck(async()=>{await pool.query(`UPDATE hestia_identity_flow SET ${updates[mode]} WHERE id=$1`,[f.flowId]);});
    expect(await dispatchIdentityMail(checked,crypto,send)).toEqual({state:"cancelled"});
    expect(send).not.toHaveBeenCalled();expect(await row(f.id)).toMatchObject({state:"cancelled",ciphertext:null,lease_id:null});
  });
  it("does not expose uncommitted work and rollback produces no mail",async()=>{
    const client=await pool.connect(),flowId=randomUUID(),send=vi.fn<MailTransport>();
    try {
      await client.query("BEGIN");await client.query("INSERT INTO hestia_identity_flow(id,kind,email) VALUES($1,'invite',$2)",[flowId,`rollback-${flowId}@example.invalid`]);
      await enqueue(client,crypto,{id:flowId,version:1},"invitation",{email:"rollback@example.invalid",url:config.origin});
      expect(await dispatchIdentityMail(other,crypto,send)).toEqual({state:"idle"});
      await client.query("ROLLBACK");
      expect(await dispatchIdentityMail(other,crypto,send)).toEqual({state:"idle"});expect(send).not.toHaveBeenCalled();
    } finally {client.release();}
  });
  it("retains the same provider identity and content after ambiguous acceptance across pools",async()=>{
    const f=await fixture(),accepted=new Map<string,string>();
    const send=vi.fn<MailTransport>(async message=>{accepted.set(message.id,JSON.stringify(message));if(send.mock.calls.length===1)throw Error("synthetic connection lost");});
    expect(await dispatchIdentityMail(pool,crypto,send)).toEqual({state:"failed"});
    const first=await row(f.id);expect(first.ciphertext).not.toBeNull();await due(f.id);
    expect(await dispatchIdentityMail(other,crypto,send)).toEqual({state:"sent"});
    expect(JSON.stringify(send.mock.calls[1][0])).toEqual(JSON.stringify(send.mock.calls[0][0]));expect(accepted.size).toBe(1);
    expect((await row(f.id)).first_attempt_at).toEqual(first.first_attempt_at);
  });
  it("serializes concurrent workers while the provider is still in flight",async()=>{
    await fixture();let release!:()=>void,entered!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
    const send=vi.fn<MailTransport>(async()=>{entered();await wait;});
    const first=dispatchIdentityMail(pool,crypto,send);await ready;
    expect(await dispatchIdentityMail(other,crypto,send)).toEqual({state:"idle"});release();
    expect(await first).toEqual({state:"sent"});expect(send).toHaveBeenCalledTimes(1);
  });
  it("persists a keyed payload binding before network and refuses drift across pools",async()=>{
    const f=await fixture();let networkCalls=0;
    const send=(payload:string):MailTransport=>async message=>{
      if(!await message.bindPayload(payload))throw new MailDeliveryError(false);
      expect((await row(f.id)).payload_digest).toBe(crypto.digest("mail-payload",f.id,payload));
      networkCalls++;throw new MailDeliveryError(true);
    };
    await dispatchIdentityMail(pool,crypto,send("first complete synthetic envelope"));await due(f.id);
    await dispatchIdentityMail(other,crypto,send("first complete synthetic envelope"));await due(f.id);
    await dispatchIdentityMail(other,crypto,send("changed synthetic envelope"));
    expect(networkCalls).toBe(2);expect(await row(f.id)).toMatchObject({state:"failed",ciphertext:null,attempts:3});
  });
  it.each([false,true])("late callback cannot resurrect cancelled state (failure=%s)",async(failure)=>{
    const f=await fixture();
    const result=await dispatchIdentityMail(pool,crypto,async()=>{
      // Deliberately retain the lease: state itself must protect cancellation.
      await pool.query("UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL WHERE id=$1",[f.id]);
      if(failure)throw new MailDeliveryError(true);
    });
    expect(result).toEqual({state:"cancelled"});expect((await row(f.id)).state).toBe("cancelled");
  });
  it("a replaced lease cannot be completed by its former holder",async()=>{
    const f=await fixture(),replacement=randomUUID();
    expect(await dispatchIdentityMail(pool,crypto,async()=>{await pool.query("UPDATE hestia_mail_outbox SET lease_id=$2 WHERE id=$1",[f.id,replacement]);})).toEqual({state:"cancelled"});
    expect(await row(f.id)).toMatchObject({state:"sending",lease_id:replacement});
  });
  it("permanent rejection wipes payload; temporary rejection respects bounded retry delay",async()=>{
    const f=await fixture();expect(await dispatchIdentityMail(pool,crypto,async()=>{throw new MailDeliveryError(false);})).toEqual({state:"failed"});
    expect(await row(f.id)).toMatchObject({state:"failed",ciphertext:null});
    const retry=await fixture();await dispatchIdentityMail(pool,crypto,async()=>{throw new MailDeliveryError(true,9000);});
    const saved=await row(retry.id);expect(saved.ciphertext).not.toBeNull();
    const seconds=(await pool.query("SELECT extract(epoch FROM next_attempt-clock_timestamp()) seconds FROM hestia_mail_outbox WHERE id=$1",[retry.id])).rows[0].seconds;
    expect(Number(seconds)).toBeGreaterThan(3590);expect(Number(seconds)).toBeLessThanOrEqual(3600);
  });
  it("the fifth failed attempt is terminal and a fifth interrupted lease is cleaned",async()=>{
    const f=await fixture();await pool.query("UPDATE hestia_mail_outbox SET attempts=4,first_attempt_at=clock_timestamp() WHERE id=$1",[f.id]);
    await dispatchIdentityMail(pool,crypto,async()=>{throw Error("network");});expect(await row(f.id)).toMatchObject({attempts:5,state:"failed",ciphertext:null});
    const crashed=await fixture(),send=vi.fn<MailTransport>();
    await pool.query("UPDATE hestia_mail_outbox SET state='sending',attempts=5,first_attempt_at=clock_timestamp(),lease_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[crashed.id,randomUUID()]);
    expect(await dispatchIdentityMail(pool,crypto,send)).toEqual({state:"failed"});expect(send).not.toHaveBeenCalled();
    expect(await row(crashed.id)).toMatchObject({state:"failed",ciphertext:null,lease_id:null,lease_until:null});
  });
  it.each(["23 hours","24 hours"])("never retries at or past window %s even with a future next_attempt",async(age)=>{
    const f=await fixture(),send=vi.fn<MailTransport>();await pool.query("UPDATE hestia_mail_outbox SET attempts=1,first_attempt_at=clock_timestamp()-$2::interval,next_attempt=clock_timestamp()+interval '1 hour' WHERE id=$1",[f.id,age]);
    expect(await dispatchIdentityMail(pool,crypto,send)).toEqual({state:"failed"});expect(send).not.toHaveBeenCalled();expect((await row(f.id)).ciphertext).toBeNull();
  });
  it("accepts a retry before the window but rejects a window elapsed after claim",async()=>{
    const f=await fixture();await pool.query("UPDATE hestia_mail_outbox SET attempts=1,first_attempt_at=clock_timestamp()-interval '22 hours 59 minutes' WHERE id=$1",[f.id]);
    expect(await dispatchIdentityMail(pool,crypto,async()=>{})).toEqual({state:"sent"});
    const expired=await fixture(),send=vi.fn<MailTransport>();
    const checked=beforeFinalCheck(async()=>{await pool.query("UPDATE hestia_mail_outbox SET first_attempt_at=clock_timestamp()-interval '23 hours' WHERE id=$1",[expired.id]);});
    expect(await dispatchIdentityMail(checked,crypto,send)).toEqual({state:"failed"});expect(send).not.toHaveBeenCalled();expect((await row(expired.id)).ciphertext).toBeNull();
  });
  it("cancels legacy OTP without assigning an arbitrary proof and never renews attempted legacy mail",async()=>{
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA mail_migration_fixture");await client.query("SET LOCAL search_path TO mail_migration_fixture");
      await client.query("CREATE TABLE hestia_identity_proof(id uuid PRIMARY KEY)");
      await client.query("CREATE TABLE hestia_mail_outbox(id int,template text,state text,ciphertext text,lease_id uuid,lease_until timestamptz,created_at timestamptz,attempts int)");
      await client.query("INSERT INTO hestia_mail_outbox VALUES(1,'otp','pending','synthetic',NULL,NULL,clock_timestamp()-interval '2 days',0),(2,'invitation','failed','synthetic',NULL,NULL,clock_timestamp()-interval '2 days',1)");
      await client.query(await readFile(new URL("../../src/server/db/migrations/007-mail-delivery.sql",import.meta.url),"utf8"));
      const rows=(await client.query("SELECT *,first_attempt_at=created_at AS conservative FROM hestia_mail_outbox ORDER BY id")).rows;
      expect(rows[0]).toMatchObject({state:"cancelled",ciphertext:null,proof_id:null});expect(rows[1]).toMatchObject({state:"failed",ciphertext:"synthetic",conservative:true});
    } finally {await client.query("ROLLBACK");client.release();}
  });
});
