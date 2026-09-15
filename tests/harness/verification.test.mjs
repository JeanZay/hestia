import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { beginRun, digest, readVerificationRun, writeLatest, writeRunJson } from '../../scripts/lib/verification-evidence.mjs';
import { runVerification } from '../../scripts/lib/verification-run.mjs';

const summaryEntry = fileURLToPath(new URL('../../scripts/ci-summary.mjs', import.meta.url));
const snapshotEntry = fileURLToPath(new URL('../../scripts/evidence.mjs', import.meta.url));
const verifyEntry = fileURLToPath(new URL('../../scripts/verify.mjs', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-verification-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n');
  writeFileSync(path.join(root, 'source.txt'), 'SYNTHETIC SOURCE\n');
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-verification-'));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const steps = [{ name: 'one', args: ['-e', 'process.exit(0)'] }, { name: 'two', args: ['-e', 'process.exit(0)'] }];
const success = () => ({ status: 0 });
function read(root, relative) { return JSON.parse(readFileSync(path.join(root, relative), 'utf8')); }
function save(root, relative, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path.join(root, relative), bytes);
  return digest(bytes);
}
function tamperReport(root, edit) {
  const pointer = read(root, 'artifacts/verification-latest.json');
  const report = read(root, pointer.report.path);
  edit(report);
  pointer.report.sha256 = save(root, pointer.report.path, report);
  save(root, 'artifacts/verification-latest.json', pointer);
}

test('two real process runs preserve both final reports and manifests without overwriting historical files', t => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'artifacts'));
  writeFileSync(path.join(root, 'artifacts/verification.json'), 'SYNTHETIC HISTORICAL REPORT');
  writeFileSync(path.join(root, 'artifacts/source-manifest.json'), 'SYNTHETIC HISTORICAL MANIFEST');
  const first = runVerification({ root, steps });
  const firstBytes = readFileSync(path.join(root, first.reference.path));
  const second = runVerification({ root, steps });
  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  assert.notEqual(first.report.runId, second.report.runId);
  assert.equal(readdirSync(path.join(root, 'artifacts/verification-runs')).length, 2);
  assert.deepEqual(readFileSync(path.join(root, first.reference.path)), firstBytes);
  assert.equal(readVerificationRun(root).report.runId, second.report.runId);
  assert.equal(readFileSync(path.join(root, 'artifacts/verification.json'), 'utf8'), 'SYNTHETIC HISTORICAL REPORT');
  assert.equal(readFileSync(path.join(root, 'artifacts/source-manifest.json'), 'utf8'), 'SYNTHETIC HISTORICAL MANIFEST');
  assert.throws(() => writeRunJson({ root, directory: path.posix.dirname(first.reference.path) }, 'verification.json', {}), { code: 'EEXIST' });
});

test('an early failed run has its own before and after identity and explicit unperformed checks', t => {
  const root = fixture(t);
  runVerification({ root, steps, execute: success });
  const failed = runVerification({ root, steps, execute: () => ({ status: 7 }) });
  const { report, manifests } = readVerificationRun(root);
  assert.equal(failed.exitCode, 1);
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.results.map(step => [step.status, step.exitCode]), [['FAIL', 7], ['NOT_PERFORMED', null]]);
  assert.equal(manifests.before.runId, failed.report.runId);
  assert.equal(manifests.after.runId, failed.report.runId);
  const summary = spawnSync(process.execPath, [summaryEntry], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: 'false' } });
  assert.equal(summary.status, 0);
  assert.match(summary.stdout, /Résultat : FAIL/);
  assert.match(summary.stdout, /NOT_PERFORMED/);
});

