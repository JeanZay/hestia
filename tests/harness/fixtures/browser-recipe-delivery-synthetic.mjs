import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { discoverRecipeRepository } from '../../../scripts/lib/browser-recipe-paths.mjs';
import { beginAttempt, decide, finishCampaign, promote, propose, recordAttempt, reportCampaign, startCampaign } from '../../../scripts/lib/browser-recipe.mjs';
import { recipeImpactDigest } from '../../../scripts/lib/browser-recipe-impact.mjs';
import { checkRecipeDelivery, recipeDeliveryScopeDigest } from '../../../scripts/lib/browser-recipe-delivery.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const time = seconds => `2020-10-08T10:00:${String(seconds).padStart(2, '0')}.000Z`;
export const write = (root, file, value) => { const absolute = path.join(root, file); mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return { path: file, sha256: hash(readFileSync(absolute)) }; };
export const load = (root, file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
export function scenario(id = 'folder-new', revision = 1) {
  const data = { schemaVersion: 1, id, title: 'Synthetic folder journey', theme: 'Folders', revision, status: 'active', references: ['README.md'], actor: 'Synthetic owner', rights: ['Create own folder'], preconditions: ['Signed in'], syntheticData: ['Folder SAMPLE'], objective: 'Persist folder', actions: ['Create SAMPLE in UI'], assertions: ['SAMPLE visible after reload'], persistentEffects: ['Folder exists'], cleanup: ['Delete SAMPLE in UI'], stopConditions: ['Session invalid'], dependencies: [] };
  return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n# Synthetic journey\nObserve the folder.\n`;
}
export function buildRecipeDeliveryFixture(root, { old = false } = {}) {
  write(root, 'README.md', 'Synthetic behavior.');
  const proposal = write(root, 'artifacts/new.md', scenario());
  const impact = { schemaVersion: 1, kind: 'browser-recipe-impact', recordedAtUtc: time(0), candidate: { head: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) }, authors: ['author'], source: write(root, 'artifacts/impact-source.txt', 'Synthetic scoped delivery'), conclusions: [{ kind: 'added', scenarioIds: ['folder-new'], reason: 'New journey', references: [proposal] }], reservations: [], review: null };
  impact.review = write(root, 'artifacts/impact-review.json', { schemaVersion: 1, kind: 'browser-recipe-impact-review', recordedAtUtc: time(1), analysisDigest: recipeImpactDigest(impact), reviewer: { identity: 'reviewer', cleanContext: true }, status: 'PASS', openBlockingFindings: 0, evidence: write(root, 'artifacts/impact-review.txt', 'Independent synthetic review') });
  const scope = { schemaVersion: 1, kind: 'browser-recipe-delivery-scope', recordedAtUtc: time(0), authors: ['author'], baseline: old ? [{ id: 'folder-old', revision: 1, sha256: 'c'.repeat(64) }] : [], proposals: [proposal], impacts: [write(root, 'artifacts/impact.json', impact)], review: null };
  if (old) scope.proposals.push(write(root, 'artifacts/old.md', scenario('folder-old', 2)));
  const input = { schemaVersion: 1, kind: 'browser-recipe-delivery', recordedAtUtc: time(1), deployment: { environment: 'Dev', id: 'dev-synthetic', commit: 'a'.repeat(40), url: 'https://dev.example.invalid', observedAt: time(0), source: write(root, 'artifacts/deployment.txt', 'Observed synthetic Dev deployment') }, qa: { status: 'PASS', completedAt: time(1), source: write(root, 'artifacts/qa.txt', 'Synthetic QA PASS') }, scope: null, decision: null, campaigns: [], manualOverride: null };
  const f = { root, input, scope, impact };
  rescope(f); return f;
}
export function rescope(f) {
  f.scope.review = write(f.root, 'artifacts/scope-review.json', { scopeDigest: recipeDeliveryScopeDigest(f.scope), status: 'PASS', reviewer: 'reviewer', cleanContext: true, recordedAtUtc: time(1), evidence: write(f.root, 'artifacts/scope-review.txt', 'Reviewed exact synthetic scope and baseline') });
  f.input.scope = write(f.root, 'artifacts/scope.json', f.scope); save(f);
}
export function save(f) { write(f.root, 'artifacts/delivery.json', f.input); }
export function check(f) { save(f); return checkRecipeDelivery({ root: f.root, inputPath: 'artifacts/delivery.json', now: time(59) }); }
export function choose(f, mode = 'browser', extra = {}) {
  const scopeDigest = check(f).scopeDigest;
  const source = write(f.root, 'artifacts/choice-source.txt', 'I explicitly choose the exact synthetic selection.');
  f.input.decision = write(f.root, 'artifacts/choice.json', { schemaVersion: 1, kind: 'browser-recipe-delivery-choice', mode, scopeDigest, actor: 'Amaury', decidedAt: time(2), source, quote: 'I explicitly choose the exact synthetic selection.', ...extra });
}
export function admit(f, id = 'folder-new', revision = 1) {
  write(f.root, 'artifacts/admit.md', scenario(id, revision)); const proposal = propose({ root: f.root, input: 'artifacts/admit.md' });
  const source = write(f.root, 'artifacts/admit-source.txt', 'Approve this exact synthetic recipe.');
  const decision = decide({ root: f.root, input: { schemaVersion: 1, proposalId: proposal.id, proposalSha256: proposal.proposalSha256, verdict: 'approved', kind: 'human', actor: 'Amaury', author: 'author', decidedAt: time(2), source, quote: 'Approve this exact synthetic recipe.', review: null, diff: null } });
  promote({ root: f.root, input: { proposalId: proposal.id, decisionId: decision.id } });
}
export function campaign(f, outcome = 'PASS', { selection = ['folder-new'], deployment = f.input.deployment, startedAt = time(3), finalized = true } = {}) {
  const authorization = { ...write(f.root, 'artifacts/run-source.txt', 'Run exact synthetic selection.'), quote: 'Run exact synthetic selection.' };
  const context = { executor: 'Synthetic agent', tool: 'Browser Use', browser: 'Synthetic browser', device: 'desktop', model: null, effort: null };
  const c = startCampaign({ root: f.root, input: { selection, deployment, authorization, startedAt, preparations: [], ...context } });
  if (outcome !== 'NOT_RUN') {
    const a = beginAttempt({ root: f.root, input: { campaignId: c.id, scenarioId: selection[0], startedAt: time(4), deployment, preflight: { syntheticAccountsAuthorized: true, preconditionsMet: true, browserAvailable: true }, ...context } });
    if (outcome !== 'INTERRUPTED') recordAttempt({ root: f.root, input: { campaignId: c.id, attemptId: a.id, endedAt: time(5), outcome, waitingMs: null, steps: ['Created in UI'], observations: ['Observed in UI'], limitations: outcome === 'PASS' ? [] : ['Synthetic finding remains'], evidence: [], deployment, environmentState: 'reliable' } });
  }
  if (finalized) finishCampaign({ root: f.root, input: { campaignId: c.id, finishedAt: time(6), reason: 'Synthetic campaign complete' } });
  const reportPath = finalized ? `artifacts/functional-browser/campaigns/${c.id}/finish.json` : `artifacts/observations/${c.id}.json`;
  const report = finalized ? { path: reportPath, sha256: hash(readFileSync(path.join(discoverRecipeRepository(f.root).primaryRoot, reportPath))) } : write(f.root, reportPath, reportCampaign({ root: f.root, campaignId: c.id }));
  f.input.campaigns.push({ id: c.id, report, ...(!finalized ? { observedAt: time(6) } : {}) });
  return c;
}
export function override(f, extra = {}) {
  f.input.manualOverride = write(f.root, 'artifacts/override.json', { schemaVersion: 1, kind: 'browser-recipe-delivery-choice', mode: 'manual', scopeDigest: check(f).scopeDigest, actor: 'Amaury', decidedAt: time(7), source: write(f.root, 'artifacts/override-source.txt', 'Proceed manually after these findings.'), quote: 'Proceed manually after these findings.', reports: f.input.campaigns.map(item => item.report), reservations: ['Observed findings remain open; no Browser PASS claimed.'], ...extra });
}

