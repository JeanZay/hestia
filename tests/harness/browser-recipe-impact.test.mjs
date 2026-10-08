import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkRecipeImpact, recipeImpactDigest } from '../../scripts/lib/browser-recipe-impact.mjs';
import { captureCandidate, digest } from '../../scripts/lib/verification-evidence.mjs';
import { runVerification } from '../../scripts/lib/verification-run.mjs';

const when = '2026-10-01T00:00:00Z';
const cli = fileURLToPath(new URL('../../scripts/lib/browser-recipe-impact.mjs', import.meta.url));
const verifyCli = fileURLToPath(new URL('../../scripts/verify.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-recipe-impact-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-recipe-impact-'));
    rmSync(root, { recursive: true, force: true });
  });
  const put = (relative, content) => {
    const bytes = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), bytes);
    return { path: relative, sha256: digest(bytes) };
  };
  put('.gitignore', 'artifacts/\n');
  put('synthetic.txt', 'SYNTHETIC INPUT\n');
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Synthetic initial input'], { cwd: root });
  const source = put('artifacts/source.md', 'SYNTHETIC scoped contract; no deployment or permission.\n');
  const evidence = put('artifacts/review.md', 'SYNTHETIC independent review, not a real consent.\n');
  const snapshot = captureCandidate({ root, runId: 'synthetic', phase: 'snapshot' });
  const impactPath = 'artifacts/impact.json';
  const impact = { schemaVersion: 1, kind: 'browser-recipe-impact', recordedAtUtc: when, candidate: { head: snapshot.commit, sourceDigest: snapshot.sourceDigest }, authors: ['author'], source, conclusions: [{ kind: 'no-impact', scenarioIds: [], reason: 'Synthetic harness change with explicit no-impact reasoning.', references: [source] }], reservations: ['Proposals await a separate human decision; no browser execution.'], review: { path: 'artifacts/impact-review.json', sha256: 'a'.repeat(64) } };
  const review = { schemaVersion: 1, kind: 'browser-recipe-impact-review', recordedAtUtc: when, analysisDigest: recipeImpactDigest(impact), reviewer: { identity: 'reviewer', cleanContext: true }, status: 'PASS', openBlockingFindings: 0, evidence };
  const save = ({ refreshReview = true } = {}) => {
    if (refreshReview) review.analysisDigest = recipeImpactDigest(impact);
    impact.review = put('artifacts/impact-review.json', review);
    put(impactPath, impact);
  };
  save();
  return { root, put, impactPath, impact, review, save, check: () => checkRecipeImpact({ root, impactPath }) };
}

test('valid reservations remain PASS for documentation only; all exact inputs are captured without a hash cycle', t => {
  const f = fixture(t);
  const result = f.check();
  assert.equal(result.status, 'PASS');
  assert.equal(result.browserExecuted, false);
  assert.equal(result.consentAuthenticated, false);
  assert.deepEqual(result.reservations, f.impact.reservations);
  assert.deepEqual(result.references.map(item => item.path), ['artifacts/impact-review.json', 'artifacts/impact.json', 'artifacts/review.md', 'artifacts/source.md']);
  const verification = runVerification({ root: f.root, inputPaths: () => f.check().references.map(item => item.path), steps: [{ name: 'browser-recipe-impact', args: [cli, 'check', f.impactPath] }] });
  assert.equal(verification.report.status, 'PASS');
  const manifest = JSON.parse(readFileSync(path.join(f.root, verification.report.candidate.after.path)));
  assert.equal(manifest.sourceDigest, f.impact.candidate.sourceDigest);
  assert.deepEqual(manifest.activeInputs.map(item => item.path).sort(), result.references.map(item => item.path).sort());
  const cliResult = spawnSync(process.execPath, [cli, 'check', f.impactPath], { cwd: f.root, encoding: 'utf8' });
  assert.equal(cliResult.status, 0);
  assert.equal(JSON.parse(cliResult.stdout).browserExecuted, false);
});

for (const kind of ['unchanged', 'added', 'modified', 'retired']) test(`${kind} is an explicit sourced conclusion`, t => {
  const f = fixture(t);
  f.impact.conclusions[0].kind = kind;
  f.impact.conclusions[0].scenarioIds = ['synthetic-scenario'];
  f.save();
  assert.equal(f.check().status, 'PASS');
});

test('missing input, changed source bytes and stale candidate are rejected', t => {
  const f = fixture(t);
  assert.throws(() => checkRecipeImpact({ root: f.root, impactPath: 'artifacts/missing.json' }), { code: 'ENOENT' });
  f.put('artifacts/source.md', 'SYNTHETIC changed source\n');
  assert.throws(f.check, /recipe-impact-reference-drift/);
  f.impact.source = f.put('artifacts/source.md', 'SYNTHETIC restored reviewed source\n');
  f.impact.conclusions[0].references = [f.impact.source]; f.save();
  f.put('synthetic.txt', 'SYNTHETIC changed candidate\n');
  assert.throws(f.check, /recipe-impact-candidate-stale/);
});

