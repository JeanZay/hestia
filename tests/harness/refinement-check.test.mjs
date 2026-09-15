import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { computeDigests, main, validateJsonSchema, validateRefinement, validateTaskContract } from '../../scripts/refinement-check.mjs';
import { approval, authorized, candidate, clone, fixtureDate, fixtureRepo, handoff, plan, published, ready, refreshMutations, signBrief } from './fixtures/refinement-synthetic.mjs';

const entry = fileURLToPath(new URL('../../scripts/refinement-check.mjs', import.meta.url));
const template = JSON.parse(readFileSync(new URL('../../harness/templates/refinement.template.json', import.meta.url), 'utf8'));
function valid(record) { const result = validateRefinement(record); assert.equal(result.valid, true, JSON.stringify(result.errors)); return result; }
function invalid(record) { const result = validateRefinement(record); assert.equal(result.valid, false, 'An incoherent dossier must be rejected.'); assert.ok(result.errors.length > 0); return result; }
function withTemporary(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'hestia-refinement-test-'));
  try { return run(directory); } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('hestia-refinement-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('exploration and candidate are valid without pretending to have approval', () => {
  valid(template); valid(candidate());
  const record = clone(template); record.stage = 'ready'; invalid(record);
});

test('all stages are reachable with their distinct synthetic evidence', () => {
  const brief = candidate(); brief.stage = 'brief-validated'; signBrief(brief);
  for (const record of [brief, plan(), authorized(), published(), ready()]) valid(record);
});

test('one consent reference can describe distinct publication and execution scopes', () => {
  const record = ready();
  const before = computeDigests(record);
  record.readiness.handoffs[0].contract.authorization.source = record.approvals.publication.source;
  valid(record);
  assert.deepEqual(computeDigests(record), before, 'Source validation must not silently change historical digest semantics.');
  record.readiness.handoffs[0].contract.authorization.source = '   ';
  assert.ok(invalid(record).errors.some((error) => error.code === 'execution-authorization-source-empty'));
});

test('schema rejects missing domains, unknown fields, invalid dates and real-data mode', () => {
  for (const mutate of [
    (r) => { delete r.brief.decisions.security; },
    (r) => { r.unknown = 'not in schema'; },
    (r) => { r.source.capturedAt = 'not-a-date'; },
    (r) => { r.dataPolicy = 'family-real'; },
    (r) => { r.brief.criteria[0].negative = '   '; }
  ]) { const record = candidate(); mutate(record); invalid(record); }
});

test('accepted decisions and answered questions require a recorded source', () => {
  const decision = candidate(); decision.brief.decisions.product[0].source = null; invalid(decision);
  const record = candidate(); record.brief.questions.push({ id: 'Q_RECOVERY', domain: 'ux', text: 'Comment reprendre ?', blocking: true, status: 'answered', answer: null, evidence: null }); invalid(record);
});

test('a nonblocking question may remain unanswered with an explicit recorded deferral', () => {
  const record = candidate();
  record.brief.questions.push({ id: 'Q_LATER', domain: 'ux', text: 'Quel parcours secondaire ?', blocking: false, status: 'deferred', answer: null, evidence: 'Report explicite synthétique, hors périmètre de cette version, 2026-09-12.' });
  valid(record); record.stage = 'brief-validated'; signBrief(record); valid(record);
  record.brief.questions[0].evidence = null; invalid(record);
});

test('brief approval cannot be replaced by publication approval or inferred from stage', () => {
  const record = plan(); record.approvals.brief = null; invalid(record);
  const publication = authorized(); publication.approvals.publication = null; invalid(publication);
  const briefOnly = plan(); briefOnly.stage = 'publication-authorized'; invalid(briefOnly);
});

test('changed nuance, decision, source or destination invalidates exact brief approval', () => {
  for (const mutate of [
    (r) => r.nuances.push('Nouvelle nuance non approuvée.'),
    (r) => { r.brief.decisions.product[0].statement = 'Un autre comportement.'; },
    (r) => { r.source.original = 'Une autre demande.'; },
    (r) => { r.plan.repository = 'https://github.com/example/other-fixture'; }
  ]) { const record = authorized(); mutate(record); invalid(record); }
});

test('hashes ignore object key order but preserve content and array order', () => {
  const record = authorized();
  const reversed = Object.fromEntries(Object.entries(record).reverse());
  assert.deepEqual(computeDigests(record), computeDigests(reversed));
  const changed = clone(record); changed.plan.issues.reverse();
  assert.equal(computeDigests(record).brief, computeDigests(changed).brief);
  assert.notEqual(computeDigests(record).publication, computeDigests(changed).publication);
});

