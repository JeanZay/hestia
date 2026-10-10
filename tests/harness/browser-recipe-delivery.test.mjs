import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverRecipeRepository, parseScenario } from '../../scripts/lib/browser-recipe.mjs';
import { recipeDeliveryChoiceDigest } from '../../scripts/lib/browser-recipe-delivery.mjs';
import { buildRecipeDeliveryFixture, write, load, time, scenario, rescope, check, choose, admit, campaign, override } from './fixtures/browser-recipe-delivery-synthetic.mjs';

function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-recipe-delivery-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^hestia-recipe-delivery-/); rmSync(root, { recursive: true, force: true }); });
  for (const args of [['init'], ['config', 'user.name', 'Synthetic'], ['config', 'user.email', 'synthetic@example.invalid']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  write(root, 'README.md', 'Synthetic behavior.');
  for (const args of [['add', '.'], ['commit', '-m', 'synthetic']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  return buildRecipeDeliveryFixture(root, options);
}

function assertCapturedCampaign(f, c, result) {
  const folder = `artifacts/functional-browser/campaigns/${c.id}`;
  const report = load(f.root, `${folder}/finish.json`);
  const expected = [
    `${folder}/attempts/${report.selection[0].history[0].id}/result.json`,
    `${folder}/finish.json`,
    'artifacts/impact-review.txt',
  ];
  // A primary-root reference can be absolute on Windows even for the same
  // checkout (drive casing or an expanded short path). Compare the actual file.
  for (const relative of expected) {
    const absolute = realpathSync.native(path.resolve(f.root, relative));
    const captured = result.references.filter(item => realpathSync.native(path.resolve(f.root, item.path)) === absolute);
    assert.equal(captured.length, 1, `Expected exactly one captured reference for ${relative}`);
    assert.equal(captured[0].sha256, createHash('sha256').update(readFileSync(absolute)).digest('hex'), `Captured bytes differ for ${relative}`);
  }
}

test('silence requires choice and no recipe is implicitly admitted or run', t => {
  const f = fixture(t); const result = check(f);
  assert.equal(result.state, 'CHOICE_REQUIRED'); assert.equal(result.manualReady, false); assert.equal(result.browserReady, false);
  assert.equal(result.selection[0].outcome, 'NOT_RUN'); assert.equal(result.browserExecuted, false);
});
test('manual choice permits unadmitted proposals and preserves NOT_RUN', t => {
  const f = fixture(t); choose(f, 'manual'); const result = check(f);
  assert.equal(result.state, 'READY_FOR_MANUAL'); assert.equal(result.manualReady, true); assert.equal(result.browserReady, false);
  assert.equal(result.selection[0].outcome, 'NOT_RUN'); assert.ok(result.reservations.length);
});
test('browser choice needs exact admission then a campaign, approval does not stale scope', t => {
  const f = fixture(t); choose(f); const before = check(f); assert.equal(before.state, 'ADMISSION_REQUIRED');
  admit(f); const after = check(f); assert.equal(after.state, 'CAMPAIGN_REQUIRED'); assert.equal(after.browserReady, true); assert.equal(after.scopeDigest, before.scopeDigest);
});
test('old recipes stay excluded even if modified and the catalogue contains them', t => {
  const f = fixture(t, { old: true }); admit(f, 'folder-old', 2); const result = check(f);
  assert.equal(result.state, 'CHOICE_REQUIRED'); assert.deepEqual(result.selection.map(item => item.id), ['folder-new']);
});
test('scope must cover every added impact and review must cover exact scope', t => {
  const f = fixture(t); f.scope.proposals = []; rescope(f); assert.equal(check(f).state, 'BLOCKED'); assert.ok(check(f).diagnostics.includes('recipe-delivery-added-coverage-incomplete'));
  const g = fixture(t); g.scope.baseline.push({ id: 'other', revision: 1, sha256: 'a'.repeat(64) }); g.input.scope = write(g.root, 'artifacts/scope.json', g.scope);
  assert.ok(check(g).diagnostics.includes('recipe-delivery-review-stale'));
});
test('changed candidate, selection revision or content cannot inherit a choice', t => {
  const f = fixture(t); choose(f, 'manual'); f.input.deployment.commit = 'c'.repeat(40); assert.equal(check(f).state, 'CHOICE_REQUIRED');
  const g = fixture(t); choose(g, 'manual'); g.scope.proposals[0] = write(g.root, 'artifacts/new.md', scenario('folder-new', 2));
  // Impact keeps its original proposal reference and correctly rejects first.
  rescope(g); assert.equal(check(g).state, 'BLOCKED');
  const parsed = parseScenario(scenario(), { requireApproval: false }); const next = parseScenario(scenario('folder-new', 2), { requireApproval: false });
  assert.notEqual(recipeDeliveryChoiceDigest(f.input.deployment, [{ id: parsed.metadata.id, revision: 1, contentSha256: parsed.contentSha256 }]), recipeDeliveryChoiceDigest(f.input.deployment, [{ id: next.metadata.id, revision: 2, contentSha256: next.contentSha256 }]));
});
test('changed source hashes, invalid actor, absent quote and future decision do not authorize', t => {
  for (const extra of [{ actor: 'agent' }, { quote: 'not in source' }, { decidedAt: '2031-01-01T00:00:00Z' }, { decidedAt: time(0) }]) {
    const f = fixture(t); choose(f, 'manual', extra); assert.equal(check(f).state, 'CHOICE_REQUIRED');
  }
  const f = fixture(t); choose(f, 'manual'); write(f.root, 'artifacts/choice-source.txt', 'changed'); assert.equal(check(f).state, 'CHOICE_REQUIRED');
});
test('actual exact final PASS permits manual handoff and captures supporting files', t => {
  const f = fixture(t); choose(f); admit(f); const c = campaign(f); const result = check(f);
  assert.equal(result.state, 'READY_FOR_MANUAL', result.diagnostics.join(',')); assert.equal(result.selection[0].outcome, 'PASS');
  assertCapturedCampaign(f, c, result);
});

test('Windows drive-case aliases retain exact absolute campaign evidence', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t); choose(f); admit(f); const c = campaign(f);
  const primary = discoverRecipeRepository(f.root).primaryRoot;
  assert.match(primary, /^[A-Za-z]:/);
  const drive = primary[0] === primary[0].toUpperCase() ? primary[0].toLowerCase() : primary[0].toUpperCase();
  const aliased = { ...f, root: `${drive}${primary.slice(1)}` };
  assert.notEqual(path.resolve(aliased.root), path.resolve(primary));
  assert.equal(realpathSync.native(aliased.root), realpathSync.native(primary));
  const result = check(aliased);
  assert.equal(result.state, 'READY_FOR_MANUAL', result.diagnostics.join(',')); assert.equal(result.selection[0].outcome, 'PASS');
  assert.ok(result.references.some(item => path.isAbsolute(item.path) && path.basename(item.path) === 'result.json'));
  assertCapturedCampaign(aliased, c, result);
});
test('FAIL BLOCKED NOT_RUN and interrupted campaigns require a new explicit decision', t => {
  for (const outcome of ['FAIL', 'BLOCKED', 'NOT_RUN', 'INTERRUPTED']) {
    const f = fixture(t); choose(f); admit(f); campaign(f, outcome); const result = check(f);
    assert.equal(result.state, 'REDECISION_REQUIRED', result.diagnostics.join(',')); assert.equal(result.manualReady, false);
    assert.equal(result.selection[0].outcome, outcome); assert.ok(result.reservations.length);
  }
});
test('explicit manual override follows findings, names exact reports and preserves them', t => {
  const f = fixture(t); choose(f); admit(f); campaign(f, 'FAIL'); const reference = f.input.campaigns[0].report; const bytes = readFileSync(path.join(f.root, reference.path));
  override(f, { decidedAt: time(5) }); assert.equal(check(f).state, 'REDECISION_REQUIRED');
  override(f, { reports: [] }); assert.equal(check(f).state, 'REDECISION_REQUIRED');
  override(f); const result = check(f); assert.equal(result.state, 'READY_FOR_MANUAL'); assert.equal(result.selection[0].outcome, 'FAIL'); assert.ok(result.reservations.length >= 2);
  assert.deepEqual(readFileSync(path.join(f.root, reference.path)), bytes);
});
test('unfinished campaign uses an exact observation and permits explicit manual override', t => {
  const f = fixture(t); choose(f); admit(f); campaign(f, 'INTERRUPTED', { finalized: false });
  assert.equal(check(f).state, 'REDECISION_REQUIRED'); override(f);
  const result = check(f); assert.equal(result.state, 'READY_FOR_MANUAL', result.diagnostics.join(',')); assert.equal(result.selection[0].outcome, 'INTERRUPTED');
});
test('refreshed review on unchanged scope does not require repeating the choice', t => {
  const f = fixture(t); choose(f, 'manual'); const review = load(f.root, 'artifacts/scope-review.json'); review.recordedAtUtc = time(10);
  f.scope.review = write(f.root, 'artifacts/scope-review.json', review); f.input.scope = write(f.root, 'artifacts/scope.json', f.scope);
  assert.equal(check(f).state, 'READY_FOR_MANUAL');
});
test('a fresh direct manual choice cannot erase a failed campaign without override', t => {
  const f = fixture(t); choose(f); admit(f); campaign(f, 'FAIL'); choose(f, 'manual', { decidedAt: time(7) });
  assert.equal(check(f).state, 'REDECISION_REQUIRED'); assert.equal(check(f).selection[0].outcome, 'FAIL');
});
test('omitting an existing failed or interrupted campaign cannot bypass manual redecision', t => {
  for (const outcome of ['FAIL', 'INTERRUPTED']) {
    const f = fixture(t); choose(f); admit(f); campaign(f, outcome, { finalized: outcome !== 'INTERRUPTED' });
    f.input.campaigns = []; choose(f, 'manual', { decidedAt: time(7) });
    const result = check(f); assert.equal(result.state, 'REDECISION_REQUIRED'); assert.ok(result.diagnostics.includes('recipe-delivery-existing-campaign-omitted'));
  }
});
test('a new deployment observation of the same identity does not reset initial QA or choice', t => {
  const f = fixture(t); choose(f, 'manual'); f.input.deployment.observedAt = time(10);
  assert.equal(check(f).state, 'READY_FOR_MANUAL');
});
test('PASS on other deployment or before choice is inapplicable', t => {
  for (const options of [{ deploymentChange: true }, { startedAt: time(1) }]) {
    const f = fixture(t); choose(f); admit(f);
    campaign(f, 'PASS', options.deploymentChange ? { deployment: { ...f.input.deployment, id: 'old-dev' } } : options);
    assert.equal(check(f).state, 'REDECISION_REQUIRED'); assert.equal(check(f).selection[0].outcome, options.deploymentChange ? 'NOT_RUN' : 'PASS');
  }
});
test('extra selected old recipe cannot count as delivery selection PASS', t => {
  const f = fixture(t, { old: true }); choose(f); admit(f); admit(f, 'folder-old', 2);
  campaign(f, 'PASS', { selection: ['folder-new', 'folder-old'] }); assert.equal(check(f).state, 'REDECISION_REQUIRED');
});
test('forged report summary is rejected by reconstructing campaign attempts', t => {
  const f = fixture(t); choose(f); admit(f); campaign(f, 'FAIL'); const item = f.input.campaigns[0]; const report = load(f.root, item.report.path);
  report.allPassed = true; report.selection[0].outcome = 'PASS'; item.report = write(f.root, item.report.path, report);
  assert.notEqual(check(f).state, 'READY_FOR_MANUAL');
});
test('future QA and failing QA block handoff', t => {
  const f = fixture(t); f.input.qa.status = 'FAIL'; assert.equal(check(f).state, 'BLOCKED');
  f.input.qa.status = 'PASS'; f.input.qa.completedAt = '2031-01-01T00:00:00Z'; assert.equal(check(f).state, 'BLOCKED');
});
test('unsafe paths, guarded contents and linked parents fail without leaking content', t => {
  const f = fixture(t); f.input.scope.path = '../outside.json'; assert.equal(check(f).state, 'BLOCKED');
  const g = fixture(t); const secret = `ghp_${'x'.repeat(40)}`; write(g.root, 'artifacts/scope-review.txt', secret); const result = check(g);
  assert.equal(result.state, 'BLOCKED'); assert.equal(JSON.stringify(result).includes(secret), false);
  const h = fixture(t); symlinkSync(path.join(h.root, 'artifacts'), path.join(h.root, 'linked'), 'junction'); h.input.scope.path = 'linked/scope.json'; assert.equal(check(h).state, 'BLOCKED');
});
