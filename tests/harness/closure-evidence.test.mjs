import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { digest, readVerificationRun } from '../../scripts/lib/verification-evidence.mjs';
import { runVerification } from '../../scripts/lib/verification-run.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-closure-evidence-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n');
  writeFileSync(path.join(root, 'synthetic.txt'), 'SYNTHETIC\n');
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-closure-evidence-'));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const steps = [{ name: 'synthetic', args: [] }];
const good = () => ({ status: 0 });
const state = () => ({ registry: 'artifacts/closure/registry.json', present: true, files: [{ path: 'artifacts/closure/source.json', sha256: 'a'.repeat(64) }], inventoryDigest: 'b'.repeat(64) });

test('shared closure state is frozen before/after and required by the current proof reader', t => {
  const root = fixture(t);
  const result = runVerification({ root, steps, execute: good, closureState: state });
  assert.equal(result.report.status, 'PASS');
  assert.equal(result.report.closure.status, 'UNCHANGED');
  assert.throws(() => readVerificationRun(root), /closure-current-reader-required/);
  assert.equal(readVerificationRun(root, process.env, { closureState: state }).report.status, 'PASS');
  const before = JSON.parse(readFileSync(path.join(root, result.report.closure.before.path), 'utf8'));
  assert.equal(before.runId, result.report.runId);
  assert.deepEqual(before.state, state());
  assert.equal(before.stateDigest, digest(JSON.stringify(state())));
});

for (const changed of ['inventoryDigest', 'files', 'present']) {
  test(`a changed shared ${changed} during tests invalidates successful checks`, t => {
    const root = fixture(t);
    let current = state();
    const result = runVerification({ root, steps, closureState: () => current, execute: () => {
      current = { ...current, [changed]: changed === 'files' ? [] : changed === 'present' ? false : 'c'.repeat(64) };
      return good();
    } });
    assert.equal(result.report.candidate.status, 'UNCHANGED');
    assert.equal(result.report.closure.status, 'CHANGED');
    assert.equal(result.report.status, 'FAIL');
    assert.equal(result.report.results[0].status, 'PASS');
    assert.equal(readVerificationRun(root, process.env, { closureState: () => current }).report.status, 'FAIL');
  });
}

test('an old PASS cannot survive a changed registry, agreement, or branch inventory', t => {
  const root = fixture(t);
  runVerification({ root, steps, execute: good, closureState: state });
  for (const current of [{ ...state(), inventoryDigest: 'c'.repeat(64) }, { ...state(), files: [] }, { ...state(), present: false }]) {
    assert.throws(() => readVerificationRun(root, process.env, { closureState: () => current }), /closure-state-stale/);
  }
});

test('missing closure sources prevent checks and cannot borrow a previous run', t => {
  const root = fixture(t);
  runVerification({ root, steps, execute: good, closureState: state });
  let calls = 0;
  const result = runVerification({ root, steps, execute: () => { calls++; return good(); }, closureState: () => { throw new Error('missing'); } });
  assert.equal(calls, 0);
  assert.equal(result.report.status, 'FAIL');
  assert.equal(result.report.closure.status, 'UNAVAILABLE');
  assert.equal(result.report.results[0].status, 'NOT_PERFORMED');
  assert.equal(readVerificationRun(root).report.status, 'FAIL');
});

test('tampered closure snapshots are refused even if a new pointer hash is supplied', t => {
  const root = fixture(t);
  const result = runVerification({ root, steps, execute: good, closureState: state });
  const snapshot = JSON.parse(readFileSync(path.join(root, result.report.closure.after.path), 'utf8'));
  snapshot.state.inventoryDigest = 'c'.repeat(64);
  const bytes = JSON.stringify(snapshot);
  writeFileSync(path.join(root, result.report.closure.after.path), bytes);
  const report = result.report;
  report.closure.after.sha256 = digest(bytes);
  const reportBytes = JSON.stringify(report);
  writeFileSync(path.join(root, result.reference.path), reportBytes);
  const pointerPath = path.join(root, 'artifacts/verification-latest.json');
  const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
  pointer.report.sha256 = digest(reportBytes);
  writeFileSync(pointerPath, JSON.stringify(pointer));
  assert.throws(() => readVerificationRun(root, process.env, { closureState: state }), /closure-snapshot-digest-mismatch/);
});
