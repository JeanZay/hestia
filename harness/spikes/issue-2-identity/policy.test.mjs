import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITIES, POLICY_LIMITS, createPolicyHarness } from './policy.mjs';

// Finite synthetic corpus. This fixture is NOT a runtime creation/identity proof.
function fixture() {
  const members = ['owner', 'admin', 'holder', 'root', 'blind', 'editor', 'reader', 'guest', 'delegate', 'peer', 'child', 'other']
    .map((id) => ({ id, active: true, role: ['owner', 'admin'].includes(id) ? id : 'member' }));
  const folders = [['P', 'personal', 'holder'], ['S', 'shared', 'root'], ['Q', 'personal', 'other']]
    .map(([id, kind, holder]) => ({ id, kind, holder: kind === 'personal' ? holder : null,
      referenceGrantId: `${holder}-${id}-administrer`, state: 'active', used: 8, quota: 1000 }));
  const grants = [];
  for (const [folderId, subject] of [['P', 'holder'], ['S', 'root'], ['Q', 'other']]) {
    for (const capability of CAPABILITIES) grants.push({
      id: `${subject}-${folderId}-${capability}`, subject, folderId, capability,
      kind: capability === 'administrer' ? 'reference' : 'direct',
      transmit: capability === 'administrer' ? [...CAPABILITIES]
        : capability === 'partager' ? CAPABILITIES.filter((c) => c !== 'administrer') : [],
    });
  }
  const resources = [
    { id: 'p-doc', folderId: 'P', content: 'PRIVATE-P', original: 'PRIVATE-P', title: 'PRIVATE-P-TITLE', metadata: { label: 'PRIVATE-P-LABEL' }, version: 1 },
    { id: 's-doc', folderId: 'S', content: 'abcdefghij', original: 'abcdefghij', title: 'SHARED-S', metadata: { label: 'old' }, version: 1 },
    { id: 'q-doc', folderId: 'Q', content: 'PRIVATE-Q', original: 'PRIVATE-Q', title: 'PRIVATE-Q-TITLE', version: 1 },
    { id: 'mixed', folderId: 'S', sourceIds: ['s-doc', 'q-doc'], content: 'COMBINED-PRIVATE-Q', title: 'COMBINED-TITLE', version: 1 },
  ];
  return { members, folders, resources, grants };
}
function allow(result) { assert.equal(result.allowed, true, JSON.stringify(result)); return result; }
function refuse(result) { assert.deepEqual(result, { allowed: false, code: 'DENIED' }); }
function setup(initial = fixture()) {
  let at = 10;
  const h = createPolicyHarness(initial, { now: () => at });
  const sessions = Object.fromEntries(initial.members.filter((m) => m.active).map((m) => [m.id, h.sessionFor(m.id)]));
  const run = (actor, operation, rest = {}) => h.execute(sessions[actor], { operation, ...rest });
  const direct = (subject, capability, rest = {}, actor = 'root', folderId = 'S') => allow(run(actor, 'O08', {
    folderId, authorityId: `${actor}-${folderId}-administrer`, subject, capability, ...rest,
  })).grantId;
  const delegate = (subject = 'delegate', transmit = ['consulter', 'partager', 'exporter'], expiresAt = 100) =>
    allow(run('root', 'O09', { action: 'create', folderId: 'S', subject, transmit, expiresAt })).grantId;
  return { h, sessions, run, direct, delegate, tick: (value) => { at = value; } };
}

test('C_CAPABILITIES: seven separate capabilities, no global role or person label opens content', () => {
  assert.equal(CAPABILITIES.length, 7);
  const { run } = setup();
  for (const actor of ['owner', 'admin', 'guest']) {
    for (const operation of ['O01', 'O03', 'O04', 'O05', 'O07']) refuse(run(actor, operation, { resourceId: 'p-doc' }));
  }
  allow(run('holder', 'O01', { resourceId: 'p-doc' }));
});

