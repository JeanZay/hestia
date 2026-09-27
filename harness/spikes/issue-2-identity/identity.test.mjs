import './network-fence.mjs';
import { networkAttempts } from './network-fence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { createIdentityBench, syntheticPassword, origin } = await import('./identity.mjs');
const make = async (t, options) => { const b = await createIdentityBench(options); t.after(() => b.close()); return b; };
const login = async (b, email='owner@example.invalid', role='owner') => { const id=await b.seed(email,{role});const s=await b.signIn(email);assert.equal(s.response.status,200);return {id,...s}; };
const denied = promise => assert.rejects(promise, /DENIED|Invalid password/);

test('Q2 real library refuses anonymous session and signup on public AND server API', async t => {
  const b=await make(t);assert.equal(await (await b.raw('/get-session')).json(),null);
  const body={email:'new@example.invalid',password:syntheticPassword,name:'Synthetic'};
  assert.equal((await b.raw('/sign-up/email',{method:'POST',body})).status,400);
  await assert.rejects(b.auth.api.signUpEmail({body}));
  assert.equal(b.db.prepare('SELECT count(*) AS n FROM user').get().n,0);
});
test('Q2 unverified account cannot obtain a session', async t => {
  const b=await make(t);await b.seed('unverified@example.invalid',{verified:false});
  assert.equal((await b.signIn('unverified@example.invalid')).response.status,403);
  assert.equal(b.db.prepare('SELECT count(*) AS n FROM session').get().n,0);
});
test('Q2 session cookie flags, non-persistence and no cookie cache', async t => {
  const b=await make(t),s=await login(b);
  const sessionCookie=s.cookies.find(x=>x.startsWith('__Secure-better-auth.session_token='));
  assert.ok(sessionCookie);assert.match(sessionCookie,/HttpOnly/i);assert.match(sessionCookie,/Secure/i);assert.match(sessionCookie,/SameSite=Lax/i);
  assert.doesNotMatch(sessionCookie,/Max-Age|Expires=/i);assert.ok(s.cookies.every(x=>!x.includes('session_data=')));
});
test('Q2 personal-device cookie persistent, absolute policy still bounded', async t => {
  let now=Date.now();const b=await make(t,{now:()=>now});await b.seed('p@example.invalid');const s=await b.signIn('p@example.invalid',{rememberMe:true});
  assert.match(s.cookies.find(x=>x.includes('session_token=')),/Max-Age=/i);
  const row=b.db.prepare('SELECT * FROM session_policy').get();now=row.started+604800000;
  assert.equal(await b.protectedSession(s.cookie),null);
});
for (const [rememberMe,idle] of [[false,1800000],[true,86400000]]) test(`Q2 inactivity boundary (${rememberMe?'personal':'ordinary'})`,async t=>{
  let now=Date.now();const b=await make(t,{now:()=>now});await b.seed('idle@example.invalid');const s=await b.signIn('idle@example.invalid',{rememberMe});
  now+=idle;assert.equal(await b.protectedSession(s.cookie),null);
});
test('Q2 ordinary absolute bound remains despite recent activity',async t=>{
  let now=Date.now();const b=await make(t,{now:()=>now});const s=await login(b);const start=now;
  for(let i=0;i<24;i++){now+=1700000;assert.ok(await b.protectedSession(s.cookie));}
  now=start+43200000;assert.equal(await b.protectedSession(s.cookie),null);
});
test('Q2 DB session expiry and logout both refuse next real-library request',async t=>{
  const b=await make(t),s=await login(b);assert.ok(await b.protectedSession(s.cookie));
  const expiry=b.db.prepare('SELECT expiresAt FROM session').get().expiresAt;
  await b.raw('/get-session',{cookie:s.cookie});assert.equal(b.db.prepare('SELECT expiresAt FROM session').get().expiresAt,expiry);
  assert.equal((await b.gateway('/sign-out',{method:'POST',body:{},cookie:s.cookie})).status,200);
  assert.equal(await (await b.raw('/get-session',{cookie:s.cookie})).json(),null);
  const again=await b.signIn('owner@example.invalid');b.db.prepare('UPDATE session SET expiresAt=?').run(Date.now()-1000);
  assert.equal(await (await b.raw('/get-session',{cookie:again.cookie})).json(),null);
});
test('Q2 Hestia active-account check independently closes a still-valid library session',async t=>{
  const b=await make(t),s=await login(b);b.revokeMember(s.id);
  assert.ok(await (await b.raw('/get-session',{cookie:s.cookie})).json());
  assert.equal(await b.protectedSession(s.cookie),null);
});
test('Q2 invitation: admin only, GET no effect, POST verified account, no auto-session',async t=>{
  const b=await make(t),s=await login(b),m=await login(b,'member@example.invalid','member');
  await denied(b.invite(m.cookie,'new@example.invalid'));
  const token=await b.invite(s.cookie,'new@example.invalid');
  await denied(b.activate({token,password:syntheticPassword,method:'GET'}));
  assert.equal(b.db.prepare('SELECT count(*) n FROM user WHERE email=?').get('new@example.invalid').n,0);
  const before=b.db.prepare('SELECT count(*) n FROM session').get().n;
  const id=await b.activate({token,password:syntheticPassword});
  assert.equal(b.db.prepare('SELECT emailVerified FROM user WHERE id=?').get(id).emailVerified,1);
  assert.equal(b.db.prepare('SELECT count(*) n FROM session').get().n,before);
  assert.equal((await b.signIn('new@example.invalid')).response.status,200);
  await denied(b.activate({token,password:syntheticPassword}));
});
test('R2 invitation cannot commit after recovery invalidates its previously checked session',async t=>{
  const b=await make(t),s=await login(b);
  await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const context=await b.auth.$context,adapter=context.internalAdapter;
  const find=adapter.findVerificationValue,remove=adapter.deleteUserSessions,prepare=b.db.prepare.bind(b.db);
  const token=b.mail.find(x=>x.type==='reset').token;
  const proof=await find(`reset-password:${token}`);
  // Only the gateway's first lookup is pre-resolved. The library still uses
  // its real lookup/consumption; no fabricated member mutation is injected.
  adapter.findVerificationValue=()=>{adapter.findVerificationValue=find;return proof;};
  let release,entered,pendingReset;
  const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);
  adapter.deleteUserSessions=async id=>{entered();await gate;return remove(id);};
  b.db.prepare=sql=>{
    const statement=prepare(sql);
    if(!sql.startsWith('UPDATE session_policy SET touched=')) return statement;
    return {run(...args){
      const result=statement.run(...args);b.db.prepare=prepare;
      pendingReset=b.gateway('/reset-password',{method:'POST',body:{token,newPassword:'Phrase synthétique de remplacement!'}});
      return result;
    }};
  };
  const attempt=Promise.allSettled([b.invite(s.cookie,'after-recovery@example.invalid')]);
  try {
    await arrived;
    assert.equal(prepare('SELECT recovering FROM member WHERE id=?').get(s.id).recovering,1);
    const [result]=await attempt;
    assert.equal(result.status,'rejected');assert.match(result.reason.message,/DENIED/);
    assert.equal(prepare('SELECT count(*) n FROM invitation').get().n,0);
    assert.equal(b.mail.filter(x=>x.type==='invite').length,0);
    assert.equal(await b.protectedSession(s.cookie),null);
  } finally {
    release();if(pendingReset)assert.equal((await pendingReset).status,200);
    b.db.prepare=prepare;adapter.findVerificationValue=find;adapter.deleteUserSessions=remove;
  }
});

