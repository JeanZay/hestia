import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, evaluate, issueGrant, changeRestriction, createChild, managementFrame,
  placementHypothesis, visibleEntry, policyFingerprint, checkedIssue, transmitManagement, attestedReference } from './rights-model.mjs';

const NOW = 1000;
function grant(id, folderId, userId, cap, extra = {}) {
  return { id, folderId, userId, cap, kind: 'direct', parentId: null, transmit: [],
    lineage: [], authorId: 'alice', subjectEpoch: 0, expiresAt: null, revoked: false, origin: 'initial', ...extra };
}
function fixture() {
  return {
    members: ['alice', 'bob', 'carol', 'dave', 'globalAdmin'].map(id => ({ id, active: true, epoch: 0, role: id === 'globalAdmin' ? 'admin' : 'member' })),
    folders: [
      { id: 'private', name: 'Hidden ancestor', parentId: null, createdBy: 'alice', governance: { mode: 'own', referenceId: 'ref', anchorFolderId: 'private' } },
      { id: 'child', name: 'Shared child', parentId: 'private', createdBy: 'alice', governance: { mode: 'inherited', referenceId: 'ref', anchorFolderId: 'private' } },
      { id: 'leaf', name: 'Leaf', parentId: 'child', createdBy: 'alice', governance: { mode: 'inherited', referenceId: 'ref', anchorFolderId: 'private' } },
      { id: 'sibling', name: 'Hidden sibling', parentId: 'private', createdBy: 'alice', governance: { mode: 'inherited', referenceId: 'ref', anchorFolderId: 'private' } },
      { id: 'other', name: 'Other branch', parentId: null, createdBy: 'carol', governance: { mode: 'own', referenceId: 'other-ref', anchorFolderId: 'other' } },
    ],
    grants: [grant('ref', 'private', 'alice', 'administrer', { kind: 'reference', transmit: CAPS }),
      ...CAPS.filter(c => c !== 'administrer').map(c => grant(`a-${c}`, 'private', 'alice', c)),
      grant('other-ref', 'other', 'carol', 'administrer', { kind: 'reference', transmit: CAPS, authorId: 'carol' })],
    restrictions: [],
  };
}
const has = (s, folder, user, cap, now = NOW) => evaluate(s, folder, user, now).capabilities.includes(cap);
const unavailable = fn => assert.throws(fn, /^Error: UNAVAILABLE$/);

test('R01: live ancestor grant updates, expiration and revocation reach descendants', () => {
  const s = fixture(); s.grants.push(grant('reader', 'private', 'bob', 'consulter', { expiresAt: 2000 }));
  assert.equal(has(s, 'leaf', 'bob', 'consulter', 1999), true);
  assert.equal(has(s, 'leaf', 'bob', 'consulter', 2000), false);
  s.grants.find(g => g.id === 'reader').revoked = true;
  assert.equal(has(s, 'leaf', 'bob', 'consulter'), false);
});

test('R02: targeted subtree restriction dominates lower direct grants without erasing other capabilities or siblings', () => {
  let s = fixture();
  s.grants.push(grant('read', 'private', 'bob', 'consulter'), grant('export', 'private', 'bob', 'exporter'), grant('bypass', 'leaf', 'bob', 'exporter'));
  s = changeRestriction(s, { id: 'r', folderId: 'child', actorId: 'alice', userId: 'bob', caps: ['exporter'] }, NOW);
  assert.equal(has(s, 'leaf', 'bob', 'exporter'), false);
  assert.equal(has(s, 'leaf', 'bob', 'consulter'), true);
  assert.equal(has(s, 'sibling', 'bob', 'exporter'), true);
  s = changeRestriction(s, { id: 'r', folderId: 'child', actorId: 'alice', userId: 'bob', caps: ['exporter'], lift: true }, NOW);
  assert.equal(has(s, 'leaf', 'bob', 'exporter'), true);
});

test('R03: isolated explicit share never exposes parent, sibling or ancestor metadata', () => {
  const s = fixture(); s.grants.push(grant('isolated', 'child', 'bob', 'consulter'));
  assert.equal(has(s, 'leaf', 'bob', 'consulter'), true);
  assert.equal(visibleEntry(s, 'private', 'bob', NOW), null);
  assert.equal(visibleEntry(s, 'sibling', 'bob', NOW), null);
  assert.deepEqual(visibleEntry(s, 'child', 'bob', NOW), { id: 'child', name: 'Shared child' });
  assert.deepEqual(evaluate(s, 'child', 'globalAdmin', NOW).capabilities, []);
});