test('source mutation during a successful check invalidates the final result', t => {
  const root = fixture(t);
  const result = runVerification({ root, steps, execute: () => { writeFileSync(path.join(root, 'source.txt'), 'SYNTHETIC CHANGED\n'); return { status: 0 }; } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.candidate.status, 'CHANGED');
  assert.ok(result.report.errors.includes('candidate-changed-during-verification'));
  assert.ok(result.report.results.every(step => step.status === 'PASS'));
  assert.equal(readVerificationRun(root).report.status, 'FAIL');
});

test('designated ignored inputs are captured before and after, including a changed reference set', t => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'artifacts'));
  writeFileSync(path.join(root, 'artifacts/active.json'), '{"synthetic":true}');
  writeFileSync(path.join(root, 'artifacts/added.json'), '{"synthetic":"added"}');
  let paths = ['artifacts/active.json'];
  const result = runVerification({ root, steps, checkpoint: 'artifacts/active.json', inputPaths: () => paths, execute: () => { paths = ['artifacts/active.json', 'artifacts/added.json']; return { status: 0 }; } });
  assert.equal(result.report.candidate.status, 'CHANGED');
  const { manifests } = readVerificationRun(root);
  assert.equal(manifests.before.sourceDigest, manifests.after.sourceDigest);
  assert.notEqual(manifests.before.inputDigest, manifests.after.inputDigest);
});

test('unavailable active inputs prevent all checks and remain a current failed report', t => {
  const root = fixture(t);
  runVerification({ root, steps, execute: success });
  let executed = 0;
  const result = runVerification({ root, steps, inputPaths: () => ['artifacts/missing.json'], execute: () => { executed++; return { status: 0 }; } });
  assert.equal(executed, 0);
  assert.equal(result.report.candidate.status, 'UNAVAILABLE');
  assert.ok(result.report.results.every(step => step.status === 'NOT_PERFORMED'));
  assert.equal(readVerificationRun(root).report.runId, result.report.runId);
});

test('manifest references from a different run are rejected even with a matching file hash', t => {
  const root = fixture(t);
  const first = runVerification({ root, steps, execute: success });
  runVerification({ root, steps, execute: success });
  tamperReport(root, report => { report.candidate.after = first.report.candidate.after; });
  assert.throws(() => readVerificationRun(root), /evidence-reference-mismatch/);
});

test('changed manifest bytes and forged internal digest are rejected independently', t => {
  const root = fixture(t);
  let result = runVerification({ root, steps, execute: success });
  let manifest = read(root, result.report.candidate.after.path);
  manifest.files[0].sha256 = 'a'.repeat(64);
  save(root, result.report.candidate.after.path, manifest);
  assert.throws(() => readVerificationRun(root), /evidence-hash-mismatch/);
  result = runVerification({ root, steps, execute: success });
  manifest = read(root, result.report.candidate.after.path);
  manifest.sourceDigest = 'b'.repeat(64);
  const changedHash = save(root, result.report.candidate.after.path, manifest);
  tamperReport(root, report => { report.candidate.after.sha256 = changedHash; });
  assert.throws(() => readVerificationRun(root), /manifest-digest-mismatch/);
});

test('an interrupted newer run and a different CI run cannot display a historical PASS', t => {
  const root = fixture(t);
  runVerification({ root, steps, execute: success, env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' } });
  assert.throws(() => readVerificationRun(root, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '124', GITHUB_RUN_ATTEMPT: '1' }), /verification-other-ci-run/);
  beginRun(root, 'verification');
  assert.throws(() => readVerificationRun(root), /verification-incomplete/);
  const summary = spawnSync(process.execPath, [summaryEntry], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: 'false' } });
  assert.equal(summary.status, 1);
  assert.doesNotMatch(summary.stdout, /Résultat : PASS|Candidat après/);
});

test('finishing an earlier invocation does not replace the latest invocation pointer', t => {
  const root = fixture(t);
  const older = beginRun(root, 'verification');
  const newer = beginRun(root, 'verification');
  writeLatest(older, { path: `${older.directory}/verification.json`, sha256: 'a'.repeat(64) });
  assert.equal(read(root, 'artifacts/verification-latest.json').runId, newer.runId);
});

