import { randomInt, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Pool, PoolClient } from "pg";
import { guarded, HttpError, invalid, isUuid, json, response, textField, unavailable, type Access } from "../access";
import type { ServerConfig } from "../config";
import { capability, identityCrypto, newCodes } from "./crypto";
import { createCredential, credential, setPassword } from "./auth-record";
import { dispatchIdentityMail, enqueue, type MailTransport } from "./outbox";
import { revokeFlows } from "./revoke";
export { revokeIdentityArtifacts } from "./revoke";

type Flow={id:string;kind:string;actor_id:string|null;actor_epoch:number|null;actor_role:string|null;target_id:string|null;target_epoch:number|null;email:string;name:string|null;version:number;status:string;capability_digest:string|null;browser_digest:string|null;email_verified:boolean;admission_id:string|null;prepared_password_hash:string|null;prepared_ciphertext:string|null;prepared_batch:string|null;alive:boolean;browser_alive:boolean;prepared_alive:boolean};
const conflict=()=>new HttpError(409,"IDENTITY_CONFLICT","Ce parcours a changé. Recommencez depuis son point d’entrée.");
const limited=()=>new HttpError(429,"RATE_LIMITED","Trop de tentatives. Réessayez plus tard.");
const emailValue=(value:unknown)=>{const email=textField(value,254).toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw invalid();return email;};
const passwordValue=(value:unknown)=>{if(typeof value!=="string"||value.length<15||value.length>128)throw invalid();return value;};
const uuid=(value:unknown)=>{if(!isUuid(value))throw invalid();return value;};
const codeAAD=(f:Flow)=>`codes|${f.id}|${f.version}|${f.prepared_batch}`;
const fail=(error:HttpError)=>response({error:{code:error.code,message:error.message}},error.status);

