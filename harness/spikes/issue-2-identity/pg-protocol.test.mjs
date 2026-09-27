// This suite qualifies a bounded SQL MODEL, never Better Auth or product flows.
import './pg-fence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestDatabase } from './pg-support.mjs';
import { initializeProtocol, tokenHash, bootstrap, activateInvitation, consumeIntent,
  admitRecovery, revokeSession, createDelegatedGrant, revokeGrant, effectiveGrantIds,
  transaction } from './pg-protocol.mjs';

async function fixture(t) {
  const database = await createTestDatabase();
  t.after(() => database.close());
  await initializeProtocol(database.pool);
  return database;
}
async function memberFixture(pool, id = 'owner', role = 'owner') {
  await pool.query('INSERT INTO q_member(id,email,role) VALUES($1,$2,$3)', [id, `${id}@example.invalid`, role]);
  await pool.query('INSERT INTO q_session(id,member_id,epoch) VALUES($1,$2,0)', [`session-${id}`, id]);
  await pool.query('INSERT INTO q_target(id) VALUES($1)', [id]);
}
async function intentFixture(pool, token = 'intent', actor = 'owner', action = 'transfer', target = 'owner') {
  await pool.query(`INSERT INTO q_intent(token_hash,actor,session_id,action,target,actor_epoch,target_version,expires_at)
    VALUES($1,$2,$3,$4,$5,0,0,clock_timestamp()+interval '5 minutes')`, [tokenHash(token), actor, `session-${actor}`, action, target]);
  return { requestId: `request-${token}`, token, sessionId: `session-${actor}`, action, target };
}
const denied = promise => assert.rejects(promise, error => error.code === 'DENIED');
async function waitForLock(pool, pid) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const { rows: [{ waiting }] } = await pool.query(
      'SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting', [pid]);
    if (waiting) return;
    await delay(10);
  }
  assert.fail('CONTENTION_NOT_OBSERVED');
}
function barrier() {
  let arrived, release, first = true;
  const reached = new Promise(resolve => { arrived = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  return { reached, release, checkpoint: async (phase, data) => {
    if (phase === 'before-commit' && first) { first = false; arrived(data); await released; }
  } };
}
function started() {
  let signal;
  const observedAttempts = [];
  const reached = new Promise(resolve => { signal = resolve; });
  return { reached, observedAttempts, checkpoint: async (phase, data) => {
    if (phase === 'transaction-start') { observedAttempts.push(data.attempt); signal(data); }
  } };
}
async function checkpointData(start, operation) {
  let timer;
  try {
    const data = await Promise.race([
      start.reached,
      operation.then(() => { throw new Error('OPERATION_FINISHED_WITHOUT_START'); }),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('TRANSACTION_START_TIMEOUT')), 10000); }),
    ]);
    return data;
  } finally { clearTimeout(timer); }
}
async function startedPid(start, operation) { return (await checkpointData(start, operation)).pid; }

function worker(t, config, operation, input, pauseAt) {
  const names = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT',
    'HESTIA_PG_HOST', 'HESTIA_PG_PORT', 'HESTIA_PG_PASSWORD', 'HESTIA_PG_RUN_ID'];
  const env = Object.fromEntries(names.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  env.NODE_ENV = 'test'; env.BETTER_AUTH_TELEMETRY = 'false';
  const child = fork(new URL('./pg-worker.mjs', import.meta.url), [], {
    env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  const messages = [], waiters = [];
  child.on('message', message => {
    const index = waiters.findIndex(waiter => waiter.type === message.type || message.type === 'failure');
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else messages.push(message);
  });
  const exit = once(child, 'exit');
  const wait = type => {
    const index = messages.findIndex(message => message.type === type || message.type === 'failure');
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WORKER_TIMEOUT')), 15000);
      waiters.push({ type, resolve: message => { clearTimeout(timer); resolve(message); } });
    });
  };
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    return exit;
  };
  t.after(stop);
  child.send({ type: 'run', config, operation, input, pauseAt });
  return { child, wait, exit, stop };
}