test('standalone snapshot runs are retained and cannot replace verification evidence', t => {
  const root = fixture(t);
  const verified = runVerification({ root, steps, execute: success });
  execFileSync(process.execPath, [snapshotEntry], { cwd: root });
  const firstPointer = read(root, 'artifacts/evidence-latest.json');
  const originalBytes = readFileSync(path.join(root, firstPointer.report.path));
  execFileSync(process.execPath, [snapshotEntry], { cwd: root });
  assert.equal(readdirSync(path.join(root, 'artifacts/evidence-runs')).length, 2);
  assert.deepEqual(readFileSync(path.join(root, firstPointer.report.path)), originalBytes);
  assert.equal(readVerificationRun(root).report.runId, verified.report.runId);
});

test('without an active checkpoint the result exposes an explicit limit, not a dossier validation', t => {
  const root = fixture(t);
  const result = runVerification({ root, steps: [...steps, { name: 'lifecycle-active', args: [], required: false, skipReason: 'no-checkpoint-provided' }], execute: success });
  assert.equal(result.report.status, 'PASS');
  assert.equal(result.report.activeCheckpoint.status, 'NOT_PERFORMED');
  assert.match(result.report.limits.join('\n'), /dossiers locaux ignorés ne sont pas validés/);
});

test('unsupported CLI arguments create a failed current run instead of reusing a prior report', t => {
  const root = fixture(t);
  const first = runVerification({ root, steps, execute: success });
  const failed = spawnSync(process.execPath, [verifyEntry, '--unknown'], { cwd: root, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  const { report } = readVerificationRun(root);
  assert.notEqual(report.runId, first.report.runId);
  assert.equal(report.status, 'FAIL');
  assert.ok(report.results.every(step => step.status === 'NOT_PERFORMED'));
});

test('CLI forwards the active checkpoint, root and resume action and captures ignored references', t => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'artifacts'));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'artifacts/active.json'), JSON.stringify({ refinement: { path: 'artifacts/dossier.json', sha256: 'a'.repeat(64) } }));
  writeFileSync(path.join(root, 'artifacts/dossier.json'), '{"synthetic":true}');
  for (const name of ['guard.mjs', 'refinement-check.mjs']) writeFileSync(path.join(root, 'scripts', name), 'process.exit(0);\n');
  writeFileSync(path.join(root, 'scripts/lifecycle-check.mjs'), "import { writeFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nif (args.some(arg => ['artifacts/active.json', 'artifacts/active-work.json'].includes(arg))) { writeFileSync('artifacts/forwarded.json', JSON.stringify(args)); process.exit(5); }\n");
  writeFileSync(path.join(root, 'artifacts/active-work.json'), readFileSync(path.join(root, 'artifacts/active.json')));
  const result = spawnSync(process.execPath, [verifyEntry, '--checkpoint', 'artifacts/active.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(read(root, 'artifacts/forwarded.json'), ['--checkpoint', 'artifacts/active.json', '--root', root, '--action', 'resume']);
  const { report, manifests } = readVerificationRun(root);
  assert.equal(report.activeCheckpoint.status, 'FAIL');
  assert.equal(report.results.find(step => step.name === 'lifecycle-active').exitCode, 5);
  assert.deepEqual(manifests.before.activeInputs.map(entry => entry.path), ['artifacts/active.json', 'artifacts/dossier.json']);
  assert.equal(report.results.find(step => step.name === 'harness').status, 'NOT_PERFORMED');
  const automatic = spawnSync(process.execPath, [verifyEntry], { cwd: root, encoding: 'utf8' });
  assert.equal(automatic.status, 1);
  assert.deepEqual(read(root, 'artifacts/forwarded.json'), ['--checkpoint', 'artifacts/active-work.json', '--root', root, '--action', 'resume']);
  assert.equal(readVerificationRun(root).report.activeCheckpoint.path, 'artifacts/active-work.json');
});

