import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { BINDINGS, createIntegratedBench } from './pg-integrated.mjs';
import { CAPABILITIES } from './policy.mjs';

const allow = result => { assert.equal(result.allowed, true); return result; };
const refuse = result => assert.deepEqual(result, { allowed: false, code: 'DENIED' });
const read = resourceId => ({ operation: 'O01', resourceId });
async function setup(t) {
  const bench = await createIntegratedBench();
  t.after(() => bench.close());
  const holder = await bench.controls.member('holder@example.invalid');
  const admin = await bench.controls.member('admin@example.invalid', 'admin');
  const reader = await bench.controls.member('reader@example.invalid');
  await bench.controls.createSpace(holder, 'P');
  await bench.controls.policy(state => {
    state.resources.push({ id: 'doc', folderId: 'P', content: 'PRIVATE-P', original: 'PRIVATE-P', title: 'PRIVATE-TITLE', version: 1 });
  });
  const login = async (email, adapter = bench.a, options) => allow(await adapter.signIn(email, options)).cookie;
  return { ...bench, holder, admin, reader, login };
}
async function grant(h, capability = 'consulter', rest = {}) {
  const id = randomUUID();
  await h.controls.policy(state => state.grants.push({ id, subject: h.reader, folderId: 'P',
    capability, kind: 'direct', parent: null, transmit: [], lineage: [], revoked: false,
    expiresAt: null, ...rest }));
  return id;
}
async function revoke(h, id) {
  await h.controls.policy(state => { state.grants.find(value => value.id === id).revoked = true; });
}

test('Integrated: actual BA cookie works across two pools; unadmitted raw cookie and impersonation fail', async t => {
  const h = await setup(t);
  const cookie = await h.login('holder@example.invalid');
  const result = allow(await h.b.execute(cookie, read('doc')));
  assert.equal(result.content, 'PRIVATE-P');
  await h.identity.poolB.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [h.holder]);
  refuse(await h.a.execute(cookie, read('doc')));
  await h.identity.poolB.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [h.holder]);
  refuse(await h.b.execute('', read('doc')));
  refuse(await h.b.execute(cookie, { ...read('doc'), actor: h.admin }));
  const raw = await h.identity.login(h.identity.authB, 'holder@example.invalid');
  assert.equal(raw.response.ok, true);
  refuse(await h.a.execute(raw.cookie, read('doc')));
  const [a, b] = await Promise.all([h.identity.pool.connect(), h.identity.poolB.connect()]);
  try { assert.notEqual((await a.query('SELECT pg_backend_pid() p')).rows[0].p, (await b.query('SELECT pg_backend_pid() p')).rows[0].p); }
  finally { a.release(); b.release(); }
});

