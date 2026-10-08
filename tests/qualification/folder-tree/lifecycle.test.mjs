import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, preview, execute, nameKey, readable, trashReadable, chargedBytes, expire,
  confirmPhysicalDeletion, snapshot, restoreSnapshot, RETENTION_MS } from './lifecycle-model.mjs';

const folder = (id, parentId, name = id, rootNamespace = 'alice') => ({ id, parentId, name, rootNamespace, type: 'folder', management: `reference-${id}` });
const document = (id, parentId) => ({ id, parentId, name: `Synthetic ${id}`, type: 'document', provenance: 'synthetic-import' });
function fixture() {
  return createState([folder('A', null), folder('B', 'A'), folder('C', 'B'), folder('Z', null),
    document('DA', 'A'), document('DB', 'B'), document('DC', 'C')],
  ['DA', 'DB', 'DC'].map((id, i) => ({ documentId: id, owner: 'alice', size: 10 + i, objectKey: `synthetic/${id}`, sha256: `${i}`.repeat(64) })),
  { grants: [{ id: 'grant-1', parent: null, epoch: 3, expiresAt: 999999999 }], restrictions: [], revision: 0 });
}
// Synthetic predicate deliberately separate from actual Hestia authorization.
const authority = { authorize: () => true, stamp: ({ before }) => before.policy };
function perform(state, request, now = 0, key = JSON.stringify(request), auth = authority) {
  return execute(state, 'alice', request, now, auth, preview(state, 'alice', request, now, auth), key);
}
function unchangedOnFailure(state, action, pattern) {
  const before = snapshot(state); assert.throws(action, pattern); assert.equal(snapshot(state), before);
}

test('TREE: multilevel creation and rename preserve authority and originals', () => {
  let state = fixture(); const policy = snapshot(state.policy), objects = snapshot(state.objects);
  state = perform(state, { action: 'create', id: 'D', parentId: 'C', name: ' New ' }).state;
  state = perform(state, { action: 'rename', id: 'D', name: 'Renamed' }).state;
  assert.equal(state.nodes.D.name, 'Renamed'); assert.equal(state.nodes.D.parentId, 'C');
  assert.equal(snapshot(state.policy), policy); assert.equal(snapshot(state.objects), objects);
});

test('NAMES: Unicode NFC, case, edge whitespace; accents remain distinct', () => {
  assert.equal(nameKey(' E\u0301TE\u0301 '), nameKey('Été'));
  assert.notEqual(nameKey('Eté'), nameKey('Été'));
  let state = perform(fixture(), { action: 'create', id: 'E', parentId: 'A', name: 'Été' }).state;
  unchangedOnFailure(state, () => perform(state, { action: 'create', id: 'F', parentId: 'A', name: ' E\u0301TE\u0301 ' }), /NAME_CONFLICT/);
  state = perform(state, { action: 'create', id: 'F', parentId: 'Z', name: 'Été' }).state;
  assert.equal(state.nodes.F.name, state.nodes.E.name);
});

test('NAMES: root namespaces separate members without global collision probe', () => {
  const state = createState([folder('A', null, 'Archives', 'alice'), folder('B', null, 'Archives', 'bob')]);
  assert.equal(Object.keys(state.nodes).length, 2);
  unchangedOnFailure(state, () => perform(state, { action: 'create', id: 'C', parentId: null, name: 'Archives' }), /NAME_CONFLICT/);
  assert.equal(perform(state, { action: 'create', id: 'C', parentId: null, name: 'Autres' }).state.nodes.C.rootNamespace, 'alice');
});

test('MIGRATION: legacy same-scope duplicates preserved, touching duplicate needs free name', () => {
  const state = createState([folder('A', null, 'Archives'), folder('B', null, 'Archives')]);
  assert.equal(state.nodes.A.name, state.nodes.B.name);
  unchangedOnFailure(state, () => perform(state, { action: 'rename', id: 'A', name: 'Archives' }), /NAME_CONFLICT/);
  assert.equal(perform(state, { action: 'rename', id: 'A', name: 'Archives 2' }).state.nodes.A.name, 'Archives 2');
});

