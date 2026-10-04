import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { beforeAll,beforeEach,afterAll,describe,it,expect } from "vitest";
import { Pool } from "pg";
import { createIdentity,revokeIdentityArtifacts } from "../../src/server/identity";
import { createAccess } from "../../src/server/access";
import { createAuth } from "../../src/server/auth/options";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import type { IdentityMail } from "../../src/server/identity/outbox";

describe("durable family identity using PostgreSQL and real Better Auth",()=>{
  const config=readServerConfig();
  if(config.environment!=="local"||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname))throw Error("Synthetic database required");
  const pool=new Pool({connectionString:config.databaseUrl,max:8}),otherPool=new Pool({connectionString:config.databaseUrl,max:4});
  const access=createAccess(pool,config,createAuth(pool,config)),identity=createIdentity(pool,config,access),app=createApplication(pool,config);
  const other=createIdentity(otherPool,config,createAccess(otherPool,config,createAuth(otherPool,config)));
  const password="Only synthetic integration password 2026!",nextPassword="Different synthetic password 2026!";
  const suffix=randomUUID(),ownerEmail=`owner-${suffix}@example.invalid`;
  let ownerCookie:string,ownerId:string;
  const mails:{id:string;template:string;parameters:IdentityMail}[]=[];
  const req=(path:string,body?:unknown,cookie?:string,method?:string)=>new Request(config.origin+path,{method:method??(body===undefined?"GET":"POST"),headers:{origin:config.origin,...(body===undefined?{}:{"content-type":"application/json"}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const pub=(action:string,body?:unknown,cookie?:string,service=identity)=>service.handleIdentity(req(`/api/hestia/identity/${action}`,body,cookie),action);
  const cookies=(r:Response)=>r.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");
  async function drain(service=identity){for(let i=0;i<40;i++){const result=await service.dispatchMail(async mail=>{mails.push(mail);});if(result.state==="idle")return;}throw Error("Outbox limit");}
  function mail(email:string,template:string){const found=mails.findLast(m=>m.parameters.email===email&&m.template===template);if(!found)throw Error("Expected synthetic message absent");return found.parameters;}
  async function login(email:string,secret=password){return app.handleAuth(req("/api/auth/sign-in/email",{email,password:secret}));}
  async function operator(kind:string,input:unknown) {
    return new Promise<{code:number|null;output:string}>(resolve=>{
      const child=spawn(process.execPath,["--disable-warning=ExperimentalWarning","scripts/identity-operator.mjs",kind],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
      let output="";child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.resume();child.on("error",()=>resolve({code:1,output:""}));child.on("close",code=>resolve({code,output}));child.stdin.end(JSON.stringify(input));
    });
  }
  async function entry(url:string){const link=new URL(url),result=await pub("enter",{flowId:link.searchParams.get("flowId"),capability:new URLSearchParams(link.hash.slice(1)).get("capability")});expect(result.status).toBe(200);return cookies(result);}
  async function activate(url:string,email:string){const cookie=await entry(url);expect((await pub("send-otp",{},cookie)).status).toBe(200);await drain();expect((await pub("verify-email",{otp:mail(email,"otp").otp},cookie)).status).toBe(200);
    const prepared=await pub("prepare",{password},cookie);expect(prepared.status).toBe(200);const preparedBody=await prepared.json(),codes=preparedBody.codes as string[],preparationId=preparedBody.preparationId as string;const requestId=randomUUID();const result=await pub("confirm",{requestId,preparationId,acknowledged:true},cookie);expect(result.status).toBe(200);return {cookie,codes,requestId,preparationId};}
  async function invite(){const email=`member-${randomUUID()}@example.invalid`;const r=await identity.handleInvitations(req("/api/hestia/household/invitations",{email,name:"Membre synthétique",requestId:randomUUID()},ownerCookie));expect(r.status).toBe(201);const {id}=await r.json();await drain();const link=mail(email,"invitation").url!;const activation=await activate(link,email);const idRow=(await pool.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];const signed=await login(email);expect(signed.status).toBe(200);await pool.query("DELETE FROM hestia_identity_rate");return {email,id:idRow.id as string,flowId:id,link,...activation,session: cookies(signed)};}
  beforeAll(async()=>{
    await migrateDatabase(pool,config);await migrateDatabase(pool,config);
    const resultCli=await operator("bootstrap",{email:ownerEmail,name:"Propriétaire synthétique"});expect(resultCli.code).toBe(0);expect(Object.keys(JSON.parse(resultCli.output)).sort()).toEqual(["delivery","flowId","transport"]);await drain();await activate(mail(ownerEmail,"invitation").url!,ownerEmail);
    ownerId=(await pool.query('SELECT id FROM "user" WHERE email=$1',[ownerEmail])).rows[0].id;
    const result=await login(ownerEmail);expect(result.status).toBe(200);ownerCookie=cookies(result);
  },60000);
  beforeEach(async()=>{await pool.query("DELETE FROM hestia_identity_rate");await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');});
  afterAll(async()=>{await otherPool.end();await pool.end();});

  it("closes singleton installation permanently and retains no plaintext codes",async()=>{
    let denied=false;try{await identity.prepareInstallation(`other-${suffix}@example.invalid`,"Autre");}catch{denied=true;}expect(denied).toBe(true);
    expect((await pool.query("SELECT count(*) n FROM hestia_member WHERE role='owner'")).rows[0].n).toBe("1");
    expect((await pool.query("SELECT count(*) n FROM hestia_recovery_code WHERE user_id=$1 AND revoked_at IS NULL",[ownerId])).rows[0].n).toBe("8");
    expect((await pool.query("SELECT prepared_ciphertext,prepared_password_hash FROM hestia_identity_flow WHERE target_id=$1 AND status='completed'",[ownerId])).rows.every(r=>r.prepared_ciphertext===null&&r.prepared_password_hash===null)).toBe(true);
  });
  it("rejects GET side effects, unknown fields, queries and cross origin",async()=>{
    const before=(await pool.query("SELECT count(*) n FROM hestia_mail_outbox")).rows[0].n;
    expect((await pub("recover")).status).toBe(404);
    expect((await pub("recover",{email:ownerEmail,admin:true})).status).toBe(400);
    const r=req("/api/hestia/identity/recover?token=x",{email:ownerEmail});expect((await identity.handleIdentity(r,"recover")).status).toBe(404);
    const cross=new Request(config.origin+"/api/hestia/identity/recover",{method:"POST",headers:{origin:"https://other.invalid","content-type":"application/json"},body:JSON.stringify({email:ownerEmail})});expect((await identity.handleIdentity(cross,"recover")).status).toBe(403);
    expect((await pool.query("SELECT count(*) n FROM hestia_mail_outbox")).rows[0].n).toBe(before);
  });
  it("creates a member without grants and replays exactly one concurrent activation receipt",async()=>{
    const m=await invite();expect((await pool.query("SELECT 1 FROM hestia_grant WHERE user_id=$1",[m.id])).rowCount).toBe(0);
    const replies=await Promise.all([pub("confirm",{requestId:m.requestId,preparationId:m.preparationId,acknowledged:true},m.cookie),pub("confirm",{requestId:m.requestId,preparationId:m.preparationId,acknowledged:true},m.cookie,other)]);
    expect(replies.map(r=>r.status)).toEqual([200,200]);expect((await pub("confirm",{requestId:randomUUID(),preparationId:m.preparationId,acknowledged:true},m.cookie)).status).toBe(409);
    expect((await pub("status",undefined,m.cookie)).status).toBe(200);
  });
  it("retains failed OTP attempts across pools and never grants on a mismatched proof",async()=>{
    const r=await pub("recover",{email:ownerEmail}),cookie=cookies(r);await drain();const correct=mail(ownerEmail,"otp").otp!;const wrong=correct==="000000"?"111111":"000000";
    for(let i=0;i<5;i++)expect((await pub("verify-email",{otp:wrong},cookie,i%2?other:identity)).status).toBe(400);
    expect((await pub("verify-email",{otp:correct},cookie)).status).toBe(400);
    expect((await pool.query("SELECT recovering FROM hestia_member WHERE user_id=$1",[ownerId])).rows[0].recovering).toBe(false);
    expect((await app.handleSession(req("/api/hestia/session",undefined,ownerCookie))).status).toBe(200);
  });
  it("gives known and unknown recovery the same response while a mere request leaves admission alive",async()=>{
    const a=await pub("recover",{email:ownerEmail}),b=await pub("recover",{email:`unknown-${suffix}@example.invalid`});
    expect(a.status).toBe(b.status);expect(await a.json()).toEqual(await b.json());
    expect((await app.handleSession(req("/api/hestia/session",undefined,ownerCookie))).status).toBe(200);
  });
  it("blocks an admitted identity while treating stale, inadmissible and forged BA cookies as anonymous",async()=>{
    expect((await pub("recover",{email:ownerEmail},ownerCookie)).status).toBe(409);
    expect((await pub("recover",{email:`forged-${randomUUID()}@example.invalid`},"better-auth.session_token=forged")).status).toBe(202);
    const m=await invite();await pool.query("UPDATE hestia_session_policy SET touched_at=clock_timestamp()-interval '31 minutes' WHERE session_id IN(SELECT id FROM session WHERE \"userId\"=$1)",[m.id]);
    expect((await pub("recover",{email:m.email},m.session)).status).toBe(202);
    await access.transaction(async client=>{const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[m.id]);await revokeIdentityArtifacts(client,m.id,r.rows[0].departure_epoch);});
    const readmit=await identity.handleReadmissions(req("/api/hestia/household/readmissions",{memberId:m.id,requestId:randomUUID()},ownerCookie));expect(readmit.status).toBe(201);await drain();
    const link=new URL(mail(m.email,"invitation").url!);
    expect((await pub("enter",{flowId:link.searchParams.get("flowId"),capability:new URLSearchParams(link.hash.slice(1)).get("capability")},m.session)).status).toBe(200);
    const failing=createIdentity(pool,config,{...access,withActor:async()=>{throw Error("Synthetic database unavailable");}} as typeof access);
    expect((await pub("recover",{email:m.email},"better-auth.session_token=forged",failing)).status).toBe(503);
  });
  it("admits recovery atomically, resumes across pools, rejects old login and finishes with zero codes",async()=>{
    const m=await invite(),start=await pub("recover",{email:m.email}),cookie=cookies(start);await drain();
    expect((await pub("verify-email",{otp:mail(m.email,"otp").otp},cookie)).status).toBe(200);
    const row=(await pool.query('SELECT m.*,a.password FROM hestia_member m JOIN account a ON a."userId"=m.user_id WHERE m.user_id=$1',[m.id])).rows[0];expect(row.recovering).toBe(true);expect(row.password===null).toBe(true);
    expect((await app.handleSession(req("/api/hestia/session",undefined,m.session))).status).toBe(401);expect((await login(m.email)).status).toBe(401);
    expect((await pub("status",undefined,cookie,other)).status).toBe(200);
    const requestId=randomUUID(),finish=await pub("finish",{password:nextPassword,requestId},cookie,other);expect(finish.status).toBe(200);expect(await finish.json()).toEqual({completed:true,recoveryCodeCount:0});
    expect((await pub("finish",{password:nextPassword,requestId},cookie)).status).toBe(200);
    const signed=await login(m.email,nextPassword);expect(signed.status).toBe(200);
    const rotation=await identity.handleMeRecoveryCodes(req("/api/hestia/me/recovery-codes/prepare",{password:nextPassword},cookies(signed)),"prepare");expect(rotation.status).toBe(200);const prepared=await rotation.json();expect(prepared.codes.length).toBe(8);
    const rotateId=randomUUID(),body={requestId:rotateId,preparationId:prepared.preparationId,acknowledged:true};expect((await identity.handleMeRecoveryCodes(req("/api/hestia/me/recovery-codes/confirm",body,cookies(signed)),"confirm")).status).toBe(200);
    const status=await identity.handleMeRecoveryCodes(req(`/api/hestia/me/recovery-codes?requestId=${rotateId}`,undefined,cookies(signed)));expect(await status.json()).toEqual({count:8,confirmedRequestId:rotateId});
    expect((await pool.query("SELECT membership_version,departure_epoch,role FROM hestia_member WHERE user_id=$1",[m.id])).rows[0]).toMatchObject({membership_version:"1",departure_epoch:0,role:"member"});
  });
  it("requires a previously issued cookie for code admission and verifies the new email before finish",async()=>{
    const m=await invite();expect((await pub("recover-code",{code:m.codes[0]})).status).toBe(404);
    const start=await pub("recover",{email:m.email,method:"code"}),cookie=cookies(start);expect((await pub("recover-code",{code:m.codes[0]},cookie)).status).toBe(200);
    expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},cookie)).status).toBe(409);
    const newEmail=`new-${randomUUID()}@example.invalid`;expect((await pub("recovery-email",{email:newEmail},cookie)).status).toBe(200);await drain();
    expect((await pub("verify-email",{otp:mail(newEmail,"otp").otp},cookie)).status).toBe(200);
    expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},cookie)).status).toBe(200);
    expect((await login(newEmail,nextPassword)).status).toBe(200);expect((await login(m.email)).status).toBe(401);
    await drain();expect(Object.keys(mail(m.email,"email-changed"))).toEqual(["email"]);
    const again=await pub("recover",{email:newEmail,method:"code"});expect((await pub("recover-code",{code:m.codes[1]},cookies(again))).status).toBe(400);
  });
  it("keeps recovery closed after expiration and permits a remaining code to replace the interrupted flow",async()=>{
    const m=await invite(),start=await pub("recover",{email:m.email,method:"code"}),cookie=cookies(start);expect((await pub("recover-code",{code:m.codes[0]},cookie)).status).toBe(200);
    const id=cookie.split("=")[1].split(".")[0];await pool.query("UPDATE hestia_identity_flow SET browser_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    expect((await pub("status",undefined,cookie)).status).toBe(404);expect((await login(m.email)).status).toBe(401);
    const again=await pub("recover",{email:m.email,method:"code"}),nextCookie=cookies(again);expect((await pub("recover-code",{code:m.codes[0]},nextCookie)).status).toBe(400);expect((await pub("recover-code",{code:m.codes[1]},nextCookie)).status).toBe(200);
    expect((await pool.query("SELECT status FROM hestia_identity_flow WHERE id=$1",[id])).rows[0].status).toBe("revoked");
  });
  it("a concurrent withdrawal wins over recovery without reactivation",async()=>{
    const m=await invite(),start=await pub("recover",{email:m.email}),cookie=cookies(start);await drain();expect((await pub("verify-email",{otp:mail(m.email,"otp").otp},cookie)).status).toBe(200);
    await access.transaction(async client=>{const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[m.id]);await revokeIdentityArtifacts(client,m.id,r.rows[0].departure_epoch);});
    expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},cookie)).status).toBe(404);expect((await pool.query("SELECT active FROM hestia_member WHERE user_id=$1",[m.id])).rows[0].active).toBe(false);
  });
  it("resumes via the proved new address after the last code and expired admission browser, including retention cleanup",async()=>{
    const m=await invite(),newEmail=`retained-${randomUUID()}@example.invalid`;
    // The first seven codes represent already consumed historic recovery codes.
    await pool.query("UPDATE hestia_recovery_code SET consumed_at=clock_timestamp() WHERE user_id=$1 AND selector<>$2",[m.id,m.codes[7].split("-")[0]]);
    const start=await pub("recover",{email:m.email,method:"code"}),oldCookie=cookies(start);
    expect((await pub("recover-code",{code:m.codes[7]},oldCookie)).status).toBe(200);
    expect((await pub("recovery-email",{email:newEmail},oldCookie)).status).toBe(200);await drain();
    expect((await pub("verify-email",{otp:mail(newEmail,"otp").otp},oldCookie)).status).toBe(200);
    expect((await pool.query("SELECT count(*) n FROM hestia_recovery_code WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL",[m.id])).rows[0].n).toBe("0");
    const oldId=oldCookie.split("=")[1].split(".")[0];
    await pool.query("UPDATE hestia_identity_flow SET browser_until=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '31 days' WHERE id=$1",[oldId]);
    const resumed=await pub("recover",{email:newEmail}),resumedCookie=cookies(resumed);expect(resumed.status).toBe(202);expect(await resumed.json()).toEqual({accepted:true});await drain();
    // capacity has expired and archived the browser, but retained the admission.
    expect((await pool.query("SELECT status FROM hestia_identity_flow WHERE id=$1",[oldId])).rows[0].status).toBe("revoked");
    expect((await pub("verify-email",{otp:mail(newEmail,"otp").otp},resumedCookie,other)).status).toBe(200);
    expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},oldCookie)).status).toBe(404);
    expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},resumedCookie,other)).status).toBe(200);
    expect((await login(newEmail,nextPassword)).status).toBe(200);expect((await login(m.email)).status).toBe(401);
    expect((await pub("status",undefined,oldCookie)).status).toBe(404);
  });
  it("does not resolve unproved, superseded, withdrawn, ambiguous or registered-to-another recovery aliases",async()=>{
    const first=await invite(),second=await invite(),email=`alias-${randomUUID()}@example.invalid`;
    async function lookup(address:string) {
      // Address-resolution cases are independent of emission-window saturation.
      await pool.query("DELETE FROM hestia_identity_rate");
      const result=await pub("recover",{email:address});expect(result.status).toBe(202);expect(await result.clone().json()).toEqual({accepted:true});
      const id=cookies(result).split("=")[1].split(".")[0];return (await pool.query("SELECT target_id FROM hestia_identity_flow WHERE id=$1",[id])).rows[0].target_id;
    }
    const initial=await pub("recover",{email:first.email,method:"code"}),initialCookie=cookies(initial);expect((await pub("recover-code",{code:first.codes[0]},initialCookie)).status).toBe(200);
    expect((await pub("recovery-email",{email},initialCookie)).status).toBe(200);await drain();const initialOtp=mail(email,"otp").otp;
    expect(await lookup(email)).toBeNull();expect((await pub("verify-email",{otp:initialOtp},initialCookie)).status).toBe(200);expect(await lookup(email)).toBe(first.id);
    const replacement=await pub("recover",{email:first.email,method:"code"}),replacementCookie=cookies(replacement);expect((await pub("recover-code",{code:first.codes[1]},replacementCookie)).status).toBe(200);expect(await lookup(email)).toBeNull();
    const currentEmail=`current-${randomUUID()}@example.invalid`;expect((await pub("recovery-email",{email:currentEmail},replacementCookie)).status).toBe(200);await drain();expect((await pub("verify-email",{otp:mail(currentEmail,"otp").otp},replacementCookie)).status).toBe(200);
    const secondStart=await pub("recover",{email:second.email,method:"code"}),secondCookie=cookies(secondStart);expect((await pub("recover-code",{code:second.codes[0]},secondCookie)).status).toBe(200);expect((await pub("recovery-email",{email:currentEmail},secondCookie)).status).toBe(200);await drain();expect((await pub("verify-email",{otp:mail(currentEmail,"otp").otp},secondCookie)).status).toBe(200);
    expect(await lookup(currentEmail)).toBeNull(); // Two current admissions: no arbitrary identity selection.
    await pool.query('UPDATE "user" SET email=$2 WHERE id=$1',[second.id,currentEmail]);
    expect(await lookup(currentEmail)).toBe(second.id); // Registered identity wins over the first alias.
    await access.transaction(async client=>{const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[second.id]);await revokeIdentityArtifacts(client,second.id,r.rows[0].departure_epoch);});
    expect(await lookup(currentEmail)).toBeNull(); // Inactive registered address still blocks fallback.
    await pool.query('UPDATE "user" SET email=$2 WHERE id=$1',[second.id,second.email]);
    expect(await lookup(currentEmail)).toBe(first.id);
    await access.transaction(async client=>{const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[first.id]);await revokeIdentityArtifacts(client,first.id,r.rows[0].departure_epoch);});
    expect(await lookup(currentEmail)).toBeNull();
  });
  it("readmits the same inactive identity as member once without reviving grants",async()=>{
    const m=await invite();await access.transaction(async client=>{const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[m.id]);await revokeIdentityArtifacts(client,m.id,r.rows[0].departure_epoch);});
    const result=await identity.handleReadmissions(req("/api/hestia/household/readmissions",{memberId:m.id,requestId:randomUUID()},ownerCookie));expect(result.status).toBe(201);await drain();
    const activated=await activate(mail(m.email,"invitation").url!,m.email);
    const before=(await pool.query("SELECT membership_version,epoch,departure_epoch,role FROM hestia_member WHERE user_id=$1",[m.id])).rows[0];expect(before).toMatchObject({membership_version:"3",departure_epoch:1,role:"member"});
    expect((await pub("confirm",{requestId:activated.requestId,preparationId:activated.preparationId,acknowledged:true},activated.cookie)).status).toBe(200);
    expect((await pool.query("SELECT membership_version FROM hestia_member WHERE user_id=$1",[m.id])).rows[0].membership_version).toBe(before.membership_version);
    expect((await pool.query("SELECT 1 FROM hestia_grant WHERE user_id=$1 AND revoked_at IS NULL",[m.id])).rowCount).toBe(0);
  });
  it("rejects obsolete link after reissue and never marks an absent transport delivered",async()=>{
    const email=`invite-${randomUUID()}@example.invalid`,result=await identity.handleInvitations(req("/api/hestia/household/invitations",{email,name:"Invité",requestId:randomUUID()},ownerCookie));const {id}=await result.json();await drain();const old=mail(email,"invitation").url!;
    await pool.query("DELETE FROM hestia_identity_rate");expect((await identity.handleInvitations(req(`/api/hestia/household/invitations/${id}/reissue`,{requestId:randomUUID()},ownerCookie),id,"reissue")).status).toBe(200);
    expect((await identity.dispatchMail()).state).toBe("transport-unavailable");
    const url=new URL(old);expect((await pub("enter",{flowId:id,capability:new URLSearchParams(url.hash.slice(1)).get("capability")})).status).toBe(404);
    expect((await pool.query("SELECT state FROM hestia_mail_outbox WHERE flow_id=$1 ORDER BY created_at DESC LIMIT 1",[id])).rows[0].state).toBe("pending");
  });
  it("serializes two first confirmations and binds the receipt to the exact intention",async()=>{
    const email=`race-${randomUUID()}@example.invalid`,created=await identity.handleInvitations(req("/api/hestia/household/invitations",{name:"Concurrent",email,requestId:randomUUID()},ownerCookie));expect(created.status).toBe(201);await drain();
    const cookie=await entry(mail(email,"invitation").url!);expect((await pub("send-otp",{},cookie)).status).toBe(200);await drain();expect((await pub("verify-email",{otp:mail(email,"otp").otp},cookie)).status).toBe(200);
    const a=await pub("prepare",{password},cookie),preparedA=await a.json(),b=await pub("prepare",{password},cookie),preparedB=await b.json();expect(a.status).toBe(200);expect(b.status).toBe(200);
    expect((await pub("confirm",{requestId:randomUUID(),preparationId:preparedA.preparationId,acknowledged:true},cookie)).status).toBe(409);
    const body={requestId:randomUUID(),preparationId:preparedB.preparationId,acknowledged:true},responses=await Promise.all([pub("confirm",body,cookie),pub("confirm",body,cookie,other)]);expect(responses.map(r=>r.status)).toEqual([200,200]);
    expect((await pool.query('SELECT count(*) n FROM "user" WHERE email=$1',[email])).rows[0].n).toBe("1");
    expect((await pub("prepare",{password},cookie)).status).toBe(404);
  });
  it("never lets a new link browser inherit another browser's verified address",async()=>{
    const email=`browser-${randomUUID()}@example.invalid`;await identity.handleInvitations(req("/api/hestia/household/invitations",{name:"Navigateur",email,requestId:randomUUID()},ownerCookie));await drain();const url=mail(email,"invitation").url!;
    const first=await entry(url);await pub("send-otp",{},first);await drain();expect((await pub("verify-email",{otp:mail(email,"otp").otp},first)).status).toBe(200);
    const second=await entry(url);expect((await pub("prepare",{password},second)).status).toBe(409);expect((await pub("prepare",{password},first)).status).toBe(404);
  });
  it("rolls back admission when credential mutation fails and admits only once after retry",async()=>{
    const m=await invite(),start=await pub("recover",{email:m.email}),cookie=cookies(start);await drain();const otp=mail(m.email,"otp").otp;
    await pool.query(`CREATE FUNCTION hestia_test_identity_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.password IS NULL THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER hestia_test_identity_failure BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION hestia_test_identity_failure()`);
    try {expect((await pub("verify-email",{otp},cookie)).status).toBe(503);expect((await pool.query("SELECT recovering,epoch FROM hestia_member WHERE user_id=$1",[m.id])).rows[0]).toMatchObject({recovering:false,epoch:0});
      expect((await app.handleSession(req("/api/hestia/session",undefined,m.session))).status).toBe(200);
    }finally{await pool.query("DROP TRIGGER hestia_test_identity_failure ON account; DROP FUNCTION hestia_test_identity_failure()");}
    const responses=await Promise.all([pub("verify-email",{otp},cookie),pub("verify-email",{otp},cookie,other)]);expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
    expect((await pool.query("SELECT epoch FROM hestia_member WHERE user_id=$1",[m.id])).rows[0].epoch).toBe(1);
  });
  it("requires target-bound owner confirmation for former admins and demotes on return",async()=>{
    const m=await invite(),otherMember=await invite();
    for(const id of [m.id,otherMember.id])await access.transaction(async client=>{await client.query("UPDATE hestia_member SET role='admin' WHERE user_id=$1",[id]);const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[id]);await revokeIdentityArtifacts(client,id,r.rows[0].departure_epoch);});
    const confirm=await identity.handleConfirmReadmission(req("/api/hestia/household/readmissions/confirm",{memberId:m.id,password,requestId:randomUUID()},ownerCookie));expect(confirm.status).toBe(200);const {confirmationId}=await confirm.json();
    const wrong=await identity.handleReadmissions(req("/api/hestia/household/readmissions",{memberId:otherMember.id,confirmationId,requestId:randomUUID()},ownerCookie));expect(wrong.status).toBe(409);
    const result=await identity.handleReadmissions(req("/api/hestia/household/readmissions",{memberId:m.id,confirmationId,requestId:randomUUID()},ownerCookie));expect(result.status).toBe(201);await drain();
    const before=(await pool.query("SELECT membership_version FROM hestia_member WHERE user_id=$1",[m.id])).rows[0];await activate(mail(m.email,"invitation").url!,m.email);
    const after=(await pool.query("SELECT membership_version,role,active FROM hestia_member WHERE user_id=$1",[m.id])).rows[0];expect(after.role).toBe("member");expect(after.active).toBe(true);expect(Number(after.membership_version)).toBe(Number(before.membership_version)+1);
  });
  it("invalidates invitations and pending mail when the inviting administrator leaves",async()=>{
    const admin=await invite();await pool.query("UPDATE hestia_member SET role='admin' WHERE user_id=$1",[admin.id]);
    const email=`actor-${randomUUID()}@example.invalid`,created=await identity.handleInvitations(req("/api/hestia/household/invitations",{name:"Invitation",email,requestId:randomUUID()},admin.session));expect(created.status).toBe(201);const {id}=await created.json();
    await access.transaction(async client=>{const r=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[admin.id]);await revokeIdentityArtifacts(client,admin.id,r.rows[0].departure_epoch);});
    await drain();expect(mails.some(m=>m.parameters.email===email)).toBe(false);expect((await pool.query("SELECT status FROM hestia_identity_flow WHERE id=$1",[id])).rows[0].status).toBe("revoked");
  });
  it("rolls back invitation and encrypted outbox together on persistence failure",async()=>{
    const email=`rollback-${randomUUID()}@example.invalid`;
    await pool.query(`CREATE FUNCTION hestia_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$;
      CREATE TRIGGER hestia_test_outbox_failure BEFORE INSERT ON hestia_mail_outbox FOR EACH ROW EXECUTE FUNCTION hestia_test_outbox_failure()`);
    try{const r=await identity.handleInvitations(req("/api/hestia/household/invitations",{name:"Rollback",email,requestId:randomUUID()},ownerCookie));expect(r.status).toBe(503);expect((await pool.query("SELECT 1 FROM hestia_identity_flow WHERE email=$1",[email])).rowCount).toBe(0);}
    finally{await pool.query("DROP TRIGGER hestia_test_outbox_failure ON hestia_mail_outbox; DROP FUNCTION hestia_test_outbox_failure()");}
  });
  it("recovers an expired worker lease with the same message ID and rejects corrupted ciphertext",async()=>{
    // Drain unrelated pending test messages first, then use one isolated message.
    await drain();const email=`lease-${randomUUID()}@example.invalid`,r=await identity.handleInvitations(req("/api/hestia/household/invitations",{name:"Lease",email,requestId:randomUUID()},ownerCookie));const {id}=await r.json();
    const row=(await pool.query("SELECT * FROM hestia_mail_outbox WHERE flow_id=$1",[id])).rows[0];
    await pool.query("UPDATE hestia_mail_outbox SET state='sending',lease_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[row.id,randomUUID()]);
    let sentId="";expect((await identity.dispatchMail(async message=>{sentId=message.id;})).state).toBe("sent");expect(sentId===row.id).toBe(true);
    await pool.query("UPDATE hestia_mail_outbox SET state='pending',ciphertext=$2 WHERE id=$1",[row.id,row.ciphertext.slice(0,-4)+"AAAA"]);
    let sent=false;expect((await identity.dispatchMail(async()=>{sent=true;})).state).toBe("failed");expect(sent).toBe(false);
  });
  it("supports exceptional operator preparation with mandatory new-address proof and no premature admission",async()=>{
    const m=await invite(),email=`exception-${randomUUID()}@example.invalid`,operator=await identity.prepareExceptionalRecovery(m.id,email);
    expect((await app.handleSession(req("/api/hestia/session",undefined,m.session))).status).toBe(200);
    const cookie=await entry(operator.url);expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},cookie)).status).toBe(409);
    await pub("send-otp",{},cookie);await drain();expect((await pub("verify-email",{otp:mail(email,"otp").otp},cookie)).status).toBe(200);
    expect((await pub("finish",{password:nextPassword,requestId:randomUUID()},cookie)).status).toBe(200);expect((await login(email,nextPassword)).status).toBe(200);
  });
  it("paginates outstanding invitations without hiding them behind completed history",async()=>{
    const outstanding:string[]=Array.from({length:3},()=>randomUUID()),history:string[]=Array.from({length:101},()=>randomUUID());
    const insert=async(ids:string[],status:string)=>pool.query(`INSERT INTO hestia_identity_flow(id,kind,email,status,actor_id,actor_epoch,actor_role)
      SELECT x.id,'invite',x.id::text||'@example.invalid',$2,m.user_id,m.epoch,m.role
      FROM unnest($1::uuid[]) AS x(id) CROSS JOIN hestia_member m WHERE m.user_id=$3`,[ids,status,ownerId]);
    try {
      await insert(outstanding,"pending");await insert(history,"completed");
      await pool.query("UPDATE hestia_identity_flow SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[outstanding[0]]);
      expect((await pub("recover",{email:`housekeeping-${randomUUID()}@example.invalid`})).status).toBe(202);
      let offset:number|null=0;const seen:{id:string;status:string;allowedActions:{canReissue:boolean}}[]=[];
      while(offset!==null){const result=await identity.handleInvitations(req(`/api/hestia/household/invitations?offset=${offset}&limit=2`,undefined,ownerCookie));expect(result.status).toBe(200);const body=await result.json();expect(body.invitations.length).toBeLessThanOrEqual(2);seen.push(...body.invitations);offset=body.nextOffset;}
      expect(new Set(seen.map(row=>row.id)).size).toBe(seen.length);
      expect(outstanding.every(id=>seen.some(row=>row.id===id))).toBe(true);
      expect(seen.some(row=>history.includes(row.id))).toBe(false);
      expect(seen.find(row=>row.id===outstanding[0])).toMatchObject({status:"expired",allowedActions:{canReissue:true}});
      expect((await identity.handleInvitations(req(`/api/hestia/household/invitations/${outstanding[0]}/reissue`,{requestId:randomUUID()},ownerCookie),outstanding[0],"reissue")).status).toBe(200);
      for(const query of ["limit=0","limit=101","offset=-1","offset=0&offset=1"])expect((await identity.handleInvitations(req(`/api/hestia/household/invitations?${query}`,undefined,ownerCookie))).status).toBeGreaterThanOrEqual(400);
    } finally {await pool.query("DELETE FROM hestia_mail_outbox WHERE flow_id=ANY($1::uuid[])",[[...outstanding,...history]]);await pool.query("DELETE FROM hestia_identity_flow WHERE id=ANY($1::uuid[])",[[...outstanding,...history]]);}
  });
  it("projects former-admin readmission controls and actor-bound uncertain-operation receipts",async()=>{
    const target=await invite(),admin=await invite();
    await pool.query("UPDATE hestia_member SET role='admin' WHERE user_id=ANY($1::text[])",[[target.id,admin.id]]);
    await access.transaction(async client=>{const result=await client.query("UPDATE hestia_member SET active=false WHERE user_id=$1 RETURNING departure_epoch",[target.id]);await revokeIdentityArtifacts(client,target.id,result.rows[0].departure_epoch);});
    const confirmation=await identity.handleConfirmReadmission(req("/api/hestia/household/readmissions/confirm",{memberId:target.id,password,requestId:randomUUID()},ownerCookie));expect(confirmation.status).toBe(200);
    const {confirmationId}=await confirmation.json(),requestId=randomUUID();
    const created=await identity.handleReadmissions(req("/api/hestia/household/readmissions",{memberId:target.id,confirmationId,requestId},ownerCookie));expect(created.status).toBe(201);const {id}=await created.json();
    const ownerView=await identity.handleReadmissions(req(`/api/hestia/household/readmissions?requestId=${requestId}`,undefined,ownerCookie));const ownerData=await ownerView.json();expect(ownerData.operationStatus).toBe("committed");
    const ownerRow=ownerData.readmissions.find((row:{id:string})=>row.id===id);expect(ownerRow).toMatchObject({name:"Membre synthétique",targetId:target.id,kind:"readmit",allowedActions:{canManage:true,canCancel:true,canReissue:true}});
    const adminView=await identity.handleReadmissions(req(`/api/hestia/household/readmissions?requestId=${requestId}`,undefined,admin.session));const adminData=await adminView.json();expect(adminData.operationStatus).toBe("not-recorded");expect(adminData.readmissions.find((row:{id:string})=>row.id===id).allowedActions.canManage).toBe(false);
    for(const action of ["reissue","cancel"])expect((await identity.handleReadmissions(req(`/api/hestia/household/readmissions/${id}/${action}`,{requestId:randomUUID()},admin.session),id,action)).status).toBe(404);
    expect((await identity.handleReadmissions(req(`/api/hestia/household/readmissions/${id}/reissue`,{requestId:randomUUID()},ownerCookie),id,"reissue")).status).toBe(200);
    expect((await identity.handleReadmissions(req(`/api/hestia/household/readmissions/${id}/cancel`,{requestId:randomUUID()},ownerCookie),id,"cancel")).status).toBe(200);
  });
});