test('PG SQL model: invalid retry limits fail explicitly without opening a connection', async () => {
  let connections = 0;
  const pool = { connect: () => { connections++; throw new Error('UNEXPECTED_CONNECTION'); } };
  for (const attempts of [[], 0, -1, 1.5, 4, Infinity]) {
    await assert.rejects(transaction(pool, async () => {}, { attempts }), error => error.code === 'INVALID_RETRY_LIMIT');
  }
  assert.equal(connections, 0);
});

test('PG SQL model: actual separate connections, transaction rollback and bounded serialization retry', async t => {
  const { pool } = await fixture(t);
  const a = await pool.connect(), b = await pool.connect();
  try {
    const [pa, pb] = await Promise.all([a.query('SELECT pg_backend_pid() AS pid'), b.query('SELECT pg_backend_pid() AS pid')]);
    assert.notEqual(pa.rows[0].pid, pb.rows[0].pid);
  } finally { a.release(); b.release(); }
  let attempts = 0;
  await transaction(pool, async client => {
    attempts++;
    await client.query("INSERT INTO q_target(id) VALUES('retry-effect')");
    if (attempts < 3) throw Object.assign(new Error('synthetic serialization abort'), { code: '40001' });
  });
  assert.equal(attempts, 3);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM q_target WHERE id='retry-effect'")).rows[0].n, 1);
  let exhausted = 0;
  await assert.rejects(transaction(pool, async client => {
    exhausted++;
    await client.query("INSERT INTO q_target(id) VALUES('aborted-effect')");
    throw Object.assign(new Error('synthetic serialization abort'), { code: '40001' });
  }), error => error.code === '40001');
  assert.equal(exhausted, 3);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM q_target WHERE id='aborted-effect'")).rows[0].n, 0);
});

test('PG SQL model: bootstrap contenders in distinct processes establish one owner', async t => {
  const db = await fixture(t);
  await db.pool.query("INSERT INTO q_verified VALUES('a@example.invalid'),('b@example.invalid')");
  const input = { requestId: 'boot-a', token: 'synthetic-bootstrap-capability', memberId: 'a', email: 'a@example.invalid' };
  const a = worker(t, db.config, 'bootstrap', input, 'before-commit');
  const checkpoint = await a.wait('checkpoint'); assert.equal(checkpoint.type, 'checkpoint');
  const b = worker(t, db.config, 'bootstrap', { ...input, requestId: 'boot-b', memberId: 'b', email: 'b@example.invalid' });
  const contender = await b.wait('started');
  assert.equal(contender.type, 'started'); assert.notEqual(contender.pid, checkpoint.pid);
  await waitForLock(db.pool, contender.pid);
  a.child.send({ type: 'resume' });
  const [winner, loser] = await Promise.all([a.wait('result'), b.wait('failure')]);
  assert.equal(winner.type, 'result'); assert.equal(loser.code, 'DENIED');
  await Promise.all([a.exit, b.exit]);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM q_member WHERE role='owner'")).rows[0].n, 1);
  assert.equal((await db.pool.query('SELECT consumed FROM q_boot')).rows[0].consumed, true);
  await denied(bootstrap(db.pool, { ...input, requestId: 'boot-replay' }));
});