test('MOVE: cycle, self, document virtual root and wrong destination rejected atomically', () => {
  const state = fixture();
  for (const request of [{ action: 'move', id: 'A', parentId: 'C' }, { action: 'move', id: 'A', parentId: 'A' }])
    unchangedOnFailure(state, () => perform(state, request), /CYCLE/);
  unchangedOnFailure(state, () => perform(state, { action: 'move', id: 'DA', parentId: null }), /DOCUMENT_NEEDS_FOLDER/);
  unchangedOnFailure(state, () => perform(state, { action: 'move', id: 'B', parentId: 'DA' }), /INVALID_PARENT/);
});

test('MOVE: subtree and document identity, provenance, objects, quota and management conserved', () => {
  const before = fixture(); const moved = perform(before, { action: 'move', id: 'B', parentId: 'Z' }).state;
  assert.equal(moved.nodes.B.parentId, 'Z'); assert.equal(moved.nodes.C.parentId, 'B');
  assert.equal(moved.nodes.B.management, before.nodes.B.management); assert.deepEqual(moved.objects, before.objects);
  const next = perform(moved, { action: 'move', id: 'DA', parentId: 'B' }).state;
  assert.equal(next.nodes.DA.id, before.nodes.DA.id); assert.equal(next.nodes.DA.provenance, before.nodes.DA.provenance);
  assert.equal(chargedBytes(next, 'alice'), 33);
});

test('MOVE: root without surviving management is rejected by current authority', () => {
  const state = fixture(), request = { action: 'move', id: 'B', parentId: null };
  const denyRoot = { ...authority, authorize: ({ request: operation }) => operation.parentId !== null };
  unchangedOnFailure(state, () => perform(state, request, 0, 'root-denied', denyRoot), /UNAVAILABLE/);
  assert.equal(perform(state, request).state.nodes.B.parentId, null);
});

test('MOVE: complete scope reaches authority including already trashed descendants', () => {
  let state = perform(fixture(), { action: 'trash', id: 'C' }, 10).state;
  const oldGroup = state.nodes.C.groupId; const beforeGroup = snapshot(state.groups[oldGroup]);
  const denyDescendant = { ...authority, authorize: ({ affected }) => !affected.includes('DC') };
  unchangedOnFailure(state, () => perform(state, { action: 'move', id: 'B', parentId: 'Z' }, 20, 'denied', denyDescendant), /UNAVAILABLE/);
  state = perform(state, { action: 'move', id: 'B', parentId: 'Z' }, 20).state;
  assert.equal(snapshot(state.groups[oldGroup]), beforeGroup); assert.equal(state.nodes.C.parentId, 'B');
});

test('PREVIEW: tree change, policy revision and changed request invalidate confirmation', () => {
  const state = fixture(), request = { action: 'move', id: 'B', parentId: 'Z' };
  const confirmation = preview(state, 'alice', request, 0, authority);
  const renamed = perform(state, { action: 'rename', id: 'C', name: 'Changed' }).state;
  unchangedOnFailure(renamed, () => execute(renamed, 'alice', request, 1, authority, confirmation, 'move'), /STALE_PREVIEW/);
  const revoked = structuredClone(state); revoked.policy.revision++;
  unchangedOnFailure(revoked, () => execute(revoked, 'alice', request, 1, authority, confirmation, 'move'), /STALE_PREVIEW/);
  unchangedOnFailure(state, () => execute(state, 'alice', { ...request, parentId: null }, 1, authority, confirmation, 'move'), /STALE_PREVIEW/);
});

test('PREVIEW: current expiry stamp changes even with identical stored state; current refusal leaves no effect', () => {
  const state = fixture(), request = { action: 'move', id: 'B', parentId: 'Z' };
  const timed = { authorize: () => true, stamp: ({ now }) => ({ readerActive: now < 100 }) };
  const confirmation = preview(state, 'alice', request, 99, timed);
  unchangedOnFailure(state, () => execute(state, 'alice', request, 100, timed, confirmation, 'move'), /STALE_PREVIEW/);
  unchangedOnFailure(state, () => execute(state, 'alice', request, 100, { ...timed, authorize: () => false }, confirmation, 'move'), /UNAVAILABLE/);
});