export function createIdentity(pool:Pool,config:ServerConfig,access:Access) {
  const crypto=identityCrypto(config.secret);
  const cookieName="hestia.identity";
  const send=(data:unknown,status=200,headers?:Headers)=>{const h=new Headers(headers);h.set("Referrer-Policy","no-referrer");return response(data,status,h);};
  function route(request:Request,method="POST") {
    if(new URL(request.url).search||request.method!==method)throw unavailable();
    if(method!=="GET")access.origin(request);
  }
  async function noLogin(request:Request) {
    if(!/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(request.headers.get("cookie")??""))return;
    try {await access.withActor(request,async()=>true,false);}
    catch(error) {
      // An expired, revoked or forged BA cookie is not an admitted Hestia
      // identity. Database/service failures must not be mistaken for anonymity.
      if(error instanceof HttpError&&error.status===401)return;
      throw error;
    }
    throw new HttpError(409,"SIGN_OUT_REQUIRED","Déconnectez-vous avant de poursuivre ce parcours.");
  }
  function cookie(request:Request) {
    const values=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(cookieName+"="));
    if(values.length!==1)throw unavailable();
    const parts=values[0].slice(cookieName.length+1).split(".");
    if(parts.length!==2||!isUuid(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))throw unavailable();
    return {id:parts[0],secret:parts[1]};
  }
  const cookieHeaders=(id:string,secret:string)=>new Headers({"Set-Cookie":`${cookieName}=${id}.${secret}; Path=/api/hestia; HttpOnly; SameSite=Strict; Max-Age=1800${config.origin.startsWith("https:")?"; Secure":""}`});
  async function flow(client:PoolClient,id:string) {
    const row=(await client.query(`SELECT *,expires_at>clock_timestamp() AS alive,browser_until>clock_timestamp() AS browser_alive,
      prepared_until>clock_timestamp() AS prepared_alive FROM hestia_identity_flow WHERE id=$1 FOR UPDATE`,[id])).rows[0] as Flow|undefined;
    if(!row)throw unavailable();return row;
  }
  async function privateFlow(client:PoolClient,request:Request,completed=false) {
    const c=cookie(request), f=await flow(client,c.id);
    if(!f.alive||!f.browser_alive||f.status==="revoked"||(!completed&&f.status==="completed")||!crypto.matches(f.browser_digest,crypto.digest("browser",f.id,f.version,c.secret)))throw unavailable();
    return f;
  }
  async function rate(client:PoolClient,dimension:string,value:string,seconds:number,max:number) {
    const key=crypto.digest("rate",dimension,value);
    const row=(await client.query(`INSERT INTO hestia_identity_rate(key,bucket,count,expires_at)
      VALUES($1,floor(extract(epoch FROM clock_timestamp())/$2)::bigint,1,clock_timestamp()+make_interval(secs=>$2))
      ON CONFLICT(key,bucket) DO UPDATE SET count=hestia_identity_rate.count+1 RETURNING count`,[key,seconds])).rows[0];
    return row.count<=max;
  }
  async function publicBudget() {
    // Untrusted forwarded headers are deliberately ignored. Hosting may supply a
    // verified adapter later; this conservative global budget works on every host.
    const ok=await access.transaction(c=>rate(c,"public","instance",60,30));
    if(!ok)throw limited();
  }
  async function emailBudget(client:PoolClient,email:string) {
    const a=await rate(client,"email-short",email,900,3),b=await rate(client,"email-hour",email,3600,10);
    return a&&b;
  }
  async function capacity(client:PoolClient) {
    await client.query("DELETE FROM hestia_identity_rate WHERE expires_at<clock_timestamp()-interval '1 hour'");
    await client.query(`UPDATE hestia_identity_flow SET status=CASE WHEN kind IN ('invite','readmit') THEN status ELSE 'revoked' END,browser_digest=NULL,capability_digest=NULL,
      prepared_password_hash=NULL,prepared_ciphertext=NULL WHERE expires_at<=clock_timestamp() AND status NOT IN ('completed','revoked')`);
    await client.query(`UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE state IN ('pending','sending','failed')
      AND flow_id IN (SELECT id FROM hestia_identity_flow WHERE status='revoked' OR expires_at<=clock_timestamp())`);
    await client.query("DELETE FROM hestia_identity_confirmation WHERE expires_at<clock_timestamp()-interval '1 day'");
    await client.query("DELETE FROM hestia_identity_receipt WHERE created_at<clock_timestamp()-interval '30 days'");
    await client.query("DELETE FROM hestia_recovery_code WHERE revoked_at<clock_timestamp()-interval '30 days'");
    // A current recovery admission outlives its browser capability. Retain its
    // proved address until another admission/finish/departure supersedes it;
    // otherwise losing the last recovery code would strand the rightful holder.
    const obsolete=`SELECT f.id FROM hestia_identity_flow f WHERE f.status IN ('completed','revoked')
      AND f.expires_at<clock_timestamp()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM hestia_member m
        WHERE m.user_id=f.target_id AND m.active AND m.recovering AND m.epoch=f.target_epoch AND f.admission_id IS NOT NULL)`;
    await client.query(`DELETE FROM hestia_mail_outbox WHERE flow_id IN (${obsolete})`);
    await client.query(`DELETE FROM hestia_identity_proof WHERE flow_id IN (${obsolete})`);
    await client.query(`DELETE FROM hestia_identity_flow WHERE id IN (${obsolete})`);
    return Number((await client.query("SELECT count(*) n FROM hestia_identity_flow WHERE status NOT IN ('completed','revoked') AND expires_at>clock_timestamp()")).rows[0].n)<5000;
  }
  async function receipt(client:PoolClient,principal:string,id:string,operation:string,command:unknown) {
    const digest=crypto.digest("command",operation,command);
    const row=(await client.query("SELECT * FROM hestia_identity_receipt WHERE principal=$1 AND request_id=$2",[principal,id])).rows[0];
    if(row&&(row.operation!==operation||!crypto.matches(row.command_digest,digest)))throw conflict();
    return {prior:row?.result,save:async(result:unknown)=>{await client.query("INSERT INTO hestia_identity_receipt(principal,request_id,operation,command_digest,result) VALUES($1,$2,$3,$4,$5)",[principal,id,operation,digest,JSON.stringify(result)]);return result;}};
  }
  async function actorRole(client:PoolClient,id:string) {
    const member=(await client.query("SELECT * FROM hestia_member WHERE user_id=$1 AND active AND NOT recovering",[id])).rows[0];
    if(!member||!["owner","admin"].includes(member.role))throw unavailable();return member;
  }
  async function recoveryTarget(client:PoolClient,email:string) {
    // A registered address always takes precedence, including inactive or
    // inconsistent identities. Never resolve its name to someone else's alias.
    const registered=await client.query('SELECT m.* FROM "user" u LEFT JOIN hestia_member m ON m.user_id=u.id WHERE lower(u.email)=$1',[email]);
    if(registered.rowCount)return registered.rowCount===1&&registered.rows[0].active?registered.rows[0]:undefined;
    const aliases=await client.query(`SELECT DISTINCT m.* FROM hestia_member m JOIN hestia_identity_flow f ON f.target_id=m.user_id
      WHERE f.email=$1 AND f.kind IN ('recovery','exceptional') AND f.email_verified AND f.admission_id IS NOT NULL
        AND m.active AND m.recovering AND m.epoch=f.target_epoch
        AND EXISTS(SELECT 1 FROM hestia_identity_proof p WHERE p.flow_id=f.id AND p.version=f.version AND p.email=f.email
          AND p.purpose IN ('new-email','recovery') AND p.consumed_at IS NOT NULL AND p.revoked_at IS NULL)`,[email]);
    // Public response remains neutral for ambiguous aliases. Expired private
    // cookies do not revoke an independently proved current admission address.
    return aliases.rowCount===1?aliases.rows[0]:undefined;
  }
  async function actorStillValid(client:PoolClient,f:Flow) {
    if(!f.actor_id)return;
    const m=await actorRole(client,f.actor_id);
    if(m.epoch!==f.actor_epoch||(f.actor_role==="owner"&&m.role!=="owner"))throw conflict();
  }
  async function revokeFlow(client:PoolClient,id:string) {
    await client.query("UPDATE hestia_identity_flow SET status='revoked',capability_digest=NULL,browser_digest=NULL,prepared_ciphertext=NULL,prepared_password_hash=NULL WHERE id=$1",[id]);
    await client.query("UPDATE hestia_identity_proof SET revoked_at=clock_timestamp() WHERE flow_id=$1",[id]);
    await client.query("UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE flow_id=$1 AND state IN ('pending','sending','failed')",[id]);
  }
  async function issueOtp(client:PoolClient,f:Flow,purpose:string) {
    const recent=(await client.query("SELECT 1 FROM hestia_identity_proof WHERE flow_id=$1 AND created_at>clock_timestamp()-interval '60 seconds'",[f.id])).rowCount;
    if(recent)return false;
    await client.query("UPDATE hestia_identity_proof SET revoked_at=clock_timestamp() WHERE flow_id=$1 AND consumed_at IS NULL",[f.id]);
    await client.query("UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE flow_id=$1 AND template='otp' AND state IN ('pending','sending','failed')",[f.id]);
    const otp=randomInt(0,1000000).toString().padStart(6,"0"),id=randomUUID();
    await client.query("INSERT INTO hestia_identity_proof(id,flow_id,version,email,purpose,digest) VALUES($1,$2,$3,$4,$5,$6)",[id,f.id,f.version,f.email,purpose,crypto.digest("otp",id,f.id,f.version,f.email,purpose,otp)]);
    if(f.kind!=="recovery"||f.target_id)await enqueue(client,crypto,f,"otp",{email:f.email,otp},id);
    return true;
  }
  async function proveOtp(client:PoolClient,f:Flow,otp:unknown,purpose:string) {
    const p=(await client.query(`SELECT *,expires_at>clock_timestamp() AS alive FROM hestia_identity_proof
      WHERE flow_id=$1 AND version=$2 AND email=$3 AND purpose=$4 AND consumed_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[f.id,f.version,f.email,purpose])).rows[0];
    if(!p||!p.alive||p.attempts>=5)return false;
    await client.query("UPDATE hestia_identity_proof SET attempts=attempts+1 WHERE id=$1",[p.id]);
    if(typeof otp!=="string"||!/^\d{6}$/.test(otp)||!crypto.matches(p.digest,crypto.digest("otp",p.id,f.id,f.version,f.email,purpose,otp)))return false;
    await client.query("UPDATE hestia_identity_proof SET consumed_at=clock_timestamp() WHERE id=$1",[p.id]);return true;
  }
  async function boundEmailProof(client:PoolClient,f:Flow,purpose:string) {
    return !!(await client.query("SELECT 1 FROM hestia_identity_proof WHERE flow_id=$1 AND version=$2 AND email=$3 AND purpose=$4 AND consumed_at IS NOT NULL AND revoked_at IS NULL",[f.id,f.version,f.email,purpose])).rowCount;
  }
  async function replaceCodes(client:PoolClient,userId:string,batch:string,codes:string[]) {
    await client.query("UPDATE hestia_recovery_code SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1",[userId]);
    for(const code of codes){const selector=code.split("-")[0];await client.query("INSERT INTO hestia_recovery_code(user_id,batch_id,selector,digest) VALUES($1,$2,$3,$4)",[userId,batch,selector,crypto.digest("recovery-code",userId,batch,selector,code)]);}
  }
  async function admitted(client:PoolClient,f:Flow) {
    if(!f.target_id)throw conflict();
    const m=(await client.query("SELECT * FROM hestia_member WHERE user_id=$1 FOR UPDATE",[f.target_id])).rows[0];
    if(!m?.active||!m.recovering||m.epoch!==f.target_epoch||!f.admission_id||f.status!=="recovering")throw conflict();
    return m;
  }
  async function admit(client:PoolClient,f:Flow,emailVerified:boolean) {
    const m=(await client.query("SELECT * FROM hestia_member WHERE user_id=$1 FOR UPDATE",[f.target_id])).rows[0];
    if(!m?.active||m.epoch!==f.target_epoch)throw conflict();
    const epoch=m.epoch+1,admission=randomUUID();
    await revokeFlows(client,f.target_id!,f.id);
    await setPassword(client,f.target_id!,null);
    await client.query("UPDATE hestia_member SET recovering=true,epoch=$2 WHERE user_id=$1",[f.target_id,epoch]);
    await client.query("UPDATE hestia_identity_flow SET status='recovering',admission_id=$2,target_epoch=$3,email_verified=$4 WHERE id=$1",[f.id,admission,epoch,emailVerified]);
  }
  async function newLink(client:PoolClient,kind:string,email:string,actor?:{id:string;epoch:number;role:string},target?:{id:string;epoch:number},name?:string) {
    if(!await capacity(client))throw limited();
    const id=randomUUID(),secret=capability();
    await client.query(`INSERT INTO hestia_identity_flow(id,kind,email,actor_id,actor_epoch,actor_role,target_id,target_epoch,capability_digest,name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,kind,email,actor?.id??null,actor?.epoch??null,actor?.role??null,target?.id??null,target?.epoch??null,crypto.digest("capability",id,1,secret),name??null]);
    const url=`${config.origin}/?flowId=${id}&kind=${kind}#capability=${secret}`;
    await enqueue(client,crypto,{id,version:1},"invitation",{email,url});
    return {id,url};
  }

  function handleIdentity(request:Request,action:string) {
    return guarded(async()=>{
      route(request,action==="status"?"GET":"POST");await noLogin(request);
      if(action==="status")return access.transaction(async client=>{const f=await privateFlow(client,request,true);return send({flowId:f.id,kind:f.kind,status:f.status,completed:f.status==="completed",email:f.email,emailVerified:f.email_verified,version:f.version});});
      await publicBudget();
      if(action==="enter") {
        const input=await json(request,["flowId","capability"]),id=uuid(input.flowId);
        if(typeof input.capability!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(input.capability))throw invalid();
        return access.transaction(async client=>{
          const f=await flow(client,id);
          if(!["bootstrap","invite","readmit","exceptional"].includes(f.kind)||!f.alive||!["pending","proved","prepared"].includes(f.status)||!crypto.matches(f.capability_digest,crypto.digest("capability",id,f.version,input.capability)))throw unavailable();
          await actorStillValid(client,f);
          const secret=capability();
          // Re-entering changes the private browser capability, including any
          // previous prepared response, but never activates an account.
          // A link holder must not inherit another browser's verified mailbox
          // or chosen credential. Re-entry requires a fresh OTP and preparation.
          await client.query("UPDATE hestia_identity_proof SET revoked_at=clock_timestamp() WHERE flow_id=$1",[id]);
          await client.query("UPDATE hestia_identity_flow SET browser_digest=$2,browser_until=clock_timestamp()+interval '30 minutes',status='pending',email_verified=false,prepared_password_hash=NULL,prepared_ciphertext=NULL WHERE id=$1",[id,crypto.digest("browser",id,f.version,secret)]);
          return send({flowId:id,kind:f.kind,status:"pending",email:f.email,version:f.version},200,cookieHeaders(id,secret));
        });
      }
      if(action==="recover") {
        const input=await json(request,["email","method"]),email=emailValue(input.email);
        if(input.method!==undefined&&input.method!=="email"&&input.method!=="code")throw invalid();
        return access.transaction(async client=>{
          const ok=await emailBudget(client,email);if(!ok||!await capacity(client))return fail(limited());
          const m=await recoveryTarget(client,email);
          const id=randomUUID(),secret=capability();
          await client.query(`INSERT INTO hestia_identity_flow(id,kind,email,target_id,target_epoch,browser_digest,browser_until,expires_at)
            VALUES($1,'recovery',$2,$3,$4,$5,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '30 minutes')`,[id,email,m?.user_id??null,m?.epoch??null,crypto.digest("browser",id,1,secret)]);
          if(input.method!=="code")await issueOtp(client,await flow(client,id),"recovery");
          return send({accepted:true},202,cookieHeaders(id,secret));
        });
      }
      if(action==="send-otp") {
        await json(request,[]);
        return access.transaction(async client=>{const f=await privateFlow(client,request);if(!["pending","recovering"].includes(f.status))throw conflict();
          if(!await emailBudget(client,f.email))return fail(limited());
          if(!await issueOtp(client,f,f.status==="recovering"||f.kind==="exceptional"?"new-email":f.kind==="recovery"?"recovery":"activation"))return fail(limited());return send({accepted:true});});
      }
      if(action==="verify-email") {
        const input=await json(request,["otp"]);
        return access.transaction(async client=>{const f=await privateFlow(client,request);
          if(!["pending","recovering"].includes(f.status))throw conflict();
          const purpose=f.status==="recovering"||f.kind==="exceptional"?"new-email":f.kind==="recovery"?"recovery":"activation";
          if(!await proveOtp(client,f,input.otp,purpose))return fail(invalid());
          if(["recovery","exceptional"].includes(f.kind)&&f.status==="pending") {if(!f.target_id)return fail(invalid());await admit(client,f,true);return send({status:"recovering",emailVerified:true});}
          if(f.status==="recovering")await admitted(client,f);
          await client.query("UPDATE hestia_identity_flow SET email_verified=true,status=CASE WHEN status='pending' THEN 'proved' ELSE status END WHERE id=$1",[f.id]);
          return send({status:f.status==="pending"?"proved":f.status,emailVerified:true});
        });
      }
      if(action==="recover-code") {
        const input=await json(request,["code"]);
        return access.transaction(async client=>{const f=await privateFlow(client,request);if(f.kind!=="recovery"||f.status!=="pending")throw conflict();
          const code=typeof input.code==="string"?input.code.toLowerCase():"",selector=code.split("-")[0];
          const a=await rate(client,"code-global","instance",900,10),b=await rate(client,"code-selector",selector,900,10);if(!a||!b)return fail(limited());
          if(!/^[0-9a-f]{12}(?:-[0-9a-f]{8}){4}$/.test(code)||!f.target_id)return fail(invalid());
          const p=(await client.query("SELECT * FROM hestia_recovery_code WHERE user_id=$1 AND selector=$2 AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE",[f.target_id,selector])).rows[0];
          if(!p||!crypto.matches(p.digest,crypto.digest("recovery-code",f.target_id,p.batch_id,selector,code)))return fail(invalid());
          await client.query("UPDATE hestia_recovery_code SET consumed_at=clock_timestamp() WHERE user_id=$1 AND selector=$2",[f.target_id,selector]);
          await admit(client,f,false);return send({status:"recovering",emailVerified:false});
        });
      }
      if(action==="recovery-email") {
        const input=await json(request,["email"]),email=emailValue(input.email);
        return access.transaction(async client=>{const f=await privateFlow(client,request);await admitted(client,f);
          if(!await emailBudget(client,email))return fail(limited());
          if((await client.query('SELECT 1 FROM "user" WHERE lower(email)=$1 AND id<>$2',[email,f.target_id])).rowCount)return fail(invalid());
          await client.query("UPDATE hestia_identity_proof SET revoked_at=clock_timestamp() WHERE flow_id=$1 AND purpose='new-email'",[f.id]);
          await client.query("UPDATE hestia_identity_flow SET email=$2,email_verified=false WHERE id=$1",[f.id,email]);
          f.email=email;if(!await issueOtp(client,f,"new-email"))return fail(limited());return send({accepted:true});
        });
      }
      if(action==="prepare") {
        const input=await json(request,["password","name"]),password=passwordValue(input.password),name=input.name===undefined?undefined:textField(input.name,120);
        const hash=await hashPassword(password),codes=newCodes(),batch=randomUUID();
        return access.transaction(async client=>{const f=await privateFlow(client,request);
          if(!["bootstrap","invite","readmit"].includes(f.kind)||!["proved","prepared"].includes(f.status)||!f.email_verified||!await boundEmailProof(client,f,"activation"))throw conflict();
          await actorStillValid(client,f);if(f.kind!=="readmit"&&!name&&!f.name)throw invalid();
          f.prepared_batch=batch;
          await client.query(`UPDATE hestia_identity_flow SET name=COALESCE($2,name),prepared_password_hash=$3,prepared_ciphertext=$4,
            prepared_batch=$5,prepared_until=LEAST(expires_at,clock_timestamp()+interval '10 minutes'),status='prepared' WHERE id=$1`,[f.id,name??null,hash,crypto.seal(codes,codeAAD(f)),batch]);
          return send({flowId:f.id,status:"prepared",preparationId:batch,codes});
        });
      }
      if(action==="confirm") {
        const input=await json(request,["requestId","preparationId","acknowledged"]),requestId=uuid(input.requestId),preparationId=uuid(input.preparationId);if(input.acknowledged!==true)throw invalid();
        return access.transaction(async client=>{const f=await privateFlow(client,request,true),r=await receipt(client,f.id,requestId,"activate",{acknowledged:true,preparationId});if(r.prior)return send(r.prior);
          if(!["bootstrap","invite","readmit"].includes(f.kind)||f.status!=="prepared"||!f.prepared_alive||!f.prepared_password_hash||!f.prepared_ciphertext||!f.prepared_batch||!f.email_verified||!await boundEmailProof(client,f,"activation"))throw conflict();
          if(f.prepared_batch!==preparationId)throw conflict();await actorStillValid(client,f);
          const codes=crypto.open<string[]>(f.prepared_ciphertext,codeAAD(f));
          let target=f.target_id;
          if(f.kind==="readmit") {
            const m=(await client.query("SELECT * FROM hestia_member WHERE user_id=$1 FOR UPDATE",[target])).rows[0];
            if(!m||m.active||m.role==="owner"||m.epoch!==f.target_epoch)throw conflict();
            const u=(await client.query('SELECT email FROM "user" WHERE id=$1',[target])).rows[0];if(u.email!==f.email)throw conflict();
            if(m.role==="admin"&&f.actor_role!=="owner")throw conflict();
            await setPassword(client,target!,f.prepared_password_hash);
            await client.query("UPDATE hestia_member SET active=true,role='member',epoch=epoch+1,recovering=false WHERE user_id=$1",[target]);
          } else {
            if((await client.query('SELECT 1 FROM "user" WHERE lower(email)=$1',[f.email])).rowCount)throw conflict();
            if(f.kind==="bootstrap") {
              const install=(await client.query("SELECT * FROM hestia_installation WHERE id=1 FOR UPDATE")).rows[0];
              if(!install||install.initialized_at||(await client.query("SELECT 1 FROM hestia_member WHERE role='owner'")).rowCount)throw conflict();
            }
            target=randomUUID();await createCredential(client,target,f.email,f.name!,f.prepared_password_hash);
            await client.query("INSERT INTO hestia_member(user_id,role,active) VALUES($1,$2,true)",[target,f.kind==="bootstrap"?"owner":"member"]);
            if(f.kind==="bootstrap")await client.query("UPDATE hestia_installation SET initialized_at=clock_timestamp(),owner_id=$1 WHERE id=1",[target]);
          }
          await replaceCodes(client,target!,f.prepared_batch,codes);await revokeFlows(client,target!,f.id);
          await client.query("UPDATE hestia_identity_flow SET target_id=$2,status='completed',capability_digest=NULL,prepared_ciphertext=NULL,prepared_password_hash=NULL WHERE id=$1",[f.id,target]);
          await client.query("UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE flow_id=$1 AND state IN ('pending','sending','failed')",[f.id]);
          return send(await r.save({completed:true,recoveryCodeCount:8}));
        });
      }
      if(action==="finish") {
        const input=await json(request,["password","requestId"]),password=passwordValue(input.password),requestId=uuid(input.requestId),hash=await hashPassword(password);
        return access.transaction(async client=>{const f=await privateFlow(client,request,true),r=await receipt(client,f.id,requestId,"recovery-finish",{password});if(r.prior)return send(r.prior);
          await admitted(client,f);if(!f.email_verified||(!await boundEmailProof(client,f,"recovery")&&!await boundEmailProof(client,f,"new-email")))throw conflict();
          if((await client.query('SELECT 1 FROM "user" WHERE lower(email)=$1 AND id<>$2',[f.email,f.target_id])).rowCount)throw conflict();
          const old=(await client.query('SELECT email FROM "user" WHERE id=$1',[f.target_id])).rows[0];
          await setPassword(client,f.target_id!,hash);
          await client.query('UPDATE "user" SET email=$2,"emailVerified"=true,"updatedAt"=clock_timestamp() WHERE id=$1',[f.target_id,f.email]);
          await client.query("UPDATE hestia_recovery_code SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1",[f.target_id]);
          await revokeFlows(client,f.target_id!,f.id);
          await client.query("UPDATE hestia_member SET recovering=false WHERE user_id=$1",[f.target_id]);
          await client.query("UPDATE hestia_identity_flow SET status='completed',prepared_ciphertext=NULL,prepared_password_hash=NULL WHERE id=$1",[f.id]);
          await client.query("UPDATE hestia_identity_proof SET revoked_at=clock_timestamp() WHERE flow_id=$1",[f.id]);
          if(old.email!==f.email)await enqueue(client,crypto,f,"email-changed",{email:old.email});
          return send(await r.save({completed:true,recoveryCodeCount:0}));
        });
      }
      throw unavailable();
    });
  }

  function handleInvitations(request:Request,id?:string,action?:string) {
    return manageLink(request,"invite",id,action);
  }
  function handleReadmissions(request:Request,id?:string,action?:string) {
    return manageLink(request,"readmit",id,action);
  }
  function manageLink(request:Request,kind:"invite"|"readmit",id?:string,action?:string) {
    return guarded(async()=>{
      if(request.method==="GET"&&!id) {
        const url=new URL(request.url);
        if([...url.searchParams.keys()].some(k=>!["requestId","offset","limit"].includes(k)||url.searchParams.getAll(k).length!==1))throw unavailable();
        const requestId=url.searchParams.has("requestId")?uuid(url.searchParams.get("requestId")):undefined;
        const integer=(key:string,fallback:number,max:number)=>{const raw=url.searchParams.get(key);if(raw!==null&&!/^\d{1,9}$/.test(raw))throw invalid();const n=raw===null?fallback:Number(raw);if(n>max)throw invalid();return n;};
        const offset=integer("offset",0,1000000),limit=integer("limit",50,100);if(limit<1)throw invalid();
        return access.withActor(request,async(client,actor)=>{
          const acting=await actorRole(client,actor.id);
          const rows=await client.query(`SELECT f.id,COALESCE(f.name,u.name) AS name,f.kind,f.target_id AS "targetId",f.email,
            CASE WHEN f.expires_at<=clock_timestamp() AND f.status NOT IN ('completed','revoked') THEN 'expired' ELSE f.status END AS status,f.version,f.expires_at,
            (SELECT o.state FROM hestia_mail_outbox o WHERE o.flow_id=f.id ORDER BY o.created_at DESC LIMIT 1) AS delivery,
            f.status NOT IN ('completed','revoked') AND (f.kind<>'readmit' OR t.role<>'admin' OR $2='owner') AS manageable,
            a.active AND NOT a.recovering AND a.epoch=f.actor_epoch AND a.role IN ('owner','admin') AND (f.actor_role<>'owner' OR a.role='owner') AS authority
            FROM hestia_identity_flow f LEFT JOIN "user" u ON u.id=f.target_id LEFT JOIN hestia_member t ON t.user_id=f.target_id
            LEFT JOIN hestia_member a ON a.user_id=f.actor_id WHERE f.kind=$1 AND f.status NOT IN ('completed','revoked')
            ORDER BY f.created_at DESC,f.id OFFSET $3 LIMIT $4`,[kind,acting.role,offset,limit+1]);
          const invitations=rows.rows.slice(0,limit).map(({manageable,authority,...row})=>({...row,allowedActions:{canManage:!!manageable,canCancel:!!manageable,canReissue:!!manageable&&!!authority}}));
          const receipt=requestId&&(await client.query("SELECT 1 FROM hestia_identity_receipt WHERE principal=$1 AND request_id=$2 AND operation LIKE $3",[actor.id,requestId,`${kind}:%`])).rowCount;
          return send({invitations,nextOffset:rows.rows.length>limit?offset+limit:null,...(kind==="readmit"?{readmissions:invitations}:{}),...(requestId?{operationStatus:receipt?"committed":"not-recorded"}:{})});
        });
      }
      route(request);if(id)uuid(id);
      const input=await json(request,id?["requestId"]:kind==="invite"?["name","email","requestId"]:["memberId","requestId","confirmationId"]),requestId=uuid(input.requestId);
      return access.withActor(request,async(client,actor)=>{
        const m=await actorRole(client,actor.id),r=await receipt(client,actor.id,requestId,`${kind}:${action??"create"}`,{...input,id});if(r.prior)return send(r.prior);
        if(id) {
          const f=await flow(client,id);if(f.kind!==kind||f.status==="completed"||f.status==="revoked")throw unavailable();
          if(kind==="readmit"){const target=(await client.query("SELECT role FROM hestia_member WHERE user_id=$1",[f.target_id])).rows[0];if(target?.role==="admin"&&m.role!=="owner")throw unavailable();}
          if(action==="cancel"){await revokeFlow(client,id);return send(await r.save({cancelled:true}));}
          if(action!=="reissue"&&action!=="resend")throw unavailable();
          // Reissuance retains the original authority; another administrator can
          // cancel and prepare a fresh intention, never inherit a stale one.
          await actorStillValid(client,f);if(!await emailBudget(client,f.email))return fail(limited());
          await client.query("UPDATE hestia_identity_proof SET revoked_at=clock_timestamp() WHERE flow_id=$1",[id]);
          await client.query("UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL WHERE flow_id=$1 AND state IN ('pending','sending','failed')",[id]);
          const secret=capability(),version=f.version+1;
          await client.query(`UPDATE hestia_identity_flow SET version=$2,capability_digest=$3,status='pending',email_verified=false,
            browser_digest=NULL,prepared_ciphertext=NULL,prepared_password_hash=NULL,expires_at=clock_timestamp()+interval '72 hours' WHERE id=$1`,[id,version,crypto.digest("capability",id,version,secret)]);
          await enqueue(client,crypto,{id,version},"invitation",{email:f.email,url:`${config.origin}/?flowId=${id}&kind=${kind}#capability=${secret}`});
          return send(await r.save({id,version,delivery:"pending"}));
        }
        let email:string,name:string|undefined,target:{id:string;epoch:number}|undefined,confirmationId:string|undefined;
        if(kind==="invite") {
          email=emailValue(input.email);
          name=textField(input.name,120);
          if((await client.query('SELECT 1 FROM "user" WHERE lower(email)=$1',[email])).rowCount)throw conflict();
          if((await client.query("SELECT 1 FROM hestia_identity_flow WHERE kind='invite' AND email=$1 AND status NOT IN ('completed','revoked')",[email])).rowCount)throw conflict();
        } else {
          const targetId=textField(input.memberId,200),t=(await client.query('SELECT m.*,u.email FROM hestia_member m JOIN "user" u ON u.id=m.user_id WHERE m.user_id=$1 FOR UPDATE',[targetId])).rows[0];
          if(!t||t.active||t.role==="owner")throw unavailable();
          if(t.role==="admin") {
            if(m.role!=="owner")throw unavailable();confirmationId=uuid(input.confirmationId);
          }
          if((await client.query("SELECT 1 FROM hestia_identity_flow WHERE kind='readmit' AND target_id=$1 AND status NOT IN ('completed','revoked')",[targetId])).rowCount)throw conflict();
          email=t.email;target={id:targetId,epoch:t.epoch};
        }
        if(!await emailBudget(client,email))return fail(limited());
        if(confirmationId) {
          const c=(await client.query(`UPDATE hestia_identity_confirmation SET consumed_at=clock_timestamp() WHERE id=$1 AND actor_id=$2 AND actor_epoch=$3
            AND target_id=$4 AND target_epoch=$5 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,[confirmationId,actor.id,m.epoch,target!.id,target!.epoch])).rowCount;
          if(!c)throw conflict();
        }
        const created=await newLink(client,kind,email,{id:actor.id,epoch:m.epoch,role:m.role},target,name);
        return send(await r.save({id:created.id,version:1,delivery:"pending"}),201);
      });
    });
  }
  async function passwordConfirmation(request:Request,password:unknown) {
    const value=passwordValue(password);
    const snapshot=await access.withActor(request,async(client,actor)=>{
      if(!await rate(client,"password",actor.id,900,5))return null;
      const c=await credential(client,actor.id),m=(await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1",[actor.id])).rows[0];
      return {id:actor.id,epoch:m.epoch,hash:c.password};
    });
    if(!snapshot)throw limited();
    if(!snapshot.hash||!await verifyPassword({hash:snapshot.hash,password:value}))throw invalid();return snapshot;
  }
  async function samePassword(client:PoolClient,id:string,snapshot:{id:string;epoch:number;hash:string|null}) {
    const m=(await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1",[id])).rows[0];
    if(id!==snapshot.id||m.epoch!==snapshot.epoch||(await credential(client,id)).password!==snapshot.hash)throw conflict();
  }
  function handleConfirmReadmission(request:Request) {
    return guarded(async()=>{route(request);const input=await json(request,["memberId","password","requestId"]),target=textField(input.memberId,200),requestId=uuid(input.requestId);
      const snapshot=await passwordConfirmation(request,input.password);
      return access.withActor(request,async(client,actor)=>{await samePassword(client,actor.id,snapshot);const m=await actorRole(client,actor.id);if(m.role!=="owner")throw unavailable();
        const r=await receipt(client,actor.id,requestId,"confirm-readmission",{target});if(r.prior)return send(r.prior);
        const t=(await client.query("SELECT * FROM hestia_member WHERE user_id=$1 AND NOT active AND role='admin'",[target])).rows[0];if(!t)throw unavailable();
        const id=randomUUID();await client.query("INSERT INTO hestia_identity_confirmation(id,actor_id,actor_epoch,target_id,target_epoch) VALUES($1,$2,$3,$4,$5)",[id,actor.id,m.epoch,target,t.epoch]);return send(await r.save({confirmationId:id}));
      });
    });
  }
  function handleMeRecoveryCodes(request:Request,action?:string) {
    return guarded(async()=>{
      if(!action&&request.method==="GET"){
        const url=new URL(request.url);if([...url.searchParams.keys()].some(k=>k!=="requestId")||url.searchParams.getAll("requestId").length>1)throw unavailable();
        const requestId=url.searchParams.has("requestId")?uuid(url.searchParams.get("requestId")):undefined;
        return access.withActor(request,async(client,actor)=>{
          const count=Number((await client.query("SELECT count(*) n FROM hestia_recovery_code WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL",[actor.id])).rows[0].n);
          const receipt=requestId&&(await client.query("SELECT 1 FROM hestia_identity_receipt WHERE principal=$1 AND request_id=$2 AND operation='rotate-codes'",[actor.id,requestId])).rowCount;
          return send({count,...(receipt?{confirmedRequestId:requestId}:{})});
        });
      }
      route(request);
      if(action==="prepare") {
        const input=await json(request,["password"]),snapshot=await passwordConfirmation(request,input.password),codes=newCodes(),batch=randomUUID();
        return access.withActor(request,async(client,actor)=>{await samePassword(client,actor.id,snapshot);
          const old=await client.query("SELECT id FROM hestia_identity_flow WHERE kind='rotation' AND target_id=$1 AND status='prepared'",[actor.id]);for(const row of old.rows)await revokeFlow(client,row.id);
          const id=randomUUID();await client.query(`INSERT INTO hestia_identity_flow(id,kind,email,target_id,target_epoch,status,prepared_batch,prepared_until,expires_at)
            VALUES($1,'rotation',$2,$3,$4,'prepared',$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '30 minutes')`,[id,actor.email,actor.id,snapshot.epoch,batch]);
          const f=await flow(client,id);await client.query("UPDATE hestia_identity_flow SET prepared_ciphertext=$2 WHERE id=$1",[id,crypto.seal(codes,codeAAD(f))]);
          return send({preparationId:id,codes});
        });
      }
      if(action==="confirm") {
        const input=await json(request,["requestId","preparationId","acknowledged"]),id=uuid(input.preparationId),requestId=uuid(input.requestId);if(input.acknowledged!==true)throw invalid();
        return access.withActor(request,async(client,actor)=>{const r=await receipt(client,actor.id,requestId,"rotate-codes",{id,acknowledged:true});if(r.prior)return send(r.prior);
          const f=await flow(client,id),m=(await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1",[actor.id])).rows[0];
          if(f.kind!=="rotation"||f.target_id!==actor.id||f.target_epoch!==m.epoch||f.status!=="prepared"||!f.alive||!f.prepared_alive||!f.prepared_ciphertext||!f.prepared_batch)throw conflict();
          await replaceCodes(client,actor.id,f.prepared_batch,crypto.open<string[]>(f.prepared_ciphertext,codeAAD(f)));
          await client.query("UPDATE hestia_identity_flow SET status='completed',prepared_ciphertext=NULL WHERE id=$1",[id]);return send(await r.save({count:8}));
        });
      }
      throw unavailable();
    });
  }
  // Operator entry points are exported for the explicit CLI, never routed over HTTP.
  async function prepareInstallation(email:string,name:string) {
    email=emailValue(email);
    name=textField(name,120);
    return access.transaction(async client=>{const state=(await client.query("SELECT * FROM hestia_installation WHERE id=1 FOR UPDATE")).rows[0];
      if(!state||state.initialized_at||(await client.query("SELECT 1 FROM hestia_member WHERE role='owner'")).rowCount)throw conflict();
      const prior=await client.query("SELECT id FROM hestia_identity_flow WHERE kind='bootstrap' AND status NOT IN ('completed','revoked')");for(const p of prior.rows)await revokeFlow(client,p.id);
      const link=await newLink(client,"bootstrap",email,undefined,undefined,name);return {flowId:link.id,url:link.url};
    });
  }
  async function prepareExceptionalRecovery(memberId:string,email:string) {
    email=emailValue(email);
    return access.transaction(async client=>{
      const target=(await client.query("SELECT * FROM hestia_member WHERE user_id=$1 AND active FOR UPDATE",[memberId])).rows[0];
      if(!target||(await client.query('SELECT 1 FROM "user" WHERE lower(email)=$1 AND id<>$2',[email,memberId])).rowCount)throw conflict();
      const link=await newLink(client,"exceptional",email,undefined,{id:memberId,epoch:target.epoch});
      return {flowId:link.id,url:link.url};
    });
  }
  return {handleIdentity,handleInvitations,handleReadmissions,handleConfirmReadmission,handleMeRecoveryCodes,prepareInstallation,prepareExceptionalRecovery,
    dispatchMail:(transport?:MailTransport)=>dispatchIdentityMail(pool,crypto,transport)};
}
