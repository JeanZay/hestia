import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from '../guard.mjs';
import { containedPath } from './verification-evidence.mjs';

export const CATALOG = 'docs/design/prompt-catalog.json';
export const EXTRACTION_VERSION = 'article-html-v1';
export const MAX_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;
const LOCAL_LIMIT = 1024 * 1024;
const HTTP_LIMIT = 2 * 1024 * 1024;
const STAGES = ['bootstrap', 'setup', 'screen', 'iteration'];
const HASH = /^[a-f0-9]{64}$/;
const runtimeRoot = fileURLToPath(new URL('../../', import.meta.url));
const controllerPaths = ['scripts/design-prompt.mjs', 'scripts/lib/design-prompt.mjs', 'scripts/guard.mjs', 'scripts/lib/verification-evidence.mjs'];
export const OFFICIAL_SOURCES = Object.freeze([
  { id: 'get-started', slug: '14604416-get-started-with-claude-design', title: 'Get started with Claude Design', section: 'How Claude Design works' },
  { id: 'design-system', slug: '14604397-set-up-your-design-system-in-claude-design', title: 'Set up your design system in Claude Design', section: 'Prerequisites' },
  { id: 'admin', slug: '14604406-claude-design-admin-guide-for-team-and-enterprise-plans', title: 'Claude Design admin guide for Team and Enterprise plans', section: 'The design system: why it comes first' },
].map((item) => Object.freeze({ ...item, url: `https://support.claude.com/en/articles/${item.slug}` })));
const allowedUrls = new Set(OFFICIAL_SOURCES.map((item) => item.url));
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const textValue = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 10000;
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, expected, code) {
  requireValue(plain(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|'), code);
}
function relative(value) {
  requireValue(typeof value === 'string' && value.length <= 500 && !/[\\:\0*?\[\]]/.test(value) && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), 'unsafe-relative-path');
  return value;
}
function readBounded(root, name, limit = LOCAL_LIMIT, scan = true) {
  const absolute = containedPath(root, relative(name));
  const before = lstatSync(absolute);
  requireValue(before.isFile() && before.size > 0 && before.size <= limit, 'input-size-or-type');
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor); const buffer = Buffer.alloc(limit + 1); let length = 0;
    requireValue(opened.isFile() && before.ino === opened.ino && before.dev === opened.dev, 'input-changed-during-read');
    while (length < buffer.length) { const count = readSync(descriptor, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor);
    requireValue(length <= limit && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs, 'input-changed-or-oversize');
    const bytes = buffer.subarray(0, length);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (scan) { const result = inspectFile(name, bytes); requireValue(!result.binary && result.findings.length === 0, 'guard-rejected-input'); }
    return { bytes, text, sha256: hash(bytes) };
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
function parseJson(read) { try { return JSON.parse(read.text); } catch { fail('invalid-json'); } }
function utc(value, now, code, maxAge = Infinity) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), code);
  const time = Date.parse(value);
  requireValue(Number.isFinite(time) && time <= now && now - time <= maxAge && new Date(time).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), code);
  return time;
}
function nowTime(now) { const result = now === undefined ? Date.now() : Date.parse(now); requireValue(Number.isFinite(result), 'invalid-clock'); return result; }
function loadReference(root, reference, inputs, { limit = LOCAL_LIMIT, scan = true } = {}) {
  keys(reference, ['path', 'sha256'], 'invalid-file-reference');
  requireValue(HASH.test(reference.sha256), 'invalid-reference-hash');
  const read = readBounded(root, reference.path, limit, scan);
  requireValue(read.sha256 === reference.sha256, 'reference-hash-mismatch');
  inputs.set(reference.path, read.sha256);
  return read;
}
function controllerIdentity() { return controllerPaths.map((name) => ({ path: name, sha256: readBounded(runtimeRoot, name).sha256 })); }
function isIgnoredPrompt(root, name) {
  relative(name);
  if (!name.startsWith('artifacts/') || !name.toLowerCase().endsWith('.md')) return false;
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  try {
    execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', '-c', 'core.fsmonitor=false', 'check-ignore', '--quiet', '--', name], { cwd: root, env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch { return false; }
}

/** Preserve every byte inside the article, including links/attributes. Navigation and
 * hydration scripts outside it are not article content. Unexpected structure fails. */
export function extractArticle(html, source) {
  const titles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const articles = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)];
  requireValue(titles.length === 1 && articles.length === 1 && titles[0][1] === source.title, 'official-article-title-or-structure');
  const articleHtml = articles[0][0];
  requireValue(articleHtml.length >= 500 && /<p\b/i.test(articleHtml) && new RegExp(`<h[23]\\b[^>]*>${source.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/h[23]>`, 'i').test(articleHtml), 'official-article-content-missing');
  return { title: titles[0][1], articleSha256: hash(canonical({ extractionVersion: EXTRACTION_VERSION, title: titles[0][1], articleHtml })) };
}

