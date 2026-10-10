import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditCatalog, beginAttempt, catalogReport, decide, finishCampaign, parseScenario, promote, propose, recordAttempt, reportCampaign, startCampaign } from '../../scripts/lib/browser-recipe.mjs';
import { main } from '../../scripts/browser-recipe.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const time = (seconds) => `2030-10-08T10:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000Z`;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-recipe-')); t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^hestia-recipe-/); rmSync(root, { recursive: true, force: true }); });
  git(root, 'init'); git(root, 'config', 'user.name', 'Synthetic'); git(root, 'config', 'user.email', 'synthetic@example.invalid');
  mkdirSync(path.join(root, 'tests/functional-browser/scenarios'), { recursive: true });
  writeFileSync(path.join(root, 'README.md'), 'Synthetic documented behavior.'); git(root, 'add', '.'); git(root, 'commit', '-m', 'synthetic');
  return root;
}
function write(root, filename, value) { const target = path.join(root, filename); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return { path: filename, sha256: hash(readFileSync(target)) }; }
function scenario(id = 'folder-create', changes = {}, markdown = '# Synthetic recipe\n\nCreate a folder and observe it.\n') {
  return `\`\`\`json\n${JSON.stringify({ schemaVersion: 1, id, title: 'Create folder', theme: 'Folders', revision: 1, status: 'active', references: ['README.md'], actor: 'Synthetic owner', rights: ['Create own folder'], preconditions: ['Signed in'], syntheticData: ['Folder SAMPLE'], objective: 'Persist folder', actions: ['Create SAMPLE in UI'], assertions: ['SAMPLE visible after reload'], persistentEffects: ['Folder exists'], cleanup: ['Delete SAMPLE in UI'], stopConditions: ['Session invalid'], dependencies: [], ...changes }, null, 2)}\n\`\`\`\n${markdown}`;
}
function approval(root, raw, overrides = {}) {
  write(root, 'draft.md', raw); const p = propose({ root, input: 'draft.md' });
  const source = write(root, 'approval.txt', 'Approve this exact synthetic recipe.');
  const d = decide({ root, input: { schemaVersion: 1, proposalId: p.id, proposalSha256: p.proposalSha256, verdict: 'approved', kind: 'human', actor: 'Amaury', author: 'author', decidedAt: time(0), source, quote: 'Approve this exact synthetic recipe.', review: null, diff: null, ...overrides } });
  promote({ root, input: { proposalId: p.id, decisionId: d.id } }); return p;
}
function editorialDecision(root, raw, reviewChanges = {}) {
  const previous = readFileSync(path.join(root, 'tests/functional-browser/scenarios/folder-create.md'), 'utf8');
  write(root, 'editorial-draft.md', raw); const proposal = propose({ root, input: 'editorial-draft.md' });
  const diff = write(root, 'editorial-diff.txt', `--- previous\n+++ proposed\n${previous.split('\n').map((line) => `-${line}`).join('\n')}\n${raw.split('\n').map((line) => `+${line}`).join('\n')}\n`);
  const source = write(root, 'editorial-review-source.txt', 'Reviewed exact source correction.');
  const review = write(root, 'editorial-review.json', { verdict: 'PASS', reviewer: 'reviewer', proposalSha256: proposal.proposalSha256, previousSha256: hash(previous), contractUnchanged: true, justification: 'Same synthetic behavior, replacement source inspected.', diffSha256: diff.sha256, ...reviewChanges });
  const decision = decide({ root, input: { schemaVersion: 1, proposalId: proposal.id, proposalSha256: proposal.proposalSha256, verdict: 'approved', kind: 'editorial', actor: 'reviewer', author: 'author', decidedAt: time(0), source, quote: 'Reviewed exact source correction.', review, diff } });
  return { proposalId: proposal.id, decisionId: decision.id };
}
function target(root, id = 'dev-synthetic-1') { return { environment: 'Dev', url: 'https://dev.example.invalid', id, commit: 'a'.repeat(40), source: write(root, `deployment-${id}.txt`, `Synthetic deployment ${id}`), observedAt: time(0) }; }
function start(root, selection = ['folder-create'], extra = {}) {
  const deployment = target(root); const authorization = { ...write(root, 'campaign-approval.txt', 'Run selected recipes.'), quote: 'Run selected recipes.' };
  return startCampaign({ root, input: { selection, deployment, authorization, startedAt: time(1), executor: 'Synthetic agent', tool: 'Browser Use', browser: 'Synthetic browser', device: 'desktop', model: null, effort: null, preparations: [], ...extra } });
}
function begin(root, campaignId, extra = {}) { return beginAttempt({ root, input: { campaignId, scenarioId: 'folder-create', startedAt: time(2), deployment: target(root), preflight: { syntheticAccountsAuthorized: true, preconditionsMet: true, browserAvailable: true }, executor: 'Synthetic agent', tool: 'Browser Use', browser: 'Synthetic browser', device: 'desktop', model: null, effort: null, ...extra } }); }
function result(root, campaignId, attemptId, extra = {}) { return recordAttempt({ root, input: { campaignId, attemptId, endedAt: time(12), outcome: 'PASS', waitingMs: null, steps: ['UI create performed'], observations: ['UI folder observed'], limitations: [], evidence: [], deployment: target(root), environmentState: 'reliable', ...extra } }); }