test('C_SYNTHETIC_BOUNDARY: opaque sessions and copied fixtures do not trust actor/provenance assertions', () => {
  const initial = fixture(); const { h, sessions, run } = setup(initial);
  refuse(h.execute({ actor: 'holder' }, { operation: 'O01', resourceId: 'p-doc' }));
  refuse(h.execute(null, { operation: 'O01', resourceId: 'p-doc' }));
  initial.grants.push({ id: 'injected', subject: 'guest', capability: 'consulter', folderId: 'P', kind: 'direct' });
  const snapshot = h.snapshot(); snapshot.grants[0].subject = 'guest';
  refuse(run('guest', 'O01', { resourceId: 'p-doc' }));
  for (const operation of ['unknown', '__proto__', 'constructor']) refuse(run('holder', operation));
  refuse(h.execute(sessions.holder, null));
  for (const extra of [{ actor: 'holder' }, { independent: true }, { origin: 'initial' }, { parent: null }]) {
    refuse(run('root', 'O08', { folderId: 'S', authorityId: 'root-S-administrer', subject: 'guest', capability: 'consulter', ...extra }));
  }
});

test('O01/O03/O04/O05/O07: each required capability is necessary, including export plus read', () => {
  const cases = [
    ['O01', ['consulter'], {}], ['O03', ['consulter', 'modifier'], { version: 1, patch: { label: 'new' } }],
    ['O04', ['consulter', 'modifier', 'déposer'], { version: 1, title: 'v2', content: 'version-two' }],
    ['O05', ['consulter', 'supprimer'], {}], ['O07', ['consulter', 'exporter'], {}],
  ];
  for (const [operation, required, rest] of cases) {
    for (const missing of [...required, null]) {
      const { direct, run } = setup();
      for (const capability of required.filter((c) => c !== missing)) direct('guest', capability);
      const result = run('guest', operation, { resourceId: 's-doc', ...rest });
      if (missing === null) allow(result); else refuse(result);
      refuse(run('guest', operation, { resourceId: 'q-doc', ...rest }));
    }
  }
});

test('O02: deposit without read yields only a neutral request receipt, no existing content or duplicate oracle', () => {
  const { direct, run, h } = setup(); direct('blind', 'déposer');
  const command = { folderId: 'S', requestId: 'deposit-one', title: 'SHARED-S', content: 'abcdefghij' };
  const before = h.snapshot();
  assert.deepEqual(run('blind', 'O02', command), { allowed: true, requestReference: 'deposit-one' });
  const after = h.snapshot();
  assert.equal(after.resources.length, before.resources.length + 1);
  assert.equal(after.resources.find((x) => x.id === 's-doc').original, 'abcdefghij');
  const created = after.resources.find((x) => !before.resources.some((old) => old.id === x.id));
  refuse(run('blind', 'O01', { resourceId: created.id }));
  refuse(run('blind', 'O01', { resourceId: 's-doc' }));
  allow(run('blind', 'O02', command));
  assert.equal(h.snapshot().resources.length, after.resources.length);
  refuse(run('blind', 'O02', { ...command, content: 'changed-replay' }));
  refuse(run('guest', 'O02', command));
});

test('O02/O04: byte quota boundary blocks additions without changing existing content', () => {
  const initial = fixture(); initial.folders.find((x) => x.id === 'S').quota = 10;
  const { direct, run, h } = setup(initial); direct('blind', 'déposer');
  allow(run('blind', 'O02', { folderId: 'S', requestId: 'exact-boundary', title: 'x', content: 'é' }));
  assert.equal(h.snapshot().folders.find((x) => x.id === 'S').used, 10);
  const before = h.snapshot();
  refuse(run('blind', 'O02', { folderId: 'S', requestId: 'over-limit', title: 'x', content: 'a' }));
  refuse(run('root', 'O04', { resourceId: 's-doc', version: 1, content: 'a', title: 'v2' }));
  assert.deepEqual(h.snapshot(), before);
});

test('O03/O04: mutable metadata and new objects preserve the original; stale/forged fields have no effect', () => {
  const { run, h } = setup();
  for (const patch of [{ original: 'changed' }, { label: 'x', folderId: 'Q' }, { sourceIds: [] }]) {
    refuse(run('root', 'O03', { resourceId: 's-doc', version: 1, patch }));
  }
  allow(run('root', 'O03', { resourceId: 's-doc', version: 1, patch: { label: 'corrected' } }));
  refuse(run('root', 'O03', { resourceId: 's-doc', version: 1, patch: { label: 'stale' } }));
  const next = allow(run('root', 'O04', { resourceId: 's-doc', version: 2, content: 'NEW', title: 'v2' }));
  const rows = h.snapshot().resources;
  assert.equal(rows.find((x) => x.id === 's-doc').original, 'abcdefghij');
  assert.equal(rows.find((x) => x.id === next.resourceId).previousId, 's-doc');
});

