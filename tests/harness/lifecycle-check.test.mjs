import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { computeCoverageDigest, inspectCheckpoint, ownershipConflicts, referencedFiles, validateLifecycle } from '../../scripts/lifecycle-check.mjs';
import { computeDigests, validateRefinement } from '../../scripts/refinement-check.mjs';
import { handoff, ready, refreshMutations, signBrief } from './fixtures/refinement-synthetic.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = path.join(root, 'scripts/lifecycle-check.mjs');
const now = '2026-09-15T00:01:00Z';
const when = '2026-09-15T00:00:00Z';
const quote = "ACCORD SYNTHETIQUE : je valide ce brief, j'engage ce besoin, j'autorise sa publication exacte et son exécution locale.";
const resolution = 'DECISION SYNTHETIQUE : les cas de sélection, absence et récupération suivent les décisions du scénario.';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function put(directory, relative, value) {
  const target = path.join(directory, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : json(value));
  return { path: relative, sha256: sha(readFileSync(target)) };
}

function withFixture(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'hestia-lifecycle-test-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    put(directory, '.gitignore', 'artifacts/\n');
    const record = ready();
    record.brief.decisions.ux[0].status = 'accepted';
    record.brief.decisions.ux[0].source = 'Décision synthétique sourcée.';
    record.brief.decisions.architecture.push({ id: 'D_ARCH', status: 'accepted', statement: 'Le stockage reste local et contient des identifiants fictifs.', rationale: 'Aucune dépendance distante pour le scénario.', source: 'Décision synthétique sourcée.' });
    function sealRecord() {
      refreshMutations(record);
      signBrief(record);
      record.approvals.publication.digest = computeDigests(record).publication;
      for (const receipt of record.publication.receipts) receipt.digest = computeDigests(record).mutations[receipt.mutationKey];
      record.readiness.handoffs = [handoff(record, 'keep')];
      assert.equal(validateRefinement(record).valid, true);
    }
    sealRecord();
    const briefDigest = computeDigests(record).brief;
    const fixtureSource = put(directory, 'artifacts/continuity/source.md', `# Scénario fictif de test\n\n${quote}\n\n${resolution}\n`);
    const code = put(directory, 'src/synthetic.txt', 'SELECTION SYNTHETIQUE v1\n');
    const files = [{ path: '.gitignore', sha256: sha(readFileSync(path.join(directory, '.gitignore'))) }, code];
    const sourceDigest = sha(JSON.stringify(files));
    const manifest = put(directory, 'artifacts/continuity/candidate.json', { createdAt: when, sourceDigest, files });
    const review = {
      kind: 'brief-review', briefDigest, criterionIds: ['C_KEEP'], reviewedAtUtc: when, authors: ['fixture-author'],
      reviewer: { identity: 'fixture-reviewer', effectiveModel: 'SYNTHETIC-MODEL-FOR-TEST-ONLY', cleanContext: true },
      providedContext: ['Dossier synthétique exact, sans raisonnement de son auteur.'], verdict: 'PASS', openBlockingFindings: 0,
    };
    const checkpoint = {
      schemaVersion: 1, templateOnly: false, id: 'synthetic-current-need', recordedAtUtc: when, status: 'active',
      need: { id: 'synthetic-selection', title: 'Sélection fictive persistante', githubIssue: 'https://github.com/example/hestia-fixture/issues/3' },
      refinement: put(directory, 'artifacts/continuity/refinement.json', record),
      contract: put(directory, 'artifacts/continuity/contract.json', record.readiness.handoffs[0].contract),
      sources: [{ id: 'source', kind: 'conversation', capturedAtUtc: when, file: fixtureSource }],
      agreements: [{ id: 'one-message', sourceId: 'source', quote, recordedAtUtc: when, actions: ['brief', 'engage', 'publish', 'execute'], briefDigest, criterionIds: ['C_KEEP'], status: 'active' }],
      engagement: { agreementIds: ['one-message'], briefDigest, criterionIds: ['C_KEEP'] },
      qualification: {
        status: 'complete', briefDigest, review: put(directory, 'artifacts/continuity/brief-review.json', review),
        coverage: [
          ['product', 'nominal', 'D_PRODUCT', 'La personne fictive sélectionne un exemple puis recharge.', 'La même référence synthétique est présente.'],
          ['ux', 'recovery', 'D_UX', 'La personne quitte la page pendant la sélection puis revient.', 'Une confirmation décrit la sélection conservée.'],
          ['security', 'negative', 'D_SECURITY', 'Une référence extérieure au jeu synthétique est présentée.', 'La référence inconnue est refusée sans modifier la sélection.'],
          ['architecture', 'boundary', 'D_ARCH', 'Le service distant est absent dans ce test autonome.', 'Les identifiants synthétiques restent disponibles localement.'],
        ].map(([domain, kind, decision, scenario, expected]) => ({ id: `case_${domain}`, domain, kind, criterionIds: ['C_KEEP'], scenario, expected, evidence: 'Parcours synthétique et assertion du résultat observable.', status: 'resolved', decisionRefs: [`${domain}:${decision}`], resolution: { sourceId: 'source', quote: resolution } })),
      },
      candidate: { manifest, sourceDigest, environment: 'local', capturedAtUtc: when },
      observations: [], dependencyLevels: [{ url: 'https://github.com/example/hestia-fixture/issues/7', environment: 'local' }],
      ownership: [{ agent: 'writer', paths: ['src'] }, { agent: 'tester', paths: ['tests'] }],
      nextAction: { owner: 'agent', action: 'Exécuter le lot fictif déjà cadré.', support: 'Le contrat synthétique référencé.', expectedResponse: 'Preuves des contrôles et revue du candidat implémenté.', unblocks: 'La livraison locale du seul scénario de test.' },
    };
    review.coverageDigest = computeCoverageDigest(checkpoint.qualification.coverage);
    checkpoint.qualification.review = put(directory, 'artifacts/continuity/brief-review.json', review);
    function observation(id, kind, subject, environment, candidateDigest = null) {
      const observed = { kind, subject, observedAtUtc: when, maxAgeSeconds: 3600, candidateDigest, environment, status: 'satisfied', evidence: 'OBSERVATION FABRIQUEE POUR TEST UNIQUEMENT, aucune lecture ou livraison réelle.' };
      const file = put(directory, `artifacts/continuity/${id}.json`, observed);
      return { id, ...Object.fromEntries(Object.entries(observed).filter(([key]) => key !== 'evidence')), file };
    }
    checkpoint.observations.push(observation('github-read', 'github', checkpoint.need.githubIssue, 'GitHub'));
    checkpoint.observations.push(observation('dependency-proof', 'dependency', checkpoint.dependencyLevels[0].url, 'local', 'd'.repeat(64)));
    function save() { return put(directory, 'artifacts/continuity/checkpoint.json', checkpoint); }
    function updateRecord() {
      checkpoint.refinement = put(directory, checkpoint.refinement.path, record);
      checkpoint.contract = put(directory, checkpoint.contract.path, record.readiness.handoffs[0].contract);
    }
    return run({ directory, record, checkpoint, review, save, updateRecord, sealRecord, observation });
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('hestia-lifecycle-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

function check(fixture, action = 'execute') { return validateLifecycle(fixture.checkpoint, { root: fixture.directory, now, action }); }
function has(result, code) { assert.ok(result.diagnostics.some((item) => item.code === code), JSON.stringify(result.diagnostics)); }

test('synthetic template resumes but cannot plan or execute, with no implicit consent', () => {
  const result = inspectCheckpoint('harness/templates/lifecycle.template.json', { root, now });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.planningReadiness, false);
  assert.equal(result.executionReadiness, false);
  assert.equal(result.humanConsentAuthenticated, false);
  assert.equal(result.remoteStateVerified, false);
});

test('one explicit synthetic message can cover distinct actions without repeated micro approvals', () => withFixture((fixture) => {
  const result = check(fixture);
  assert.equal(result.executionReadiness, true, JSON.stringify(result.diagnostics));
  assert.equal(result.humanConsentAuthenticated, false);
  assert.equal(result.remoteStateVerified, false);
  assert.equal(fixture.checkpoint.observations.some((item) => ['validation', 'review'].includes(item.kind)), false, 'Future code checks are not a prerequisite to begin implementation.');
}));

test('scope approval alone preserves context but grants neither brief approval nor engagement', () => withFixture((fixture) => {
  fixture.checkpoint.agreements[0].actions = ['scope'];
  fixture.checkpoint.engagement = null;
  const result = check(fixture, 'resume');
  assert.equal(result.resumable, true, JSON.stringify(result.diagnostics));
  assert.equal(result.planningReadiness, false);
  has(result, 'brief-not-fully-approved'); has(result, 'need-not-engaged');
}));

test('an approved broad brief can stay without stories until the need is engaged', () => withFixture((fixture) => {
  const { record, checkpoint } = fixture;
  record.stage = 'brief-validated'; record.plan.issues = []; record.plan.order = []; record.plan.mutations = [];
  record.approvals.publication = null; record.publication.receipts = [];
  record.readiness.dependencyEvidence = []; record.readiness.handoffs = [];
  checkpoint.refinement = put(fixture.directory, checkpoint.refinement.path, record);
  checkpoint.engagement = null;
  checkpoint.agreements[0].actions = ['brief'];
  const result = check(fixture, 'resume');
  assert.equal(result.resumable, true, JSON.stringify(result.diagnostics));
  has(result, 'need-not-engaged');
  assert.equal(result.planningReadiness, false);
}));

test('stories without applicable engagement cannot pass the planning action', () => withFixture((fixture) => {
  fixture.checkpoint.engagement = null;
  const result = check(fixture, 'plan');
  assert.equal(result.valid, false); has(result, 'stories-before-engagement');
}));

test('partial engagement cannot be expanded to additional criteria by the checkpoint', () => withFixture((fixture) => {
  fixture.record.brief.criteria.push({ id: 'C_ADDITIONAL', positive: 'Le second parcours conserve son résultat au rechargement.', negative: 'Une référence invalide est rejetée par le second parcours.', evidence: 'Essai synthétique du second parcours après rechargement.' });
  fixture.record.plan.issues[1].briefCriteria.push('C_ADDITIONAL');
  fixture.sealRecord(); fixture.updateRecord();
  const digest = computeDigests(fixture.record).brief;
  fixture.checkpoint.agreements[0].briefDigest = digest;
  fixture.checkpoint.engagement.briefDigest = digest;
  fixture.checkpoint.engagement.criterionIds.push('C_ADDITIONAL');
  const result = check(fixture);
  assert.equal(result.executionReadiness, false); has(result, 'brief-not-fully-approved');
  has(result, 'engagement-agreement-missing');
  assert.deepEqual(fixture.checkpoint.agreements[0].criterionIds, ['C_KEEP'], 'The partial approval must remain unchanged.');
}));

test('a historical V1 ready dossier does not qualify itself for the new lifecycle', () => withFixture((fixture) => {
  const before = computeDigests(fixture.record);
  fixture.checkpoint.engagement = null;
  fixture.checkpoint.qualification = { status: 'pending', briefDigest: null, coverage: [], review: null };
  const result = check(fixture, 'resume');
  assert.equal(result.resumable, true);
  assert.equal(result.executionReadiness, false);
  assert.deepEqual(computeDigests(fixture.record), before);
  has(result, 'qualification-incomplete-or-stale');
}));

test('missing domain, negative scenario and unresolved scenario stop planning before execution', () => withFixture((fixture) => {
  fixture.checkpoint.qualification.coverage = fixture.checkpoint.qualification.coverage.filter((scenario) => scenario.domain !== 'security');
  fixture.checkpoint.qualification.coverage[0].status = 'open';
  const result = check(fixture, 'plan');
  assert.equal(result.valid, false); has(result, 'domain-not-covered'); has(result, 'criterion-scenario-missing'); has(result, 'scenario-unresolved');
}));

test('proposed decisions and an unexamined determining hypothesis prevent planning', () => withFixture((fixture) => {
  fixture.record.brief.decisions.ux[0].status = 'proposed';
  fixture.record.brief.hypotheses.push({ id: 'H_RETENTION', statement: 'La sélection survit à une interruption du stockage.', status: 'untested', evidence: null });
  fixture.sealRecord(); fixture.updateRecord();
  const result = check(fixture, 'plan');
  assert.equal(result.valid, false); has(result, 'decision-unresolved'); has(result, 'hypothesis-unexamined');
}));

test('unrelated unregistered future work is not read and cannot block the active need', () => withFixture((fixture) => {
  put(fixture.directory, 'artifacts/unrelated-future-need.json', { status: 'paused', questions: ['A future decision outside this need remains open.'] });
  assert.equal(check(fixture).executionReadiness, true);
  fixture.checkpoint.backlog = [{ need: 'unrelated' }];
  assert.equal(check(fixture, 'resume').structuralValid, false, 'A checkpoint must not become a backlog list.');
}));

test('paused cancelled and superseded checkpoints block every requested action', () => withFixture((fixture) => {
  for (const status of ['paused', 'cancelled', 'superseded']) {
    fixture.checkpoint.status = status;
    for (const action of ['resume', 'plan', 'execute']) {
      const result = check(fixture, action); assert.equal(result.valid, false); has(result, `checkpoint-${status}`);
      assert.equal(result.nextAction, null, 'An inactive checkpoint must not return its old execution instruction.');
    }
  }
}));

test('revoked and superseded agreement traces remain readable but cannot satisfy engagement', () => withFixture((fixture) => {
  fixture.checkpoint.agreements[0].status = 'withdrawn';
  const result = check(fixture, 'resume');
  assert.equal(result.resumable, true); assert.equal(result.executionReadiness, false); has(result, 'engagement-agreement-missing');
}));

test('source byte changes and invented quotes fail resume, including ignored references', () => withFixture((fixture) => {
  const source = fixture.checkpoint.sources[0];
  put(fixture.directory, source.file.path, 'Une source différente, sans les décisions citées.\n');
  const changed = check(fixture, 'resume'); assert.equal(changed.resumable, false); has(changed, 'reference-digest-mismatch');
  assert.equal(changed.nextAction, null, 'A broken context must not return an actionable old instruction.');
  source.file = put(fixture.directory, source.file.path, 'Une source différente, sans les décisions citées.\n');
  const invented = check(fixture, 'resume'); assert.equal(invented.resumable, false); has(invented, 'source-quote-mismatch');
}));

test('a relocated source needs an explicit locator update while preserving identical bytes', () => withFixture((fixture) => {
  const source = fixture.checkpoint.sources[0];
  renameSync(path.join(fixture.directory, source.file.path), path.join(fixture.directory, 'artifacts/continuity/moved.md'));
  const missing = check(fixture, 'resume'); assert.equal(missing.resumable, false); has(missing, 'reference-missing');
  source.file.path = 'artifacts/continuity/moved.md';
  assert.equal(check(fixture).executionReadiness, true);
}));

test('references reject escapes, symlinks and symlinked parent directories', () => withFixture((fixture) => {
  const original = fixture.checkpoint.sources[0].file.path;
  for (const unsafe of ['../outside.md', 'C:/outside.md', '/outside.md', 'artifacts/../outside.md', 'artifacts\\outside.md']) {
    fixture.checkpoint.sources[0].file.path = unsafe;
    const result = check(fixture, 'resume'); assert.equal(result.resumable, false); has(result, 'path-outside-root');
  }
  fixture.checkpoint.sources[0].file.path = original;
  symlinkSync(path.join(fixture.directory, 'artifacts/continuity'), path.join(fixture.directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fixture.checkpoint.sources[0].file.path = 'linked/source.md';
  const linked = check(fixture, 'resume'); assert.equal(linked.resumable, false); has(linked, 'unsupported-link');
}));

test('old observations remain readable, future or rewritten timestamps do not create fresh proof', () => withFixture((fixture) => {
  const observation = fixture.checkpoint.observations[0];
  observation.maxAgeSeconds = 1;
  const observed = JSON.parse(readFileSync(path.join(fixture.directory, observation.file.path)));
  observed.maxAgeSeconds = 1;
  observation.file = put(fixture.directory, observation.file.path, observed);
  const old = check(fixture); assert.equal(old.resumable, true); assert.equal(old.executionReadiness, false); has(old, 'observation-stale');
  fixture.checkpoint.observations[0].observedAtUtc = '2099-01-01T00:00:00Z';
  const future = check(fixture); assert.equal(future.resumable, false); has(future, 'future-or-invalid-date'); has(future, 'observation-content-mismatch');
}));

test('extending expiry in the checkpoint alone cannot refresh an unchanged old observation', () => withFixture((fixture) => {
  const observation = fixture.checkpoint.observations[0];
  const observed = JSON.parse(readFileSync(path.join(fixture.directory, observation.file.path)));
  observed.maxAgeSeconds = 1;
  observation.maxAgeSeconds = 1;
  observation.file = put(fixture.directory, observation.file.path, observed);
  const before = readFileSync(path.join(fixture.directory, observation.file.path));
  const stale = check(fixture); assert.equal(stale.resumable, true); assert.equal(stale.executionReadiness, false); has(stale, 'observation-stale');
  observation.maxAgeSeconds = 2592000;
  const extended = check(fixture);
  assert.equal(extended.resumable, false); assert.equal(extended.executionReadiness, false); has(extended, 'observation-content-mismatch');
  assert.deepEqual(readFileSync(path.join(fixture.directory, observation.file.path)), before, 'The rejected extension must not modify the frozen proof.');
}));

test('dependency evidence at local level does not satisfy a required Dev capability', () => withFixture((fixture) => {
  fixture.checkpoint.dependencyLevels[0].environment = 'Dev';
  const result = check(fixture); assert.equal(result.executionReadiness, false); has(result, 'dependency-evidence-insufficient');
}));

test('published dependency and an observation marked pending do not prove delivery', () => withFixture((fixture) => {
  const observation = fixture.checkpoint.observations.find((item) => item.kind === 'dependency');
  observation.status = 'pending';
  const body = JSON.parse(readFileSync(path.join(fixture.directory, observation.file.path)));
  body.status = 'pending'; observation.file = put(fixture.directory, observation.file.path, body);
  const result = check(fixture); assert.equal(result.executionReadiness, false); has(result, 'dependency-evidence-insufficient');
}));

test('candidate file mutation invalidates resume and proof for another candidate cannot pass execution', () => withFixture((fixture) => {
  fixture.checkpoint.observations.push(fixture.observation('old-validation', 'validation', 'current-candidate', 'local', 'a'.repeat(64)));
  const mismatch = check(fixture); assert.equal(mismatch.executionReadiness, false); has(mismatch, 'evidence-candidate-mismatch');
  put(fixture.directory, 'src/synthetic.txt', 'SELECTION SYNTHETIQUE v2\n');
  const changed = check(fixture, 'resume'); assert.equal(changed.resumable, false); has(changed, 'candidate-file-changed');
}));

test('a newly added deliverable cannot be omitted from the candidate manifest', () => withFixture((fixture) => {
  put(fixture.directory, 'src/new.txt', 'NOUVEAU LIVRABLE SYNTHETIQUE\n');
  const result = check(fixture, 'resume');
  assert.equal(result.resumable, false); has(result, 'candidate-source-scope-changed');
}));

test('brief review must be independent, exact, complete and actually PASS before execution', () => withFixture((fixture) => {
  for (const mutate of [
    (review) => { review.reviewer.identity = review.authors[0]; },
    (review) => { review.briefDigest = '0'.repeat(64); },
    (review) => { review.criterionIds = []; },
    (review) => { review.verdict = 'NOT_PERFORMED'; },
    (review) => { review.openBlockingFindings = 1; },
    (review) => { review.reviewer.cleanContext = false; },
  ]) {
    const review = structuredClone(fixture.review); mutate(review);
    fixture.checkpoint.qualification.review = put(fixture.directory, 'artifacts/continuity/brief-review.json', review);
    assert.equal(check(fixture).executionReadiness, false);
  }
}));

test('changing ASCII identity case cannot make a brief author an independent reviewer', () => withFixture((fixture) => {
  const review = structuredClone(fixture.review);
  review.authors = ['Fixture-Reviewer'];
  assert.equal(review.reviewer.identity, 'fixture-reviewer');
  fixture.checkpoint.qualification.review = put(fixture.directory, 'artifacts/continuity/brief-review.json', review);
  const result = check(fixture);
  assert.equal(result.executionReadiness, false); has(result, 'brief-review-not-passed-independently');
}));

test('changing a scenario invalidates its independent review even when the brief is unchanged', () => withFixture((fixture) => {
  fixture.checkpoint.qualification.coverage[0].expected = 'Un résultat différent non examiné par le relecteur.';
  const result = check(fixture);
  assert.equal(result.executionReadiness, false); has(result, 'brief-review-stale-or-partial');
}));

test('author ownership rejects Windows case aliases and parent child overlap', () => {
  assert.equal(ownershipConflicts([{ agent: 'a', paths: ['src'] }, { agent: 'b', paths: ['SRC/domain.ts'] }]).length, 1);
  assert.equal(ownershipConflicts([{ agent: 'a', paths: ['src'] }, { agent: 'b', paths: ['src-other'] }]).length, 0);
});

test('fixed input inventory includes ignored decision sources, review and evidence without any backlog scan', () => withFixture((fixture) => {
  const files = referencedFiles(fixture.checkpoint);
  for (const expected of ['artifacts/continuity/refinement.json', 'artifacts/continuity/contract.json', 'artifacts/continuity/source.md', 'artifacts/continuity/brief-review.json', 'artifacts/continuity/candidate.json', 'artifacts/continuity/github-read.json', 'artifacts/continuity/dependency-proof.json']) assert.ok(files.includes(expected));
  assert.deepEqual(files, [...new Set(files)].sort());
}));

test('fresh CLI process resumes the exact checkpoint without inherited conversation context', () => withFixture((fixture) => {
  fixture.save();
  const result = spawnSync(process.execPath, [entry, '--checkpoint', 'artifacts/continuity/checkpoint.json', '--root', fixture.directory, '--action', 'resume'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.resumable, true); assert.equal(output.humanConsentAuthenticated, false);
  assert.deepEqual(output.nextAction, fixture.checkpoint.nextAction);
}));

test('CLI rejects duplicate options and malformed or duplicated JSON keys without echoing contents', () => withFixture((fixture) => {
  const file = 'artifacts/continuity/invalid.json';
  put(fixture.directory, file, '{"schemaVersion":1,"schemaVersion":1,"secret-note":"private-content"}');
  const result = spawnSync(process.execPath, [entry, '--checkpoint', file, '--root', fixture.directory], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.ok(!result.stdout.includes('private-content'));
  has(JSON.parse(result.stdout), 'duplicate-json-key');
  const duplicate = spawnSync(process.execPath, [entry, '--checkpoint', file, '--checkpoint', file], { encoding: 'utf8' });
  assert.equal(duplicate.status, 2);
}));
