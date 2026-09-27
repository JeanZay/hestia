// EXPERIMENT ONLY. Not imported by Hestia's application or exposed as a server.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
export const origin = 'https://hestia.invalid';
export const syntheticPassword = 'Une phrase uniquement pour ce banc 2026!';
const digest = value => createHash('sha256').update(value).digest('hex');
const failure = () => { throw new Error('DENIED'); };
const actions = new Set(['transfer', 'email-change', 'admin-role', 'space-delete']);

export async function createIdentityBench({ now = () => Date.now(), resetHookFails = false } = {}) {
  const db = new DatabaseSync(':memory:');
  const mail = [];
  const options = {
    database: db, baseURL: origin, secret: randomBytes(48).toString('base64url'),
    trustedOrigins: [origin], telemetry: { enabled: false }, logger: { disabled: true },
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: true,
      autoSignIn: false, minPasswordLength: 15, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async data => { mail.push({ type: 'reset', ...data }); },
      ...(resetHookFails ? { onPasswordReset: async () => { throw new Error('SYNTHETIC_HOOK_FAILURE'); } } : {}) },
    emailVerification: { autoSignInAfterVerification: false, sendOnSignIn: false,
      sendVerificationEmail: async data => { mail.push({ type: 'verify', ...data }); } },
    verification: { storeIdentifier: 'hashed' },
    session: { expiresIn: 604800, disableSessionRefresh: true, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
    advanced: { useSecureCookies: true },
  };
  await (await getMigrations(options)).runMigrations();
  db.exec(`CREATE TABLE member (id TEXT PRIMARY KEY, active INTEGER NOT NULL, role TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0, recovering INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX one_owner ON member(role) WHERE role='owner';
    CREATE TABLE invitation (tokenHash TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE action_intent (tokenHash TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, epoch INTEGER NOT NULL, targetEpoch INTEGER NOT NULL, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE target_state (id TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE session_policy (id TEXT PRIMARY KEY, started INTEGER NOT NULL, touched INTEGER NOT NULL, persistent INTEGER NOT NULL, epoch INTEGER NOT NULL);
    CREATE TABLE boot (id INTEGER PRIMARY KEY CHECK(id=1), tokenHash TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);`);
  const auth = betterAuth(options);
  const context = await auth.$context;
  const bootstrapToken = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO boot(id,tokenHash) VALUES(1,?)').run(digest(bootstrapToken));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function addIdentity(email, hash, { verified = true, role = 'member' } = {}) {
    const id = randomUUID(), stamp = Date.now();
    db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id, 'Synthetic member', email.toLowerCase(), Number(verified), stamp, stamp);
    db.prepare('INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, 'credential', id, hash, stamp, stamp);
    db.prepare('INSERT INTO member(id,active,role) VALUES(?,1,?)').run(id, role);
    return id;
  }
  async function seed(email, config = {}) {
    // Trusted fixture setup, never a public provisioning endpoint.
    const hash = await context.password.hash(syntheticPassword);
    return transaction(() => addIdentity(email, hash, config));
  }
  const request = (path, { method = 'GET', body, cookie, source = origin } = {}) => {
    const headers = new Headers();
    if (source !== null) headers.set('origin', source);
    if (cookie) headers.set('cookie', cookie);
    if (body !== undefined) headers.set('content-type', 'application/json');
    return new Request(origin + '/api/auth' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const raw = (path, input) => auth.handler(request(path, input));
  const allowed = new Map([['/api/auth/sign-in/email','POST'], ['/api/auth/get-session','GET'], ['/api/auth/sign-out','POST'], ['/api/auth/request-password-reset','POST'], ['/api/auth/reset-password','POST']]);
  async function gateway(path, input) {
    const req = request(path, input), url = new URL(req.url);
    // Exact route allowlist. Raw verification GET and plugin paths never pass.
    if (url.search || allowed.get(url.pathname) !== req.method || (req.method !== 'GET' && req.headers.get('origin') !== origin)) return new Response(null, { status: 404 });
    if (url.pathname === '/api/auth/sign-in/email') {
      const email = input?.body?.email;
      const before = typeof email === 'string' && db.prepare('SELECT member.* FROM member JOIN user ON user.id=member.id WHERE user.email=?').get(email.toLowerCase());
      if (before && (!before.active || before.recovering)) return Response.json({ code:'INVALID_EMAIL_OR_PASSWORD' },{status:401});
      const result = await auth.handler(req);
      if (!result.ok) return result;
      const cookie = result.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
      const session = await auth.api.getSession({ headers:new Headers({cookie}) });
      const current = session && db.prepare('SELECT * FROM member WHERE id=?').get(session.user.id);
      if (!before || !current?.active || current.recovering || before.id!==current.id || before.epoch!==current.epoch || !session) {
        if (session) await context.internalAdapter.deleteSession(session.session.token);
        return Response.json({ code:'INVALID_EMAIL_OR_PASSWORD' },{status:401});
      }
      db.prepare('INSERT INTO session_policy VALUES(?,?,?,?,?)').run(session.session.id,now(),now(),Number(input?.body?.rememberMe===true),before.epoch);
      return result;
    }
    if (url.pathname === '/api/auth/reset-password') {
      // Experiment: a valid recovery proof closes prior sessions BEFORE any
      // password mutation/hook. Failure can require a fresh link, never leave
      // an old session alive after a password already changed. Wrong proofs
      // cannot log out another member. PostgreSQL atomicity still unqualified.
      const token = input?.body?.token;
      if (typeof token !== 'string') return new Response(null, { status: 400 });
      const proof = await context.internalAdapter.findVerificationValue(`reset-password:${token}`);
      const member = proof && db.prepare('SELECT active FROM member WHERE id=?').get(proof.value);
      const expiry = proof ? new Date(proof.expiresAt).getTime() : NaN;
      if (!proof || !Number.isFinite(expiry) || expiry <= Date.now() || !member?.active) return new Response(null, { status: 400 });
      // Serialized admission within this test process. Generation changes close
      // in-flight old-password logins, not just sessions already in the DB.
      if (db.prepare('UPDATE member SET recovering=1,epoch=epoch+1 WHERE id=? AND active=1 AND recovering=0').run(proof.value).changes!==1) return new Response(null,{status:400});
      try {
        await context.internalAdapter.deleteUserSessions(proof.value);
        return await auth.handler(req);
      }
      finally { db.prepare('UPDATE member SET recovering=0 WHERE id=?').run(proof.value); }
    }
    return auth.handler(req);
  }
  async function signIn(email, { rememberMe = false } = {}) {
    const response = await gateway('/sign-in/email', { method:'POST', body:{ email, password:syntheticPassword, rememberMe } });
    const cookies = response.headers.getSetCookie();
    const cookie = cookies.map(x => x.split(';')[0]).join('; ');
    const data = await response.json();
    return { response, data, cookie, cookies };
  }
  async function protectedSession(cookie) {
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) return null;
    const member = db.prepare('SELECT * FROM member WHERE id=?').get(session.user.id);
    const policy = db.prepare('SELECT * FROM session_policy WHERE id=?').get(session.session.id);
    if (!member?.active || member.recovering || !policy || policy.epoch!==member.epoch) return null;
    const idle = policy.persistent ? 86400000 : 1800000, absolute = policy.persistent ? 604800000 : 43200000;
    if (now() >= policy.started + absolute || now() >= policy.touched + idle) return null;
    db.prepare('UPDATE session_policy SET touched=? WHERE id=?').run(now(), policy.id);
    return { ...session, member };
  }
  async function invite(cookie, email) {
    const session = await protectedSession(cookie);
    if (!session || !['owner','admin'].includes(session.member.role) || !/^[^@\s]+@[^@\s]+\.invalid$/.test(email)) failure();
    const token = randomBytes(32).toString('base64url');
    transaction(() => {
      const inviter = db.prepare('SELECT active,role,epoch,recovering FROM member WHERE id=?').get(session.user.id);
      if (!inviter?.active || inviter.recovering || inviter.epoch!==session.member.epoch || !['owner','admin'].includes(inviter.role)) failure();
      if (db.prepare('SELECT id FROM user WHERE email=?').get(email.toLowerCase())) failure();
      db.prepare('INSERT INTO invitation(tokenHash,email,expires) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET tokenHash=excluded.tokenHash,expires=excluded.expires,consumed=0,revoked=0').run(digest(token), email.toLowerCase(), now()+259200000);
    });
    mail.push({ type:'invite', email:email.toLowerCase(), token });
    return token;
  }
  async function activate({ token, password, method='POST', source=origin }) {
    if (method !== 'POST' || source !== origin || typeof token !== 'string' || typeof password !== 'string' || password.length < 15 || password.length > 128) failure();
    const hash = await context.password.hash(password);
    return transaction(() => {
      const invitation = db.prepare('SELECT * FROM invitation WHERE tokenHash=?').get(digest(token));
      if (!invitation || invitation.revoked || invitation.consumed || now() >= invitation.expires) failure();
      const id = addIdentity(invitation.email, hash);
      db.prepare('UPDATE invitation SET consumed=1 WHERE tokenHash=? AND consumed=0').run(digest(token));
      return id;
    });
  }
  async function bootstrap({ token, email, emailProof, method='POST' }) {
    // emailProof is an opaque fixture-issued proof, not a boolean from an HTTP client.
    if (method !== 'POST' || emailProof !== proofFor(email) || typeof token !== 'string') failure();
    const hash = await context.password.hash(syntheticPassword);
    return transaction(() => {
      const boot = db.prepare('SELECT * FROM boot WHERE id=1').get();
      if (boot.consumed || boot.tokenHash !== digest(token)) failure();
      const id = addIdentity(email, hash, { role:'owner' });
      db.prepare('UPDATE boot SET consumed=1 WHERE id=1').run();
      return id;
    });
  }
  const emailProofs = new Map();
  function proofFor(email) { if (!emailProofs.has(email)) emailProofs.set(email, Object.freeze({ proof:randomUUID() })); return emailProofs.get(email); }
  async function confirm(cookie, { action, target, password }) {
    const session = await protectedSession(cookie);
    const targetState = typeof target === 'string' && db.prepare('SELECT * FROM target_state WHERE id=?').get(target);
    if (!session || !actions.has(action) || !targetState) failure();
    await auth.api.verifyPassword({ headers:new Headers({ cookie }), body:{ password } });
    const current = await protectedSession(cookie);
    if (!current || current.member.epoch !== session.member.epoch || db.prepare('SELECT epoch FROM target_state WHERE id=?').get(target)?.epoch !== targetState.epoch) failure();
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO action_intent VALUES(?,?,?,?,?,?,?,0)').run(digest(token), session.user.id, action, target, session.member.epoch, targetState.epoch, now()+300000);
    return token;
  }
  async function consumeIntent(cookie, { token, action, target }) {
    const session = await protectedSession(cookie);
    if (!session || typeof token !== 'string') failure();
    return transaction(() => {
      const member = db.prepare('SELECT * FROM member WHERE id=?').get(session.user.id);
      const row = db.prepare('SELECT * FROM action_intent WHERE tokenHash=?').get(digest(token));
      const targetState = typeof target === 'string' && db.prepare('SELECT epoch FROM target_state WHERE id=?').get(target);
      if (!member?.active || !row || row.consumed || row.actor!==member.id || row.action!==action || row.target!==target || row.epoch!==member.epoch || row.targetEpoch!==targetState?.epoch || now()>=row.expires) failure();
      if (['transfer','admin-role'].includes(action) && member.role!=='owner') failure();
      if (action==='space-delete' && !['owner','admin'].includes(member.role)) failure();
      db.prepare('UPDATE action_intent SET consumed=1 WHERE tokenHash=?').run(digest(token));
      // No product mutation: this is an action-bound admission receipt only.
      return { actor:member.id, action, target };
    });
  }
  return { db, auth, mail, raw, gateway, seed, signIn, protectedSession, invite, activate, bootstrap, bootstrapToken, proofFor, confirm, consumeIntent,
    registerTarget: id => db.prepare('INSERT INTO target_state(id) VALUES(?)').run(id),
    changeTarget: id => db.prepare('UPDATE target_state SET epoch=epoch+1 WHERE id=?').run(id),
    revokeInvitation: token => db.prepare('UPDATE invitation SET revoked=1 WHERE tokenHash=?').run(digest(token)),
    revokeMember: id => db.prepare('UPDATE member SET active=0,epoch=epoch+1 WHERE id=?').run(id),
    close: () => db.close() };
}