test('TRASH: one denied descendant rejects entire group; no authorization defaults', () => {
  const state = fixture(), request = { action: 'trash', id: 'A' };
  const auth = { ...authority, authorize: ({ affected }) => !affected.includes('DC') };
  unchangedOnFailure(state, () => perform(state, request, 0, 'trash', auth), /UNAVAILABLE/);
  unchangedOnFailure(state, () => preview(state, 'alice', request, 0, {}), /INVALID_CONTEXT/);
});

test('TRASH: exact group excludes previously trashed subtree and individual document', () => {
  let state = perform(fixture(), { action: 'trash', id: 'C' }, 10).state;
  state = perform(state, { action: 'trash', id: 'DA' }, 20).state;
  const cGroup = state.nodes.C.groupId, daGroup = state.nodes.DA.groupId;
  const savedGroups = [snapshot(state.groups[cGroup]), snapshot(state.groups[daGroup])];
  const result = perform(state, { action: 'trash', id: 'A' }, 30);
  state = result.state;
  assert.deepEqual(state.groups[result.result.groupId].members, ['A', 'B', 'DB']);
  assert.deepEqual([snapshot(state.groups[cGroup]), snapshot(state.groups[daGroup])], savedGroups);
  assert.equal(chargedBytes(state), 33); assert.equal(readable(state, 'DC', 31), false);
});

test('RESTORE: restores exact group only and preserves current revoked rights', () => {
  let state = perform(fixture(), { action: 'trash', id: 'C' }, 10).state;
  const childGroup = state.nodes.C.groupId;
  const deleted = perform(state, { action: 'trash', id: 'A' }, 20); state = deleted.state;
  state.policy.grants[0].revoked = true; state.policy.revision++;
  const restored = perform(state, { action: 'restore', groupId: deleted.result.groupId }, 30).state;
  assert.deepEqual(['A', 'B', 'DB'].map(id => restored.nodes[id].status), ['active', 'active', 'active']);
  assert.equal(restored.nodes.C.status, 'trashed'); assert.equal(restored.nodes.C.groupId, childGroup);
  assert.equal(restored.policy.grants[0].revoked, true); assert.equal(restored.policy.revision, 1);
});

test('RESTORE: hidden/trashed parent requires alternate destination; every group member checked', () => {
  let result = perform(fixture(), { action: 'trash', id: 'B' }, 10), state = result.state, childGroup = result.result.groupId;
  state = perform(state, { action: 'trash', id: 'A' }, 20).state;
  unchangedOnFailure(state, () => perform(state, { action: 'restore', groupId: childGroup }, 30), /UNAVAILABLE/);
  const request = { action: 'restore', groupId: childGroup, parentId: 'Z' };
  const denied = { ...authority, authorize: ({ affected }) => !affected.includes('DC') };
  unchangedOnFailure(state, () => perform(state, request, 30, 'denied', denied), /UNAVAILABLE/);
  const next = perform(state, request, 30).state;
  assert.equal(next.nodes.B.parentId, 'Z'); assert.equal(next.nodes.DC.status, 'active'); assert.equal(next.nodes.A.status, 'trashed');
});

test('RESTORE: collision refuses entire group, explicit name correction succeeds', () => {
  let result = perform(fixture(), { action: 'trash', id: 'B' }, 10), state = result.state;
  state = perform(state, { action: 'create', id: 'X', parentId: 'A', name: 'B' }, 20).state;
  unchangedOnFailure(state, () => perform(state, { action: 'restore', groupId: result.result.groupId }, 30), /NAME_CONFLICT/);
  state = perform(state, { action: 'restore', groupId: result.result.groupId, name: 'B restored' }, 30).state;
  assert.equal(state.nodes.B.name, 'B restored'); assert.equal(state.nodes.X.name, 'B');
});

