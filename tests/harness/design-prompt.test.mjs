import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { auditCatalog, checkDossier, extractArticle, hash, inspectDossier, OFFICIAL_SOURCES, refreshSources } from '../../scripts/lib/design-prompt.mjs';
import { fakeFetch, now, prepare, put, syntheticHtml } from './fixtures/design-prompt/synthetic.mjs';

const cli = fileURLToPath(new URL('../../scripts/design-prompt.mjs', import.meta.url));
async function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-design-prompt-'));
  try { await run(await prepare(root)); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-design-prompt-'));
    rmSync(root, { recursive: true, force: true });
  }
}
const check = (state, options = {}) => checkDossier({ root: state.root, dossier: state.dossierPath, now, fetcher: fakeFetch(), ...options });
const inspect = (state) => inspectDossier({ root: state.root, dossier: state.dossierPath, now });
const json = (state, name) => JSON.parse(readFileSync(path.join(state.root, name), 'utf8'));
function replaceReview(state, change) { const review = json(state, state.dossier.review.path); change(review); state.dossier.review = put(state.root, state.dossier.review.path, review); state.save(); }
function setStage(state, stage) { state.dossier.stage = stage; state.catalog.entries[0].stage = stage; state.dossier.setupMode = null; state.dossier.userObservation = null; state.dossier.userObservedAtUtc = null; state.dossier.claims = [{ claim: 'Hestia test requirement.', basis: 'hestia', sourceIds: [] }]; state.save(); }
function approved(state, name) { return { status: 'approved', reference: put(state.root, `artifacts/current/${name}.md`, '# Synthetic version 1\n'), validation: put(state.root, `artifacts/current/${name}-validation.md`, '# Synthetic approval of exact version 1\n') }; }

