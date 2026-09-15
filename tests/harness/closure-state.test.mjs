import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { closureInputs, discoverRepository, inspectClosure, inventory } from '../../scripts/lib/closure-state.mjs';
import { captureCandidate } from '../../scripts/lib/verification-evidence.mjs';

const repository = 'https://github.com/example/closure-fixture';
const when = '2026-09-15T00:00:00Z';
const now = '2026-09-16T00:00:00Z';
const quote = 'ACCORD FABRIQUE POUR TEST : les actions et réservations du scénario synthétique sont explicitement distinguées.';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const nextAction = (owner = 'agent') => ({ owner, action: 'Continuer la seule étape synthétique applicable.', support: 'Le candidat et le contrat synthétiques identifiés.', expectedResponse: 'Résultat ou décision explicite concernant ce candidat.', unblocks: 'La suite bornée du scénario de test.' });

function put(root, value, content) {
  const file = path.join(root, value); mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  return { path: value, sha256: hash(readFileSync(file)) };
}
function fixture(run) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'hestia-closure-state-'));
  const primary = path.join(temporary, 'repo'); mkdirSync(primary);
  try {
    git(primary, 'init', '-b', 'main', '--quiet'); git(primary, 'config', 'user.name', 'Synthetic test'); git(primary, 'config', 'user.email', 'fixture@example.invalid');
    put(primary, '.gitignore', 'artifacts/\n'); put(primary, 'source.txt', 'SOURCE SYNTHETIQUE\n');
    git(primary, 'add', '.'); git(primary, 'commit', '-qm', 'Synthetic initial source'); git(primary, 'remote', 'add', 'origin', `${repository}.git`);
    const registry = { schemaVersion: 1, repository, recordedAtUtc: when, entries: [] };
    const source = put(primary, 'artifacts/closure/source.md', `# Exemple de test, aucune autorisation réelle\n\n${quote}\n`);
    const paths = new Map();
    const save = () => put(primary, 'artifacts/closure/registry.json', registry);
    function add(branch = 'codex/one', lotId = 'lot-one', external = false) {
      const slug = branch.split('/').at(-1); const checkout = external ? path.join(temporary, slug) : path.join(primary, `artifacts/worktrees/${slug}`);
      git(primary, 'worktree', 'add', '-q', '-b', branch, checkout, 'main'); paths.set(branch, checkout);
      const entry = { lotId, branch, target: 'main', state: 'working', reason: 'Lot synthétique explicitement en cours.', source, candidate: null, proofs: { validation: null, review: null }, authorization: null, disposition: null, reservation: null, nextAction: nextAction() };
      registry.entries.push(entry); save(); return entry;
    }
    const identity = (entry) => ({ repository, branch: entry.branch, head: git(primary, 'rev-parse', `refs/heads/${entry.branch}`), target: entry.target, recordedAtUtc: when });
    function authorization(entry, actions, pr = `${repository}/pull/1`) {
      return put(primary, `artifacts/closure/${entry.branch.split('/').at(-1)}-${actions.join('-')}-authorization.json`, { kind: 'authorization', ...identity(entry), pr, actions, source, quote });
    }
    function disposition(entry, kind, extra = {}) {
      entry.disposition = put(primary, `artifacts/closure/${entry.branch.split('/').at(-1)}-disposition.json`, { kind, ...identity(entry), pr: `${repository}/pull/1`, reason: 'Motif synthétique de conservation ou de clôture explicite.', authorization: null, mergeCommit: null, remoteReceipt: null, ...extra });
      save();
    }
    function ready(entry, { inputPaths = [], evidenceRoot = '.' } = {}) {
      const state = closureInputs(primary); const stateDigest = hash(JSON.stringify(state));
      const runId = '1790000000000-11111111-1111-4111-8111-111111111111';
      const snapshot = captureCandidate({ root: paths.get(entry.branch), runId, phase: 'before', inputPaths });
      entry.candidate = { head: snapshot.commit, sourceDigest: snapshot.sourceDigest }; entry.state = 'ready'; entry.nextAction = nextAction('Amaury');
      const slug = entry.branch.split('/').at(-1); const base = `artifacts/closure/${slug}`;
      const prefix = evidenceRoot === '.' ? '' : `${evidenceRoot}/`;
      const before = { ...put(primary, `${prefix}${base}-before.json`, snapshot), path: `${base}-before.json`, sourceDigest: snapshot.sourceDigest, identityDigest: snapshot.identityDigest };
      const after = { ...put(primary, `${prefix}${base}-after.json`, { ...snapshot, phase: 'after' }), path: `${base}-after.json`, sourceDigest: snapshot.sourceDigest, identityDigest: snapshot.identityDigest };
      const closure = { status: 'UNCHANGED' };
      for (const phase of ['before', 'after']) closure[phase] = { ...put(primary, `${prefix}${base}-closure-${phase}.json`, { schemaVersion: 1, runId, phase, state, stateDigest }), path: `${base}-closure-${phase}.json`, stateDigest };
      const evidence = put(primary, `${prefix}${base}-verification.json`, { schemaVersion: 2, runId, status: 'PASS', errors: [], activeCheckpoint: { path: inputPaths[0] ?? null, status: inputPaths.length ? 'PASS' : 'NOT_PERFORMED' }, candidate: { status: 'UNCHANGED', before, after }, closure, results: [{ name: 'synthetic-behavior', required: true, status: 'PASS', exitCode: 0 }] });
      entry.proofs.validation = put(primary, `${base}-validation.json`, { kind: 'validation', ...identity(entry), sourceDigest: snapshot.sourceDigest, status: 'PASS', checks: [{ name: 'synthetic-behavior', status: 'PASS', exitCode: 0 }], evidence, evidenceRoot });
      const review = put(primary, `${base}-original-review.md`, `# Revue entièrement synthétique de test\n\nCandidat ${snapshot.commit}, ${snapshot.sourceDigest}.\nAucune revue réelle de livraison.\n`);
      entry.proofs.review = put(primary, `${base}-review.json`, { kind: 'review', ...identity(entry), sourceDigest: snapshot.sourceDigest, status: 'PASS', authors: ['author'], reviewer: { identity: 'reviewer', effectiveModel: 'SYNTHETIC-TEST-ONLY', cleanContext: true }, openBlockingFindings: 0, evidence: review, evidenceRead: true });
      disposition(entry, 'ready'); return snapshot;
    }
    function reservation(branch, lotId, sources = ['src/one'], worktree = `artifacts/worktrees/${branch.split('/').at(-1)}`) {
      return put(primary, `artifacts/closure/${branch.split('/').at(-1)}-reservation.json`, { kind: 'reservation', repository, lotId, branch, target: 'main', baseHead: git(primary, 'rev-parse', 'main'), paths: sources, worktree, recordedAtUtc: when, source, quote, nextAction: nextAction() });
    }
    function merged(entry, options) {
      ready(entry, options); entry.authorization = authorization(entry, ['merge', 'cleanup']); entry.state = 'merged';
      const head = entry.candidate.head;
      const receipt = put(primary, `artifacts/closure/${entry.branch.split('/').at(-1)}-remote-receipt.json`, { kind: 'remote-merge-receipt', ...identity(entry), pr: `${repository}/pull/1`, mergeCommit: head, targetHead: head, merged: true, comparison: 'identical' });
      disposition(entry, 'merged', { mergeCommit: head, remoteReceipt: receipt });
    }
    const check = (action = 'inspect', extra = {}) => inspectClosure({ root: primary, action, now, ...extra });
    save(); return run({ primary, temporary, registry, source, paths, save, add, ready, merged, identity, authorization, disposition, reservation, check });
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('hestia-closure-state-'));
    rmSync(temporary, { recursive: true, force: true });
  }
}
const has = (result, code) => assert.ok(result.diagnostics.some((item) => item.code === code), JSON.stringify(result.diagnostics));
function changeReport(f, entry, change) {
  const wrapper = JSON.parse(readFileSync(path.join(f.primary, entry.proofs.validation.path)));
  const report = JSON.parse(readFileSync(path.join(f.primary, wrapper.evidence.path)));
  change(report, wrapper);
  wrapper.evidence = put(f.primary, wrapper.evidence.path, report);
  entry.proofs.validation = put(f.primary, entry.proofs.validation.path, wrapper); f.save();
}

