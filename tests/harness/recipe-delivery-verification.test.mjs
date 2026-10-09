import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkRecipeDelivery } from '../../scripts/lib/browser-recipe-delivery.mjs';
import { primaryRecipeInputPath, recipeVerificationInputs, readVerificationRun } from '../../scripts/lib/verification-evidence.mjs';
import { runVerification } from '../../scripts/lib/verification-run.mjs';
import { buildRecipeDeliveryFixture, choose, admit, campaign, save, time } from './fixtures/browser-recipe-delivery-synthetic.mjs';
import { main } from '../../scripts/browser-recipe.mjs';

test('CLI reports waiting without handoff permission and rejects an absent input', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-recipe-cli-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const fixture = buildRecipeDeliveryFixture(root);
    const output = [];
    assert.equal(main(['delivery', 'check', '--input', 'artifacts/delivery.json'], root, value => output.push(value)), 0);
    assert.equal(output.at(-1).state, 'CHOICE_REQUIRED');
    assert.equal(output.at(-1).manualReady, false);
    choose(fixture, 'manual'); save(fixture);
    assert.equal(main(['delivery', 'check', '--input', 'artifacts/delivery.json'], root, value => output.push(value)), 0);
    assert.equal(output.at(-1).manualReady, true);
    assert.equal(main(['delivery', 'check'], root, value => output.push(value)), 1);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-recipe-cli-'));
    rmSync(root, { recursive: true, force: true });
  }
});

test('linked-worktree verification captures actual shared campaign bytes and rejects later drift', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-recipe-shared-'));
  const primary = path.join(root, 'primary'); const worktree = path.join(root, 'worktree');
  mkdirSync(primary);
  const git = args => execFileSync('git', args, { cwd: primary, stdio: 'pipe' });
  try {
    git(['init', '--quiet']);
    writeFileSync(path.join(primary, '.gitignore'), 'artifacts/\n');
    git(['add', '.gitignore']);
    git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Synthetic repository']);
    git(['worktree', 'add', '--quiet', '-b', 'synthetic-recipe', worktree]);
    const fixture = buildRecipeDeliveryFixture(worktree); choose(fixture); admit(fixture); campaign(fixture); save(fixture);
    const checked = checkRecipeDelivery({ root: worktree, inputPath: 'artifacts/delivery.json', now: time(59) });
    assert.equal(checked.manualReady, true, JSON.stringify(checked));
    const inputPaths = () => recipeVerificationInputs(worktree, checkRecipeDelivery({ root: worktree, inputPath: 'artifacts/delivery.json', now: time(59) }).references);
    assert.ok(inputPaths().some(file => file.startsWith('@primary/artifacts/functional-browser/campaigns/')));
    const result = runVerification({ root: worktree, steps: [{ name: 'synthetic-gate', args: [] }], inputPaths,
      execute: () => ({ status: checkRecipeDelivery({ root: worktree, inputPath: 'artifacts/delivery.json', now: time(59) }).manualReady ? 0 : 1 }) });
    assert.equal(result.exitCode, 0, JSON.stringify(result.report));
    assert.equal(readVerificationRun(worktree).report.status, 'PASS');
    const shared = checked.references.find(item => path.isAbsolute(item.path) && item.path.endsWith('authorization.txt'));
    assert.ok(shared);
    writeFileSync(shared.path, readFileSync(shared.path, 'utf8') + '\nSynthetic changed evidence');
    assert.throws(() => readVerificationRun(worktree), /verification-candidate-stale/);
    assert.throws(() => recipeVerificationInputs(worktree, [{ path: path.join(root, 'outside.txt') }]), /invalid-primary-recipe-input/);
    for (const value of ['@primary/README.md', '@primary/artifacts/functional-browser/campaigns/../other', '@primary/artifacts/functional-browser/campaigns/x\\y']) assert.throws(() => primaryRecipeInputPath(value), /invalid-primary-recipe-input/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-recipe-shared-'));
    rmSync(root, { recursive: true, force: true });
  }
});