for (const [name, change, code] of [
  ['self-review', f => { f.review.reviewer.identity = 'AUTHOR'; }, 'recipe-impact-review-not-passed'],
  ['blocking finding', f => { f.review.openBlockingFindings = 1; }, 'recipe-impact-review-not-passed'],
  ['not performed review', f => { f.review.status = 'NOT_PERFORMED'; }, 'recipe-impact-review-not-passed'],
  ['unknown fields', f => { f.impact.approvedForDev = true; }, 'recipe-impact-invalid-analysis'],
  ['empty rationale', f => { f.impact.conclusions[0].reason = ' '; }, 'recipe-impact-invalid-analysis'],
  ['unsourced no impact', f => { f.impact.conclusions[0].references = []; }, 'recipe-impact-invalid-analysis'],
  ['no impact with selected scenarios', f => { f.impact.conclusions[0].scenarioIds = ['example']; }, 'recipe-impact-conclusion-invalid'],
  ['changed scenario without identity', f => { f.impact.conclusions[0].kind = 'modified'; }, 'recipe-impact-conclusion-invalid'],
  ['future review', f => { f.review.recordedAtUtc = '2999-01-01T00:00:00Z'; }, 'recipe-impact-invalid-date'],
  ['escape reference', f => { f.impact.source.path = '../outside.md'; }, 'recipe-impact-invalid-path'],
]) test(`refuses ${name}`, t => {
  const f = fixture(t); change(f); f.save();
  assert.throws(f.check, new RegExp(code));
});

test('a changed conclusion needs a new exact independent review, not just a refreshed wrapper hash', t => {
  const f = fixture(t);
  f.impact.conclusions[0].reason = 'SYNTHETIC changed assessment.';
  f.save({ refreshReview: false });
  assert.throws(f.check, /recipe-impact-review-stale/);
});

test('deleted review and malformed review cannot be treated as documentary PASS', t => {
  const f = fixture(t);
  rmSync(path.join(f.root, f.impact.review.path));
  assert.throws(f.check, { code: 'ENOENT' });
  f.impact.review = f.put('artifacts/impact-review.json', { status: 'PASS' });
  f.put(f.impactPath, f.impact);
  assert.throws(f.check, /recipe-impact-invalid-review/);
});

test('duplicate JSON fields and linked evidence parents fail closed', t => {
  const f = fixture(t);
  const original = readFileSync(path.join(f.root, f.impactPath), 'utf8');
  f.put(f.impactPath, original.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'));
  assert.throws(f.check, /duplicate-json-key/);
  const source = f.put('artifacts/source-directory/source.md', 'SYNTHETIC linked source\n');
  symlinkSync(path.join(f.root, 'artifacts/source-directory'), path.join(f.root, 'artifacts/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  f.impact.source = { ...source, path: 'artifacts/linked/source.md' };
  f.save();
  assert.throws(f.check, /linked-input-or-output/);
});

test('verify forwards the explicit impact and captures its exact review while retaining automated browser tests', t => {
  const f = fixture(t);
  for (const name of ['guard.mjs', 'refinement-check.mjs', 'lifecycle-check.mjs', 'design-prompt.mjs', 'browser-recipe.mjs']) f.put(`scripts/${name}`, 'process.exit(0);\n');
  f.put('scripts/lib/browser-recipe-impact.mjs', "import {writeFileSync} from 'node:fs'; writeFileSync('artifacts/forwarded.json',JSON.stringify(process.argv.slice(2))); process.exit(3);\n");
  const snapshot = captureCandidate({ root: f.root, runId: 'synthetic', phase: 'snapshot' });
  f.impact.candidate = { head: snapshot.commit, sourceDigest: snapshot.sourceDigest }; f.save();
  const result = spawnSync(process.execPath, [verifyCli, '--recipe-impact', f.impactPath], { cwd: f.root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.root, 'artifacts/forwarded.json'))), ['check', f.impactPath]);
  const latest = JSON.parse(readFileSync(path.join(f.root, 'artifacts/verification-latest.json')));
  const report = JSON.parse(readFileSync(path.join(f.root, latest.report.path)));
  assert.equal(report.results.find(item => item.name === 'browser-recipe-catalog').status, 'PASS');
  assert.equal(report.results.find(item => item.name === 'browser-recipe-impact').exitCode, 3);
  assert.equal(report.results.find(item => item.name === 'browser').required, true);
  const manifest = JSON.parse(readFileSync(path.join(f.root, report.candidate.before.path)));
  assert.deepEqual(manifest.activeInputs.map(item => item.path).sort(), f.check().references.map(item => item.path).sort());
});

test('CI without a designated impact reports it not verified and does not require private evidence', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [verifyCli], { cwd: f.root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.equal(result.status, 1, 'The synthetic checkout has no real suite scripts.');
  const latest = JSON.parse(readFileSync(path.join(f.root, 'artifacts/verification-latest.json')));
  const report = JSON.parse(readFileSync(path.join(f.root, latest.report.path)));
  const impact = report.results.find(item => item.name === 'browser-recipe-impact');
  assert.equal(impact.status, 'NOT_PERFORMED');
  assert.equal(impact.required, false);
  assert.equal(impact.reason, 'recipe-impact-not-provided-not-verified');
  const manifest = JSON.parse(readFileSync(path.join(f.root, report.candidate.before.path)));
  assert.deepEqual(manifest.activeInputs, []);
});