test('every worktree discovers the primary registry and the same deterministic inventory', () => fixture((f) => {
  const entry = f.add(); const checkout = f.paths.get(entry.branch);
  assert.equal(discoverRepository(checkout).primaryRoot, f.primary);
  assert.equal(discoverRepository(checkout).registryPath, path.join(f.primary, 'artifacts/closure/registry.json'));
  assert.deepEqual(closureInputs(checkout), closureInputs(f.primary));
  assert.equal(inventory(checkout).inventoryDigest, inventory(f.primary).inventoryDigest);
}));

test('a missing registry is captured as absent and blocks local gates without initialization', () => fixture((f) => {
  rmSync(path.join(f.primary, 'artifacts/closure/registry.json'));
  assert.equal(closureInputs(f.primary).present, false);
  const result = f.check(); assert.equal(result.valid, false); has(result, 'registry-missing');
  assert.equal(existsSync(path.join(f.primary, 'artifacts/closure/registry.json')), false);
}));

test('unknown branches without a checkout are visible from another worktree and block verify/start', () => fixture((f) => {
  const entry = f.add(); git(f.primary, 'branch', 'codex/forgotten');
  const result = inspectClosure({ root: f.paths.get(entry.branch), action: 'verify', now });
  assert.equal(result.valid, false); has(result, 'unknown-work-branch');
  assert.equal(result.inventory.branches.find((item) => item.branch === 'main').protected, true);
  assert.equal(f.check('resume', { branch: entry.branch }).valid, true, 'Explicit current work remains inspectable while forgotten branches are diagnosed.');
}));