test('empty catalog is valid but cannot start without an approved explicit selection', (t) => {
  const root = fixture(t); assert.equal(auditCatalog({ root }).scenarios.length, 0);
  assert.throws(() => start(root, []), /explicit-selection/); assert.throws(() => start(root), /not-approved/);
});
test('proposal exact approval, stale decisions and missing consent', (t) => {
  const root = fixture(t); write(root, 'draft.md', scenario()); const p = propose({ root, input: 'draft.md' });
  assert.throws(() => promote({ root, input: { proposalId: p.id, decisionId: 'missing' } }));
  const source = write(root, 'source.txt', 'Approved');
  const input = { schemaVersion: 1, proposalId: p.id, proposalSha256: 'f'.repeat(64), verdict: 'approved', kind: 'human', actor: 'Amaury', author: 'agent', decidedAt: time(0), source, quote: 'Approved', review: null, diff: null };
  assert.throws(() => decide({ root, input }), /decision-stale/);
  const d = decide({ root, input: { ...input, proposalSha256: p.proposalSha256 } });
  promote({ root, input: { proposalId: p.id, decisionId: d.id } });
  const audit = auditCatalog({ root }); assert.deepEqual(audit.themes, ['Folders']); assert.equal(audit.scenarios.length, 1);
  const file = path.join(root, 'tests/functional-browser/scenarios/folder-create.md'); writeFileSync(file, readFileSync(file, 'utf8').replace('SAMPLE visible after reload', 'Different assertion'));
  assert.throws(() => auditCatalog({ root }), /approval-drift/);
});
test('catalog rejects missing references, malformed metadata, unexpected and duplicate files', (t) => {
  const root = fixture(t); assert.throws(() => parseScenario(scenario('one', { references: ['missing.md'] }), { root, requireApproval: false }));
  assert.throws(() => parseScenario(scenario('one', { actions: [] }), { root, requireApproval: false }), /schema/);
  approval(root, scenario()); write(root, 'tests/functional-browser/scenarios/copy.md', readFileSync(path.join(root, 'tests/functional-browser/scenarios/folder-create.md'), 'utf8'));
  assert.throws(() => auditCatalog({ root }), /filename-mismatch|duplicate/);
});
test('editorial correction requires independent exact review and unchanged business fields', (t) => {
  const root = fixture(t); approval(root, scenario()); const old = readFileSync(path.join(root, 'tests/functional-browser/scenarios/folder-create.md'), 'utf8');
  const raw = scenario('folder-create', { revision: 2, title: 'Create a folder' }); write(root, 'draft.md', raw); const p = propose({ root, input: 'draft.md' });
  const diffText = `--- previous\n+++ proposed\n${old.split('\n').map((line) => `-${line}`).join('\n')}\n${raw.split('\n').map((line) => `+${line}`).join('\n')}\n`;
  const diff = write(root, 'diff.txt', diffText); const source = write(root, 'review-source.txt', 'Reviewed exact editorial correction.');
  const review = write(root, 'review.json', { verdict: 'PASS', reviewer: 'reviewer', proposalSha256: p.proposalSha256, previousSha256: hash(old), contractUnchanged: true, justification: 'Title spelling only, prose unchanged', diffSha256: diff.sha256 });
  const d = decide({ root, input: { schemaVersion: 1, proposalId: p.id, proposalSha256: p.proposalSha256, verdict: 'approved', kind: 'editorial', actor: 'reviewer', author: 'reviewer', decidedAt: time(0), source, quote: 'Reviewed exact editorial correction.', review, diff } });
  assert.throws(() => promote({ root, input: { proposalId: p.id, decisionId: d.id } }), /editorial-review/);
  const good = decide({ root, input: { schemaVersion: 1, proposalId: p.id, proposalSha256: p.proposalSha256, verdict: 'approved', kind: 'editorial', actor: 'reviewer', author: 'author', decidedAt: time(0), source, quote: 'Reviewed exact editorial correction.', review, diff } });
  promote({ root, input: { proposalId: p.id, decisionId: good.id } }); assert.equal(auditCatalog({ root }).scenarios[0].metadata.revision, 2);
});
test('selection dependencies and order never expand silently', (t) => {
  const root = fixture(t); approval(root, scenario()); approval(root, scenario('folder-rename', { dependencies: ['folder-create'] }));
  assert.throws(() => start(root, ['folder-rename']), /dependency/); assert.throws(() => start(root, ['folder-rename', 'folder-create']), /dependency/);
  const c = start(root, ['folder-create', 'folder-rename']); assert.deepEqual(c.selection, ['folder-create', 'folder-rename']);
  assert.throws(() => begin(root, c.id, { scenarioId: 'folder-rename' }), /selection-order/);
});
test('duration from timestamps, unavailable model, final reports and partial selection', (t) => {
  const root = fixture(t); approval(root, scenario()); approval(root, scenario('folder-search'));
  const c = start(root, ['folder-create', 'folder-search']); const a = begin(root, c.id); assert.equal(result(root, c.id, a.id).durationMs, 10000);
  assert.throws(() => result(root, c.id, a.id), /already-recorded/);
  const report = finishCampaign({ root, input: { campaignId: c.id, finishedAt: time(20), reason: 'Stop after selected first recipe' } });
  assert.equal(report.complete, false); assert.deepEqual(report.selection.map((s) => s.outcome), ['PASS', 'NOT_RUN']); assert.equal(report.selection[0].model, null);
  assert.throws(() => finishCampaign({ root, input: { campaignId: c.id, finishedAt: time(21), reason: 'Again' } }), /finalized/);
  assert.throws(() => begin(root, c.id), /finalized/);
});
test('interrupted attempt stays visible, resumption is new and cannot overlap', (t) => {
  const root = fixture(t); approval(root, scenario()); const c = start(root); const a = begin(root, c.id);
  assert.throws(() => begin(root, c.id), /must-resume/);
  const resumed = begin(root, c.id, { resumes: a.id, startedAt: time(4) }); result(root, c.id, resumed.id);
  const report = reportCampaign({ root, campaignId: c.id }); assert.deepEqual(report.selection[0].history.map((r) => r.status), ['INTERRUPTED', 'PASS']);
  assert.equal(catalogReport({ root }).scenarios[0].durations.length, 1);
});
test('unknown identity and failed preflight prohibit PASS while blocked evidence is possible', (t) => {
  const root = fixture(t); approval(root, scenario()); const unknown = { environment: 'Dev', url: 'https://dev.example.invalid', id: null, commit: null, source: null, observedAt: null };
  const c = start(root, ['folder-create'], { deployment: unknown }); const a = begin(root, c.id, { deployment: unknown });
  assert.throws(() => result(root, c.id, a.id, { deployment: unknown }), /pass-requires/); result(root, c.id, a.id, { deployment: unknown, outcome: 'BLOCKED' });
  const c2 = start(root); const a2 = begin(root, c2.id, { preflight: { syntheticAccountsAuthorized: true, preconditionsMet: false, browserAvailable: true } });
  assert.throws(() => result(root, c2.id, a2.id), /pass-requires/);
});
test('deployment drift stops permanently, including drift seen before start', (t) => {
  const root = fixture(t); approval(root, scenario()); const c = start(root); const a = begin(root, c.id);
  assert.throws(() => result(root, c.id, a.id, { deployment: target(root, 'changed') }), /pass-requires/);
  assert.throws(() => begin(root, c.id, { resumes: a.id }), /campaign-stopped/);
  result(root, c.id, a.id, { outcome: 'BLOCKED' }); assert.equal(reportCampaign({ root, campaignId: c.id }).stopped, true);
  const c2 = start(root); assert.throws(() => begin(root, c2.id, { deployment: target(root, 'changed') }), /drift-stop/);
  assert.throws(() => begin(root, c2.id), /campaign-stopped/);
});
test('coverage uses latest attempt for exact scenario and deployment, retains historical PASS', (t) => {
  const root = fixture(t); approval(root, scenario()); const c = start(root); const a = begin(root, c.id); result(root, c.id, a.id);
  const retry = begin(root, c.id, { resumes: a.id, startedAt: time(20) }); result(root, c.id, retry.id, { endedAt: time(30), outcome: 'FAIL' });
  const report = catalogReport({ root, deployment: target(root) }); assert.equal(report.scenarios[0].applicableLatest.status, 'FAIL'); assert.equal(report.scenarios[0].history[0].status, 'PASS');
  assert.equal(catalogReport({ root, deployment: target(root, 'new') }).scenarios[0].applicableLatest, null);
  approval(root, scenario('folder-create', { revision: 2, actions: ['New action'] })); assert.equal(catalogReport({ root, deployment: target(root) }).scenarios[0].applicableLatest, null);
});
test('primary artifacts survive worktree cleanup; snapshots come from caller, never primary catalog', (t) => {
  const root = fixture(t); approval(root, scenario()); git(root, 'add', 'tests'); git(root, 'commit', '-m', 'catalog');
  const worktree = path.join(root, 'artifacts/worktrees/recipe'); git(root, 'worktree', 'add', '-b', 'recipe-test', worktree);
  approval(worktree, scenario('folder-create', { revision: 2, title: 'Worktree specific title' }));
  const c = start(worktree); const report = reportCampaign({ root, campaignId: c.id }); assert.equal(report.selection[0].title, 'Worktree specific title');
  git(root, 'worktree', 'remove', '--force', worktree); assert.equal(reportCampaign({ root, campaignId: c.id }).selection[0].outcome, 'NOT_RUN');
  assert.equal(readdirSync(path.join(root, 'artifacts/functional-browser/campaigns')).length, 1);
});
test('path escapes and secrets rejected with safe CLI diagnostics', (t) => {
  const root = fixture(t); assert.throws(() => propose({ root, input: '../outside.md' }), /path-outside/);
  write(root, '.env', 'not read'); assert.throws(() => propose({ root, input: '.env' }), /guard/);
  const secret = `ghp_${'x'.repeat(40)}`; write(root, 'secret.json', { value: secret }); const output = [];
  assert.equal(main(['decision', '--input', 'secret.json'], root, (value) => output.push(value)), 1); assert.equal(JSON.stringify(output).includes(secret), false);
});
test('editorial path cannot change business contract or bypass review attachments', (t) => {
  const root = fixture(t); approval(root, scenario());
  const raw = scenario('folder-create', { revision: 2, actor: 'Different actor' }); write(root, 'draft.md', raw); const p = propose({ root, input: 'draft.md' });
  const source = write(root, 'editorial-source.txt', 'Review this correction');
  const data = { schemaVersion: 1, proposalId: p.id, proposalSha256: p.proposalSha256, verdict: 'approved', kind: 'editorial', actor: 'reviewer', author: 'author', decidedAt: time(0), source, quote: 'Review this correction', review: null, diff: null };
  assert.throws(() => decide({ root, input: data }), /review-and-diff/);
  const review = write(root, 'review.json', { verdict: 'PASS', reviewer: 'reviewer', contractUnchanged: true }); const diff = write(root, 'diff.txt', 'Claimed diff');
  const decision = decide({ root, input: { ...data, review, diff } });
  assert.throws(() => promote({ root, input: { proposalId: p.id, decisionId: decision.id } }), /editorial-business-change/);
});
test('editorial source replacement preserves old approval hashes and never transfers historical PASS', (t) => {
  const root = fixture(t); approval(root, scenario());
  const previous = auditCatalog({ root }).scenarios[0];
  const campaign = start(root); const attempt = begin(root, campaign.id); result(root, campaign.id, attempt.id);
  write(root, 'docs/public-source.md', 'Same synthetic requirement in a durable public source.');
  const raw = scenario('folder-create', { revision: 2, references: ['docs/public-source.md'] });
  const input = editorialDecision(root, raw); const promotion = promote({ root, input });
  const current = auditCatalog({ root }).scenarios[0];
  assert.equal(promotion.qualification, 'NOT_RUN');
  assert.notEqual(current.contractSha256, previous.contractSha256);
  assert.notEqual(current.sha256, previous.sha256);
  assert.equal(parseScenario(previous.text).contractSha256, previous.metadata.approval.contractSha256);
  assert.equal(current.contractSha256, current.metadata.approval.contractSha256);
  const coverage = catalogReport({ root, deployment: target(root) }).scenarios[0];
  assert.equal(coverage.applicableLatest, null); assert.equal(coverage.history[0].status, 'PASS');
});
test('editorial source replacements still reject missing references at proposal and promotion', (t) => {
  const root = fixture(t); approval(root, scenario());
  const raw = scenario('folder-create', { revision: 2, references: ['docs/public-source.md'] });
  write(root, 'draft.md', raw); assert.throws(() => propose({ root, input: 'draft.md' }), /ENOENT/);
  write(root, 'docs/public-source.md', 'Synthetic source.'); const input = editorialDecision(root, raw);
  rmSync(path.join(root, 'docs/public-source.md'));
  assert.throws(() => promote({ root, input }), /ENOENT/);
  assert.equal(auditCatalog({ root }).scenarios[0].metadata.revision, 1);
});
for (const [field, changed] of Object.entries({ actor: 'Other member', rights: ['Other right'], preconditions: ['Other precondition'], syntheticData: ['Other fixture'], objective: 'Other outcome', actions: ['Other action'], assertions: ['Other assertion'], persistentEffects: ['Other effect'], cleanup: ['Other cleanup'], stopConditions: ['Other stop condition'], dependencies: ['other-recipe'], status: 'retired', theme: 'Other theme', id: 'other-recipe' })) {
  test(`editorial source replacement cannot conceal a change to ${field}`, (t) => {
    const root = fixture(t); approval(root, scenario()); write(root, 'public.md', 'Synthetic source.');
    const raw = scenario('folder-create', { revision: 2, references: ['public.md'], [field]: changed });
    const input = editorialDecision(root, raw);
    assert.throws(() => promote({ root, input }), /editorial-business-change/);
    assert.equal(auditCatalog({ root }).scenarios[0].metadata.revision, 1);
  });
}
for (const reviewChanges of [{ contractUnchanged: false }, { previousSha256: 'a'.repeat(64) }, { proposalSha256: 'a'.repeat(64) }, { diffSha256: 'a'.repeat(64) }, { reviewer: 'author' }]) {
  test(`source correction requires exact independent review: ${Object.keys(reviewChanges)[0]}=${Object.values(reviewChanges)[0]}`, (t) => {
    const root = fixture(t); approval(root, scenario()); write(root, 'public.md', 'Synthetic source.');
    const input = editorialDecision(root, scenario('folder-create', { revision: 2, references: ['public.md'] }), reviewChanges);
    assert.throws(() => promote({ root, input }), /editorial-review-required|editorial-diff-required/);
    assert.equal(auditCatalog({ root }).scenarios[0].metadata.revision, 1);
  });
}
test('retired recipes cannot be selected and model identity requires explicit provenance', (t) => {
  const root = fixture(t); approval(root, scenario());
  assert.throws(() => start(root, ['folder-create'], { model: { value: 'Known model' } }), /source-required/);
  const c = start(root, ['folder-create'], { model: { value: 'Known model', source: 'Observed session metadata' }, effort: { value: 'high', source: 'Observed session metadata' } });
  assert.equal(reportCampaign({ root, campaignId: c.id }).selection[0].model, null);
  approval(root, scenario('folder-create', { revision: 2, status: 'retired' }));
  assert.throws(() => start(root), /retired/); assert.equal(reportCampaign({ root, campaignId: c.id }).selection.length, 1);
});
test('invalid dates, partial UI evidence, duplicate metadata and source drift fail closed', (t) => {
  const root = fixture(t); approval(root, scenario('folder-create', { assertions: ['Shown', 'Persists'] }));
  assert.throws(() => parseScenario(scenario().replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'), { requireApproval: false }), /scenario-json/);
  assert.throws(() => start(root, ['folder-create'], { startedAt: '2030-02-30T10:00:00Z' }), /timestamp/);
  const c = start(root); const a = begin(root, c.id); assert.throws(() => result(root, c.id, a.id), /pass-requires/);
  assert.throws(() => result(root, c.id, a.id, { endedAt: time(1) }), /negative-duration/);
  result(root, c.id, a.id, { observations: ['Shown', 'Persists'] }); finishCampaign({ root, input: { campaignId: c.id, finishedAt: time(15), reason: 'Completed' } });
  const final = reportCampaign({ root, campaignId: c.id }); assert.equal(final.finishedAt, time(15));
  write(root, `artifacts/functional-browser/campaigns/${c.id}/attempts/${a.id}/deployment-start.txt`, 'Altered source');
  assert.throws(() => reportCampaign({ root, campaignId: c.id }), /source-drift/);
});
test('every attempt records its effective context; retry never inherits campaign or previous model', (t) => {
  const root = fixture(t); approval(root, scenario());
  const c = start(root, ['folder-create'], { model: { value: 'Campaign model', source: 'Campaign session' }, effort: { value: 'high', source: 'Campaign session' } });
  assert.throws(() => begin(root, c.id, { executor: undefined }), /attempt-input-schema/);
  assert.throws(() => begin(root, c.id, { unexpectedField: 'must reject' }), /attempt-input-schema/);
  assert.throws(() => begin(root, c.id, { model: { value: 'Unproven model' } }), /attempt-input-schema/);
  const first = begin(root, c.id, { model: { value: 'First actual model', source: 'First actual session' }, effort: { value: 'medium', source: 'First actual session' } });
  result(root, c.id, first.id);
  const second = begin(root, c.id, { resumes: first.id, startedAt: time(20), executor: 'Different agent', tool: 'Another UI tool', browser: 'Other browser', device: 'mobile-simulated', model: null, effort: null });
  result(root, c.id, second.id, { endedAt: time(30), outcome: 'FAIL' });
  const report = reportCampaign({ root, campaignId: c.id });
  assert.equal(report.selection[0].executor, 'Different agent'); assert.equal(report.selection[0].model, null); assert.equal(report.selection[0].effort, null);
  assert.equal(report.selection[0].history[0].model.value, 'First actual model'); assert.equal(report.selection[0].history[1].browser, 'Other browser');
  const coverage = catalogReport({ root, deployment: target(root) }).scenarios[0];
  assert.equal(coverage.history[0].model.value, 'First actual model'); assert.equal(coverage.latest.model, null);
  assert.equal(coverage.durations[0].effort.value, 'medium'); assert.equal(coverage.durations[1].model, null); assert.equal(coverage.durations[1].effort, null);
});
test('maximum scenario ID remains usable through proposal, decision, promotion and campaign', (t) => {
  const root = fixture(t); const id = 's'.repeat(80);
  const p = approval(root, scenario(id)); assert.equal(p.id.length, 97);
  assert.equal(auditCatalog({ root }).scenarios[0].metadata.id, id);
  assert.deepEqual(start(root, [id]).selection, [id]);
  assert.throws(() => parseScenario(scenario(`${id}s`), { requireApproval: false }), /scenario-schema/);
});