test('Q2 invitation revoked during password hashing is refused at mutation',async t=>{
  const b=await make(t),s=await login(b),token=await b.invite(s.cookie,'new@example.invalid');
  const pending=b.activate({token,password:syntheticPassword});b.revokeInvitation(token);await denied(pending);
  assert.equal(b.db.prepare('SELECT count(*) n FROM user WHERE email=?').get('new@example.invalid').n,0);
});
test('Q2 invitation expiry, reissue and wrong origin never create access',async t=>{
  let now=Date.now();const b=await make(t,{now:()=>now}),s=await login(b),old=await b.invite(s.cookie,'new@example.invalid');
  const token=await b.invite(s.cookie,'new@example.invalid');await denied(b.activate({token:old,password:syntheticPassword}));
  await denied(b.activate({token,password:syntheticPassword,source:'https://attacker.invalid'}));
  now+=259200000;await denied(b.activate({token,password:syntheticPassword}));
});
test('Q3 two invitation consumers commit exactly one account (SQLite single process)',async t=>{
  const b=await make(t),s=await login(b),token=await b.invite(s.cookie,'same@example.invalid');
  const results=await Promise.allSettled([b.activate({token,password:syntheticPassword}),b.activate({token,password:syntheticPassword})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(b.db.prepare('SELECT count(*) n FROM user WHERE email=?').get('same@example.invalid').n,1);
});
test('Q3 bootstrap concurrent, replay, wrong proof and GET cannot add owners',async t=>{
  const b=await make(t),email='first@example.invalid',input={token:b.bootstrapToken,email,emailProof:b.proofFor(email)};
  await denied(b.bootstrap({...input,emailProof:{}}));await denied(b.bootstrap({...input,method:'GET'}));
  const results=await Promise.allSettled([b.bootstrap(input),b.bootstrap(input)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(b.db.prepare("SELECT count(*) n FROM member WHERE role='owner'").get().n,1);
  await denied(b.bootstrap(input));
});
test('Q2 bare library GET verification mutates; Hestia gateway refuses it',async t=>{
  const b=await make(t),email='verify@example.invalid';await b.seed(email,{verified:false});
  await b.auth.api.sendVerificationEmail({body:{email,callbackURL:origin}});
  const url=new URL(b.mail.find(x=>x.type==='verify').url),path=url.pathname.replace('/api/auth','')+url.search;
  assert.equal((await b.gateway(path)).status,404);
  assert.equal(b.db.prepare('SELECT emailVerified FROM user WHERE email=?').get(email).emailVerified,0);
  await b.raw(path);
  assert.equal(b.db.prepare('SELECT emailVerified FROM user WHERE email=?').get(email).emailVerified,1);
});
test('Q2 allowlist closes raw/plugin/encoded/alternate paths and hostile origin',async t=>{
  const b=await make(t);
  for(const path of ['/sign-up/email','/verify-email','//verify-email','/%76erify-email','/organization/accept-invitation','/multi-session/list-device-sessions','/verify-password','/change-email','/get-session/']) assert.equal((await b.gateway(path,{method:'POST',body:{}})).status,404);
  for(const source of [null,'https://attacker.invalid']) assert.equal((await b.gateway('/sign-in/email',{method:'POST',source,body:{}})).status,404);
});
test('Q2 reset public body is same for existing and unknown accounts; identifier hashed',async t=>{
  const b=await make(t);await b.seed('known@example.invalid');
  const a=await b.gateway('/request-password-reset',{method:'POST',body:{email:'known@example.invalid'}}),c=await b.gateway('/request-password-reset',{method:'POST',body:{email:'unknown@example.invalid'}});
  assert.equal(a.status,c.status);assert.deepEqual(await a.json(),await c.json());assert.equal(b.mail.length,1);
  const row=b.db.prepare('SELECT identifier FROM verification').get();assert.ok(!row.identifier.includes(b.mail[0].token));
});
test('Q2 reset revokes all sessions, does not auto-login, rejects replay and concurrent second consumer',async t=>{
  const b=await make(t),s=await login(b);await b.signIn('owner@example.invalid');
  await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const token=b.mail[0].token,input={method:'POST',body:{token,newPassword:'Une autre phrase synthetique longue!'}};
  const responses=await Promise.all([b.gateway('/reset-password',input),b.gateway('/reset-password',input)]);
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,400]);
  assert.equal(b.db.prepare('SELECT count(*) n FROM session').get().n,0);
  assert.equal(await b.protectedSession(s.cookie),null);
  assert.equal((await b.gateway('/reset-password',input)).status,400);
  assert.ok(responses.every(x=>x.headers.getSetCookie().length===0));
});
test('Q2 reset token expiration and min password are actually enforced',async t=>{
  const b=await make(t);await b.seed('reset@example.invalid');await b.gateway('/request-password-reset',{method:'POST',body:{email:'reset@example.invalid'}});
  const token=b.mail[0].token;
  assert.equal((await b.gateway('/reset-password',{method:'POST',body:{token,newPassword:'short'}})).status,400);
  b.db.prepare('UPDATE verification SET expiresAt=?').run(Date.now()-1000);
  assert.equal((await b.gateway('/reset-password',{method:'POST',body:{token,newPassword:syntheticPassword}})).status,400);
});
test('Q2 diagnostic: throwing reset hook leaves old session alive, so raw flow is NOT qualified for Hestia',async t=>{
  const b=await make(t,{resetHookFails:true}),s=await login(b);
  await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const token=b.mail[0].token;
  assert.equal((await b.raw('/reset-password',{method:'POST',body:{token,newPassword:'Une nouvelle phrase synthétique 2026!'}})).status,500);
  assert.ok(await b.protectedSession(s.cookie),'Counterexample must remain visible, not counted as safe reset');
  assert.equal((await b.gateway('/reset-password',{method:'POST',body:{token,newPassword:syntheticPassword}})).status,400);
});
test('Q2 experimental fail-closed reset removes old sessions even if the post-change hook throws',async t=>{
  const b=await make(t,{resetHookFails:true}),s=await login(b);
  await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const token=b.mail[0].token;
  assert.equal((await b.gateway('/reset-password',{method:'POST',body:{token:'wrong',newPassword:syntheticPassword}})).status,400);
  assert.ok(await b.protectedSession(s.cookie),'An invalid proof must not log out an account');
  assert.equal((await b.gateway('/reset-password',{method:'POST',body:{token,newPassword:'Une autre phrase synthétique longue!'}})).status,500);
  assert.equal(await b.protectedSession(s.cookie),null);
  assert.equal(b.db.prepare('SELECT count(*) n FROM session').get().n,0);
});
test('R1 reset blocks concurrent old-password login after revocation and before failed mutation',async t=>{
  const b=await make(t,{resetHookFails:true}),s=await login(b);
  await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const context=await b.auth.$context,original=context.internalAdapter.deleteUserSessions;
  let release,entered;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);
  context.internalAdapter.deleteUserSessions=async id=>{await original(id);entered();await gate;};
  const reset=b.gateway('/reset-password',{method:'POST',body:{token:b.mail[0].token,newPassword:'Phrase synthétique de remplacement!'}});
  await arrived;const concurrent=await b.signIn('owner@example.invalid');assert.equal(concurrent.response.status,401);
  assert.equal(await b.protectedSession(s.cookie),null);release();assert.equal((await reset).status,500);
  assert.equal(await b.protectedSession(concurrent.cookie),null);
  assert.equal(b.db.prepare('SELECT count(*) n FROM session').get().n,0);
});
test('R1 login already checking old password cannot survive a recovery generation change',async t=>{
  const b=await make(t),s=await login(b);
  await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const context=await b.auth.$context,original=context.password.verify;
  let release,entered;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);
  context.password.verify=async value=>{const verified=await original(value);entered();await gate;return verified;};
  const pending=b.signIn('owner@example.invalid');await arrived;
  assert.equal((await b.gateway('/reset-password',{method:'POST',body:{token:b.mail[0].token,newPassword:'Phrase synthétique de remplacement!'}})).status,200);
  release();const oldLogin=await pending;assert.equal(oldLogin.response.status,401);assert.equal(await b.protectedSession(oldLogin.cookie),null);
  assert.equal(await b.protectedSession(s.cookie),null);
});
test('R1 revocation failure leaves old sessions unusable and recovery retry possible',async t=>{
  const b=await make(t),s=await login(b);await b.gateway('/request-password-reset',{method:'POST',body:{email:'owner@example.invalid'}});
  const context=await b.auth.$context,original=context.internalAdapter.deleteUserSessions;
  const input={method:'POST',body:{token:b.mail[0].token,newPassword:'Phrase synthétique de remplacement!'}};
  context.internalAdapter.deleteUserSessions=async()=>{throw new Error('SYNTHETIC_REVOKE_FAILURE');};
  await assert.rejects(b.gateway('/reset-password',input),/SYNTHETIC_REVOKE_FAILURE/);
  assert.equal(await b.protectedSession(s.cookie),null);
  context.internalAdapter.deleteUserSessions=original;
  assert.equal((await b.gateway('/reset-password',input)).status,200);
});
for(const action of ['transfer','email-change','admin-role','space-delete']) test(`Q3 ${action}: renewed password, exact intention and one consumer`,async t=>{
  const b=await make(t),s=await login(b);
  b.registerTarget('target-1');
  await assert.rejects(b.confirm(s.cookie,{action,target:'target-1',password:'wrong'}));
  const token=await b.confirm(s.cookie,{action,target:'target-1',password:syntheticPassword});
  await denied(b.consumeIntent(s.cookie,{token,action,target:'other'}));
  const attempts=await Promise.allSettled([b.consumeIntent(s.cookie,{token,action,target:'target-1'}),b.consumeIntent(s.cookie,{token,action,target:'target-1'})]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
});
test('Q3 confirmation rejects other actor, other action, expiry and state change',async t=>{
  let now=Date.now();const b=await make(t,{now:()=>now}),s=await login(b),m=await login(b,'other@example.invalid','member');
  b.registerTarget(m.id);
  const intent={action:'transfer',target:m.id},token=await b.confirm(s.cookie,{...intent,password:syntheticPassword});
  await denied(b.consumeIntent(m.cookie,{...intent,token}));await denied(b.consumeIntent(s.cookie,{...intent,token,action:'admin-role'}));
  now+=300000;await denied(b.consumeIntent(s.cookie,{...intent,token}));
  const next=await b.confirm(s.cookie,{...intent,password:syntheticPassword});b.db.prepare('UPDATE member SET epoch=epoch+1 WHERE id=?').run(s.id);
  await denied(b.consumeIntent(s.cookie,{...intent,token:next}));
  const refreshed=await b.signIn('owner@example.invalid');assert.equal(refreshed.response.status,200);
  const changed=await b.confirm(refreshed.cookie,{...intent,password:syntheticPassword});b.changeTarget(m.id);
  await denied(b.consumeIntent(refreshed.cookie,{...intent,token:changed}));
});
test('Q3 ordinary member cannot use confirmation to gain owner-only powers',async t=>{
  const b=await make(t),s=await login(b,'ordinary@example.invalid','member');
  b.registerTarget('someone');
  const intent={action:'transfer',target:'someone'},token=await b.confirm(s.cookie,{...intent,password:syntheticPassword});
  await denied(b.consumeIntent(s.cookie,{...intent,token}));
});
test('Q2 XSS advisory regression: raw diagnostic error HTML contains no executable payload',async t=>{
  const b=await make(t),payload='<script>alert(1)</script>';
  const r=await b.raw('/error?error='+encodeURIComponent(payload)+'&error_description='+encodeURIComponent(payload));
  assert.doesNotMatch(await r.text(),/<script>alert\(1\)<\/script>/);
});
test('Q2 rate limiting stays enabled and refuses repeated login attempts',async t=>{
  const b=await make(t);await b.seed('rate@example.invalid');
  const attempts=[];for(let i=0;i<4;i++)attempts.push((await b.gateway('/sign-in/email',{method:'POST',body:{email:'rate@example.invalid',password:'incorrect'}})).status);
  assert.deepEqual(attempts,[401,401,401,429]);
});
test('Q1 all identity tests attempted zero outbound network connections',()=>assert.deepEqual(networkAttempts,[]));