test('working cannot finish and an explicit blocked state remains resumable', () => fixture((f) => {
  const entry = f.add(); const result = f.check('finish', { branch: entry.branch });
  assert.equal(result.valid, false); has(result, 'lot-not-finished');
  entry.state = 'blocked'; f.disposition(entry, 'blocked');
  assert.equal(f.check('resume', { branch: entry.branch }).valid, true);
  assert.equal(f.check('finish', { branch: entry.branch }).valid, true);
}));

test('ready may finish awaiting a precise human GO, but already authorized integration must continue', () => fixture((f) => {
  const entry = f.add(); f.ready(entry);
  const pending = f.check('finish', { branch: entry.branch }); assert.equal(pending.valid, true, JSON.stringify(pending.diagnostics));
  assert.deepEqual(pending.requiredAction, { kind: 'request-integration-approval', branch: entry.branch, head: entry.candidate.head, target: entry.target, pr: `${repository}/pull/1` });
  entry.authorization = f.authorization(entry, ['merge']); f.save();
  const authorized = f.check('finish', { branch: entry.branch }); assert.equal(authorized.valid, false); has(authorized, 'authorized-integration-still-pending');
  assert.equal(authorized.requiredAction.kind, 'execute-approved-merge');
  assert.equal(authorized.requiredAction.head, entry.candidate.head);
  assert.equal(f.check('merge', { branch: entry.branch }).valid, true);
}));

test('finish checks a proposed transition without mutating working state or skipping ready evidence', () => fixture((f) => {
  const entry = f.add();
  assert.equal(f.check('resume', { branch: entry.branch }).requiredAction.kind, 'complete-work');
  f.disposition(entry, 'ready');
  const missing = f.check('finish', { branch: entry.branch }); assert.equal(missing.valid, false); has(missing, 'candidate-proofs-missing');
  f.ready(entry); entry.state = 'working'; f.save();
  const ready = f.check('finish', { branch: entry.branch }); assert.equal(ready.valid, true, JSON.stringify(ready.diagnostics));
  assert.equal(ready.lot.state, 'working'); assert.equal(ready.requiredAction.kind, 'request-integration-approval');
  put(f.paths.get(entry.branch), 'source.txt', 'SOURCE SYNTHETIQUE CHANGE APRES PREUVE\n');
  has(f.check('finish', { branch: entry.branch }), 'candidate-source-drift');
  entry.candidate = null; entry.proofs = { validation: null, review: null }; f.disposition(entry, 'blocked');
  const blocked = f.check('finish', { branch: entry.branch }); assert.equal(blocked.valid, true, JSON.stringify(blocked.diagnostics));
  assert.equal(blocked.requiredAction.kind, 'resolve-blocker'); assert.equal(entry.state, 'working');
  f.disposition(entry, 'deferred'); has(f.check('finish', { branch: entry.branch }), 'deferral-not-explicitly-authorized');
}));