test('O05: document deletion is local and does not remove account, folder, or another document', () => {
  const { run, h } = setup(); allow(run('root', 'O05', { resourceId: 's-doc' }));
  refuse(run('root', 'O01', { resourceId: 's-doc' }));
  assert.equal(h.snapshot().members.find((x) => x.id === 'root').active, true);
  assert.equal(h.snapshot().folders.find((x) => x.id === 'S').state, 'active');
  allow(run('holder', 'O01', { resourceId: 'p-doc' }));
});

test('O06: sharing requires the actual mandate, scope and transmissible capability', () => {
  const { direct, run } = setup();
  const share = direct('reader', 'partager', { transmit: ['consulter'], expiresAt: 50 });
  allow(run('reader', 'O06', { folderId: 'S', authorityId: share, subject: 'guest', capability: 'consulter', expiresAt: 50 }));
  allow(run('guest', 'O01', { resourceId: 's-doc' }));
  for (const capability of ['supprimer', 'partager', 'administrer', 'not-a-capability']) {
    refuse(run('reader', 'O06', { folderId: 'S', authorityId: share, subject: 'child', capability, expiresAt: 50 }));
  }
  refuse(run('reader', 'O06', { folderId: 'Q', authorityId: share, subject: 'child', capability: 'consulter', expiresAt: 50 }));
  refuse(run('guest', 'O06', { folderId: 'S', authorityId: share, subject: 'child', capability: 'consulter', expiresAt: 50 }));
});

test('O06/O08: a capability alone never grants power to transmit it', () => {
  const { direct, run } = setup(); const read = direct('reader', 'consulter');
  for (const operation of ['O06', 'O08']) refuse(run('reader', operation, {
    folderId: 'S', authorityId: read, subject: 'guest', capability: 'consulter',
  }));
});

test('C_DELEGATED_GRANTS_LIFECYCLE: deadlines include exact expiry and cannot exceed parent', () => {
  const { direct, run, tick } = setup();
  const share = direct('reader', 'partager', { transmit: ['consulter'], expiresAt: 50 });
  for (const expiresAt of [0, 10, 51, null, -1, Number.NaN]) {
    refuse(run('reader', 'O06', { folderId: 'S', authorityId: share, subject: 'guest', capability: 'consulter', expiresAt }));
  }
  allow(run('reader', 'O06', { folderId: 'S', authorityId: share, subject: 'guest', capability: 'consulter', expiresAt: 50 }));
  tick(49); allow(run('guest', 'O01', { resourceId: 's-doc' }));
  tick(50); refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  tick(51); refuse(run('guest', 'O01', { resourceId: 's-doc' }));
});

test('O09/O10: reference can retire its mandate; delegate cannot retire reference or a peer', () => {
  const { run, delegate } = setup(); const g = delegate(); const peer = delegate('peer');
  for (const grantId of ['root-S-administrer', peer]) {
    refuse(run('delegate', 'O09', { folderId: 'S', action: 'revoke', grantId }));
    refuse(run('delegate', 'O10', { folderId: 'S', authorityId: g, grantId }));
  }
  refuse(run('delegate', 'O09', { folderId: 'S', action: 'create', subject: 'child', transmit: ['consulter'] }));
  allow(run('root', 'O09', { folderId: 'S', action: 'revoke', grantId: g }));
  refuse(run('delegate', 'O08', { folderId: 'S', authorityId: g, subject: 'child', capability: 'consulter', expiresAt: 80 }));
});

test('O08: local administration without read neither reads nor self-extends through an intermediary', () => {
  const { run, delegate, direct } = setup(); const mandate = delegate();
  refuse(run('delegate', 'O01', { resourceId: 's-doc' }));
  refuse(run('delegate', 'O08', { folderId: 'S', authorityId: mandate, subject: 'delegate', capability: 'consulter', expiresAt: 90 }));
  const bridge = allow(run('delegate', 'O08', { folderId: 'S', authorityId: mandate, subject: 'child', capability: 'partager', transmit: ['consulter'], expiresAt: 90 })).grantId;
  refuse(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'delegate', capability: 'consulter', expiresAt: 80 }));
  allow(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'guest', capability: 'consulter', expiresAt: 80 }));
  allow(run('guest', 'O01', { resourceId: 's-doc' }));
  direct('delegate', 'consulter'); // Genuinely separate reference act.
  allow(run('delegate', 'O01', { resourceId: 's-doc' }));
});

