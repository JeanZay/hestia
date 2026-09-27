import './pg-fence.mjs';
import {deniedNetwork} from './pg-fence.mjs';
import net from 'node:net';
import https from 'node:https';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createPgIdentity,password} from './pg-identity.mjs';
const make=async(t,options)=>{const b=await createPgIdentity(options);t.after(()=>b.close());return b;};
const worker=async(b,cookie)=>{
  const child=fork(new URL('./pg-identity-worker.mjs',import.meta.url),[],{env:{...process.env},stdio:['ignore','ignore','ignore','ipc']});
  const timeout=setTimeout(()=>child.kill(),10000);let message;
  const done=new Promise((resolve,reject)=>{child.on('message',m=>message=m);child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);if(code===0&&message?.ok)resolve(message);else reject(Error('WORKER_FAILED'));});});
  child.send({config:b.config,secret:b.secret,cookie,revoke:true});return done;
};
test('PG library: two pools use different backend connections; unverified and public signup refused',async t=>{
  const b=await make(t),a=await b.pool.connect(),c=await b.poolB.connect();
  try{assert.notEqual((await a.query('SELECT pg_backend_pid() p')).rows[0].p,(await c.query('SELECT pg_backend_pid() p')).rows[0].p);}finally{a.release();c.release();}
  assert.equal(await(await b.call(b.authA,'/get-session')).json(),null);
  assert.equal((await b.call(b.authA,'/sign-up/email',{body:{name:'Synthetic',email:'public@example.invalid',password}})).status,400);
  await b.seed('unverified@example.invalid',{verified:false});assert.equal((await b.login(b.authA,'unverified@example.invalid')).response.status,403);
  assert.equal(Number((await b.pool.query('SELECT count(*) n FROM session')).rows[0].n),0);
});
test('PG library: second process observes session and revokes it; first process cannot reuse cookie',async t=>{
  const b=await make(t);await b.seed('member@example.invalid');const login=await b.login();assert.equal(login.response.status,200);
  const own=(await b.pool.query('SELECT pg_backend_pid() p')).rows[0].p,result=await worker(b,login.cookie);
  assert.notEqual(result.pid,own);assert.equal(result.sessionPresent,true);
  assert.equal(await b.authA.api.getSession({headers:new Headers({cookie:login.cookie})}),null);
  assert.equal(await b.authB.api.getSession({headers:new Headers({cookie:login.cookie})}),null);
});
test('PG library: concurrent reset consumers across instances yield one success and no old session',async t=>{
  const b=await make(t);await b.seed('member@example.invalid');const login=await b.login();await b.call(b.authA,'/request-password-reset',{body:{email:'member@example.invalid'}});
  const body={token:b.mail[0].token,newPassword:'Une nouvelle phrase synthétique PostgreSQL!'};
  const results=await Promise.all([b.call(b.authA,'/reset-password',{body}),b.call(b.authB,'/reset-password',{body})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);
  assert.equal(await b.authB.api.getSession({headers:new Headers({cookie:login.cookie})}),null);
  assert.equal((await b.login()).response.status,401);assert.equal((await b.login(b.authB,'member@example.invalid',body.newPassword)).response.status,200);
  assert.equal((await b.call(b.authB,'/reset-password',{body})).status,400);
});
test('PG raw diagnostic: hook failure after password change leaves sessions; library alone is insufficient',async t=>{
  const b=await make(t,{hookFails:true});await b.seed('member@example.invalid');const login=await b.login();await b.call(b.authA,'/request-password-reset',{body:{email:'member@example.invalid'}});
  const body={token:b.mail[0].token,newPassword:'Une nouvelle phrase synthétique PostgreSQL!'};
  assert.equal((await b.call(b.authA,'/reset-password',{body})).status,500);
  assert.ok(await b.authB.api.getSession({headers:new Headers({cookie:login.cookie})}),'Diagnostic, not an acceptable Hestia recovery');
  assert.equal((await b.login()).response.status,401);assert.equal((await b.login(b.authB,'member@example.invalid',body.newPassword)).response.status,200);
  assert.equal((await b.call(b.authB,'/reset-password',{body})).status,400);
});
test('PG library: hashed reset identifier, unknown-account response, DB expiry and logout',async t=>{
  const b=await make(t);await b.seed('member@example.invalid');
  const a=await b.call(b.authA,'/request-password-reset',{body:{email:'member@example.invalid'}}),c=await b.call(b.authB,'/request-password-reset',{body:{email:'unknown@example.invalid'}});
  assert.equal(a.status,c.status);assert.deepEqual(await a.json(),await c.json());assert.equal(b.mail.length,1);
  const row=(await b.pool.query('SELECT identifier FROM verification')).rows[0];assert.ok(!row.identifier.includes(b.mail[0].token));
  const s=await b.login();await b.call(b.authB,'/sign-out',{body:{},cookie:s.cookie});assert.equal(await b.authA.api.getSession({headers:new Headers({cookie:s.cookie})}),null);
  const again=await b.login();await b.pool.query('UPDATE session SET "expiresAt"=now()-interval \'1 second\'');
  assert.equal(await b.authB.api.getSession({headers:new Headers({cookie:again.cookie})}),null);
});
test('PG1.7.5 diagnostic: maxPasswordLength is not an early verification guard on login',async t=>{
  const b=await make(t);await b.seed('member@example.invalid');let calls=0;const verify=b.ctxA.password.verify;
  b.ctxA.password.verify=async(...args)=>{calls++;return verify(...args);};
  assert.equal((await b.login(b.authA,'member@example.invalid','x'.repeat(129))).response.status,401);
  assert.equal(calls,1,'A diagnostic regression; 1.7.6 changes this behavior and needs separate qualification');
});
test('PG network: DB endpoint permitted, other sockets and HTTP refused, no SDK egress observed',()=>{
  assert.deepEqual(deniedNetwork,[]);
  assert.throws(()=>net.connect({host:'127.0.0.2',port:Number(process.env.HESTIA_PG_PORT)}),/TEST_EGRESS_DENIED/);
  assert.throws(()=>net.connect({host:'127.0.0.1',port:Number(process.env.HESTIA_PG_PORT)===1024?1025:1024}),/TEST_EGRESS_DENIED/);
  assert.throws(()=>fetch('https://telemetry.invalid'),/TEST_EGRESS_DENIED/);
  assert.throws(()=>https.get('https://telemetry.invalid'),/TEST_EGRESS_DENIED/);
  assert.equal(deniedNetwork.length,4);
});