test('merge refuses missing approval and a GO for another PR/head/target', () => fixture((f) => {
  const entry = f.add(); f.ready(entry);
  const missing = f.check('merge', { branch: entry.branch }); assert.equal(missing.valid, false); has(missing, 'exact-merge-approval-required');
  entry.authorization = f.authorization(entry, ['merge'], `${repository}/pull/999`); f.save();
  assert.equal(f.check('merge', { branch: entry.branch }).valid, false);
  const auth = JSON.parse(readFileSync(path.join(f.primary, entry.authorization.path))); auth.head = '1'.repeat(40);
  entry.authorization = put(f.primary, entry.authorization.path, auth); f.save();
  const otherHead = f.check('merge', { branch: entry.branch }); has(otherHead, 'authorization-candidate-mismatch');
}));

test('candidate head and uncommitted source drift invalidate ready evidence', () => fixture((f) => {
  const entry = f.add(); f.ready(entry); const checkout = f.paths.get(entry.branch);
  put(checkout, 'source.txt', 'SOURCE SYNTHETIQUE MODIFIEE\n');
  const changed = f.check('resume', { branch: entry.branch }); assert.equal(changed.valid, false); has(changed, 'candidate-source-drift');
  git(checkout, 'add', 'source.txt'); git(checkout, 'commit', '-qm', 'Synthetic change');
  const moved = f.check('resume', { branch: entry.branch }); assert.equal(moved.valid, false); has(moved, 'candidate-head-drift');
}));

test('PASS wrappers cannot replace absent/failed original validation reports', () => fixture((f) => {
  const entry = f.add(); f.ready(entry);
  const wrapper = JSON.parse(readFileSync(path.join(f.primary, entry.proofs.validation.path)));
  const report = JSON.parse(readFileSync(path.join(f.primary, wrapper.evidence.path)));
  report.results[0].status = 'NOT_PERFORMED'; report.results[0].exitCode = null;
  wrapper.evidence = put(f.primary, wrapper.evidence.path, report);
  entry.proofs.validation = put(f.primary, entry.proofs.validation.path, wrapper); f.save();
  const result = f.check('finish', { branch: entry.branch }); assert.equal(result.valid, false); has(result, 'validation-report-not-passed');
}));

test('independent review checks identity case and preserves a separate original report', () => fixture((f) => {
  const entry = f.add(); f.ready(entry);
  const wrapper = JSON.parse(readFileSync(path.join(f.primary, entry.proofs.review.path)));
  wrapper.reviewer.identity = 'AUTHOR'; entry.proofs.review = put(f.primary, entry.proofs.review.path, wrapper); f.save();
  const result = f.check('finish', { branch: entry.branch }); assert.equal(result.valid, false); has(result, 'independent-review-not-passed');
  wrapper.reviewer.identity = 'reviewer'; wrapper.evidence = entry.proofs.review;
  entry.proofs.review = put(f.primary, entry.proofs.review.path, wrapper); f.save();
  assert.equal(f.check('finish', { branch: entry.branch }).valid, false);
}));

test('deferred is not a loophole: missing exact human report approval blocks the registry', () => fixture((f) => {
  const entry = f.add(); entry.state = 'deferred'; f.disposition(entry, 'deferred');
  const invalid = f.check('resume', { branch: entry.branch }); assert.equal(invalid.valid, false); has(invalid, 'deferral-not-explicitly-authorized');
  f.disposition(entry, 'deferred', { authorization: f.authorization(entry, ['defer']) });
  assert.equal(f.check('resume', { branch: entry.branch }).valid, true);
}));

test('new branch start accepts an exact reservation without inventing a pre-existing branch entry', () => fixture((f) => {
  const reservation = f.reservation('codex/new', 'new-lot', ['src/new']);
  const result = f.check('start', { branch: 'codex/new', lotId: 'new-lot', reservation });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.registry.entries.length, 0);
  assert.equal(inventory(f.primary).branches.some((item) => item.branch === 'codex/new'), false);
}));