test('O10: withdrawing one attribution preserves an independently granted right and documents', () => {
  const { run, direct, delegate, h } = setup(); const mandate = delegate();
  const independent = direct('guest', 'consulter');
  allow(run('delegate', 'O08', { folderId: 'S', authorityId: mandate, subject: 'guest', capability: 'consulter', expiresAt: 80 }));
  allow(run('root', 'O10', { folderId: 'S', grantId: mandate }));
  allow(run('guest', 'O01', { resourceId: 's-doc' }));
  allow(run('root', 'O10', { folderId: 'S', authorityId: 'root-S-administrer', grantId: independent }));
  refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  assert.equal(h.snapshot().resources.find((x) => x.id === 's-doc').deleted, undefined);
});

test('O09 reduction: only removed powers cease, including nested sharing; lifetime clips at new limit', () => {
  const { run, delegate, tick } = setup(); const mandate = delegate();
  const bridge = allow(run('delegate', 'O08', { folderId: 'S', authorityId: mandate, subject: 'child', capability: 'partager', transmit: ['consulter', 'exporter'], expiresAt: 90 })).grantId;
  const read = allow(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'guest', capability: 'consulter', expiresAt: 90 })).grantId;
  allow(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'guest', capability: 'exporter', expiresAt: 90 }));
  allow(run('root', 'O09', { folderId: 'S', action: 'reduce', grantId: mandate, transmit: ['partager', 'exporter'], expiresAt: 40 }));
  refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  refuse(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'peer', capability: 'consulter', expiresAt: 40 }));
  allow(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'peer', capability: 'exporter', expiresAt: 40 }));
  refuse(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'reader', capability: 'exporter', expiresAt: 41 }));
  refuse(run('root', 'O09', { folderId: 'S', action: 'reduce', grantId: mandate, transmit: ['consulter', 'partager', 'exporter'] }));
  allow(run('root', 'O10', { folderId: 'S', authorityId: 'root-S-administrer', grantId: read }));
  tick(40);
  refuse(run('child', 'O06', { folderId: 'S', authorityId: bridge, subject: 'reader', capability: 'exporter', expiresAt: 40 }));
});

test('C_PERSONAL_HOLDER_PROTECTION: delegate cannot evict holder through grant removal or replacement', () => {
  const { run } = setup();
  const g = allow(run('holder', 'O09', { folderId: 'P', action: 'create', subject: 'delegate', transmit: ['consulter', 'supprimer'] })).grantId;
  for (const grantId of ['holder-P-consulter', 'holder-P-administrer']) refuse(run('delegate', 'O10', { folderId: 'P', authorityId: g, grantId }));
  refuse(run('delegate', 'O08', { folderId: 'P', authorityId: g, subject: 'guest', capability: 'administrer' }));
  allow(run('holder', 'O01', { resourceId: 'p-doc' }));
  allow(run('holder', 'O09', { folderId: 'P', action: 'revoke', grantId: g }));
});

test('invalid fixture provenance: missing parents, cycles, cross-folder and unknown capabilities fail closed', () => {
  for (const mode of ['missing', 'cycle', 'cross-folder', 'unknown-capability']) {
    const initial = fixture();
    initial.grants.push({ id: 'bad-read', subject: 'guest', folderId: 'S', capability: 'consulter', kind: 'delegated', parent: 'bad-parent' });
    if (mode !== 'missing') initial.grants.push({ id: 'bad-parent', subject: 'reader', folderId: mode === 'cross-folder' ? 'Q' : 'S',
      capability: mode === 'unknown-capability' ? 'god-mode' : 'partager', kind: mode === 'cycle' ? 'delegated' : 'direct',
      parent: mode === 'cycle' ? 'bad-parent' : null, transmit: ['consulter', 'partager'] });
    const { run } = setup(initial); refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  }
});