test('PG SQL model: invitation consumers have one atomic activation and no partial losing member', async t => {
  const { pool } = await fixture(t);
  await pool.query("INSERT INTO q_verified VALUES('invite@example.invalid')");
  await pool.query("INSERT INTO q_invitation(token_hash,email,expires_at) VALUES($1,'invite@example.invalid',clock_timestamp()+interval '1 hour')", [tokenHash('invitation')]);
  const hold = barrier();
  const a = activateInvitation(pool, { requestId: 'activate-a', token: 'invitation', memberId: 'a' }, hold);
  await checkpointData(hold, a);
  const start = started();
  const b = activateInvitation(pool, { requestId: 'activate-b', token: 'invitation', memberId: 'b' }, start);
  const outcome = Promise.allSettled([a, b]);
  try { await waitForLock(pool, await startedPid(start, b)); } finally { hold.release(); }
  const results = await outcome;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DENIED');
  assert.ok(start.observedAttempts.includes(2), 'Actual conflicting PostgreSQL transaction must have been restarted');
  assert.deepEqual((await pool.query('SELECT id FROM q_member')).rows, [{ id: 'a' }]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM q_effect')).rows[0].n, 1);
});

test('PG SQL model: action-bound intent consumed once with exactly one synthetic effect', async t => {
  const { pool } = await fixture(t); await memberFixture(pool);
  const input = await intentFixture(pool);
  const hold = barrier();
  const a = consumeIntent(pool, input, hold); await checkpointData(hold, a);
  const start = started();
  const b = consumeIntent(pool, { ...input, requestId: 'other-request' }, start);
  const outcome = Promise.allSettled([a, b]);
  try { await waitForLock(pool, await startedPid(start, b)); } finally { hold.release(); }
  const results = await outcome;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DENIED');
  assert.deepEqual((await pool.query('SELECT effects,version FROM q_target')).rows, [{ effects: 1, version: 1 }]);
  assert.equal((await consumeIntent(pool, input)).replayed, true);
  await assert.rejects(consumeIntent(pool, { ...input, target: 'different' }), error => error.code === 'REQUEST_MISMATCH');
});

for (const stale of ['actor', 'action', 'target', 'target-version', 'epoch', 'expired', 'session-revoked', 'recovering', 'role']) {
  test(`PG SQL model: intent rejects ${stale} without consumption or effect`, async t => {
    const { pool } = await fixture(t); await memberFixture(pool); await memberFixture(pool, 'other', 'member');
    const input = await intentFixture(pool);
    if (stale === 'actor') input.sessionId = 'session-other';
    if (stale === 'action') input.action = 'space-delete';
    if (stale === 'target') input.target = 'other';
    if (stale === 'target-version') await pool.query("UPDATE q_target SET version=1 WHERE id='owner'");
    if (stale === 'epoch') await pool.query("UPDATE q_member SET epoch=1 WHERE id='owner'");
    if (stale === 'expired') await pool.query("UPDATE q_intent SET expires_at=clock_timestamp()-interval '1 second'");
    if (stale === 'session-revoked') await revokeSession(pool, 'session-owner');
    if (stale === 'recovering') await pool.query("UPDATE q_member SET recovering=true WHERE id='owner'");
    if (stale === 'role') await pool.query("UPDATE q_member SET role='member' WHERE id='owner'");
    await denied(consumeIntent(pool, input));
    assert.equal((await pool.query('SELECT consumed FROM q_intent')).rows[0].consumed, false);
    assert.equal((await pool.query('SELECT sum(effects)::int AS n FROM q_target')).rows[0].n, 0);
  });
}

test('PG SQL model: committed session revocation wins against waiting intent', async t => {
  const { pool } = await fixture(t); await memberFixture(pool);
  const input = await intentFixture(pool), hold = barrier();
  const revocation = revokeSession(pool, 'session-owner', hold); await checkpointData(hold, revocation);
  const start = started();
  const intent = consumeIntent(pool, input, start); const rejected = denied(intent);
  try { await waitForLock(pool, await startedPid(start, intent)); } finally { hold.release(); }
  await revocation; await rejected;
  assert.equal((await pool.query('SELECT effects FROM q_target')).rows[0].effects, 0);
});

for (const first of ['grant', 'revoke']) {
  test(`PG SQL model: ${first} first in grant/revocation race preserves only independent access`, async t => {
    const { pool } = await fixture(t);
    await pool.query("INSERT INTO q_grant(id,beneficiary,scope,capability) VALUES('parent','delegator','folder','read'),('independent','reader','folder','read')");
    const input = { requestId: 'grant-request', grantId: 'child', parentId: 'parent', beneficiary: 'reader', scope: 'folder', capability: 'read' };
    const hold = barrier();
    const firstCall = first === 'grant' ? createDelegatedGrant(pool, input, hold) : revokeGrant(pool, 'parent', hold);
    await checkpointData(hold, firstCall);
    const start = started();
    const secondCall = first === 'grant' ? revokeGrant(pool, 'parent', start) : createDelegatedGrant(pool, input, start);
    const outcomes = Promise.allSettled([firstCall, secondCall]);
    try { await waitForLock(pool, await startedPid(start, secondCall)); } finally { hold.release(); }
    const results = await outcomes;
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, first === 'grant' ? 'fulfilled' : 'rejected');
    if (first === 'revoke') assert.equal(results[1].reason.code, 'DENIED');
    assert.deepEqual(await effectiveGrantIds(pool, 'reader'), ['independent']);
    await revokeGrant(pool, 'independent');
    assert.deepEqual(await effectiveGrantIds(pool, 'reader'), []);
  });
}