test('a different lot cannot start while the existing lot is working, ready or blocked', () => fixture((f) => {
  const entry = f.add(); const reservation = f.reservation('codex/new', 'new-lot');
  for (const state of ['working', 'ready', 'blocked']) {
    if (state === 'ready') f.ready(entry);
    else if (state === 'blocked') { entry.state = state; f.disposition(entry, 'blocked'); }
    const result = f.check('start', { branch: 'codex/new', lotId: 'new-lot', reservation });
    assert.equal(result.valid, false); has(result, 'previous-lot-awaits-closure');
  }
}));

test('same lot parallelism compares source paths even when worktree destinations differ', () => fixture((f) => {
  const entry = f.add(); entry.reservation = f.reservation(entry.branch, entry.lotId, ['src']); f.save();
  const overlapping = f.reservation('codex/two', entry.lotId, ['SRC/domain.ts']);
  const denied = f.check('start', { branch: 'codex/two', lotId: entry.lotId, reservation: overlapping });
  assert.equal(denied.valid, false); has(denied, 'parallel-reservation-overlap');
  const distinct = f.reservation('codex/two', entry.lotId, ['tests/domain.test.ts', 'docs/guide.md']);
  const allowed = f.check('start', { branch: 'codex/two', lotId: entry.lotId, reservation: distinct });
  assert.equal(allowed.valid, true, JSON.stringify(allowed.diagnostics));
}));

test('start refuses an already existing destination and a moved target base', () => fixture((f) => {
  const reservation = f.reservation('codex/new', 'new-lot');
  mkdirSync(path.join(f.primary, 'artifacts/worktrees/new'), { recursive: true });
  const occupied = f.check('start', { branch: 'codex/new', lotId: 'new-lot', reservation }); has(occupied, 'reservation-destination-exists');
  put(f.primary, 'source.txt', 'NOUVELLE BASE SYNTHETIQUE\n'); git(f.primary, 'add', 'source.txt'); git(f.primary, 'commit', '-qm', 'Moved target');
  const stale = f.check('start', { branch: 'codex/new', lotId: 'new-lot', reservation }); has(stale, 'reservation-start-mismatch');
}));

test('resume rejects a false merged state with no exact confirmed remote receipt', () => fixture((f) => {
  const entry = f.add(); f.ready(entry); entry.state = 'merged'; f.disposition(entry, 'merged', { mergeCommit: entry.candidate.head });
  const result = f.check('resume', { branch: entry.branch }); assert.equal(result.valid, false); has(result, 'merge-not-confirmed');
  f.merged(entry); const recorded = f.check('resume', { branch: entry.branch });
  assert.equal(recorded.valid, true, JSON.stringify(recorded.diagnostics)); assert.equal(recorded.remoteStateVerified, false);
  assert.equal(recorded.requiredAction.kind, 'reconcile-local-and-preserve');
}));

test('cleanup blocks ignored/untracked content until exact copies are preserved outside the worktree', () => fixture((f) => {
  const entry = f.add(); f.merged(entry); const checkout = f.paths.get(entry.branch);
  const original = put(checkout, 'artifacts/source-to-preserve.md', 'SOURCE SYNTHETIQUE A CONSERVER\n');
  const missing = f.check('cleanup', { branch: entry.branch }); assert.equal(missing.valid, false); has(missing, 'cleanup-content-not-preserved');
  const copy = put(f.primary, 'artifacts/closure/preserved/source.md', readFileSync(path.join(checkout, original.path), 'utf8'));
  const disposition = JSON.parse(readFileSync(path.join(f.primary, entry.disposition.path)));
  disposition.preserved = [{ ...original, copy }]; entry.disposition = put(f.primary, entry.disposition.path, disposition); f.save();
  const valid = f.check('cleanup', { branch: entry.branch }); assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  assert.equal(existsSync(checkout), true, 'The core must never remove the checkout.');
}));