test('C_MEMBER_DEPARTURE_ACCESS: departing mandate holder cascades, new session cannot resurrect it', () => {
  const { run, delegate, h } = setup(); const g = delegate();
  allow(run('delegate', 'O08', { folderId: 'S', authorityId: g, subject: 'guest', capability: 'consulter', expiresAt: 80 }));
  h.controls.setActive('delegate', false);
  refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  h.controls.setActive('delegate', true);
  refuse(run('delegate', 'O08', { folderId: 'S', authorityId: g, subject: 'reader', capability: 'consulter', expiresAt: 80 }));
  refuse(h.execute(h.sessionFor('delegate'), { operation: 'O08', folderId: 'S', authorityId: g,
    subject: 'reader', capability: 'consulter', expiresAt: 80 }));
  refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  const replacement = delegate();
  assert.notEqual(replacement, g);
  refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  allow(h.execute(h.sessionFor('delegate'), { operation: 'O08', folderId: 'S', authorityId: replacement,
    subject: 'reader', capability: 'consulter', expiresAt: 80 }));
  allow(run('reader', 'O01', { resourceId: 's-doc' }));
});

test('document commands after capability withdrawal refuse without partial effects or receipt replay', () => {
  const cases = [
    ['O02', ['déposer'], { folderId: 'S', requestId: 'saved-receipt', title: 'x', content: 'x' }],
    ['O03', ['consulter', 'modifier'], { resourceId: 's-doc', version: 1, patch: { label: 'new' } }],
    ['O04', ['consulter', 'modifier', 'déposer'], { resourceId: 's-doc', version: 1, title: 'v2', content: 'v2' }],
    ['O05', ['consulter', 'supprimer'], { resourceId: 's-doc' }],
  ];
  for (const [operation, required, command] of cases) {
    for (const withdrawn of required) {
      const { direct, run, h } = setup();
      const ids = Object.fromEntries(required.map((c) => [c, direct('guest', c)]));
      if (operation === 'O02') allow(run('guest', operation, command));
      allow(run('root', 'O10', { folderId: 'S', authorityId: 'root-S-administrer', grantId: ids[withdrawn] }));
      const before = h.snapshot();
      refuse(run('guest', operation, command));
      assert.deepEqual(h.snapshot(), before);
    }
  }
});

test('reference role and contributor departure do not cascade based on author alone', () => {
  const { direct, run, h } = setup(); direct('reader', 'consulter');
  h.controls.setRole('root', 'owner');
  h.controls.setRole('root', 'member');
  allow(run('reader', 'O01', { resourceId: 's-doc' }));
  h.controls.setActive('root', false);
  allow(run('reader', 'O01', { resourceId: 's-doc' }));
});

test('snapshot-only succession: no reader after cascade is ineligible; direct reader becomes reference without content powers', () => {
  const { direct, run, delegate, h, sessions } = setup(); const g = delegate();
  allow(run('delegate', 'O08', { folderId: 'S', authorityId: g, subject: 'guest', capability: 'consulter', expiresAt: 80 }));
  direct('reader', 'consulter');
  h.controls.setActive('delegate', false); h.controls.setActive('root', false);
  refuse(h.controls.succeed(sessions.admin, 'S', 'guest'));
  allow(h.controls.succeed(sessions.admin, 'S', 'reader'));
  allow(run('reader', 'O01', { resourceId: 's-doc' }));
  refuse(run('reader', 'O05', { resourceId: 's-doc' }));
  refuse(run('admin', 'O01', { resourceId: 's-doc' }));
  refuse(h.controls.succeed(sessions.admin, 'S', 'child'));
  refuse(h.controls.succeed(sessions.admin, 'P', 'holder'));
});

test('C_ADMIN_MINIMAL_METADATA: administrative projection is closed even when actor separately can read', () => {
  const { h, sessions, run } = setup();
  const expected = { allowed: true, member: 'holder', volume: 8, quota: 1000, state: 'active' };
  assert.deepEqual(h.controls.adminProjection(sessions.admin, 'P'), expected);
  refuse(run('admin', 'O01', { resourceId: 'p-doc' }));
  h.controls.setRole('holder', 'admin');
  assert.deepEqual(h.controls.adminProjection(sessions.holder, 'P'), expected);
  refuse(h.controls.adminProjection(sessions.guest, 'P'));
});

test('deleted/restored fixture state never restores a revoked attribution', () => {
  const { direct, run, h } = setup(); const read = direct('reader', 'consulter');
  h.controls.setFolderState('S', 'deleted');
  refuse(run('reader', 'O01', { resourceId: 's-doc' }));
  h.controls.setFolderState('S', 'active');
  allow(run('root', 'O10', { folderId: 'S', authorityId: 'root-S-administrer', grantId: read }));
  h.controls.setFolderState('S', 'deleted'); h.controls.setFolderState('S', 'active');
  refuse(run('reader', 'O01', { resourceId: 's-doc' }));
});