test('native-create without pre-existing assets passes only with exact review and live articles', () => fixture(async (state) => {
  assert.equal(inspect(state).status, 'CANDIDATE');
  assert.equal(inspect(state).handoffAllowed, false);
  const audit = auditCatalog({ root: state.root });
  assert.equal(audit.status, 'AUDIT_PASS'); assert.equal(audit.handoffAllowed, false); assert.equal(audit.remoteStateVerified, false);
  const urls = [];
  const report = await check(state, { fetcher: async (url, options) => { urls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Cache-Control']); return fakeFetch()(url); } });
  assert.equal(report.status, 'PASS'); assert.equal(report.handoffAllowed, true); assert.equal(report.checkedAtUtc, now); assert.deepEqual(report.prompt, state.dossier.prompt); assert.equal(urls.length, 3);
}));

test('rewrite without updating evidence refuses before network', () => fixture(async (state) => {
  put(state.root, state.dossier.prompt.path, '# Rewritten prompt\n');
  let calls = 0;
  await assert.rejects(check(state, { fetcher: () => { calls += 1; throw new Error(); } }), /catalog-prompt-hash-mismatch/);
  assert.equal(calls, 0);
}));

test('updated prompt/context/demands/claim hashes each invalidate the exact independent review', () => fixture(async (state) => {
  const initialDigest = inspect(state).candidateDigest;
  state.dossier.prompt = put(state.root, state.dossier.prompt.path, '# Revised synthetic prompt\n');
  state.catalog.entries[0].sha256 = state.dossier.prompt.sha256; state.save();
  assert.notEqual(inspect(state).candidateDigest, initialDigest);
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
  state.review();
  state.dossier.context[0] = put(state.root, state.dossier.context[0].path, '# Revised context\n'); state.save();
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
  state.review(); state.dossier.requests.push('Additional request'); state.save();
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
  state.review(); state.dossier.claims[0].claim += ' Changed'; state.save();
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
}));

test('missing, modified, blocked, self or incomplete review never passes', () => fixture(async (state) => {
  const reference = state.dossier.review;
  state.dossier.review = null; state.save(); await assert.rejects(check(state), /invalid-file-reference/);
  state.dossier.review = reference; state.save(); put(state.root, reference.path, '# Modified review\n');
  await assert.rejects(check(state), /reference-hash-mismatch/);
  state.review(); replaceReview(state, (review) => { review.verdict = 'BLOCKED'; });
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
  state.review(); replaceReview(state, (review) => { review.reviewer.identity = ' SYNTHETIC-AUTHOR '; });
  await assert.rejects(check(state), /review-not-independent/);
  state.review(); replaceReview(state, (review) => { review.checks.factualClaims = false; });
  await assert.rejects(check(state), /review-check-not-passed/);
  state.review(); replaceReview(state, (review) => { review.reviewedAtUtc = '2026-09-16T13:00:00.000Z'; });
  await assert.rejects(check(state), /review-date-invalid/);
}));

test('capture freshness and future timestamps are mandatory', () => fixture(async (state) => {
  await assert.rejects(check(state, { now: '2026-09-16T12:00:00.001Z' }), /sources-stale-or-future/);
  await assert.rejects(check(state, { now: '2026-09-15T11:59:59.999Z' }), /invalid-user-observation-date|sources-stale-or-future/);
  const bundle = json(state, state.dossier.sources.path); bundle.capturedAtUtc = '2026-09-17T00:00:00Z';
  state.dossier.sources = put(state.root, state.dossier.sources.path, bundle); state.save();
  await assert.rejects(check(state), /sources-stale-or-future/);
}));

test('real article text, links and attributes changes each require refresh and review', () => fixture(async (state) => {
  for (const transform of [(html) => html.replace('bounded manual', 'unlimited automated'), (html) => html.replace('example.invalid/original', 'example.invalid/changed'), (html) => html.replace('synthetic-fixture', 'changed-style')]) {
    await assert.rejects(check(state, { fetcher: fakeFetch(transform) }), /official-source-changed-refresh-and-review-required/);
  }
  const result = await check(state, { fetcher: fakeFetch((html) => html.replace('synthetic navigation state', 'changed navigation state')) });
  assert.equal(result.status, 'PASS');
}));

test('source tampering or an unofficial source record is rejected offline', () => fixture(async (state) => {
  const bundle = json(state, state.dossier.sources.path); const source = bundle.sources[0];
  put(state.root, source.html.path, syntheticHtml(OFFICIAL_SOURCES[0]).replace('bounded manual', 'tampered manual'));
  assert.throws(() => inspect(state), /reference-hash-mismatch/);
  source.html = put(state.root, source.html.path, syntheticHtml(OFFICIAL_SOURCES[0])); source.url = 'https://example.invalid/article';
  state.dossier.sources = put(state.root, state.dossier.sources.path, bundle); state.save();
  assert.throws(() => inspect(state), /source-not-official/);
}));

test('HTTP login page, error, redirect, oversize, type, failure and timeout are refused', () => fixture(async (state) => {
  const cases = [
    [async () => new Response('<h1>Sign in</h1>', { headers: { 'content-type': 'text/html' } }), /official-article-title-or-structure/],
    [async () => new Response('Denied', { status: 403 }), /official-http-refused/],
    [async () => new Response(null, { status: 302, headers: { location: 'https://example.invalid/redirect' } }), /official-redirect-not-allowlisted/],
    [async () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': '99999999' } }), /official-content-oversize/],
    [async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }), /official-content-oversize/],
    [async () => new Response('{}', { headers: { 'content-type': 'application/json' } }), /official-content-type/],
    [async () => { throw new Error('offline'); }, /official-fetch-failed/],
    [() => new Promise(() => {}), /official-fetch-timeout/],
  ];
  for (const [fetcher, pattern] of cases) await assert.rejects(check(state, { fetcher, timeoutMs: 20 }), pattern);
}));

test('native-create requires user observation; asset import requires approved assets', () => fixture(async (state) => {
  state.dossier.userObservation = null; state.save(); assert.throws(() => inspect(state), /native-user-observation-required/);
  state.dossier.setupMode = 'import-assets'; state.dossier.userObservedAtUtc = null; state.dossier.claims = [{ claim: 'Local test requirement.', basis: 'hestia', sourceIds: [] }]; state.save();
  assert.throws(() => inspect(state), /approved-assets-required/);
  state.dossier.prerequisites.assets = approved(state, 'assets'); state.review(); assert.equal((await check(state)).status, 'PASS');
}));

test('screen and iteration require exact approved DS; bootstrap cannot claim native-ready', () => fixture(async (state) => {
  setStage(state, 'screen'); assert.throws(() => inspect(state), /approved-design-system-required/);
  setStage(state, 'iteration'); assert.throws(() => inspect(state), /approved-design-system-required/);
  state.dossier.prerequisites.designSystem = approved(state, 'design-system'); state.review(); assert.equal((await check(state)).status, 'PASS');
  state.dossier.prerequisites.designSystem.validation = put(state.root, 'artifacts/current/design-system-validation.md', '# Changed validation\n'); state.save();
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
  setStage(state, 'bootstrap'); state.dossier.nativeDesignSystemReady = true; state.save();
  assert.throws(() => inspect(state), /bootstrap-cannot-claim-native-ready/);
  state.dossier.nativeDesignSystemReady = false; state.review(); assert.equal((await check(state)).status, 'PASS');
}));

test('dated user observations remain available and review-bound for every stage', () => fixture(async (state) => {
  const observation = state.dossier.userObservation;
  for (const stage of ['screen', 'iteration', 'bootstrap']) {
    setStage(state, stage);
    state.dossier.prerequisites.designSystem = approved(state, 'design-system');
    state.dossier.userObservation = observation;
    state.dossier.userObservedAtUtc = now;
    state.dossier.claims = [{ claim: 'Synthetic capability observed in the account.', basis: 'user-observed', sourceIds: [] }];
    state.review();
    assert.equal((await check(state)).status, 'PASS');
  }
  state.dossier.userObservedAtUtc = null; state.save();
  assert.throws(() => inspect(state), /invalid-user-observation-date/);
  state.dossier.userObservedAtUtc = '2026-09-16T13:00:00.000Z'; state.save();
  assert.throws(() => inspect(state), /invalid-user-observation-date/);
  state.dossier.userObservedAtUtc = now; state.dossier.userObservation = null; state.save();
  assert.throws(() => inspect(state), /observation-date-without-source/);
  state.dossier.userObservedAtUtc = null; state.save();
  assert.throws(() => inspect(state), /claim-without-user-observation/);
  state.dossier.userObservation = observation; state.dossier.userObservedAtUtc = now; state.review();
  state.dossier.userObservation = put(state.root, observation.path, '# Revised synthetic observation\n'); state.save();
  await assert.rejects(check(state), /review-not-passed-or-candidate-mismatch/);
}));

test('omitted, changed, historical and unknown prompts cannot gain handoff through audit', () => fixture(async (state) => {
  put(state.root, 'docs/design/prompts/unlisted.md', '# Unlisted synthetic prompt\n');
  assert.throws(() => auditCatalog({ root: state.root }), /catalog-prompt-not-registered/);
  state.catalog.entries.push({ path: 'docs/design/prompts/unlisted.md', sha256: hash(readFileSync(path.join(state.root, 'docs/design/prompts/unlisted.md'))), status: 'historical', stage: 'bootstrap' }); state.save();
  assert.equal(auditCatalog({ root: state.root }).status, 'AUDIT_PASS');
  state.catalog.entries[0].status = 'historical'; state.save(); assert.throws(() => inspect(state), /prompt-not-active-or-stage-mismatch/);
  state.catalog.entries[0].status = 'active'; state.dossier.prompt = put(state.root, 'outside-catalog/unknown.md', '# Unknown prompt\n'); state.save();
  assert.throws(() => inspect(state), /local-prompt-not-ignored-or-out-of-scope/);
}));

test('an explicitly designated ignored local prompt is accepted; unignored and tracked ones are refused', () => fixture(async (state) => {
  execFileSync('git', ['init', '--quiet'], { cwd: state.root, stdio: 'pipe' });
  state.dossier.prompt = put(state.root, 'artifacts/current/local-prompt.md', '# Synthetic local prompt\n'); state.save();
  assert.throws(() => inspect(state), /local-prompt-not-ignored-or-out-of-scope/);
  put(state.root, '.gitignore', 'artifacts/\n'); state.review();
  const result = await check(state); assert.equal(result.status, 'PASS'); assert.equal(result.immediateHandoffOnly, true); assert.equal(result.reuseAllowed, false);
  execFileSync('git', ['add', '--force', '--', state.dossier.prompt.path], { cwd: state.root, stdio: 'pipe' });
  assert.throws(() => inspect(state), /local-prompt-not-ignored-or-out-of-scope/);
}));

test('explicit ignored dossier is read; traversal, links, unknown fields and oversize are refused', () => fixture(async (state) => {
  state.dossier.context[0].path = '../outside.md'; state.save(); assert.throws(() => inspect(state), /unsafe-relative-path/);
  state.dossier.context[0] = put(state.root, 'artifacts/current/context.md', '# Context\n');
  state.dossier.extra = 'undeclared'; state.save(); assert.throws(() => inspect(state), /invalid-dossier-fields/); delete state.dossier.extra;
  state.dossier.context[0] = put(state.root, 'artifacts/current/large.md', 'x'.repeat(1024 * 1024 + 1)); state.save(); assert.throws(() => inspect(state), /input-size-or-type/);
  const target = path.join(state.root, 'real-context'); mkdirSync(target);
  const reference = put(state.root, 'real-context/context.md', '# Context through junction\n');
  symlinkSync(target, path.join(state.root, 'linked-context'), process.platform === 'win32' ? 'junction' : 'dir');
  state.dossier.context[0] = { ...reference, path: 'linked-context/context.md' }; state.save(); assert.throws(() => inspect(state), /linked-input-or-output/);
}));

test('changes during the GET invalidate local prompt, dossier, review and evidence', () => fixture(async (state) => {
  const evidencePath = json(state, state.dossier.review.path).evidence.path;
  await assert.rejects(check(state, { fetcher: async (url) => { put(state.root, evidencePath, '# Changed during GET\n'); return fakeFetch()(url); } }), /reference-hash-mismatch/);
  state.review(); let changed = false;
  await assert.rejects(check(state, { fetcher: async (url) => { if (!changed) { changed = true; const raw = readFileSync(path.join(state.root, state.dossierPath), 'utf8'); writeFileSync(path.join(state.root, state.dossierPath), `${raw}\n`); } return fakeFetch()(url); } }), /local-input-changed-during-live-check/);
}));

test('refresh preserves captures and refuses output escape or existing directories', () => fixture(async (state) => {
  await assert.rejects(refreshSources({ root: state.root, out: '../escape', fetcher: fakeFetch() }), /unsafe-relative-path/);
  await assert.rejects(refreshSources({ root: state.root, out: 'docs/capture/new', fetcher: fakeFetch() }), /capture-output-must-be-under-artifacts/);
  await assert.rejects(refreshSources({ root: state.root, out: 'artifacts/sources/initial', fetcher: fakeFetch() }), /capture-output-already-exists/);
}));

test('extractor refuses absent sections and retains content changes', () => {
  const source = OFFICIAL_SOURCES[0];
  assert.throws(() => extractArticle(syntheticHtml(source).replace(source.section, 'Other title'), source), /official-article-content-missing/);
  assert.throws(() => extractArticle(`${syntheticHtml(source)}<article>second</article>`, source), /official-article-title-or-structure/);
});

test('only observed Intercom image signatures are volatile; content and URL identity remain bound', () => {
  const source = OFFICIAL_SOURCES[0];
  const signed = `https://downloads.intercomcdn.com/i/o/synthetic/image.png?expires=1789486200&amp;signature=${'a'.repeat(64)}&amp;req=synthetic%2Frequest&amp;width=100`;
  const wrap = (url) => syntheticHtml(source).replace('</article>', `<a href="${url}"><img src="${url}" alt="Synthetic diagram"></a></article>`);
  const digest = (html) => extractArticle(html, source).articleSha256;
  const original = wrap(signed);
  const rotated = signed.replace('1789486200', '1789487100').replace('a'.repeat(64), 'b'.repeat(64)).replace('synthetic%2Frequest', 'changed%2Frequest');
  assert.equal(digest(original), digest(wrap(rotated)));
  for (const changed of [signed.replace('image.png', 'other.png'), signed.replace('width=100', 'width=200'), signed.replace('downloads.intercomcdn.com', 'example.invalid'), signed.replace('https:', 'http:')]) {
    assert.notEqual(digest(original), digest(wrap(changed)));
  }
  assert.notEqual(digest(original), digest(original.replace('alt="Synthetic diagram"', 'alt="Changed meaning"')));
  const outside = signed.replace('downloads.intercomcdn.com', 'example.invalid');
  assert.notEqual(digest(wrap(outside)), digest(wrap(outside.replace('1789486200', '1789487100'))));
  const noReq = signed.replace('&amp;req=synthetic%2Frequest', '');
  assert.notEqual(digest(wrap(noReq)), digest(wrap(noReq.replace('1789486200', '1789487100'))));
  const duplicate = `${signed}&amp;signature=${'c'.repeat(64)}`;
  assert.notEqual(digest(wrap(duplicate)), digest(wrap(duplicate.replace('1789486200', '1789487100'))));
  for (const url of [signed.replace('.com/', '.com:443/'), signed.replace('https://', 'https://synthetic@'), signed.replace('/i/o/', '/other/')]) {
    assert.notEqual(digest(wrap(url)), digest(wrap(url.replace('1789486200', '1789487100'))));
  }
  for (const template of [
    `<img data-src="${signed}">`,
    `<a data-info='literal href="${signed}"'>Synthetic</a>`,
    `<p>literal href="${signed}"</p>`,
    `<div data-info='<img src="${signed}">'>Synthetic</div>`,
    `<!-- <img src="${signed}"> -->`,
    `<![CDATA[<img src="${signed}">]]>`,
    `<script>const example = '<img src="${signed}">';</script>`,
    `<style>/* <img src="${signed}"> */</style>`,
    `<textarea><img src="${signed}"></textarea>`,
  ]) {
    const embedded = syntheticHtml(source).replace('</article>', `${template}</article>`);
    assert.notEqual(digest(embedded), digest(embedded.replaceAll('1789486200', '1789487100')));
  }
  assert.notEqual(digest(wrap(`${signed}#one`)), digest(wrap(`${signed}#two`)));
  assert.notEqual(digest(wrap(`${signed}#section?req=FIRST`)), digest(wrap(`${signed}#section?req=SECOND`)));
  assert.notEqual(digest(wrap(`${signed}&amp;redirect=/page?req=FIRST`)), digest(wrap(`${signed}&amp;redirect=/page?req=SECOND`)));
});

test('CLI audit is offline JSON and unknown/network override options fail', () => fixture(async (state) => {
  const report = JSON.parse(execFileSync(process.execPath, [cli, 'audit', '--root', state.root], { encoding: 'utf8', timeout: 5000 }));
  assert.equal(report.status, 'AUDIT_PASS'); assert.equal(report.handoffAllowed, false);
  const unknown = spawnSync(process.execPath, [cli, 'check', '--root', state.root, '--dossier', state.dossierPath, '--url', 'https://example.invalid'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(unknown.status, 1); assert.equal(JSON.parse(unknown.stdout).status, 'BLOCKED');
  const imported = execFileSync(process.execPath, ['--input-type=module', '-e', `globalThis.fetch=()=>{throw new Error('network forbidden during import')};await import(${JSON.stringify(new URL('../../scripts/lib/design-prompt.mjs', import.meta.url).href)});console.log('imported')`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(imported.trim(), 'imported');
}));