test('external checkout contents require an explicit validated allowlist', () => fixture((f) => {
  const entry = f.add('codex/external', 'external-lot', true); f.ready(entry);
  const denied = f.check('resume', { branch: entry.branch }); assert.equal(denied.valid, false); has(denied, 'candidate-source-unverified');
  const allowed = f.check('resume', { branch: entry.branch, allowExternalWorktrees: [f.paths.get(entry.branch)] });
  assert.equal(allowed.valid, true, JSON.stringify(allowed.diagnostics));
}));

test('references reject traversal and linked parents before reading their content', () => fixture((f) => {
  const entry = f.add(); entry.source = { ...f.source, path: '../outside.md' }; f.save();
  const escaped = f.check(); assert.equal(escaped.valid, false); has(escaped, 'path-outside-primary');
  symlinkSync(path.join(f.primary, 'artifacts/closure'), path.join(f.primary, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  entry.source = { ...f.source, path: 'linked/source.md' }; f.save();
  const linked = f.check(); assert.equal(linked.valid, false); has(linked, 'linked-path');
}));

test('closure inputs include original reports and source refs but not manifest files as common-root refs', () => fixture((f) => {
  const entry = f.add(); f.ready(entry); entry.authorization = f.authorization(entry, ['merge']); f.save();
  const inputs = closureInputs(f.primary);
  assert.ok(inputs.files.some((file) => file.path.endsWith('-verification.json')));
  assert.ok(inputs.files.some((file) => file.path.endsWith('-original-review.md')));
  assert.ok(inputs.files.some((file) => file.path.endsWith('-before.json')));
  assert.ok(inputs.files.some((file) => file.path === f.source.path));
  assert.equal(inputs.files.some((file) => file.path === 'source.txt'), false);
  const changedSource = put(f.primary, f.source.path, `${quote}\nNouvelle trace synthétique.\n`);
  assert.notEqual(changedSource.sha256, f.source.sha256);
  assert.throws(() => closureInputs(f.primary));
}));

test('registry state without reason, source or an explicit next action is rejected', () => fixture((f) => {
  const entry = f.add(); entry.reason = ' '; f.save();
  const result = f.check(); assert.equal(result.valid, false); has(result, 'invalid-registry');
}));

test('lock presence and incomplete ownership are frozen; only the same-process runner token permits its gate', () => fixture((f) => {
  const entry = f.add(); f.disposition(entry, 'blocked');
  const initial = closureInputs(f.primary); assert.equal(initial.lock.present, false);
  const relative = 'artifacts/closure/operation.lock'; mkdirSync(path.join(f.primary, relative));
  const incomplete = closureInputs(f.primary); assert.equal(incomplete.lock.present, true); assert.equal(incomplete.lock.complete, false);
  has(f.check('verify'), 'closure-lock-present-reconciliation-required');
  const token = '11111111-1111-4111-8111-111111111111';
  put(f.primary, `${relative}/owner.json`, { token, pid: process.pid, recordedAtUtc: when });
  const complete = closureInputs(f.primary); assert.equal(complete.lock.complete, true); assert.ok(complete.files.some((file) => file.path.endsWith('/owner.json')));
  assert.equal(f.check('finish', { branch: entry.branch, lockToken: token }).valid, true);
  has(f.check('finish', { branch: entry.branch, lockToken: 'wrong' }), 'closure-lock-present-reconciliation-required');
  has(f.check('verify', { lockToken: token }), 'closure-lock-present-reconciliation-required');
}));

test('operation intent, result and registry snapshots are frozen and AMBIGUOUS cannot reuse an old PASS', () => fixture((f) => {
  f.add(); const id = '1790000000000-11111111-1111-4111-8111-111111111111'; const base = `artifacts/closure/operations/${id}`;
  const absent = closureInputs(f.primary); assert.equal(absent.operations.present, false);
  mkdirSync(path.join(f.primary, base), { recursive: true });
  assert.equal(closureInputs(f.primary).operations.entries[0].complete, false);
  has(f.check('verify'), 'pending-operation-reconciliation-required');
  put(f.primary, `${base}/intent.json`, { schemaVersion: 1, operationId: id, action: 'finish', recordedAtUtc: when });
  const registry = put(f.primary, `${base}/registry-after.json`, f.registry);
  put(f.primary, `${base}/result.json`, { schemaVersion: 1, operationId: id, action: 'finish', status: 'COMPLETED', registry, recordedAtUtc: when });
  assert.equal(closureInputs(f.primary).operations.entries[0].complete, false, 'COMPLETED cannot replace the missing original registry.');
  const registryBefore = put(f.primary, `${base}/registry-before.json`, JSON.stringify(f.registry));
  put(f.primary, `${base}/intent.json`, { schemaVersion: 1, operationId: id, action: 'finish', recordedAtUtc: when, registryBefore });
  const completed = closureInputs(f.primary); assert.equal(completed.operations.entries[0].complete, true);
  assert.equal(f.check('verify').valid, true);
  assert.equal(completed.files.filter((file) => file.path.startsWith(base)).length, 4);
  put(f.primary, registryBefore.path, f.registry);
  assert.equal(closureInputs(f.primary).operations.entries[0].complete, false, 'Reformatting the retained original bytes invalidates intent.registryBefore.');
  put(f.primary, `${base}/result.json`, { schemaVersion: 1, operationId: id, action: 'finish', status: 'AMBIGUOUS', recordedAtUtc: when });
  const ambiguous = closureInputs(f.primary); assert.notDeepEqual(ambiguous, completed);
  assert.equal(ambiguous.operations.entries[0].status, 'AMBIGUOUS'); has(f.check('verify'), 'pending-operation-reconciliation-required');
}));

test('linked operation directories are refused without reading external journal content', () => fixture((f) => {
  const external = path.join(f.temporary, 'external-journal'); mkdirSync(external);
  symlinkSync(external, path.join(f.primary, 'artifacts/closure/operations'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => closureInputs(f.primary), /linked-path/);
  has(f.check('verify'), 'linked-path');
}));

test('ignored active inputs are compared under the original evidence root before finish, merge or verify', () => fixture((f) => {
  const entry = f.add(); const checkout = f.paths.get(entry.branch); const input = 'artifacts/active-work.json';
  put(checkout, input, { synthetic: 'original checkpoint' });
  f.ready(entry, { inputPaths: [input], evidenceRoot: 'artifacts/worktrees/one' });
  assert.equal(f.check('finish', { branch: entry.branch }).valid, true);
  assert.ok(closureInputs(f.primary).files.some((item) => item.path === `artifacts/worktrees/one/${input}`));
  put(checkout, input, { synthetic: 'changed checkpoint after PASS' });
  for (const action of ['finish', 'verify']) has(f.check(action, { branch: entry.branch }), 'reference-digest-mismatch');
  entry.authorization = f.authorization(entry, ['merge']); f.save();
  has(f.check('merge', { branch: entry.branch }), 'reference-digest-mismatch');
  for (const state of ['blocked', 'deferred']) {
    entry.state = state; f.save();
    has(f.check('finish', { branch: entry.branch }), 'reference-digest-mismatch');
  }
}));

test('merged historical evidence stays verifiable after its former ignored working input is archived', () => fixture((f) => {
  const entry = f.add(); const checkout = f.paths.get(entry.branch); const input = 'artifacts/active-work.json';
  put(checkout, input, { synthetic: 'historic checkpoint' });
  f.merged(entry, { inputPaths: [input], evidenceRoot: 'artifacts/worktrees/one' });
  rmSync(path.join(checkout, input));
  const result = f.check('resume', { branch: entry.branch }); assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.remoteStateVerified, false);
}));

test('a newly appearing default checkpoint invalidates an older run with empty active inputs', () => fixture((f) => {
  const entry = f.add(); const checkout = f.paths.get(entry.branch);
  f.ready(entry, { evidenceRoot: 'artifacts/worktrees/one' });
  assert.equal(f.check('finish', { branch: entry.branch }).valid, true);
  put(checkout, 'artifacts/active-work.json', { synthetic: 'checkpoint introduced after the completed run' });
  for (const action of ['finish', 'verify']) has(f.check(action, { branch: entry.branch }), 'validation-active-checkpoint-unverified');
  entry.authorization = f.authorization(entry, ['merge']); f.save();
  has(f.check('merge', { branch: entry.branch }), 'validation-active-checkpoint-unverified');
}));

test('manifest run, phase, hashes and full candidate identity must agree with the report', () => fixture((f) => {
  const entry = f.add(); f.ready(entry);
  const originalWrapper = JSON.parse(readFileSync(path.join(f.primary, entry.proofs.validation.path)));
  const originalReport = JSON.parse(readFileSync(path.join(f.primary, originalWrapper.evidence.path)));
  const original = JSON.parse(readFileSync(path.join(f.primary, originalReport.candidate.after.path)));
  const cases = [
    [(value) => { value.runId = '1790000000000-22222222-2222-4222-8222-222222222222'; }, 'validation-manifest-run-mismatch'],
    [(value) => { value.phase = 'before'; }, 'validation-manifest-run-mismatch'],
    [(value) => { value.inputDigest = 'a'.repeat(64); }, 'validation-manifest-candidate-mismatch'],
    [(value) => { value.identityDigest = 'b'.repeat(64); }, 'validation-manifest-identity-mismatch'],
    [(value) => { value.files.push(value.files[0]); }, 'validation-manifest-files-invalid'],
    [(value) => { value.activeInputs = [{ path: '../outside.json', sha256: 'a'.repeat(64) }]; }, 'path-outside-primary'],
    [(value) => { value.deletedFiles = ['gone.txt']; value.identityDigest = hash(JSON.stringify({ commit: value.commit, sourceDigest: value.sourceDigest, inputDigest: value.inputDigest, deletedFiles: value.deletedFiles })); }, 'validation-candidate-changed'],
  ];
  for (const [mutate, code] of cases) {
    const value = structuredClone(original); mutate(value);
    const report = structuredClone(originalReport);
    report.candidate.after = { ...put(f.primary, report.candidate.after.path, value), sourceDigest: value.sourceDigest, identityDigest: value.identityDigest };
    const wrapper = structuredClone(originalWrapper); wrapper.evidence = put(f.primary, wrapper.evidence.path, report);
    entry.proofs.validation = put(f.primary, entry.proofs.validation.path, wrapper); f.save();
    has(f.check('verify'), code);
  }
}));

test('original closure snapshots must prove stability without requiring equality to the post-proof registry', () => fixture((f) => {
  const entry = f.add(); f.ready(entry);
  const baseline = f.check('finish', { branch: entry.branch }); assert.equal(baseline.valid, true, JSON.stringify(baseline.diagnostics));
  const originalWrapper = JSON.parse(readFileSync(path.join(f.primary, entry.proofs.validation.path)));
  const originalReport = JSON.parse(readFileSync(path.join(f.primary, originalWrapper.evidence.path)));
  const original = JSON.parse(readFileSync(path.join(f.primary, originalReport.closure.after.path)));
  assert.notDeepEqual(original.state, closureInputs(f.primary), 'Ready adds proof references after the historical stable verification.');
  const cases = [
    [(value) => { value.phase = 'before'; }, 'validation-closure-snapshot-invalid'],
    [(value) => { value.runId = '1790000000000-22222222-2222-4222-8222-222222222222'; }, 'validation-closure-snapshot-invalid'],
    [(value) => { value.stateDigest = 'a'.repeat(64); }, 'validation-closure-digest-mismatch'],
    [(value) => { value.state.present = false; value.stateDigest = hash(JSON.stringify(value.state)); }, 'validation-closure-changed'],
  ];
  for (const [mutate, code] of cases) {
    const value = structuredClone(original); mutate(value); const report = structuredClone(originalReport);
    report.closure.after = { ...put(f.primary, report.closure.after.path, value), stateDigest: value.stateDigest };
    const wrapper = structuredClone(originalWrapper); wrapper.evidence = put(f.primary, wrapper.evidence.path, report);
    entry.proofs.validation = put(f.primary, entry.proofs.validation.path, wrapper); f.save();
    has(f.check('finish', { branch: entry.branch }), code);
  }
  changeReport(f, entry, (report) => { report.closure.status = 'CHANGED'; });
  has(f.check('finish', { branch: entry.branch }), 'validation-closure-not-stable');
  changeReport(f, entry, (report) => { report.closure.status = 'UNCHANGED'; report.closure.after = null; });
  has(f.check('finish', { branch: entry.branch }), 'validation-manifest-missing');
}));