test('source and output paths traversing a linked parent are refused', t => {
  const root = fixture(t);
  const target = path.join(root, 'target');
  mkdirSync(target);
  mkdirSync(path.join(root, 'artifacts'));
  symlinkSync(target, path.join(root, 'artifacts/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(target, 'synthetic.json'), '{"synthetic":true}');
  const result = runVerification({ root, steps, inputPaths: () => ['artifacts/linked/synthetic.json'], execute: success });
  assert.equal(result.report.candidate.status, 'UNAVAILABLE');
  const another = fixture(t);
  mkdirSync(path.join(another, 'target'));
  symlinkSync(path.join(another, 'target'), path.join(another, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => beginRun(another, 'verification'), /linked-input-or-output/);
  assert.deepEqual(readdirSync(path.join(another, 'target')), []);
});

test('real CLI startup failures cannot reuse a previous PASS, including an unparseable entry point', async t => {
  for (const modulePath of ['scripts/refinement-check.mjs', 'scripts/lib/verification-run.mjs', 'scripts/verify.mjs']) {
    for (const failure of ['missing', 'invalid']) {
      await t.test(`${modulePath}: ${failure}`, child => {
        const root = fixture(child);
        for (const relative of ['scripts/verify.mjs', 'scripts/ci-summary.mjs', 'scripts/guard.mjs', 'scripts/refinement-check.mjs', 'scripts/lib/verification-evidence.mjs', 'scripts/lib/verification-run.mjs']) {
          mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
          copyFileSync(path.join(sourceRoot, relative), path.join(root, relative));
        }
        // A separate Node process executes a real passing check and writes its own run.
        execFileSync(process.execPath, ['--input-type=module', '-e', "import { runVerification } from './scripts/lib/verification-run.mjs'; const result = runVerification({ root: process.cwd(), steps: [{ name: 'synthetic-process', args: ['-e', 'process.exit(0)'] }] }); process.exitCode = result.exitCode;"], { cwd: root });
        const summaryArgs = { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: 'false' } };
        const passing = spawnSync(process.execPath, ['scripts/ci-summary.mjs'], summaryArgs);
        assert.equal(passing.status, 0, passing.stderr);
        assert.match(passing.stdout, /Résultat : PASS/);
        const previous = read(root, 'artifacts/verification-latest.json');
        if (failure === 'missing') rmSync(path.join(root, modulePath));
        else writeFileSync(path.join(root, modulePath), 'export const broken = ;\n');
        const failed = spawnSync(process.execPath, ['scripts/verify.mjs'], summaryArgs);
        assert.notEqual(failed.status, 0);
        const current = read(root, 'artifacts/verification-latest.json');
        if (modulePath === 'scripts/verify.mjs') assert.equal(current.runId, previous.runId); // No JS entry point ran.
        else {
          assert.notEqual(current.runId, previous.runId);
          assert.equal(current.report, null); // Invocation exists before mutable module imports.
        }
        const summary = spawnSync(process.execPath, ['scripts/ci-summary.mjs'], summaryArgs);
        assert.equal(summary.status, 1, summary.stderr);
        assert.doesNotMatch(summary.stdout, /Résultat : PASS|Candidat après/);
        assert.match(summary.stdout, /Aucune preuve de vérification courante/);
      });
    }
  }
});

test('summary refuses an ignored input changed after a PASS and a newly present active checkpoint', t => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'artifacts'));
  writeFileSync(path.join(root, 'artifacts/checkpoint.json'), '{"synthetic":true}');
  writeFileSync(path.join(root, 'artifacts/source.json'), '{"synthetic":"original"}');
  runVerification({ root, steps, execute: success, checkpoint: 'artifacts/checkpoint.json', inputPaths: () => ['artifacts/checkpoint.json', 'artifacts/source.json'] });
  assert.equal(readVerificationRun(root).report.status, 'PASS');
  writeFileSync(path.join(root, 'artifacts/source.json'), '{"synthetic":"changed"}');
  assert.throws(() => readVerificationRun(root), /verification-candidate-stale/);
  runVerification({ root, steps, execute: success });
  writeFileSync(path.join(root, 'artifacts/active-work.json'), '{"synthetic":true}');
  assert.throws(() => readVerificationRun(root), /verification-active-checkpoint-unverified/);
});