test('RESTORE: alternate destination authorizes older recoverable groups without restoring them', () => {
  let state = perform(fixture(), { action: 'trash', id: 'C' }, 10).state;
  const oldGroupId = state.nodes.C.groupId;
  const savedOldGroup = snapshot(state.groups[oldGroupId]);
  const savedOldNodes = snapshot([state.nodes.C, state.nodes.DC]);
  const deleted = perform(state, { action: 'trash', id: 'B' }, 20); state = deleted.state;
  const request = { action: 'restore', groupId: deleted.result.groupId, parentId: 'Z' };
  const denyOldDocument = { ...authority, authorize: ({ affected }) => !affected.includes('DC') };
  unchangedOnFailure(state, () => perform(state, request, 30, 'restore-denied', denyOldDocument), /UNAVAILABLE/);
  const contexts = [];
  const capturing = { ...authority, authorize: context => { contexts.push(context); return true; } };
  const restored = perform(state, request, 30, 'restore-allowed', capturing).state;
  for (const context of contexts) {
    assert.deepEqual(context.affected, ['B', 'C', 'DB', 'DC']);
    assert.deepEqual(context.restoredMembers, ['B', 'DB']);
  }
  assert.equal(restored.nodes.B.parentId, 'Z'); assert.equal(restored.nodes.DB.status, 'active');
  assert.equal(snapshot(restored.groups[oldGroupId]), savedOldGroup);
  assert.equal(snapshot([restored.nodes.C, restored.nodes.DC]), savedOldNodes);
  assert.equal(trashReadable(restored, 'DC', 30), true);
  assert.equal(readable(restored, 'DC', 30), false);
});

test('RESTORE: expired older group leaves policy scope at deadline without changing retained structure', () => {
  let state = perform(fixture(), { action: 'trash', id: 'C' }, 10).state;
  const deleted = perform(state, { action: 'trash', id: 'B' }, 100); state = deleted.state;
  const request = { action: 'restore', groupId: deleted.result.groupId, parentId: 'Z' };
  const confirmation = preview(state, 'alice', request, 10 + RETENTION_MS - 1, authority);
  assert.deepEqual(confirmation.affected, ['B', 'C', 'DB', 'DC']);
  unchangedOnFailure(state, () => execute(state, 'alice', request, 10 + RETENTION_MS, authority, confirmation, 'restore'), /STALE_PREVIEW/);
  const current = preview(state, 'alice', request, 10 + RETENTION_MS, authority);
  assert.deepEqual(current.affected, ['B', 'DB']);
  const restored = execute(state, 'alice', request, 10 + RETENTION_MS, authority, current, 'restore').state;
  assert.deepEqual(restored.nodes.C, state.nodes.C); assert.deepEqual(restored.nodes.DC, state.nodes.DC);
  assert.equal(trashReadable(restored, 'DC', 10 + RETENTION_MS), false);
});

test('RETENTION: 168 hours minus 1ms accepted; exact deadline refused before purge', () => {
  const result = perform(fixture(), { action: 'trash', id: 'B' }, 10), state = result.state;
  const request = { action: 'restore', groupId: result.result.groupId };
  assert.equal(trashReadable(state, 'DB', 10 + RETENTION_MS - 1), true);
  assert.equal(perform(state, request, 10 + RETENTION_MS - 1).state.nodes.DB.status, 'active');
  assert.equal(trashReadable(state, 'DB', 10 + RETENTION_MS), false);
  unchangedOnFailure(state, () => perform(state, request, 10 + RETENTION_MS), /UNAVAILABLE/);
  assert.equal(chargedBytes(state), 33);
});

test('TOMBSTONES: expired earlier child kept opaque, newer parent restores without child', () => {
  let result = perform(fixture(), { action: 'trash', id: 'C' }, 10), state = result.state;
  result = perform(state, { action: 'trash', id: 'A' }, 100); state = result.state;
  state = expire(state, 10 + RETENTION_MS);
  assert.deepEqual(Object.keys(state.nodes.C).sort(), ['groupId', 'id', 'parentId', 'status', 'type']);
  assert.equal(state.nodes.C.parentId, 'B'); assert.equal(state.nodes.C.status, 'tombstone');
  assert.equal(trashReadable(state, 'C', 10 + RETENTION_MS), false);
  const restored = perform(state, { action: 'restore', groupId: result.result.groupId }, 10 + RETENTION_MS).state;
  assert.equal(restored.nodes.A.status, 'active'); assert.equal(restored.nodes.B.status, 'active');
  assert.equal(restored.nodes.C.status, 'tombstone'); assert.equal(chargedBytes(restored), 33);
});