for (const phase of ['before-commit', 'after-commit']) {
  test(`PG SQL model: real worker death ${phase}; bootstrap retry has exactly one effect`, async t => {
    const db = await fixture(t); await db.pool.query("INSERT INTO q_verified VALUES('crash@example.invalid')");
    const input = { requestId: 'crash-bootstrap', token: 'synthetic-bootstrap-capability', memberId: 'crash-owner', email: 'crash@example.invalid' };
    const child = worker(t, db.config, 'bootstrap', input, phase);
    const checkpoint = await child.wait('checkpoint'); assert.equal(checkpoint.type, 'checkpoint');
    await child.stop();
    const observer = await db.pool.connect();
    try {
      assert.notEqual((await observer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, checkpoint.pid);
      const count = (await observer.query('SELECT count(*)::int AS n FROM q_member')).rows[0].n;
      assert.equal(count, phase === 'before-commit' ? 0 : 1);
    } finally { observer.release(); }
    const result = await bootstrap(db.pool, input);
    assert.equal(result.replayed, phase === 'after-commit');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM q_member')).rows[0].n, 1);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM q_effect')).rows[0].n, 1);
  });
  test(`PG SQL model: real worker death ${phase}; intent consumption and effect are atomic`, async t => {
    const db = await fixture(t); await memberFixture(db.pool);
    const input = await intentFixture(db.pool);
    const child = worker(t, db.config, 'consumeIntent', input, phase);
    const checkpoint = await child.wait('checkpoint'); assert.equal(checkpoint.type, 'checkpoint');
    await child.stop();
    const state = (await db.pool.query('SELECT consumed,effects FROM q_intent CROSS JOIN q_target')).rows[0];
    assert.deepEqual(state, phase === 'before-commit' ? { consumed: false, effects: 0 } : { consumed: true, effects: 1 });
    const result = await consumeIntent(db.pool, input);
    assert.equal(result.replayed, phase === 'after-commit');
    assert.equal((await db.pool.query('SELECT effects FROM q_target')).rows[0].effects, 1);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM q_effect')).rows[0].n, 1);
  });
}

test('PG SQL model: recovery admission survives real worker death and stays fail-closed', async t => {
  const db = await fixture(t); await memberFixture(db.pool);
  const intent = await intentFixture(db.pool);
  await db.pool.query("INSERT INTO q_recovery_proof VALUES($1,'owner',clock_timestamp()+interval '30 minutes',false)", [tokenHash('recovery')]);
  const input = { requestId: 'recovery-request', memberId: 'owner', token: 'recovery' };
  const child = worker(t, db.config, 'admitRecovery', input, 'after-commit');
  assert.equal((await child.wait('checkpoint')).type, 'checkpoint'); await child.stop();
  assert.deepEqual((await db.pool.query("SELECT epoch,recovering,recovery_id FROM q_member WHERE id='owner'")).rows,
    [{ epoch: 1, recovering: true, recovery_id: 'recovery-request' }]);
  assert.equal((await db.pool.query('SELECT active FROM q_session')).rows[0].active, false);
  await denied(consumeIntent(db.pool, intent));
  assert.equal((await admitRecovery(db.pool, input)).replayed, true);
  await denied(admitRecovery(db.pool, { ...input, requestId: 'unsafe-unlock' }));
  assert.equal((await db.pool.query('SELECT recovering FROM q_member')).rows[0].recovering, true);
  // Deliberate limit: no completed recovery/unlock protocol is claimed here.
});