test('changed exact publication body needs new publication approval only', () => {
  const record = authorized(); record.plan.issues[0].body += ' Précision nouvelle.'; refreshMutations(record);
  assert.equal(record.approvals.brief.digest, computeDigests(record).brief);
  invalid(record);
  record.approvals.publication = approval(computeDigests(record).publication); valid(record);
});

test('published issue bodies must contain the structured scope and acceptance contract', () => {
  const record = plan();
  const mutation = record.plan.mutations[0]; const payload = JSON.parse(mutation.payload);
  payload.body = 'Un simple texte qui omet les critères et les limites.';
  mutation.payload = JSON.stringify(payload); invalid(record);
});

test('duplicate keys, unknown dependencies, cycles and wrong order are rejected', () => {
  for (const mutate of [
    (r) => { r.plan.issues[1].key = 'keep'; },
    (r) => { r.plan.issues[0].dependencies = ['missing']; },
    (r) => { r.plan.issues[0].dependencies = ['clear']; },
    (r) => { r.plan.order.reverse(); },
    (r) => { r.plan.order.push('keep'); }
  ]) { const record = plan(); mutate(record); refreshMutations(record); invalid(record); }
});

test('issue criteria must reference actual brief criteria', () => {
  const record = plan(); record.plan.issues[0].briefCriteria = ['not_in_brief']; invalid(record);
});

test('cross-repository targets and identical receipt URLs are refused', () => {
  const record = plan(); record.plan.mutations[0].target = 'https://github.com/example/other-fixture'; invalid(record);
  const duplicate = published(); duplicate.publication.receipts[1].url = duplicate.publication.receipts[0].url; invalid(duplicate);
});

test('publication must be complete and reread with the exact content digests', () => {
  const incomplete = published(); incomplete.publication.receipts.pop(); invalid(incomplete);
  const stale = published(); stale.publication.receipts[0].digest = '0'.repeat(64); invalid(stale);
  const wrongTarget = published(); wrongTarget.publication.receipts[0].url = `${fixtureRepo}/issues/999`; // Creation may return any new issue number.
  valid(wrongTarget);
});

test('partial publication preserves receipts without claiming the plan was fully published', () => {
  const record = published(); record.stage = 'publication-authorized'; record.publication.receipts.pop();
  valid(record);
  record.stage = 'published'; invalid(record);
});

test('internal dependencies need explicit approved GitHub relation mutations', () => {
  const record = plan(); record.plan.mutations = record.plan.mutations.filter((mutation) => mutation.kind !== 'link-dependency');
  invalid(record);
});

test('a relation readback belongs to its source issue, not an unrelated issue in the repository', () => {
  const record = published(); record.publication.receipts.find((r) => r.mutationKey === 'link_clear_keep').url = `${fixtureRepo}/issues/909`;
  invalid(record);
});

test('a plan must publish the complete approved brief and handoff its actual reread reference', () => {
  const missing = plan(); missing.plan.mutations = missing.plan.mutations.filter((m) => m.kind !== 'publish-brief'); invalid(missing);
  const abridged = plan(); abridged.plan.mutations.find((m) => m.kind === 'publish-brief').payload = JSON.stringify({ body: 'Le seul identifiant du critère ne constitue pas le brief.' }); invalid(abridged);
  const noReference = ready(); delete noReference.readiness.handoffs[0].briefReference; invalid(noReference);
  const wrongVersion = ready(); wrongVersion.readiness.handoffs[0].briefReference.digest = '0'.repeat(64); invalid(wrongVersion);
  const wrongIssue = ready(); wrongIssue.publication.receipts.find((r) => r.mutationKey === 'publish_brief').url = `${fixtureRepo}/issues/909#issuecomment-500`; invalid(wrongIssue);
});

test('the approved brief may be published on an issue created by this same plan', () => {
  const record = plan(); const mutation = record.plan.mutations.find((m) => m.kind === 'publish-brief');
  mutation.target = fixtureRepo; mutation.issueKey = 'keep';
  refreshMutations(record);
  record.stage = 'publication-authorized'; record.approvals.publication = approval(computeDigests(record).publication); valid(record);
  const digests = computeDigests(record);
  record.publication.receipts = published().publication.receipts.map((receipt) => ({ ...receipt, digest: digests.mutations[receipt.mutationKey], ...(receipt.mutationKey === 'publish_brief' ? { url: `${fixtureRepo}/issues/101#issuecomment-500` } : {}) }));
  record.stage = 'ready'; record.readiness.handoffs = [handoff(record, 'keep')]; valid(record);
});