test('PURGE: failed/unconfirmed physical deletion retains quota; successful receipt replay is inert', () => {
  const deleted = perform(fixture(), { action: 'trash', id: 'B' }, 0).state;
  const expired = expire(deleted, RETENTION_MS);
  assert.equal(chargedBytes(expired), 33); assert.deepEqual(expire(expired, RETENTION_MS + 1), expired);
  const purged = confirmPhysicalDeletion(expired, 'DB');
  assert.equal(chargedBytes(purged), 22); assert.equal(chargedBytes(purged, 'alice'), 22);
  assert.deepEqual(confirmPhysicalDeletion(purged, 'DB'), purged);
  assert.equal(purged.nodes.DB.status, 'tombstone');
  unchangedOnFailure(expired, () => confirmPhysicalDeletion(expired, 'DA'), /NOT_EXPIRED/);
});

test('RECOVERY: exact replay after lost response does not move again; altered payload conflicts', () => {
  const request = { action: 'move', id: 'B', parentId: 'Z' }, result = perform(fixture(), request, 0, 'move-1');
  const state = perform(result.state, { action: 'move', id: 'B', parentId: 'A' }, 1, 'move-2').state;
  const replay = execute(state, 'alice', request, 2, authority, null, 'move-1');
  assert.equal(replay.state, state); assert.equal(replay.state.nodes.B.parentId, 'A');
  assert.deepEqual(replay.result, { committed: true, replayed: true });
  unchangedOnFailure(state, () => execute(state, 'alice', { ...request, parentId: null }, 2, authority, null, 'move-1'), /IDEMPOTENCY_CONFLICT/);
});

test('RECOVERY: historical restore replay never resurrects a later expired group', () => {
  let result = perform(fixture(), { action: 'trash', id: 'B' }, 0, 'trash-1');
  const request = { action: 'restore', groupId: result.result.groupId };
  let state = perform(result.state, request, 1, 'restore-1').state;
  state = perform(state, { action: 'trash', id: 'B' }, 2, 'trash-2').state;
  state = expire(state, RETENTION_MS + 2);
  const replay = execute(state, 'alice', request, RETENTION_MS + 3, authority, null, 'restore-1');
  assert.equal(replay.state.nodes.B.status, 'tombstone'); assert.equal(replay.state, state);
});

test('SNAPSHOT: synthetic roundtrip preserves groups, graph, exceptions, dependencies, receipts and originals', () => {
  let result = perform(fixture(), { action: 'trash', id: 'C' }, 10), state = result.state;
  state.policy.grants.push({ id: 'dependent', parent: 'grant-1', epoch: 3, expiresAt: 999 });
  state.policy.restrictions.push({ folder: 'B', member: 'bob', capability: 'consulter' });
  const archived = snapshot(state), restored = restoreSnapshot(archived);
  assert.deepEqual(restored, state); assert.equal(snapshot(restored), archived); assert.equal(chargedBytes(restored), 33);
  const next = perform(restored, { action: 'restore', groupId: result.result.groupId }, 20).state;
  assert.equal(next.nodes.C.status, 'active'); assert.deepEqual(next.objects, fixture().objects);
});

test('SNAPSHOT: broken parent/cycle rejected; no depth ceiling claimed from small fixtures', () => {
  const bad = fixture(); bad.nodes.A.parentId = 'C';
  assert.throws(() => restoreSnapshot(snapshot(bad)), /CYCLE/);
  const chain = Array.from({ length: 128 }, (_, i) => folder(`F${i}`, i ? `F${i - 1}` : null));
  const state = createState(chain);
  assert.equal(perform(state, { action: 'trash', id: 'F0' }).state.groups['group:1:F0'].members.length, 128);
});