for (const kind of ['intent', 'invitation', 'recovery']) {
  test(`PG SQL model: ${kind} expiration during unchanged-row lock wait forbids consumption`, async t => {
    const { pool } = await fixture(t);
    let operation, expiryTable, lockTable;
    if (kind === 'intent') {
      await memberFixture(pool);
      const input = await intentFixture(pool);
      operation = options => consumeIntent(pool, input, options);
      expiryTable = 'q_intent'; lockTable = 'q_target';
    } else if (kind === 'invitation') {
      await pool.query("INSERT INTO q_verified VALUES('expiry@example.invalid')");
      await pool.query("INSERT INTO q_invitation(token_hash,email,expires_at) VALUES($1,'expiry@example.invalid',clock_timestamp()+interval '1 hour')", [tokenHash('expiry-invite')]);
      operation = options => activateInvitation(pool, { requestId: 'expiry-invite', token: 'expiry-invite', memberId: 'expired-member' }, options);
      expiryTable = 'q_invitation'; lockTable = 'q_invitation';
    } else {
      await memberFixture(pool);
      await pool.query("INSERT INTO q_recovery_proof VALUES($1,'owner',clock_timestamp()+interval '1 hour',false)", [tokenHash('expiry-recovery')]);
      operation = options => admitRecovery(pool, { requestId: 'expiry-recovery', memberId: 'owner', token: 'expiry-recovery' }, options);
      expiryTable = 'q_recovery_proof'; lockTable = 'q_recovery_proof';
    }
    // Identifiers above are closed test literals, never an external input.
    const blocker = await pool.connect();
    let pending;
    try {
      await pool.query(`UPDATE ${expiryTable} SET expires_at=clock_timestamp()+interval '1500 milliseconds'`);
      await blocker.query('BEGIN');
      await blocker.query(`SELECT * FROM ${lockTable} FOR UPDATE`);
      const start = started(); pending = operation(start);
      // Observe the result immediately to avoid a floating rejection on failure.
      pending.catch(() => {});
      await waitForLock(pool, await startedPid(start, pending));
      assert.equal((await pool.query(`SELECT expires_at>clock_timestamp() AS valid FROM ${expiryTable}`)).rows[0].valid, true,
        'Contender must already be blocked while the proof is still valid');
      const deadline = Date.now() + 3000;
      while ((await pool.query(`SELECT expires_at>clock_timestamp() AS valid FROM ${expiryTable}`)).rows[0].valid) {
        assert.ok(Date.now() < deadline, 'Server expiry deadline was not observed');
        await delay(10);
      }
      // Only release the lock: no version change may manufacture a 40001 retry.
      await blocker.query('COMMIT');
    } finally {
      await blocker.query('ROLLBACK').catch(() => {}); blocker.release();
    }
    await denied(pending);
    assert.equal((await pool.query(`SELECT consumed FROM ${expiryTable}`)).rows[0].consumed, false);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM q_effect')).rows[0].n, 0);
    if (kind === 'intent') assert.equal((await pool.query('SELECT effects FROM q_target')).rows[0].effects, 0);
    if (kind === 'invitation') assert.equal((await pool.query('SELECT count(*)::int AS n FROM q_member')).rows[0].n, 0);
    if (kind === 'recovery') assert.deepEqual((await pool.query('SELECT epoch,recovering FROM q_member')).rows, [{ epoch: 0, recovering: false }]);
  });
}
