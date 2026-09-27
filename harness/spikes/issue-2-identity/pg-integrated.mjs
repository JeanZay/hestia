// LOCAL QUALIFICATION ONLY. No application route or provisioning API.
// Better Auth is real; membership/provisioning/recovery controls below are
// trusted fixtures. They do NOT implement invitation, bootstrap or reset.
import { randomUUID } from 'node:crypto';
import { createPgIdentity, password } from './pg-identity.mjs';
import { CAPABILITIES, createPolicyHarness } from './policy.mjs';

export const BINDINGS = Object.freeze({
  O01: ['consulter'], O02: ['déposer'], O03: ['consulter', 'modifier'],
  O04: ['consulter', 'modifier', 'déposer'], O05: ['consulter', 'supprimer'],
  O06: ['partager'], O07: ['consulter', 'exporter'], O08: ['administrer'],
  O09: ['administrer'], O10: ['administrer'],
});
const denied = () => ({ allowed: false, code: 'DENIED' });
const fault = () => { throw new Error('FIXTURE_PRECONDITION'); };

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function stateForUpdate(client) {
  const { rows: [row] } = await client.query('SELECT body FROM i_policy WHERE id=1 FOR UPDATE');
  return row.body;
}
async function saveState(client, state) {
  await client.query('UPDATE i_policy SET body=$1 WHERE id=1', [state]);
}
async function databaseTime(client) {
  return Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS at')).rows[0].at);
}