test('Integrated: explicit initial grants are atomic and admin/account alone has no private access', async t => {
  const h = await setup(t);
  const state = (await h.identity.pool.query('SELECT body FROM i_policy')).rows[0].body;
  assert.deepEqual(state.grants.filter(value => value.subject === h.holder).map(value => value.capability).sort(), [...CAPABILITIES].sort());
  assert.equal(state.grants.some(value => [h.admin, h.reader].includes(value.subject)), false);
  refuse(await h.a.execute(await h.login('admin@example.invalid'), read('doc')));
  refuse(await h.a.execute(await h.login('reader@example.invalid'), read('doc')));
  const results = await Promise.allSettled([h.controls.createSpace(h.holder, 'S', 'shared'), h.controls.createSpace(h.holder, 'S', 'shared')]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const after = (await h.identity.pool.query('SELECT body FROM i_policy')).rows[0].body;
  assert.equal(after.folders.filter(value => value.id === 'S').length, 1);
  assert.equal(after.grants.filter(value => value.folderId === 'S').length, 7);
  assert.equal(after.folders.find(value => value.id === 'S').holder, null);
});

test('Integrated: unknown operation and unqualified mutations fail closed; all bindings are explicit', async t => {
  const h = await setup(t), cookie = await h.login('holder@example.invalid');
  assert.deepEqual(Object.keys(BINDINGS), Array.from({ length: 10 }, (_, index) => 'O' + String(index + 1).padStart(2, '0')));
  assert.deepEqual(BINDINGS.O04, ['consulter', 'modifier', 'déposer']);
  assert.deepEqual(BINDINGS.O07, ['consulter', 'exporter']);
  for (const operation of ['unknown', 'O02', 'O03', 'O04', 'O05', 'O06', 'O08', 'O09', 'O10']) {
    refuse(await h.a.execute(cookie, { operation, resourceId: 'doc' }));
  }
});

test('Integrated: read and export remain distinct with real sessions and current grants', async t => {
  const h = await setup(t), cookie = await h.login('reader@example.invalid');
  const reader = await grant(h);
  allow(await h.b.execute(cookie, read('doc')));
  refuse(await h.b.execute(cookie, { operation: 'O07', resourceId: 'doc' }));
  await grant(h, 'exporter');
  allow(await h.b.execute(cookie, { operation: 'O07', resourceId: 'doc' }));
  await revoke(h, reader);
  refuse(await h.a.execute(cookie, { operation: 'O07', resourceId: 'doc' }));
});

test('Integrated: revocation between preparation and return denies complete projection', async t => {
  const h = await setup(t), id = await grant(h), cookie = await h.login('reader@example.invalid');
  let barrierReached = false;
  refuse(await h.a.execute(cookie, read('doc'), { beforeReturn: async () => {
    barrierReached = true;
    await revoke(h, id); // second pool commits before the final authorization
  } }));
  assert.equal(barrierReached, true);
  refuse(await h.b.execute(cookie, read('doc')));
});

test('Integrated: forbidden composite source denies all content, including after preparation', async t => {
  const h = await setup(t), cookie = await h.login('reader@example.invalid');
  await grant(h);
  await h.controls.createSpace(h.admin, 'Q');
  await h.controls.policy(state => state.resources.push(
    { id: 'q', folderId: 'Q', content: 'PRIVATE-Q', title: 'PRIVATE-Q-TITLE', version: 1 },
    { id: 'mix', folderId: 'P', sourceIds: ['doc', 'q'], content: 'COMPOSITE-PRIVATE-Q', title: 'COMPOSITE', version: 1 },
  ));
  refuse(await h.a.execute(cookie, read('mix')));
  const second = await grant(h, 'consulter', { folderId: 'Q' });
  assert.equal(allow(await h.b.execute(cookie, read('mix'))).content, 'COMPOSITE-PRIVATE-Q');
  refuse(await h.a.execute(cookie, read('mix'), { beforeReturn: () => revoke(h, second) }));
});

test('Integrated: parent revocation removes dependent access but preserves an independent grant', async t => {
  const h = await setup(t), cookie = await h.login('reader@example.invalid');
  const parent = await grant(h, 'partager', { subject: h.holder, transmit: ['consulter'] });
  await grant(h, 'consulter', { kind: 'delegated', parent });
  const independent = await grant(h);
  await revoke(h, parent);
  allow(await h.b.execute(cookie, read('doc')));
  await revoke(h, independent);
  refuse(await h.a.execute(cookie, read('doc')));
});

test('Integrated: malformed/cyclic provenance and expired grants fail closed', async t => {
  const h = await setup(t), cookie = await h.login('reader@example.invalid');
  const id = await grant(h, 'consulter', { kind: 'delegated', parent: 'missing' });
  refuse(await h.a.execute(cookie, read('doc')));
  await h.controls.policy(state => { state.grants.find(value => value.id === id).parent = id; });
  refuse(await h.b.execute(cookie, read('doc')));
  await grant(h, 'consulter', { expiresAt: 0 });
  refuse(await h.a.execute(cookie, read('doc')));
});

test('Integrated: real BA session revocation in second instance prevents the next return', async t => {
  const h = await setup(t), cookie = await h.login('holder@example.invalid');
  refuse(await h.a.execute(cookie, read('doc'), { beforeReturn: async () => {
    const response = await h.identity.call(h.identity.authB, '/sign-out', { cookie, body: {} });
    assert.equal(response.ok, true);
  } }));
});

test('Integrated: recovery generation captured before password verification rejects stale admission', async t => {
  const h = await setup(t);
  let reached = false;
  refuse(await h.a.signIn('holder@example.invalid', { beforeVerification: async () => {
    reached = true;
    await h.controls.recovery(h.holder);
    await h.controls.recoveryComplete(h.holder); // even completion cannot erase the generation change
  } }));
  assert.equal(reached, true);
  assert.equal((await h.identity.pool.query('SELECT count(*)::integer n FROM i_admission')).rows[0].n, 0);
});

test('Integrated: recovery after BA verification but before admission rejects the created session', async t => {
  const h = await setup(t);
  refuse(await h.a.signIn('holder@example.invalid', { afterVerification: async () => {
    await h.controls.recovery(h.holder);
  } }));
  assert.equal((await h.identity.pool.query('SELECT count(*)::integer n FROM session')).rows[0].n, 0);
});

test('Integrated: recovery state survives adapter reconstruction; old sessions remain invalid after trusted completion', async t => {
  const h = await setup(t), cookie = await h.login('holder@example.invalid');
  await h.controls.recovery(h.holder);
  const restarted = h.adapter(h.identity.poolB, h.identity.authB);
  refuse(await restarted.execute(cookie, read('doc')));
  refuse(await restarted.signIn('holder@example.invalid'));
  await h.controls.recoveryComplete(h.holder);
  refuse(await restarted.execute(cookie, read('doc')));
  allow(await restarted.execute(await h.login('holder@example.invalid', restarted), read('doc')));
});

test('Integrated: departure and absolute/idle session bounds use current database state', async t => {
  const h = await setup(t);
  const expired = await h.login('holder@example.invalid');
  await h.identity.poolB.query('UPDATE i_admission SET touched=0');
  refuse(await h.a.execute(expired, read('doc')));
  const absolute = await h.login('holder@example.invalid', h.b, { rememberMe: true });
  await h.identity.poolB.query('UPDATE i_admission SET started=0');
  refuse(await h.a.execute(absolute, read('doc')));
  const fresh = await h.login('holder@example.invalid');
  await h.controls.depart(h.holder);
  refuse(await h.b.execute(fresh, read('doc')));
  refuse(await h.a.signIn('holder@example.invalid'));
});

test('Integrated: invalid password never creates admission or grants', async t => {
  const h = await setup(t);
  const before = (await h.identity.pool.query('SELECT body FROM i_policy')).rows[0].body;
  refuse(await h.a.signIn('holder@example.invalid', { secret: 'Wrong synthetic password 2026!' }));
  assert.equal((await h.identity.pool.query('SELECT count(*)::integer n FROM i_admission')).rows[0].n, 0);
  assert.deepEqual((await h.identity.pool.query('SELECT body FROM i_policy')).rows[0].body, before);
});

test('Integrated: observed policy lock contention reloads the committed revocation before authorization', async t => {
  const h = await setup(t), id = await grant(h), cookie = await h.login('reader@example.invalid');
  const blocker = await h.identity.poolB.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    const pid = (await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const state = (await blocker.query('SELECT body FROM i_policy WHERE id=1 FOR UPDATE')).rows[0].body;
    pending = h.a.execute(cookie, read('doc'));
    // Poll PostgreSQL's actual blocking relation; launching two promises alone
    // would not prove that the decision really waited behind a state change.
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await h.identity.poolB.query(
        'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) waiting', [pid]);
      if (result.rows[0].waiting) { waiting = true; break; }
      await h.identity.poolB.query('SELECT pg_sleep(0.005)');
    }
    assert.equal(waiting, true, 'Expected an observed PostgreSQL lock wait');
    state.grants.find(value => value.id === id).revoked = true;
    await blocker.query('UPDATE i_policy SET body=$1 WHERE id=1', [state]);
    await blocker.query('COMMIT');
    refuse(await pending);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (pending) await pending.catch(() => {});
  }
});