test('R04: delegated grant dies with its dependency; independent grant survives author departure', () => {
  let s = fixture();
  s.grants.push(grant('share', 'child', 'bob', 'partager', { transmit: ['consulter'] }));
  s = issueGrant(s, { id: 'dependent', folderId: 'leaf', actorId: 'bob', userId: 'carol', cap: 'consulter', authorityId: 'share' }, NOW);
  s.grants.push(grant('independent', 'leaf', 'carol', 'consulter', { authorId: 'bob' }));
  s.members.find(m => m.id === 'bob').active = false;
  const e = evaluate(s, 'leaf', 'carol', NOW);
  assert.equal(e.valid('dependent'), false); assert.equal(e.valid('independent'), true);
  assert.equal(has(s, 'leaf', 'carol', 'consulter'), true);
});

test('R05: shrink of delegation envelope, expiry and departure epoch invalidate dependent chains', () => {
  let s = fixture(); s.grants.push(grant('share', 'child', 'bob', 'partager', { transmit: ['consulter', 'exporter'], expiresAt: 2000 }));
  s = issueGrant(s, { id: 'dependent', folderId: 'leaf', actorId: 'bob', userId: 'carol', cap: 'exporter', authorityId: 'share', expiresAt: 2000 }, NOW);
  assert.equal(has(s, 'leaf', 'carol', 'exporter', 1999), true);
  assert.equal(has(s, 'leaf', 'carol', 'exporter', 2000), false);
  const shrunk = structuredClone(s); shrunk.grants.find(g => g.id === 'share').transmit = ['consulter'];
  assert.equal(has(shrunk, 'leaf', 'carol', 'exporter'), false);
  s.members.find(m => m.id === 'bob').epoch++;
  assert.equal(has(s, 'leaf', 'carol', 'exporter'), false);
});

test('R06: restricted delegator cannot relay the restricted capability through an existing or new delegation', () => {
  let s = fixture(); s.grants.push(grant('share', 'private', 'bob', 'partager', { transmit: ['consulter', 'exporter'] }));
  s = issueGrant(s, { id: 'relay', folderId: 'leaf', actorId: 'bob', userId: 'carol', cap: 'exporter', authorityId: 'share' }, NOW);
  s = changeRestriction(s, { id: 'r', folderId: 'child', actorId: 'alice', userId: 'bob', caps: ['exporter'] }, NOW);
  assert.equal(has(s, 'leaf', 'carol', 'exporter'), false);
  unavailable(() => issueGrant(s, { id: 'relay2', folderId: 'leaf', actorId: 'bob', userId: 'dave', cap: 'exporter', authorityId: 'share' }, NOW));
});

test('R07: reader/editor/global administrator cannot share or restrict; sharing authority cannot lift restriction', () => {
  const s = fixture(); s.grants.push(grant('edit', 'child', 'bob', 'modifier'), grant('read', 'child', 'bob', 'consulter'),
    grant('share', 'child', 'dave', 'partager', { transmit: ['consulter'] }));
  for (const actorId of ['bob', 'globalAdmin']) {
    unavailable(() => issueGrant(s, { id: 'bad', folderId: 'child', actorId, userId: 'carol', cap: 'consulter', authorityId: 'edit' }, NOW));
    unavailable(() => changeRestriction(s, { id: 'r', folderId: 'child', actorId, userId: 'carol', caps: ['consulter'] }, NOW));
  }
  unavailable(() => changeRestriction(s, { id: 'r', folderId: 'child', actorId: 'dave', userId: 'carol', caps: ['consulter'] }, NOW));
});

test('R08: child administrator cannot lift an ancestor restriction from below', () => {
  let s = fixture(); s.grants.push(grant('admin', 'leaf', 'bob', 'administrer', { transmit: ['exporter'] }));
  s = changeRestriction(s, { id: 'r', folderId: 'child', actorId: 'alice', userId: 'carol', caps: ['exporter'] }, NOW);
  unavailable(() => changeRestriction(s, { id: 'r', folderId: 'leaf', actorId: 'bob', userId: 'carol', caps: ['exporter'], lift: true }, NOW));
});

test('R09: creation by editor mints no grant or authority and denied creation leaves original state intact', () => {
  const s = fixture(); s.grants.push(grant('edit', 'child', 'bob', 'modifier'), grant('read', 'child', 'bob', 'consulter'));
  const next = createChild(s, { id: 'new', name: 'New', parentId: 'child', actorId: 'bob' }, NOW);
  assert.deepEqual(next.grants, s.grants); assert.equal(has(next, 'new', 'bob', 'administrer'), false);
  assert.deepEqual(evaluate(next, 'new', 'bob', NOW).capabilities, ['consulter', 'modifier']);
  const before = structuredClone(s);
  unavailable(() => createChild(s, { id: 'bad', name: 'Bad', parentId: 'child', actorId: 'carol' }, NOW));
  assert.deepEqual(s, before);
});