async function getOfficial(source, fetcher, timeoutMs) {
  const controller = new AbortController(); let timer;
  // The explicit race also bounds a fetcher/body which ignores AbortSignal.
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('official-fetch-timeout'), { code: 'official-fetch-timeout' })); }, timeoutMs); });
  const request = async () => {
    let url = source.url;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      requireValue(allowedUrls.has(url), 'official-url-not-allowlisted');
      const response = await fetcher(url, { method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' }, signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get('location');
        requireValue(target && redirects < 3, 'official-redirect-invalid');
        url = new URL(target, url).href;
        requireValue(allowedUrls.has(url), 'official-redirect-not-allowlisted');
        await response.body?.cancel();
        continue;
      }
      requireValue(response.status === 200 && !response.redirected && (!response.url || response.url === url), 'official-http-refused');
      const contentType = response.headers.get('content-type') ?? '';
      requireValue(/^text\/html(?:;|$)/i.test(contentType), 'official-content-type');
      const length = response.headers.get('content-length');
      requireValue(length === null || (/^\d+$/.test(length) && Number(length) <= HTTP_LIMIT), 'official-content-oversize');
      requireValue(response.body && typeof response.body.getReader === 'function', 'official-body-missing');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; requireValue(size <= HTTP_LIMIT, 'official-content-oversize'); chunks.push(Buffer.from(value)); }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const article = extractArticle(html, source);
      return { id: source.id, url: source.url, finalUrl: url, httpStatus: 200, contentType, ...article, bytes };
    }
    fail('official-redirect-invalid');
  };
  try { return await Promise.race([request(), timeout]); }
  catch (error) { if (typeof error.code === 'string' && error.code.startsWith('official-')) throw error; fail('official-fetch-failed'); }
  finally { clearTimeout(timer); controller.abort(); }
}
async function fetchOfficial(fetcher, timeoutMs = 20000) {
  const results = await Promise.allSettled(OFFICIAL_SOURCES.map((source) => getOfficial(source, fetcher, timeoutMs)));
  const failed = results.find((item) => item.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((item) => item.value);
}

/** Only this command writes. It creates a new bounded capture directory; no overwrite. */
export async function refreshSources({ root = process.cwd(), out, fetcher = globalThis.fetch, now, timeoutMs } = {}) {
  relative(out);
  requireValue(/^artifacts\/[a-zA-Z0-9_/-]+$/.test(out) && out.split('/').length >= 3, 'capture-output-must-be-under-artifacts');
  const destination = containedPath(root, out, true);
  try { lstatSync(destination); fail('capture-output-already-exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fetched = await fetchOfficial(fetcher, timeoutMs);
  const capturedAtUtc = new Date(nowTime(now)).toISOString();
  mkdirSync(containedPath(root, path.posix.dirname(out), true), { recursive: true });
  mkdirSync(containedPath(root, out, true));
  const sources = fetched.map(({ bytes, ...item }) => {
    const name = `${out}/${item.id}.html`;
    writeFileSync(containedPath(root, name, true), bytes, { flag: 'wx' });
    return { ...item, html: { path: name, sha256: hash(bytes) } };
  });
  const bundle = { schemaVersion: 1, extractionVersion: EXTRACTION_VERSION, capturedAtUtc, sources };
  const name = `${out}/sources.json`; const bytes = `${JSON.stringify(bundle, null, 2)}\n`;
  writeFileSync(containedPath(root, name, true), bytes, { flag: 'wx' });
  return { status: 'CAPTURED', sources: { path: name, sha256: hash(bytes) }, capturedAtUtc, handoffAllowed: false };
}

export function auditCatalog({ root = process.cwd() } = {}) {
  const catalogRead = readBounded(root, CATALOG); const catalog = parseJson(catalogRead);
  keys(catalog, ['schemaVersion', 'entries'], 'invalid-catalog');
  requireValue(catalog.schemaVersion === 1 && Array.isArray(catalog.entries) && catalog.entries.length <= 1000, 'invalid-catalog');
  const found = []; let visited = 0;
  function walk(name) {
    requireValue(++visited <= 2000, 'prompt-directory-limit');
    const absolute = containedPath(root, name); const info = lstatSync(absolute);
    if (info.isDirectory()) for (const item of readdirSync(absolute).sort()) walk(`${name}/${item}`);
    else { requireValue(info.isFile(), 'prompt-file-type'); if (name.toLowerCase().endsWith('.md')) found.push(name); }
  }
  walk('docs/design/prompts');
  const seen = new Set();
  for (const entry of catalog.entries) {
    keys(entry, ['path', 'sha256', 'status', 'stage'], 'invalid-catalog-entry');
    requireValue(typeof entry.path === 'string' && found.includes(entry.path) && !seen.has(entry.path.toLowerCase()) && HASH.test(entry.sha256) && ['active', 'deprecated', 'historical'].includes(entry.status) && STAGES.includes(entry.stage), 'invalid-catalog-entry');
    requireValue(readBounded(root, entry.path).sha256 === entry.sha256, 'catalog-prompt-hash-mismatch');
    seen.add(entry.path.toLowerCase());
  }
  requireValue(found.length === catalog.entries.length, 'catalog-prompt-not-registered');
  return { status: 'AUDIT_PASS', scope: 'offline-catalog-only', handoffAllowed: false, remoteStateVerified: false, catalogSha256: catalogRead.sha256, entries: catalog.entries };
}

function inspectInternal({ root, dossier: dossierPath, now }, requireReview) {
  const time = nowTime(now); const inputs = new Map();
  const raw = readBounded(root, dossierPath); const dossier = parseJson(raw);
  keys(dossier, ['schemaVersion', 'id', 'author', 'stage', 'setupMode', 'userObservation', 'userObservedAtUtc', 'nativeDesignSystemReady', 'prompt', 'context', 'decisions', 'requests', 'claims', 'prerequisites', 'sources', 'review'], 'invalid-dossier-fields');
  requireValue(dossier.schemaVersion === 1 && textValue(dossier.id) && textValue(dossier.author) && STAGES.includes(dossier.stage) && typeof dossier.nativeDesignSystemReady === 'boolean', 'invalid-dossier');
  const catalog = auditCatalog({ root }); inputs.set(CATALOG, catalog.catalogSha256);
  const entry = catalog.entries.find((item) => item.path === dossier.prompt?.path);
  if (dossier.prompt?.path?.startsWith('docs/design/prompts/')) requireValue(entry && entry.status === 'active' && entry.stage === dossier.stage, 'prompt-not-active-or-stage-mismatch');
  else requireValue(isIgnoredPrompt(root, dossier.prompt?.path), 'local-prompt-not-ignored-or-out-of-scope');
  loadReference(root, dossier.prompt, inputs);
  for (const field of ['context', 'decisions']) {
    requireValue(Array.isArray(dossier[field]) && dossier[field].length > 0 && dossier[field].length <= 50, 'context-or-decisions-missing');
    for (const reference of dossier[field]) loadReference(root, reference, inputs);
  }
  requireValue(Array.isArray(dossier.requests) && dossier.requests.length > 0 && dossier.requests.length <= 50 && dossier.requests.every(textValue), 'requests-missing');
  keys(dossier.prerequisites, ['designSystem', 'assets'], 'invalid-prerequisites');
  for (const prerequisite of Object.values(dossier.prerequisites)) {
    keys(prerequisite, ['status', 'reference', 'validation'], 'invalid-prerequisite');
    requireValue(['missing', 'approved'].includes(prerequisite.status), 'invalid-prerequisite-status');
    if (prerequisite.status === 'approved') { loadReference(root, prerequisite.reference, inputs); loadReference(root, prerequisite.validation, inputs); }
    else requireValue(prerequisite.reference === null && prerequisite.validation === null, 'missing-prerequisite-has-references');
  }
  if (['screen', 'iteration'].includes(dossier.stage) || dossier.nativeDesignSystemReady) requireValue(dossier.prerequisites.designSystem.status === 'approved', 'approved-design-system-required');
  if (dossier.stage === 'bootstrap') requireValue(!dossier.nativeDesignSystemReady, 'bootstrap-cannot-claim-native-ready');
  if (dossier.stage === 'setup') {
    requireValue(['native-create', 'import-assets'].includes(dossier.setupMode), 'setup-mode-required');
    if (dossier.setupMode === 'import-assets') requireValue(dossier.prerequisites.assets.status === 'approved', 'approved-assets-required');
    else requireValue(dossier.userObservation !== null, 'native-user-observation-required');
  } else requireValue(dossier.setupMode === null, 'setup-mode-outside-setup');
  if (dossier.userObservation !== null) {
    loadReference(root, dossier.userObservation, inputs);
    utc(dossier.userObservedAtUtc, time, 'invalid-user-observation-date');
  } else requireValue(dossier.userObservedAtUtc === null, 'observation-date-without-source');
  const sources = parseJson(loadReference(root, dossier.sources, inputs));
  keys(sources, ['schemaVersion', 'extractionVersion', 'capturedAtUtc', 'sources'], 'invalid-source-bundle');
  requireValue(sources.schemaVersion === 1 && sources.extractionVersion === EXTRACTION_VERSION && Array.isArray(sources.sources) && sources.sources.length === OFFICIAL_SOURCES.length, 'invalid-source-bundle');
  const captured = utc(sources.capturedAtUtc, time, 'sources-stale-or-future', MAX_SOURCE_AGE_MS); const sourceIds = new Set();
  for (const source of sources.sources) {
    keys(source, ['id', 'url', 'finalUrl', 'httpStatus', 'contentType', 'title', 'articleSha256', 'html'], 'invalid-source-record');
    const official = OFFICIAL_SOURCES.find((item) => item.id === source.id);
    requireValue(official && !sourceIds.has(source.id) && source.url === official.url && allowedUrls.has(source.finalUrl) && source.httpStatus === 200 && /^text\/html(?:;|$)/i.test(source.contentType), 'source-not-official');
    sourceIds.add(source.id);
    const html = loadReference(root, source.html, inputs, { limit: HTTP_LIMIT, scan: false });
    const article = extractArticle(html.text, official);
    requireValue(source.title === article.title && source.articleSha256 === article.articleSha256, 'captured-article-hash-mismatch');
  }
  requireValue(Array.isArray(dossier.claims) && dossier.claims.length > 0 && dossier.claims.length <= 100, 'claims-missing');
  for (const claim of dossier.claims) {
    keys(claim, ['claim', 'basis', 'sourceIds'], 'invalid-claim');
    requireValue(textValue(claim.claim) && ['official', 'hestia', 'unverified', 'user-observed'].includes(claim.basis) && Array.isArray(claim.sourceIds) && claim.sourceIds.every((id) => sourceIds.has(id)), 'invalid-claim');
    if (claim.basis === 'official') requireValue(claim.sourceIds.length > 0, 'official-claim-without-source');
    if (claim.basis === 'user-observed') requireValue(dossier.userObservation !== null, 'claim-without-user-observation');
  }
  const { review: excludedReview, ...candidate } = dossier;
  const controller = controllerIdentity();
  const files = [...inputs.entries()].map(([name, sha256]) => ({ path: name, sha256 })).sort((a, b) => a.path < b.path ? -1 : 1);
  const candidateDigest = hash(canonical({ dossier: candidate, files, controller }));
  if (requireReview) {
    const review = parseJson(loadReference(root, excludedReview, inputs));
    keys(review, ['schemaVersion', 'kind', 'candidateDigest', 'verdict', 'reviewer', 'reviewedAtUtc', 'checks', 'openBlockingFindings', 'evidence'], 'invalid-review');
    keys(review.reviewer, ['identity', 'effectiveModel', 'cleanContext'], 'invalid-reviewer');
    requireValue(review.schemaVersion === 1 && review.kind === 'design-prompt-review' && review.candidateDigest === candidateDigest && review.verdict === 'PASS' && review.openBlockingFindings === 0, 'review-not-passed-or-candidate-mismatch');
    requireValue(textValue(review.reviewer.identity) && review.reviewer.identity.trim().toLowerCase() !== dossier.author.trim().toLowerCase() && textValue(review.reviewer.effectiveModel) && review.reviewer.cleanContext === true, 'review-not-independent');
    requireValue(utc(review.reviewedAtUtc, time, 'review-date-invalid') >= captured, 'review-predates-sources');
    keys(review.checks, ['promptAndContext', 'stageAndPrerequisites', 'factualClaims', 'requestFeasibility'], 'invalid-review-checks');
    requireValue(Object.values(review.checks).every((value) => value === true), 'review-check-not-passed');
    loadReference(root, review.evidence, inputs);
  }
  inputs.set(dossierPath, raw.sha256);
  return { candidateDigest, prompt: dossier.prompt, controller, files, inputs: [...inputs.entries()], sources, dossierSha256: raw.sha256 };
}

export function inspectDossier({ root = process.cwd(), dossier, now } = {}) {
  const result = inspectInternal({ root, dossier, now }, false);
  return { status: 'CANDIDATE', handoffAllowed: false, remoteStateVerified: false, candidateDigest: result.candidateDigest, prompt: result.prompt, controller: result.controller, files: result.files, limitation: 'Candidate identity only; the independent review and live check are still required.' };
}

export async function checkDossier({ root = process.cwd(), dossier, now, fetcher = globalThis.fetch, timeoutMs } = {}) {
  const before = inspectInternal({ root, dossier, now }, true);
  const live = await fetchOfficial(fetcher, timeoutMs);
  for (const source of live) {
    const captured = before.sources.sources.find((item) => item.id === source.id);
    requireValue(source.articleSha256 === captured.articleSha256 && source.finalUrl === captured.finalUrl, 'official-source-changed-refresh-and-review-required');
  }
  const after = inspectInternal({ root, dossier, now }, true);
  requireValue(before.candidateDigest === after.candidateDigest && before.dossierSha256 === after.dossierSha256 && canonical(before.inputs) === canonical(after.inputs), 'local-input-changed-during-live-check');
  const observedSources = live.map((source) => ({ id: source.id, url: source.url, finalUrl: source.finalUrl, httpStatus: source.httpStatus, contentType: source.contentType, title: source.title, articleSha256: source.articleSha256 }));
  return { status: 'PASS', handoffAllowed: true, remoteStateVerified: true, immediateHandoffOnly: true, reuseAllowed: false, checkedAtUtc: new Date(nowTime(now)).toISOString(), candidateDigest: after.candidateDigest, prompt: after.prompt, dossierSha256: after.dossierSha256, sources: observedSources, limitations: ['Valid only for immediate handoff of these exact prompt bytes; run check again before any later handoff.', 'HTTP article equality and an exact independent review do not prove product capability in the user account or permanent SOTA.', 'This gate detects omissions in its workflow; it does not intercept chat or authenticate reviewer identities.'] };
}