export async function createIntegratedBench() {
  const identity = await createPgIdentity();
  await identity.pool.query(`
    CREATE TABLE i_member(id text PRIMARY KEY REFERENCES "user", active boolean NOT NULL,
      role text NOT NULL CHECK(role IN ('owner','admin','member')), epoch integer NOT NULL DEFAULT 0,
      recovering boolean NOT NULL DEFAULT false);
    CREATE TABLE i_admission(id text PRIMARY KEY REFERENCES session ON DELETE CASCADE,
      member_id text NOT NULL REFERENCES i_member, epoch integer NOT NULL,
      started bigint NOT NULL, touched bigint NOT NULL, persistent boolean NOT NULL);
    CREATE TABLE i_policy(id integer PRIMARY KEY CHECK(id=1), body jsonb NOT NULL);
    INSERT INTO i_policy VALUES(1,'{"members":[],"folders":[],"resources":[],"grants":[]}');
  `);

  function adapter(pool, auth) {
    async function signIn(email, { secret = password, rememberMe = false,
      beforeVerification = async () => {}, afterVerification = async () => {} } = {}) {
      // This generation is sampled BEFORE Better Auth hashes/verifies the password.
      const { rows: [before] } = await pool.query(
        'SELECT m.* FROM i_member m JOIN "user" u ON u.id=m.id WHERE u.email=$1', [email]);
      if (!before?.active || before.recovering) return denied();
      await beforeVerification(); // deterministic test barrier, never client input
      const response = await identity.call(auth, '/sign-in/email', {
        body: { email, password: secret, rememberMe },
      });
      if (!response.ok) return denied();
      const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const verified = await auth.api.getSession({ headers: new Headers({ cookie }) });
      if (!verified) return denied();
      await afterVerification(); // deterministic test barrier
      const admitted = await transaction(pool, async client => {
        await stateForUpdate(client);
        const { rows: [member] } = await client.query('SELECT * FROM i_member WHERE id=$1 FOR UPDATE', [before.id]);
        const { rows: [user] } = await client.query('SELECT "emailVerified" FROM "user" WHERE id=$1 FOR SHARE', [before.id]);
        const { rows: [session] } = await client.query('SELECT * FROM session WHERE id=$1 FOR UPDATE', [verified.session.id]);
        const at = await databaseTime(client);
        if (!member?.active || member.recovering || !user?.emailVerified || member.epoch !== before.epoch
          || !session || session.userId !== member.id || new Date(session.expiresAt).getTime() <= at) return false;
        await client.query('INSERT INTO i_admission VALUES($1,$2,$3,$4,$4,$5)',
          [session.id, member.id, member.epoch, at, rememberMe === true]);
        return true;
      });
      if (!admitted) {
        await pool.query('DELETE FROM session WHERE id=$1', [verified.session.id]);
        return denied();
      }
      return { allowed: true, cookie };
    }

    async function readCurrent(cookie, command) {
      // Only reads/exports are qualified by this integrated surface. O02–O10
      // mutation oracles remain in policy.test.mjs; never expose a fake success.
      if (!['O01', 'O07'].includes(command?.operation)) return denied();
      const verified = await auth.api.getSession({ headers: new Headers({ cookie: cookie ?? '' }) });
      if (!verified) return denied();
      return transaction(pool, async client => {
        // One coarse lock deliberately orders the entire synthetic policy and
        // its membership changes. Not a scalable/normalized product data model.
        // Same order throughout: policy, member, user, session, admission.
        const state = await stateForUpdate(client);
        const { rows: [member] } = await client.query('SELECT * FROM i_member WHERE id=$1 FOR UPDATE', [verified.user.id]);
        const { rows: [user] } = await client.query('SELECT "emailVerified" FROM "user" WHERE id=$1 FOR SHARE', [verified.user.id]);
        const { rows: [session] } = await client.query('SELECT * FROM session WHERE id=$1 FOR UPDATE', [verified.session.id]);
        const { rows: [admission] } = await client.query('SELECT * FROM i_admission WHERE id=$1 FOR UPDATE', [verified.session.id]);
        const at = await databaseTime(client); // clock after all lock waits
        if (!member?.active || member.recovering || !user?.emailVerified || !admission || !session
          || session.userId !== member.id || admission.member_id !== member.id
          || admission.epoch !== member.epoch || new Date(session.expiresAt).getTime() <= at
          || at >= Number(admission.started) + (admission.persistent ? 604800000 : 43200000)
          || at >= Number(admission.touched) + (admission.persistent ? 86400000 : 1800000)) return denied();
        // Membership comes from current SQL rows, never the JSON oracle snapshot.
        state.members = (await client.query('SELECT id,active,role FROM i_member')).rows;
        const policy = createPolicyHarness(state, { now: () => at });
        const result = policy.execute(policy.sessionFor(member.id), command);
        if (result.allowed) await client.query('UPDATE i_admission SET touched=$2 WHERE id=$1', [session.id, at]);
        return result;
      });
    }

    async function execute(cookie, command, { beforeReturn = async () => {} } = {}) {
      const prepared = await readCurrent(cookie, command);
      if (!prepared.allowed) return prepared;
      await beforeReturn(); // test barrier, simulates preparation outside the lock
      // Recompute complete projection, not just its citations, against current
      // state. The commit is our admission boundary, not an atomic network send.
      return readCurrent(cookie, command);
    }
    return Object.freeze({ signIn, execute });
  }

  const controls = Object.freeze({
    async member(email, role = 'member') {
      const id = await identity.seed(email);
      await identity.pool.query('INSERT INTO i_member(id,active,role) VALUES($1,true,$2)', [id, role]);
      return id;
    },
    async createSpace(holder, id, kind = 'personal') {
      // Trusted installation/creation authority is supplied by the fixture, NOT
      // proven here. The resulting seven grants really are created atomically.
      if (!['personal', 'shared'].includes(kind)) fault();
      return transaction(identity.pool, async client => {
        const state = await stateForUpdate(client);
        const { rows: [member] } = await client.query('SELECT * FROM i_member WHERE id=$1 FOR UPDATE', [holder]);
        if (!member?.active || member.recovering) fault();
        if (state.folders.some(folder => folder.id === id)) fault();
        const referenceGrantId = randomUUID();
        state.folders.push({ id, kind, holder: kind === 'personal' ? holder : null,
          referenceGrantId, state: 'active', used: 0, quota: 1000 });
        for (const capability of CAPABILITIES) state.grants.push({
          id: capability === 'administrer' ? referenceGrantId : randomUUID(), subject: holder,
          folderId: id, capability, kind: capability === 'administrer' ? 'reference' : 'direct',
          parent: null, expiresAt: null, revoked: false, lineage: [], origin: 'trusted-creation-fixture',
          transmit: capability === 'administrer' ? [...CAPABILITIES]
            : capability === 'partager' ? CAPABILITIES.filter(value => value !== 'administrer') : [],
        });
        await saveState(client, state);
      });
    },
    async policy(change) {
      return transaction(identity.poolB, async client => {
        const state = await stateForUpdate(client);
        const result = change(state);
        await saveState(client, state);
        return result;
      });
    },
    async recovery(id) {
      // Trusted simulation of validated recovery ADMISSION only. No reset token,
      // password mutation, proof validation or recovery completion is implemented.
      await transaction(identity.poolB, async client => {
        await stateForUpdate(client);
        await client.query('UPDATE i_member SET epoch=epoch+1,recovering=true WHERE id=$1', [id]);
      });
    },
    async recoveryComplete(id) {
      // TRUSTED fixture operation; no public recovery unlock mechanism.
      await transaction(identity.poolB, async client => {
        await stateForUpdate(client);
        await client.query('UPDATE i_member SET recovering=false WHERE id=$1', [id]);
      });
    },
    async depart(id) {
      await transaction(identity.poolB, async client => {
        await stateForUpdate(client);
        await client.query('UPDATE i_member SET active=false,epoch=epoch+1 WHERE id=$1', [id]);
      });
    },
  });
  return { identity, controls, adapter,
    a: adapter(identity.pool, identity.authA), b: adapter(identity.poolB, identity.authB),
    close: () => identity.close() };
}