test('R10: inherited reference issues dependent grant; local reference issues independent grant', () => {
  let s = fixture();
  s = issueGrant(s, { id: 'child-read', folderId: 'child', actorId: 'alice', userId: 'bob', cap: 'consulter', authorityId: 'ref' }, NOW);
  s = issueGrant(s, { id: 'root-read', folderId: 'private', actorId: 'alice', userId: 'carol', cap: 'consulter', authorityId: 'ref' }, NOW);
  assert.equal(s.grants.find(g => g.id === 'child-read').parentId, 'ref');
  assert.equal(s.grants.find(g => g.id === 'root-read').parentId, null);
  s.grants.find(g => g.id === 'ref').revoked = true;
  assert.equal(has(s, 'child', 'bob', 'consulter'), false);
  assert.equal(has(s, 'child', 'carol', 'consulter'), true);
});

test('R11: placement retains grant dependencies and reference identity; root without a management frame is unfit', () => {
  let s = fixture();
  s = issueGrant(s, { id: 'dep', folderId: 'child', actorId: 'alice', userId: 'bob', cap: 'consulter', authorityId: 'ref' }, NOW);
  const root = placementHypothesis(s, 'child', null);
  assert.deepEqual(root.grants, s.grants);
  assert.deepEqual(root.folders.find(f => f.id === 'child').governance, s.folders.find(f => f.id === 'child').governance);
  assert.equal(managementFrame(root, 'child', NOW), null);
  assert.equal(has(root, 'child', 'alice', 'modifier'), false);
  assert.equal(has(root, 'child', 'bob', 'consulter'), true);
  root.grants.find(g => g.id === 'ref').revoked = true;
  assert.equal(has(root, 'child', 'bob', 'consulter'), false);
  // Moving under another reference never silently adopts that reference.
  const other = placementHypothesis(s, 'child', 'other');
  assert.equal(managementFrame(other, 'child', NOW), null);
});

test('R12: own management reference survives moving its tree to root, independent access remains bounded', () => {
  const s = fixture(); s.folders.find(f => f.id === 'private').parentId = 'other';
  const root = placementHypothesis(s, 'private', null);
  assert.deepEqual(managementFrame(root, 'private', NOW), { referenceId: 'ref', holderId: 'alice', transmit: CAPS });
  assert.equal(has(root, 'private', 'carol', 'administrer'), false);
  assert.deepEqual(root.grants, s.grants);
});

test('R13: envelope amplification, expiry amplification, self delegation and ancestry loops fail closed', () => {
  const s = fixture(); s.grants.push(grant('share', 'child', 'bob', 'partager', { transmit: ['consulter'], expiresAt: 1500 }));
  const input = { id: 'bad', folderId: 'leaf', actorId: 'bob', userId: 'carol', authorityId: 'share', cap: 'consulter', expiresAt: 1500 };
  for (const delta of [{ cap: 'exporter' }, { transmit: ['administrer'] }, { expiresAt: 1501 }, { userId: 'bob' }, { userId: 'alice' }]) {
    // alice is only an ancestor in the lineage-specific case.
    if (delta.userId === 'alice') s.grants.find(g => g.id === 'share').lineage = ['alice'];
    unavailable(() => issueGrant(s, { ...input, ...delta }, NOW));
  }
  unavailable(() => placementHypothesis(s, 'private', 'leaf'));
  s.grants.push(grant('x', 'child', 'carol', 'partager', { kind: 'delegated', parentId: 'y', transmit: ['partager'] }),
    grant('y', 'child', 'dave', 'partager', { kind: 'delegated', parentId: 'x', transmit: ['partager'] }));
  assert.equal(has(s, 'child', 'carol', 'partager'), false);
});

test('R14: stale policy fingerprint and expiration at effect time reject an old permission preview', () => {
  const s = fixture(); s.grants.push(grant('share', 'child', 'bob', 'partager', { transmit: ['consulter'], expiresAt: 1500 }));
  const input = { id: 'new', folderId: 'child', actorId: 'bob', userId: 'carol', authorityId: 'share', cap: 'consulter', expiresAt: 1500 };
  const token = policyFingerprint(s);
  assert.equal(checkedIssue(s, input, token, 1499).grants.at(-1).id, 'new');
  unavailable(() => checkedIssue(s, input, token, 1500));
  s.members.find(m => m.id === 'bob').epoch++;
  assert.throws(() => checkedIssue(s, input, token, 1499), /^Error: STALE$/);
});

