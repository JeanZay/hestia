// SYNTHETIC SQL MODEL ONLY. This does not call Better Auth or implement Hestia.
import { createHash } from 'node:crypto';

export const tokenHash = value => createHash('sha256').update(value).digest('hex');
const deny = (code = 'DENIED') => { throw Object.assign(new Error(code), { code }); };

export async function initializeProtocol(pool, bootstrapToken = 'synthetic-bootstrap-capability') {
  await pool.query(`
    CREATE TABLE q_verified(email text PRIMARY KEY);
    CREATE TABLE q_member(id text PRIMARY KEY, email text UNIQUE NOT NULL,
      role text NOT NULL, active boolean NOT NULL DEFAULT true,
      epoch integer NOT NULL DEFAULT 0, recovering boolean NOT NULL DEFAULT false,
      recovery_id text);
    CREATE UNIQUE INDEX q_one_owner ON q_member(role) WHERE role='owner';
    CREATE TABLE q_session(id text PRIMARY KEY, member_id text NOT NULL REFERENCES q_member,
      epoch integer NOT NULL, active boolean NOT NULL DEFAULT true);
    CREATE TABLE q_boot(id integer PRIMARY KEY CHECK(id=1), token_hash text NOT NULL,
      consumed boolean NOT NULL DEFAULT false);
    CREATE TABLE q_receipt(request_id text PRIMARY KEY, operation text NOT NULL,
      fingerprint text NOT NULL, result jsonb);
    CREATE TABLE q_effect(request_id text PRIMARY KEY REFERENCES q_receipt, kind text NOT NULL);
    CREATE TABLE q_invitation(token_hash text PRIMARY KEY, email text NOT NULL,
      expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false,
      revoked boolean NOT NULL DEFAULT false);
    CREATE TABLE q_target(id text PRIMARY KEY, version integer NOT NULL DEFAULT 0,
      effects integer NOT NULL DEFAULT 0);
    CREATE TABLE q_intent(token_hash text PRIMARY KEY, actor text NOT NULL REFERENCES q_member,
      session_id text NOT NULL REFERENCES q_session, action text NOT NULL,
      target text NOT NULL REFERENCES q_target, actor_epoch integer NOT NULL,
      target_version integer NOT NULL, expires_at timestamptz NOT NULL,
      consumed boolean NOT NULL DEFAULT false);
    CREATE TABLE q_recovery_proof(token_hash text PRIMARY KEY,
      member_id text NOT NULL REFERENCES q_member, expires_at timestamptz NOT NULL,
      consumed boolean NOT NULL DEFAULT false);
    CREATE TABLE q_grant(id text PRIMARY KEY, beneficiary text NOT NULL,
      scope text NOT NULL, capability text NOT NULL,
      parent_id text REFERENCES q_grant, active boolean NOT NULL DEFAULT true);
  `);
  await pool.query('INSERT INTO q_boot(id,token_hash) VALUES(1,$1)', [tokenHash(bootstrapToken)]);
}

// Each retry repeats the entire decision. Hooks are observation/barrier hooks,
// never external effects; before-commit may run again following a retry.
export async function transaction(pool, operation, { checkpoint = async () => {}, attempts = 3 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) deny('INVALID_RETRY_LIMIT');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
      const { rows: [{ pid }] } = await client.query('SELECT pg_backend_pid() AS pid');
      await checkpoint('transaction-start', { pid, attempt });
      const value = await operation(client, { pid, attempt });
      await checkpoint('before-commit', { pid, attempt });
      await client.query('COMMIT');
      committed = true;
      await checkpoint('after-commit', { pid, attempt });
      return value;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      if (!committed && ['40001', '40P01'].includes(error.code) && attempt < attempts) continue;
      throw error;
    } finally {
      client.release();
    }
  }
  deny('RETRIES_EXHAUSTED');
}