test('newly created issue URLs cannot disguise a self dependency as external', () => {
  const record = ready();
  record.plan.issues[0].dependencies = [`${fixtureRepo}/issues/101`]; refreshMutations(record);
  record.readiness.dependencyEvidence[0].dependency = `${fixtureRepo}/issues/101`;
  record.readiness.dependencyEvidence[0].url = `${fixtureRepo}/issues/101`;
  record.approvals.publication = approval(computeDigests(record).publication);
  for (const receipt of record.publication.receipts) receipt.digest = computeDigests(record).mutations[receipt.mutationKey];
  invalid(record);
});

test('only selected issues are ready, a published predecessor is not a completed dependency', () => {
  const record = ready(); valid(record);
  record.readiness.handoffs.push(handoff(record, 'clear')); invalid(record);
  record.readiness.dependencyEvidence.push({ issueKey: 'clear', dependency: 'keep', url: `${fixtureRepo}/issues/101`, verifiedAt: fixtureDate, state: 'satisfied', evidence: 'PREUVE SYNTHETIQUE : parcours keep vérifié sur candidat synthetic-v2, environnement local.' });
  valid(record);
});

test('pending or absent prerequisite proof prevents handoff', () => {
  const pending = ready(); pending.readiness.dependencyEvidence[0].state = 'pending'; invalid(pending);
  const missing = ready(); missing.readiness.dependencyEvidence = []; invalid(missing);
});

test('blocking question or preparation cannot be deferred into readiness', () => {
  for (const mutate of [
    (r) => r.brief.questions.push({ id: 'Q_OPEN', domain: 'product', text: 'Quel résultat choisir ?', blocking: true, status: 'deferred', answer: null, evidence: 'Décision différée dans le scénario.' }),
    (r) => r.brief.preparations.push({ id: 'P_SPIKE', kind: 'spike', reason: 'Mesurer avant implémentation.', blocking: true, status: 'needed', evidence: null })
  ]) { const record = ready(); mutate(record); refreshMutations(record); signBrief(record); record.approvals.publication = approval(computeDigests(record).publication); for (const receipt of record.publication.receipts) receipt.digest = computeDigests(record).mutations[receipt.mutationKey]; invalid(record); }
});

test('handoff scope, criteria, validation, URL and execution authorization stay bound', () => {
  for (const mutate of [
    (h) => { h.contract.scope.included.push('Un comportement supplémentaire.'); },
    (h) => { h.contract.acceptanceCriteria.pop(); },
    (h) => { h.contract.validation = ['Un contrôle différent.']; },
    (h) => { h.contract.githubIssue = `${fixtureRepo}/issues/102`; },
    (h) => { h.authorizationConfirmedSeparately = false; },
    (h) => { h.contract.independentReview.required = false; }
  ]) { const record = ready(); mutate(record.readiness.handoffs[0]); invalid(record); }
});

test('existing task contracts can be checked independently', () => {
  const contract = ready().readiness.handoffs[0].contract;
  const result = validateTaskContract(contract);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const bad = clone(contract); bad.authorization.allowedActions = [];
  assert.equal(validateTaskContract(bad).valid, false);
});

test('the supported schema subset fails closed even for unused definitions', () => {
  const errors = validateJsonSchema({}, { type: 'object', $defs: { unused: { type: 'string', imaginaryRule: true } } });
  assert.ok(errors.length > 0);
});

test('CLI scans ignored JSON and escaped token content without echoing it', () => withTemporary((directory) => {
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  writeFileSync(path.join(directory, '.gitignore'), 'artifacts/\n'); mkdirSync(path.join(directory, 'artifacts'));
  const token = `ghp_${'x'.repeat(36)}`;
  const record = candidate(); record.source.original = token;
  const file = path.join(directory, 'artifacts', 'dossier.json');
  writeFileSync(file, JSON.stringify(record).replace('ghp_', '\\u0067hp_'));
  const result = spawnSync(process.execPath, [entry, file], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.ok(!`${result.stdout}${result.stderr}`.includes(token));
}));

test('CLI refuses malformed JSON, oversized files and missing input without unsafe diagnostics', () => withTemporary((directory) => {
  const file = path.join(directory, 'dossier.json');
  for (const content of ['{private fragment', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    writeFileSync(file, content);
    const output = []; assert.notEqual(main([file], directory, (line) => output.push(line)), 0);
    assert.ok(!output.join('\n').includes('private fragment'));
  }
  assert.notEqual(main([path.join(directory, 'missing.json')], directory, () => {}), 0);
  assert.notEqual(main(['--publish', file], directory, () => {}), 0);
}));

test('CLI refuses a linked parent before opening an external dossier', () => withTemporary((directory) => {
  const real = path.join(directory, 'real'); mkdirSync(real);
  writeFileSync(path.join(real, 'dossier.json'), JSON.stringify(candidate()));
  const linked = path.join(directory, 'linked'); symlinkSync(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(main([path.join(linked, 'dossier.json')], directory, () => {}), 0);
}));