test('R15: readmission at a new epoch cannot revive old subject rights or dependent management', () => {
  const s = fixture(); s.grants.push(grant('read', 'child', 'bob', 'consulter'));
  const bob = s.members.find(m => m.id === 'bob');
  bob.active = false; bob.epoch++;
  assert.equal(has(s, 'leaf', 'bob', 'consulter'), false);
  bob.active = true;
  assert.equal(has(s, 'leaf', 'bob', 'consulter'), false);
  s.members.find(m => m.id === 'alice').epoch++;
  assert.equal(managementFrame(s, 'child', NOW), null);
});

test('R16: existing trash scope has current rights affected by ancestor placement without changing its deadline', () => {
  const s = fixture();
  const leaf = s.folders.find(f => f.id === 'leaf'); leaf.trash = { groupId: 'earlier', expiresAt: 5000 };
  s.grants.push(grant('reader', 'private', 'bob', 'consulter'));
  const after = placementHypothesis(s, 'child', 'other');
  // Policy only: lifecycle must deny normal reading and authorize this loss
  // along with all other non-expired descendant effects before accepting move.
  assert.equal(has(s, 'leaf', 'bob', 'consulter'), true);
  assert.equal(has(after, 'leaf', 'bob', 'consulter'), false);
  assert.deepEqual(after.folders.find(f => f.id === 'leaf').trash, leaf.trash);
});

test('R17: delegated envelope remains bounded across multiple hops and ancestor revocation', () => {
  let s = fixture();
  s.grants.push(grant('share', 'private', 'bob', 'partager', { transmit: ['partager', 'consulter'], expiresAt: 2000 }));
  s = issueGrant(s, { id: 'relay', folderId: 'child', actorId: 'bob', userId: 'carol', cap: 'partager', transmit: ['consulter'], expiresAt: 1900, authorityId: 'share' }, NOW);
  s = issueGrant(s, { id: 'read', folderId: 'leaf', actorId: 'carol', userId: 'dave', cap: 'consulter', expiresAt: 1800, authorityId: 'relay' }, NOW);
  assert.equal(has(s, 'leaf', 'dave', 'consulter'), true);
  assert.equal(has(s, 'leaf', 'dave', 'consulter', 1800), false);
  s.grants.find(g => g.id === 'share').revoked = true;
  assert.equal(has(s, 'leaf', 'dave', 'consulter'), false);
});

const transfer = (s, delta = {}, now = NOW) => transmitManagement(s, { folderId: 'child', actorId: 'alice', nomineeId: 'bob',
  referenceId: 'ref', newReferenceId: 'new-ref', expectedFingerprint: policyFingerprint(s), ...delta }, now);

test('R18: explicit inherited management transmission revokes only scoped dependency and enables root without moving quota', () => {
  let s = fixture(); s.grants.push(grant('reader', 'child', 'bob', 'consulter'));
  s.documents = [{ id: 'doc', folderId: 'leaf', ownerId: 'alice', objectId: 'unchanged', bytes: 50 }];
  s = issueGrant(s, { id: 'old-dependent', folderId: 'leaf', actorId: 'alice', userId: 'carol', cap: 'consulter', authorityId: 'ref' }, NOW);
  const next = transfer(s);
  assert.equal(has(next, 'leaf', 'carol', 'consulter'), false);
  assert.equal(has(next, 'child', 'alice', 'administrer'), false);
  assert.equal(managementFrame(next, 'sibling', NOW).referenceId, 'ref');
  assert.equal(managementFrame(next, 'leaf', NOW).referenceId, 'new-ref');
  assert.equal(next.grants.find(g => g.id === 'ref').revoked, false);
  const root = placementHypothesis(next, 'child', null);
  assert.equal(managementFrame(root, 'child', NOW).holderId, 'bob');
  assert.deepEqual(root.documents, s.documents);
  assert.equal(root.folders.find(f => f.id === 'child').createdBy, 'alice');
  assert.equal(attestedReference(root, root.grants.find(g => g.id === 'new-ref')), true);
});

test('R19: transmission preserves exact bounded envelope and expiry; source activity is no longer a dependency', () => {
  const s = fixture(); s.grants.push(grant('reader', 'child', 'bob', 'consulter'));
  const source = s.grants.find(g => g.id === 'ref'); source.transmit = ['consulter', 'modifier']; source.expiresAt = 2000;
  const next = transfer(s), replacement = next.grants.find(g => g.id === 'new-ref');
  assert.deepEqual(replacement.transmit, ['consulter', 'modifier']); assert.equal(replacement.expiresAt, 2000);
  next.members.find(m => m.id === 'alice').active = false; next.grants.find(g => g.id === 'ref').transmit = [];
  assert.equal(managementFrame(next, 'child', 1999).holderId, 'bob');
  assert.equal(managementFrame(next, 'child', 2000), null);
  replacement.transmit.push('exporter');
  assert.equal(attestedReference(next, replacement), false);
  assert.equal(managementFrame(next, 'child', 1999), null);
});