async function receipt(client, operation, input, apply) {
  if (typeof input.requestId !== 'string' || !input.requestId) deny();
  const fingerprint = tokenHash(JSON.stringify(input));
  await client.query(`INSERT INTO q_receipt(request_id,operation,fingerprint)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [input.requestId, operation, fingerprint]);
  const { rows: [existing] } = await client.query(
    'SELECT * FROM q_receipt WHERE request_id=$1 FOR UPDATE', [input.requestId]);
  if (existing.operation !== operation || existing.fingerprint !== fingerprint) deny('REQUEST_MISMATCH');
  // Opaque experiment receipt only: never a reusable document/session permission.
  if (existing.result) return { ...existing.result, replayed: true };
  const result = await apply();
  await client.query('INSERT INTO q_effect(request_id,kind) VALUES($1,$2)', [input.requestId, operation]);
  await client.query('UPDATE q_receipt SET result=$2 WHERE request_id=$1', [input.requestId, result]);
  return { ...result, replayed: false };
}

export function bootstrap(pool, input, options) {
  return transaction(pool, client => receipt(client, 'bootstrap', input, async () => {
    const { rows: [boot] } = await client.query('SELECT * FROM q_boot WHERE id=1 FOR UPDATE');
    const verified = await client.query('SELECT 1 FROM q_verified WHERE email=$1', [input.email]);
    if (boot.consumed || boot.token_hash !== tokenHash(input.token) || !verified.rowCount) deny();
    await client.query("INSERT INTO q_member(id,email,role) VALUES($1,$2,'owner')", [input.memberId, input.email]);
    await client.query('UPDATE q_boot SET consumed=true WHERE id=1');
    return { receipt: input.requestId, memberId: input.memberId };
  }), options);
}

export function activateInvitation(pool, input, options) {
  return transaction(pool, client => receipt(client, 'activation', input, async () => {
    const { rows: [invitation] } = await client.query(`SELECT *,expires_at>clock_timestamp() AS unexpired
      FROM q_invitation WHERE token_hash=$1 FOR UPDATE`, [tokenHash(input.token)]);
    if (!invitation || invitation.consumed || invitation.revoked || !invitation.unexpired) deny();
    const verified = await client.query('SELECT 1 FROM q_verified WHERE email=$1', [invitation.email]);
    if (!verified.rowCount) deny();
    // A SELECT expression can precede a lock wait. Expiry must be checked by
    // the consuming write itself, using server wall time after acquiring locks.
    const consumed = await client.query(`UPDATE q_invitation SET consumed=true
      WHERE token_hash=$1 AND NOT consumed AND NOT revoked AND expires_at>clock_timestamp()`, [tokenHash(input.token)]);
    if (consumed.rowCount !== 1) deny();
    await client.query("INSERT INTO q_member(id,email,role) VALUES($1,$2,'member')", [input.memberId, invitation.email]);
    return { receipt: input.requestId, memberId: input.memberId };
  }), options);
}

async function liveSession(client, sessionId) {
  const { rows: [member] } = await client.query(`SELECT m.* FROM q_member m
    JOIN q_session s ON s.member_id=m.id WHERE s.id=$1 FOR UPDATE OF m`, [sessionId]);
  const { rows: [session] } = await client.query('SELECT * FROM q_session WHERE id=$1 FOR UPDATE', [sessionId]);
  if (!member?.active || member.recovering || !session?.active || session.epoch !== member.epoch) deny();
  return member;
}

export function consumeIntent(pool, input, options) {
  return transaction(pool, client => receipt(client, 'intent', input, async () => {
    const member = await liveSession(client, input.sessionId);
    const { rows: [intent] } = await client.query(`SELECT *,expires_at>clock_timestamp() AS unexpired
      FROM q_intent WHERE token_hash=$1 FOR UPDATE`, [tokenHash(input.token)]);
    const { rows: [target] } = await client.query('SELECT * FROM q_target WHERE id=$1 FOR UPDATE', [input.target]);
    if (!intent || !target || intent.consumed || !intent.unexpired || intent.actor !== member.id
      || intent.session_id !== input.sessionId || intent.action !== input.action || intent.target !== input.target
      || intent.actor_epoch !== member.epoch || intent.target_version !== target.version) deny();
    if (!['transfer', 'admin-role', 'email-change', 'space-delete'].includes(input.action)) deny();
    if (['transfer', 'admin-role'].includes(input.action) && member.role !== 'owner') deny();
    if (input.action === 'space-delete' && !['owner', 'admin'].includes(member.role)) deny();
    if (input.action === 'email-change' && input.target !== member.id) deny();
    const consumed = await client.query(`UPDATE q_intent SET consumed=true
      WHERE token_hash=$1 AND NOT consumed AND expires_at>clock_timestamp()`, [tokenHash(input.token)]);
    if (consumed.rowCount !== 1) deny();
    // This counter is the whole synthetic effect, not a real sensitive action.
    await client.query('UPDATE q_target SET effects=effects+1,version=version+1 WHERE id=$1', [input.target]);
    return { receipt: input.requestId };
  }), options);
}

export function revokeSession(pool, sessionId, options) {
  return transaction(pool, async client => {
    await client.query(`SELECT m.id FROM q_member m JOIN q_session s ON s.member_id=m.id
      WHERE s.id=$1 FOR UPDATE OF m`, [sessionId]);
    await client.query('UPDATE q_session SET active=false WHERE id=$1', [sessionId]);
  }, options);
}

export function admitRecovery(pool, input, options) {
  return transaction(pool, client => receipt(client, 'recovery-admission', input, async () => {
    const { rows: [member] } = await client.query('SELECT * FROM q_member WHERE id=$1 FOR UPDATE', [input.memberId]);
    const { rows: [proof] } = await client.query(`SELECT *,expires_at>clock_timestamp() AS unexpired
      FROM q_recovery_proof WHERE token_hash=$1 FOR UPDATE`, [tokenHash(input.token)]);
    if (!member?.active || member.recovering || !proof || proof.member_id !== member.id || proof.consumed || !proof.unexpired) deny();
    const consumed = await client.query(`UPDATE q_recovery_proof SET consumed=true
      WHERE token_hash=$1 AND NOT consumed AND expires_at>clock_timestamp()`, [tokenHash(input.token)]);
    if (consumed.rowCount !== 1) deny();
    await client.query('UPDATE q_member SET epoch=epoch+1,recovering=true,recovery_id=$2 WHERE id=$1', [member.id, input.requestId]);
    await client.query('UPDATE q_session SET active=false WHERE member_id=$1', [member.id]);
    // No blind unlock or claimed complete password-recovery protocol.
    return { receipt: input.requestId, epoch: member.epoch + 1 };
  }), options);
}

export function createDelegatedGrant(pool, input, options) {
  return transaction(pool, client => receipt(client, 'grant', input, async () => {
    const { rows: [parent] } = await client.query('SELECT * FROM q_grant WHERE id=$1 FOR UPDATE', [input.parentId]);
    // Deliberately finite model: one root mandate -> one child, no graph engine.
    if (!parent?.active || parent.parent_id || parent.scope !== input.scope || parent.capability !== input.capability) deny();
    await client.query(`INSERT INTO q_grant(id,beneficiary,scope,capability,parent_id)
      VALUES($1,$2,$3,$4,$5)`, [input.grantId, input.beneficiary, input.scope, input.capability, parent.id]);
    return { receipt: input.requestId, grantId: input.grantId };
  }), options);
}

export function revokeGrant(pool, grantId, options) {
  return transaction(pool, async client => {
    await client.query('SELECT id FROM q_grant WHERE id=$1 FOR UPDATE', [grantId]);
    await client.query('UPDATE q_grant SET active=false WHERE id=$1', [grantId]);
  }, options);
}

export async function effectiveGrantIds(pool, beneficiary) {
  const { rows } = await pool.query(`SELECT g.id FROM q_grant g
    LEFT JOIN q_grant p ON p.id=g.parent_id
    WHERE g.beneficiary=$1 AND g.active
      AND (g.parent_id IS NULL OR (p.active AND p.parent_id IS NULL
        AND p.scope=g.scope AND p.capability=g.capability)) ORDER BY g.id`, [beneficiary]);
  return rows.map(row => row.id);
}
