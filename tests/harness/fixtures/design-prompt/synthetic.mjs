import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hash, inspectDossier, OFFICIAL_SOURCES, refreshSources } from '../../../../scripts/lib/design-prompt.mjs';

export const when = '2026-09-15T12:00:00.000Z';
export const now = '2026-09-15T13:00:00.000Z';
export function syntheticHtml(source) {
  return `<html><head><script>synthetic navigation state</script></head><body><h1>${source.title}</h1><article class="synthetic-fixture"><h2>${source.section}</h2><p>ENTIRELY SYNTHETIC TEST FIXTURE. This is fabricated article material for testing the gate, not an official capture. ${'Synthetic product documentation and bounded manual design workflow. '.repeat(15)}</p><a href="https://example.invalid/original">Synthetic link</a></article></body></html>`;
}
export function fakeFetch(transform = (html) => html) {
  return async (url) => {
    const source = OFFICIAL_SOURCES.find((item) => item.url === url);
    if (!source) throw new Error('unexpected-url');
    return new Response(transform(syntheticHtml(source), source), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
}
export function put(root, name, value) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return { path: name, sha256: hash(readFileSync(path.join(root, name))) };
}
export async function prepare(root) {
  const dossierPath = 'artifacts/current/dossier.json';
  const prompt = put(root, 'docs/design/prompts/synthetic.md', '# SYNTHETIC PROMPT\n\nCreate a reusable synthetic design system through the observed native workflow.\n');
  const context = put(root, 'artifacts/current/context.md', '# Synthetic context\nNo real user data or claim of product verification.\n');
  const decision = put(root, 'artifacts/current/decision.md', '# Synthetic decision\nOnly manual native creation is requested.\n');
  const observation = put(root, 'artifacts/current/observation.md', '# SYNTHETIC USER OBSERVATION\nThe fictitious user reports a native create workflow.\n');
  const catalog = { schemaVersion: 1, entries: [{ ...prompt, status: 'active', stage: 'setup' }] };
  const capture = await refreshSources({ root, out: 'artifacts/sources/initial', fetcher: fakeFetch(), now: when });
  const missing = () => ({ status: 'missing', reference: null, validation: null });
  const dossier = { schemaVersion: 1, id: 'synthetic-only', author: 'synthetic-author', stage: 'setup', setupMode: 'native-create', userObservation: observation, userObservedAtUtc: when, nativeDesignSystemReady: false, prompt, context: [context], decisions: [decision], requests: ['Create the synthetic reusable design system manually.'], claims: [{ claim: 'The synthetic user reports this workflow.', basis: 'user-observed', sourceIds: [] }, { claim: 'Source content is present in the fabricated test snapshot.', basis: 'official', sourceIds: ['get-started'] }], prerequisites: { designSystem: missing(), assets: missing() }, sources: capture.sources, review: null };
  const save = () => { put(root, 'docs/design/prompt-catalog.json', catalog); put(root, dossierPath, dossier); };
  const review = () => {
    save();
    const candidate = inspectDossier({ root, dossier: dossierPath, now });
    const evidence = put(root, 'artifacts/current/review.md', '# SYNTHETIC TEST REVIEW\nNo real independent review occurred. This fixture tests candidate matching only.\n');
    const document = { schemaVersion: 1, kind: 'design-prompt-review', candidateDigest: candidate.candidateDigest, verdict: 'PASS', reviewer: { identity: 'synthetic-reviewer', effectiveModel: 'SYNTHETIC-NO-MODEL', cleanContext: true }, reviewedAtUtc: now, checks: { promptAndContext: true, stageAndPrerequisites: true, factualClaims: true, requestFeasibility: true }, openBlockingFindings: 0, evidence };
    dossier.review = put(root, 'artifacts/current/review.json', document); save(); return document;
  };
  save(); review();
  return { dossier, dossierPath, catalog, save, review, root, now };
}