test('R20: nominee must be active reader surviving dependency withdrawal; failed transmission leaves source unchanged', () => {
  let s = fixture();
  s = issueGrant(s, { id: 'dependent-reader', folderId: 'child', actorId: 'alice', userId: 'bob', cap: 'consulter', authorityId: 'ref' }, NOW);
  const original = structuredClone(s); unavailable(() => transfer(s)); assert.deepEqual(s, original);
  s.grants.push(grant('independent-reader', 'child', 'bob', 'consulter'));
  s.members.find(m => m.id === 'bob').active = false; unavailable(() => transfer(s));
  s.members.find(m => m.id === 'bob').active = true; s.members.find(m => m.id === 'bob').epoch++;
  unavailable(() => transfer(s));
  s.grants.push(grant('fresh-reader', 'child', 'bob', 'consulter', { subjectEpoch: 1 }));
  assert.equal(transfer(s).grants.find(g => g.id === 'new-ref').subjectEpoch, 1);
});

test('R21: succession requires departed epoch plus revoked reference and global authority, without granting content to nominator', () => {
  const s = fixture(); s.grants.push(grant('reader', 'child', 'bob', 'consulter'));
  const input = { mode: 'nominate', actorId: 'globalAdmin' };
  unavailable(() => transfer(s, input));
  s.grants.find(g => g.id === 'ref').revoked = true;
  unavailable(() => transfer(s, input));
  s.members.find(m => m.id === 'alice').active = false; s.members.find(m => m.id === 'alice').epoch++;
  unavailable(() => transfer(s, { mode: 'nominate', actorId: 'carol' }));
  const next = transfer(s, input);
  assert.equal(managementFrame(next, 'child', NOW).holderId, 'bob');
  assert.equal(has(next, 'child', 'globalAdmin', 'consulter'), false);
  assert.equal(has(next, 'child', 'globalAdmin', 'administrer'), false);
});

test('R22: exact transmission preview and expiry rechecked; local replacement revokes old reference and dependencies', () => {
  let s = fixture(); s.grants.push(grant('reader', 'private', 'bob', 'consulter'));
  s = issueGrant(s, { id: 'dependent', folderId: 'child', actorId: 'alice', userId: 'carol', cap: 'consulter', authorityId: 'ref' }, NOW);
  const token = policyFingerprint(s); s.members.find(m => m.id === 'bob').epoch++;
  assert.throws(() => transfer(s, { expectedFingerprint: token }), /^Error: STALE$/);
  s.members.find(m => m.id === 'bob').epoch--;
  const source = s.grants.find(g => g.id === 'ref'); source.expiresAt = 1500;
  unavailable(() => transfer(s, { folderId: 'private' }, 1500));
  const next = transfer(s, { folderId: 'private' }, 1499);
  assert.equal(next.grants.find(g => g.id === 'ref').revoked, true);
  assert.equal(has(next, 'child', 'carol', 'consulter', 1499), false);
  assert.equal(managementFrame(next, 'leaf', 1499).referenceId, 'new-ref');
});

test('R23: scope withdrawal and delegator restrictions also reach grants inherited from above the restriction anchor', () => {
  let s = fixture(); s.grants.push(grant('reader', 'child', 'bob', 'consulter'),
    grant('dependent-admin', 'private', 'carol', 'administrer', { kind: 'delegated', parentId: 'ref', transmit: ['consulter'] }));
  const next = transfer(s);
  assert.equal(has(next, 'child', 'carol', 'administrer'), false);
  assert.equal(has(next, 'sibling', 'carol', 'administrer'), true);
  s.grants.push(grant('share', 'private', 'bob', 'partager', { transmit: ['exporter'] }));
  s = issueGrant(s, { id: 'relay', folderId: 'private', actorId: 'bob', userId: 'carol', cap: 'exporter', authorityId: 'share' }, NOW);
  s = changeRestriction(s, { id: 'r', folderId: 'child', actorId: 'alice', userId: 'bob', caps: ['exporter'] }, NOW);
  assert.equal(has(s, 'child', 'carol', 'exporter'), false);
  assert.equal(has(s, 'sibling', 'carol', 'exporter'), true);
});