test('MULTI_SOURCE_DERIVATIVE: one forbidden source denies complete composite and export', () => {
  const { direct, run, h } = setup(); direct('reader', 'consulter'); direct('reader', 'exporter');
  for (const operation of ['O01', 'O07']) refuse(run('reader', operation, { resourceId: 'mixed' }));
  const q = allow(run('other', 'O08', { folderId: 'Q', authorityId: 'other-Q-administrer', subject: 'reader', capability: 'consulter' })).grantId;
  allow(run('reader', 'O01', { resourceId: 'mixed' }));
  refuse(run('reader', 'O07', { resourceId: 'mixed' }));
  allow(run('other', 'O10', { folderId: 'Q', authorityId: 'other-Q-administrer', grantId: q }));
  refuse(run('reader', 'O01', { resourceId: 'mixed' }));
  const broken = fixture(); broken.resources.find((x) => x.id === 'mixed').sourceIds = ['mixed'];
  refuse(setup(broken).run('root', 'O01', { resourceId: 'mixed' }));
  assert.equal(h.snapshot().resources.find((x) => x.id === 'mixed').content, 'COMBINED-PRIVATE-Q');
});

test('POST_REVOKE_DERIVED_RESULT: each bounded portion is checked; already yielded bytes remain outside recall', () => {
  const { direct, run, h, sessions } = setup(); const read = direct('reader', 'consulter'); direct('reader', 'exporter');
  const stream = h.stream(sessions.reader, { resourceId: 's-doc', chunkBytes: 3 });
  const first = stream.next().value; allow(first); assert.equal(new TextDecoder().decode(first.bytes), 'abc');
  allow(run('root', 'O10', { folderId: 'S', authorityId: 'root-S-administrer', grantId: read }));
  refuse(stream.next().value); assert.equal(stream.next().done, true);
  assert.equal(new TextDecoder().decode(first.bytes), 'abc');
  refuse(h.stream(sessions.reader, { resourceId: 's-doc' }).next().value);
  refuse(h.stream(sessions.root, { resourceId: 's-doc', chunkBytes: POLICY_LIMITS.maxChunkBytes + 1 }).next().value);
});

test('bounded return positive corpus: exact bytes survive chunking, expiration and session retirement stop new portions', () => {
  const initial = fixture(); initial.resources.find((r) => r.id === 's-doc').content = 'Aé🙂Z';
  const { direct, h, sessions, tick } = setup(initial);
  direct('reader', 'consulter', { expiresAt: 20 }); direct('reader', 'exporter', { expiresAt: 20 });
  const expected = new TextEncoder().encode('Aé🙂Z');
  for (const chunkBytes of [1, 3, POLICY_LIMITS.maxChunkBytes]) {
    const chunks = [...h.stream(sessions.reader, { resourceId: 's-doc', chunkBytes })];
    for (const chunk of chunks) { allow(chunk); assert.ok(chunk.bytes.length <= chunkBytes); }
    assert.deepEqual(Uint8Array.from(chunks.flatMap((c) => [...c.bytes])), expected);
  }
  const expiring = h.stream(sessions.reader, { resourceId: 's-doc', chunkBytes: 1 });
  allow(expiring.next().value); tick(20); refuse(expiring.next().value); assert.equal(expiring.next().done, true);
  const fresh = setup(initial); fresh.direct('reader', 'consulter'); fresh.direct('reader', 'exporter');
  const retiring = fresh.h.stream(fresh.sessions.reader, { resourceId: 's-doc', chunkBytes: 1 });
  allow(retiring.next().value); fresh.h.controls.setActive('reader', false);
  refuse(retiring.next().value); assert.equal(retiring.next().done, true);
});

test('ordered model interleavings: grant/revoke effects cannot survive the parent withdrawal', () => {
  for (const revokeFirst of [false, true]) {
    const { run, delegate } = setup(); const g = delegate();
    if (revokeFirst) allow(run('root', 'O09', { folderId: 'S', action: 'revoke', grantId: g }));
    const issued = run('delegate', 'O08', { folderId: 'S', authorityId: g, subject: 'guest', capability: 'consulter', expiresAt: 80 });
    if (revokeFirst) refuse(issued); else {
      allow(issued); allow(run('root', 'O09', { folderId: 'S', action: 'revoke', grantId: g }));
    }
    refuse(run('guest', 'O01', { resourceId: 's-doc' }));
  }
});
