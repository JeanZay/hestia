import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from '../guard.mjs';
import { readJsonSafe, validateJsonSchema } from '../refinement-check.mjs';
import { containedPath } from './verification-evidence.mjs';
import { discoverRecipeRepository } from './browser-recipe-paths.mjs';

export { discoverRecipeRepository };
const CATALOG = 'tests/functional-browser/scenarios';
const STORE = 'artifacts/functional-browser';
const limits = ['Déclarations locales, consentement non authentifié ; aucun navigateur ni réseau exécuté.', 'Détection de secrets partielle ; données synthétiques et preuves minimisées uniquement.'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const fail = (code) => { throw new Error(code); };
const need = (condition, code) => { if (!condition) fail(code); };
// Scenario IDs allow 80 characters; proposal IDs append '-' and 16 hash characters.
const slug = (value) => { need(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,96}$/.test(value), 'invalid-id'); return value; };
const sha = (value) => need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid-sha256');
const timestamp = (value) => { need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), 'invalid-timestamp'); return Date.parse(value); };
const textField = (value) => need(typeof value === 'string' && value.trim().length > 0, 'missing-text');
function safe(bytes, filename = '') {
  const inspected = inspectFile(filename, bytes);
  need(!inspected.binary && inspected.findings.length === 0, 'guard-rejected-input');
}
function uniqueJson(text) {
  const stack = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]/g)) {
    const value = token[0];
    if (value === '{' || value === '[') { stack.push({ object: value === '{', keys: new Set(), key: value === '{' }); need(stack.length <= 64, 'json-depth'); }
    else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (value === ':' && stack.at(-1)?.object) stack.at(-1).key = false;
    else if (value.startsWith('"') && stack.at(-1)?.key) { const key = JSON.parse(value); need(!stack.at(-1).keys.has(key), 'duplicate-json-key'); stack.at(-1).keys.add(key); stack.at(-1).key = false; }
  }
  return JSON.parse(text);
}
function relative(value) {
  need(typeof value === 'string' && !/[\\:\0*?]/.test(value) && !value.startsWith('/') && !value.split('/').some((p) => !p || p === '.' || p === '..' || /[. ]$/.test(p)), 'path-outside-scope');
  need(inspectFile(value, '').findings.length === 0, 'guard-rejected-path');
  return value;
}
function bytes(root, filename) {
  const file = containedPath(root, relative(filename));
  need(lstatSync(file).isFile() && lstatSync(file).size <= 1024 * 1024, 'input-size-or-type');
  const value = readFileSync(file); safe(value, filename); return value;
}
function schema(value, name) {
  const location = fileURLToPath(new URL(`../../harness/schemas/browser-recipe-${name}.schema.json`, import.meta.url));
  need(validateJsonSchema(value, readJsonSafe(location)).length === 0, `invalid-${name}-schema`);
}
function reference(root, filename) {
  relative(filename); return { path: filename, sha256: hash(bytes(root, filename)) };
}
function references(root, values) {
  for (const value of values) {
    if (/^https:\/\//.test(value)) { const url = new URL(value); need(!url.username && !url.password && !url.search, 'unsafe-reference-url'); }
    else reference(root, value);
  }
}
function writeOnce(root, filename, value) {
  const content = typeof value === 'string' ? value : json(value); safe(content, filename);
  const target = containedPath(root, relative(filename), true);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(containedPath(root, filename, true), content, { flag: 'wx' });
  return { path: filename, sha256: hash(content) };
}
function read(root, filename) { bytes(root, filename); return readJsonSafe(containedPath(root, relative(filename))); }
function locked(root, action) {
  const folder = containedPath(root, STORE, true); mkdirSync(folder, { recursive: true });
  const lock = containedPath(root, `${STORE}/.lock`, true); let fd;
  try { fd = openSync(lock, 'wx'); return action(); }
  finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
function repository(root) { return discoverRecipeRepository(root ?? process.cwd()); }
function bodyIdentity(metadata, markdown) { const copy = { ...metadata }; delete copy.approval; return hash(canonical({ metadata: copy, markdown: markdown.replaceAll('\r\n', '\n') })); }
function contractIdentity(metadata) {
  const copy = { ...metadata }; for (const key of ['title', 'revision', 'approval']) delete copy[key]; return hash(canonical(copy));
}

/** JSON metadata contains the complete business contract; prose must remain consistent with it. */
export function parseScenario(text, { root, requireApproval = true } = {}) {
  safe(text);
  const match = text.match(/^```json\r?\n([\s\S]+?)\r?\n```\r?\n([\s\S]+)$/);
  need(match, 'scenario-format');
  let metadata; try { metadata = uniqueJson(match[1]); } catch { fail('scenario-json'); }
  safe(canonical(metadata)); schema(metadata, 'scenario');
  need(Number.isSafeInteger(metadata.revision) && metadata.revision > 0, 'scenario-revision');
  need(match[2].trim().length > 0, 'scenario-markdown');
  if (root) references(root, metadata.references);
  const contentSha256 = bodyIdentity(metadata, match[2]);
  const contractSha256 = contractIdentity(metadata);
  if (requireApproval) {
    need(metadata.approval, 'scenario-not-approved');
    need(metadata.approval.contentSha256 === contentSha256 && metadata.approval.contractSha256 === contractSha256, 'scenario-approval-drift');
  }
  return { metadata, markdown: match[2], sha256: hash(text), contentSha256, contractSha256, text };
}
export function auditCatalog({ root = process.cwd() } = {}) {
  const scenarios = [];
  const location = containedPath(root, CATALOG, true);
  if (existsSync(location)) for (const name of readdirSync(location).sort()) {
    if (name === '.gitkeep') continue;
    need(name.endsWith('.md'), 'unexpected-catalog-file');
    const filename = `${CATALOG}/${name}`;
    const scenario = parseScenario(bytes(root, filename).toString('utf8'), { root });
    need(name === `${scenario.metadata.id}.md`, 'scenario-filename-mismatch');
    need(!scenarios.some((item) => item.metadata.id === scenario.metadata.id), 'duplicate-scenario');
    scenarios.push({ path: filename, ...scenario });
  }
  const byId = new Map(scenarios.map((item) => [item.metadata.id, item]));
  for (const item of scenarios) for (const dependency of item.metadata.dependencies) need(byId.has(dependency) && dependency !== item.metadata.id, 'scenario-dependency-missing');
  const visit = (id, trail = []) => { need(!trail.includes(id), 'scenario-dependency-cycle'); for (const dep of byId.get(id).metadata.dependencies) visit(dep, [...trail, id]); };
  for (const item of scenarios) visit(item.metadata.id);
  return { status: 'PASS', scenarios, themes: [...new Set(scenarios.map((item) => item.metadata.theme))].sort(), limitations: limits };
}
export function propose({ root, input }) {
  const repo = repository(root); const raw = bytes(repo.currentRoot, input).toString('utf8');
  const scenario = parseScenario(raw, { root: repo.currentRoot, requireApproval: false });
  need(!scenario.metadata.approval, 'proposal-already-approved');
  return locked(repo.primaryRoot, () => {
    const id = `${scenario.metadata.id}-${scenario.sha256.slice(0, 16)}`;
    const folder = `${STORE}/proposals/${id}`;
    const proof = writeOnce(repo.primaryRoot, `${folder}/scenario.md`, raw);
    writeOnce(repo.primaryRoot, `${folder}/proposal.json`, { schemaVersion: 1, id, scenarioId: scenario.metadata.id, proposalSha256: scenario.sha256, contentSha256: scenario.contentSha256, contractSha256: scenario.contractSha256, source: input, sourceWorktree: repo.currentRoot, createdAt: new Date().toISOString() });
    return { status: 'PROPOSED', id, proposalSha256: scenario.sha256, proof, consentAuthenticated: false };
  });
}
function proposal(repo, id) {
  slug(id); const folder = `${STORE}/proposals/${id}`;
  const record = read(repo.primaryRoot, `${folder}/proposal.json`);
  const scenario = parseScenario(bytes(repo.primaryRoot, `${folder}/scenario.md`).toString('utf8'), { requireApproval: false });
  need(record.proposalSha256 === scenario.sha256, 'proposal-drift');
  return { folder, record, scenario };
}
export function decide({ root, input }) {
  const repo = repository(root); safe(canonical(input)); schema(input, 'decision'); timestamp(input.decidedAt);
  return locked(repo.primaryRoot, () => {
    const p = proposal(repo, input.proposalId); need(p.record.proposalSha256 === input.proposalSha256, 'decision-stale');
    const source = reference(repo.currentRoot, input.source.path); need(source.sha256 === input.source.sha256, 'decision-source-drift');
    const sourceText = bytes(repo.currentRoot, input.source.path).toString('utf8');
    need(sourceText.includes(input.quote), 'decision-quote-missing');
    const attachments = [];
    if (input.kind === 'editorial') for (const key of ['review', 'diff']) {
      need(input[key], 'editorial-review-and-diff-required');
      need(reference(repo.currentRoot, input[key].path).sha256 === input[key].sha256, 'editorial-attachment-drift');
      attachments.push({ name: key === 'review' ? 'review.json' : 'diff.txt', content: bytes(repo.currentRoot, input[key].path).toString('utf8') });
    }
    const id = `decision-${randomUUID()}`; const folder = `${STORE}/decisions/${id}`;
    writeOnce(repo.primaryRoot, `${folder}/source.txt`, sourceText);
    for (const item of attachments) writeOnce(repo.primaryRoot, `${folder}/${item.name}`, item.content);
    const proof = writeOnce(repo.primaryRoot, `${folder}/decision.json`, input);
    return { status: 'RECORDED', id, proof, consentAuthenticated: false };
  });
}
function renderScenario(metadata, markdown) { return `\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n${markdown}`; }
export function promote({ root, input }) {
  const repo = repository(root); slug(input.proposalId); slug(input.decisionId);
  return locked(repo.primaryRoot, () => {
    const p = proposal(repo, input.proposalId); const filename = `${STORE}/decisions/${input.decisionId}/decision.json`;
    const decision = read(repo.primaryRoot, filename); schema(decision, 'decision');
    need(decision.proposalId === input.proposalId && decision.proposalSha256 === p.scenario.sha256 && decision.verdict === 'approved', 'promotion-not-approved');
    const source = bytes(repo.primaryRoot, `${STORE}/decisions/${input.decisionId}/source.txt`);
    need(hash(source) === decision.source.sha256 && source.toString('utf8').includes(decision.quote), 'decision-source-drift');
    const target = `${CATALOG}/${p.scenario.metadata.id}.md`;
    const existing = existsSync(containedPath(repo.currentRoot, target, true)) ? parseScenario(bytes(repo.currentRoot, target).toString('utf8'), { root: repo.currentRoot }) : null;
    if (existing) need(p.scenario.metadata.revision > existing.metadata.revision, 'revision-not-increased');
    if (decision.kind === 'editorial') {
      need(existing && existing.contractSha256 === p.scenario.contractSha256, 'editorial-business-change');
      const reviewPath = `${STORE}/decisions/${input.decisionId}/review.json`;
      const diffPath = `${STORE}/decisions/${input.decisionId}/diff.txt`;
      const review = read(repo.primaryRoot, reviewPath);
      need(reference(repo.primaryRoot, reviewPath).sha256 === decision.review.sha256, 'editorial-review-drift');
      need(review.verdict === 'PASS' && review.reviewer !== decision.author && review.reviewer === decision.actor && review.proposalSha256 === p.scenario.sha256 && review.previousSha256 === existing.sha256 && review.contractUnchanged === true, 'editorial-review-required');
      textField(review.justification);
      const expectedDiff = `--- previous\n+++ proposed\n${existing.text.split('\n').map((line) => `-${line}`).join('\n')}\n${p.scenario.text.split('\n').map((line) => `+${line}`).join('\n')}\n`;
      need(bytes(repo.primaryRoot, diffPath).toString('utf8') === expectedDiff && reference(repo.primaryRoot, diffPath).sha256 === decision.diff.sha256 && review.diffSha256 === decision.diff.sha256, 'editorial-diff-required');
    } else need(decision.actor === 'Amaury', 'human-approval-required');
    references(repo.currentRoot, p.scenario.metadata.references);
    const current = auditCatalog({ root: repo.currentRoot });
    const dependencies = new Map(current.scenarios.map((s) => [s.metadata.id, s.metadata.dependencies]));
    dependencies.set(p.scenario.metadata.id, p.scenario.metadata.dependencies);
    const visit = (id, trail = []) => { need(dependencies.has(id) && !trail.includes(id), 'promotion-dependency-missing-or-cycle'); for (const dep of dependencies.get(id)) visit(dep, [...trail, id]); };
    for (const id of dependencies.keys()) visit(id);
    const approval = { kind: decision.kind, actor: decision.actor, approvedAt: decision.decidedAt, proposalSha256: p.scenario.sha256, decisionSha256: hash(bytes(repo.primaryRoot, filename)), contentSha256: p.scenario.contentSha256, contractSha256: p.scenario.contractSha256 };
    const promoted = renderScenario({ ...p.scenario.metadata, approval }, p.scenario.markdown);
    parseScenario(promoted, { root: repo.currentRoot });
    const receiptId = `promotion-${randomUUID()}`;
    writeOnce(repo.primaryRoot, `${STORE}/promotions/${receiptId}/scenario.md`, promoted);
    writeOnce(repo.primaryRoot, `${STORE}/promotions/${receiptId}/receipt.json`, { proposalId: input.proposalId, decisionId: input.decisionId, previousSha256: existing?.sha256 ?? null, scenarioSha256: hash(promoted) });
    const destination = containedPath(repo.currentRoot, target, true); mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, promoted, { flag: existing ? 'w' : 'wx' });
    return { status: 'PROMOTED', scenarioId: p.scenario.metadata.id, sha256: hash(promoted), qualification: 'NOT_RUN', receiptId };
  });
}

function deployment(value, root, { capture = false } = {}) {
  need(value && value.environment === 'Dev', 'dev-only');
  const url = new URL(value.url); need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'unsafe-deployment-url');
  if (value.id === null || value.commit === null || value.source === null) return { ...value, verified: false };
  textField(value.id); need(/^[a-f0-9]{40,64}$/.test(value.commit), 'invalid-deployment-commit'); timestamp(value.observedAt);
  sha(value.source.sha256);
  if (capture) need(reference(root, value.source.path).sha256 === value.source.sha256, 'deployment-source-drift');
  return { ...value, verified: true };
}
function sameDeployment(a, b) { return a.environment === b.environment && a.url === b.url && a.id === b.id && a.commit === b.commit; }
function campaign(repo, id) {
  slug(id); const folder = `${STORE}/campaigns/${id}`; const manifest = read(repo.primaryRoot, `${folder}/manifest.json`); schema(manifest, 'campaign');
  for (const item of manifest.selection) {
    const snapshot = bytes(repo.primaryRoot, `${folder}/scenarios/${item.id}.md`).toString('utf8');
    need(hash(snapshot) === item.sha256 && parseScenario(snapshot).metadata.id === item.id, 'campaign-snapshot-drift');
  }
  need(hash(bytes(repo.primaryRoot, `${folder}/authorization.txt`)) === manifest.authorization.sha256, 'campaign-authorization-drift');
  if (manifest.deployment.verified) need(hash(bytes(repo.primaryRoot, `${folder}/deployment-source.txt`)) === manifest.deployment.source.sha256, 'campaign-deployment-source-drift');
  return { folder, manifest };
}
function attempts(repo, c) {
  const folder = `${c.folder}/attempts`; const target = containedPath(repo.primaryRoot, folder, true);
  if (!existsSync(target)) return [];
  return readdirSync(target).sort().map((id) => {
    slug(id); const start = read(repo.primaryRoot, `${folder}/${id}/start.json`);
    schema(start, 'attempt-start');
    const resultPath = `${folder}/${id}/result.json`;
    const result = existsSync(containedPath(repo.primaryRoot, resultPath, true)) ? read(repo.primaryRoot, resultPath) : null;
    if (start.deployment.verified) need(hash(bytes(repo.primaryRoot, `${folder}/${id}/deployment-start.txt`)) === start.deployment.source.sha256, 'attempt-deployment-source-drift');
    if (result) {
      schema(result, 'attempt-result');
      need(result.durationMs === timestamp(result.endedAt) - timestamp(start.startedAt) && result.durationMs >= 0, 'attempt-duration-drift');
      if (result.deployment?.verified) need(hash(bytes(repo.primaryRoot, `${folder}/${id}/deployment-end.txt`)) === result.deployment.source.sha256, 'attempt-deployment-source-drift');
      for (const item of result.evidence) need(hash(bytes(repo.primaryRoot, `${folder}/${id}/${item.snapshot}`)) === item.sha256, 'attempt-evidence-drift');
    }
    return { id, ...start, result, status: result?.outcome ?? 'INTERRUPTED' };
  }).sort((a, b) => a.sequence - b.sequence);
}
function mutable(repo, c) { need(!existsSync(containedPath(repo.primaryRoot, `${c.folder}/finish.json`, true)), 'campaign-finalized'); }
function stopped(repo, c) { return existsSync(containedPath(repo.primaryRoot, `${c.folder}/stop.json`, true)); }
function stop(repo, c, code) {
  if (!stopped(repo, c)) writeOnce(repo.primaryRoot, `${c.folder}/stop.json`, { code, recordedAt: new Date().toISOString() });
}
export function startCampaign({ root, input }) {
  const repo = repository(root); safe(canonical(input));
  need(Array.isArray(input.selection) && input.selection.length > 0 && new Set(input.selection).size === input.selection.length, 'explicit-selection-required');
  const catalog = auditCatalog({ root: repo.currentRoot }); const selection = input.selection.map((id) => { slug(id); const item = catalog.scenarios.find((s) => s.metadata.id === id); need(item && item.metadata.status === 'active', 'selection-not-approved-or-retired'); return item; });
  for (const [index, item] of selection.entries()) for (const dependency of item.metadata.dependencies) need(input.selection.indexOf(dependency) >= 0 && input.selection.indexOf(dependency) < index, 'dependency-not-selected-before');
  const target = deployment(input.deployment, repo.currentRoot, { capture: true });
  const authorization = reference(repo.currentRoot, input.authorization.path); need(authorization.sha256 === input.authorization.sha256, 'authorization-drift');
  textField(input.authorization.quote); need(bytes(repo.currentRoot, authorization.path).toString('utf8').includes(input.authorization.quote), 'authorization-quote-missing');
  timestamp(input.startedAt); textField(input.executor); textField(input.tool); textField(input.browser); need(['desktop', 'mobile-simulated'].includes(input.device), 'invalid-device');
  for (const key of ['model', 'effort']) need(input[key] === null || (typeof input[key]?.value === 'string' && input[key].value.trim() && typeof input[key]?.source === 'string' && input[key].source.trim()), 'model-effort-source-required');
  need(Array.isArray(input.preparations), 'preparations-required'); safe(canonical(input));
  return locked(repo.primaryRoot, () => {
    const id = `campaign-${randomUUID()}`; const folder = `${STORE}/campaigns/${id}`;
    const manifest = { schemaVersion: 1, id, sourceWorktree: repo.currentRoot, startedAt: input.startedAt, recordedAt: new Date().toISOString(), selection: selection.map((s) => ({ id: s.metadata.id, revision: s.metadata.revision, sha256: s.sha256, title: s.metadata.title })), deployment: target, authorization: { ...input.authorization }, executor: input.executor, tool: input.tool, browser: input.browser, device: input.device, model: input.model, effort: input.effort, preparations: input.preparations };
    schema(manifest, 'campaign');
    for (const item of selection) writeOnce(repo.primaryRoot, `${folder}/scenarios/${item.metadata.id}.md`, item.text);
    writeOnce(repo.primaryRoot, `${folder}/authorization.txt`, bytes(repo.currentRoot, authorization.path).toString('utf8'));
    if (target.verified) writeOnce(repo.primaryRoot, `${folder}/deployment-source.txt`, bytes(repo.currentRoot, target.source.path).toString('utf8'));
    writeOnce(repo.primaryRoot, `${folder}/manifest.json`, manifest);
    return { status: 'OPEN', id, selection: input.selection, deploymentVerified: target.verified, limitations: limits };
  });
}
export function beginAttempt({ root, input }) {
  const repo = repository(root); safe(canonical(input)); schema(input, 'attempt-input'); timestamp(input.startedAt);
  return locked(repo.primaryRoot, () => {
    const c = campaign(repo, input.campaignId); mutable(repo, c); const all = attempts(repo, c);
    need(!stopped(repo, c) && !all.some((a) => a.result?.stopCampaign), 'campaign-stopped');
    need(timestamp(input.startedAt) >= timestamp(c.manifest.startedAt), 'attempt-before-campaign');
    const previous = all.at(-1); const selected = c.manifest.selection.map((s) => s.id); const index = selected.indexOf(input.scenarioId); need(index >= 0, 'scenario-not-selected');
    if (previous && !previous.result) need(input.resumes === previous.id && input.scenarioId === previous.scenarioId, 'interrupted-attempt-must-resume');
    else if (input.resumes) need(previous?.id === input.resumes && previous.scenarioId === input.scenarioId, 'invalid-resume');
    else need(index === (previous ? selected.indexOf(previous.scenarioId) + 1 : 0), 'selection-order');
    if (previous) need(timestamp(input.startedAt) >= timestamp(previous.result?.endedAt ?? previous.startedAt), 'attempt-time-order');
    const observed = deployment(input.deployment, repo.currentRoot, { capture: true });
    if (!sameDeployment(observed, c.manifest.deployment)) { stop(repo, c, 'deployment-drift'); fail('deployment-drift-stop-campaign'); }
    need(input.preflight && ['syntheticAccountsAuthorized', 'preconditionsMet', 'browserAvailable'].every((key) => typeof input.preflight[key] === 'boolean'), 'preflight-required');
    const id = `attempt-${randomUUID()}`;
    const record = { schemaVersion: 1, sequence: all.length + 1, scenarioId: input.scenarioId, startedAt: input.startedAt, recordedAt: new Date().toISOString(), resumes: input.resumes ?? null, deployment: observed, preflight: input.preflight, executor: input.executor, tool: input.tool, browser: input.browser, device: input.device, model: input.model, effort: input.effort };
    schema(record, 'attempt-start');
    if (observed.verified) writeOnce(repo.primaryRoot, `${c.folder}/attempts/${id}/deployment-start.txt`, bytes(repo.currentRoot, observed.source.path).toString('utf8'));
    writeOnce(repo.primaryRoot, `${c.folder}/attempts/${id}/start.json`, record);
    return { status: 'STARTED', id, campaignId: input.campaignId };
  });
}
export function recordAttempt({ root, input }) {
  const repo = repository(root); safe(canonical(input));
  return locked(repo.primaryRoot, () => {
    const c = campaign(repo, input.campaignId); mutable(repo, c); const all = attempts(repo, c); const a = all.find((item) => item.id === input.attemptId);
    need(a && a.id === all.at(-1).id && !a.result, 'attempt-not-current-or-already-recorded');
    timestamp(input.endedAt); const durationMs = timestamp(input.endedAt) - timestamp(a.startedAt); need(durationMs >= 0, 'negative-duration');
    need(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(input.outcome), 'invalid-outcome');
    need(Array.isArray(input.steps) && Array.isArray(input.observations) && Array.isArray(input.limitations) && Array.isArray(input.evidence), 'attempt-evidence-required');
    need(input.waitingMs === null || (Number.isSafeInteger(input.waitingMs) && input.waitingMs >= 0 && input.waitingMs <= durationMs), 'invalid-waiting-duration');
    need(['reliable', 'session-invalid', 'deployment-changed', 'data-contaminated', 'mutation-uncertain'].includes(input.environmentState), 'environment-state-required');
    let observed = null;
    if (input.deployment) observed = deployment(input.deployment, repo.currentRoot, { capture: true });
    const drift = observed && !sameDeployment(observed, c.manifest.deployment);
    const stopCampaign = Boolean(stopped(repo, c) || drift || input.environmentState !== 'reliable');
    if (stopCampaign) stop(repo, c, drift ? 'deployment-drift' : input.environmentState);
    const scenario = parseScenario(bytes(repo.primaryRoot, `${c.folder}/scenarios/${a.scenarioId}.md`).toString('utf8'));
    if (input.outcome === 'PASS') need(c.manifest.deployment.verified && a.deployment.verified && observed?.verified && !stopCampaign && Object.values(a.preflight).every(Boolean) && input.steps.length >= scenario.metadata.actions.length && input.observations.length >= scenario.metadata.assertions.length, 'pass-requires-version-ui-evidence');
    const evidence = input.evidence.map((item, index) => { const proof = reference(repo.currentRoot, item.path); need(proof.sha256 === item.sha256, 'evidence-drift'); return { ...proof, snapshot: `evidence-${index}.txt` }; });
    const result = { schemaVersion: 1, endedAt: input.endedAt, recordedAt: new Date().toISOString(), durationMs, waitingMs: input.waitingMs, outcome: input.outcome, steps: input.steps, observations: input.observations, limitations: input.limitations, evidence, deployment: observed, environmentState: input.environmentState, stopCampaign };
    schema(result, 'attempt-result');
    if (observed?.verified) writeOnce(repo.primaryRoot, `${c.folder}/attempts/${a.id}/deployment-end.txt`, bytes(repo.currentRoot, observed.source.path).toString('utf8'));
    for (const item of evidence) writeOnce(repo.primaryRoot, `${c.folder}/attempts/${a.id}/${item.snapshot}`, bytes(repo.currentRoot, item.path).toString('utf8'));
    writeOnce(repo.primaryRoot, `${c.folder}/attempts/${a.id}/result.json`, result);
    return { status: input.outcome, durationMs, stopCampaign };
  });
}
function campaignReport(repo, c) {
  const all = attempts(repo, c); const rows = c.manifest.selection.map((item) => {
    const history = all.filter((a) => a.scenarioId === item.id); const latest = history.at(-1);
    return { ...item, outcome: latest?.status ?? 'NOT_RUN', history, durationMs: latest?.result?.durationMs ?? null, executor: latest?.executor ?? null, tool: latest?.tool ?? null, browser: latest?.browser ?? null, device: latest?.device ?? null, model: latest?.model ?? null, effort: latest?.effort ?? null };
  });
  return { schemaVersion: 1, campaignId: c.manifest.id, deployment: c.manifest.deployment, selection: rows, stopped: stopped(repo, c), complete: rows.every((row) => row.history.at(-1)?.result), allPassed: !stopped(repo, c) && rows.every((row) => row.outcome === 'PASS'), limitations: limits };
}
export function finishCampaign({ root, input }) {
  const repo = repository(root); timestamp(input.finishedAt); textField(input.reason);
  return locked(repo.primaryRoot, () => {
    const c = campaign(repo, input.campaignId); mutable(repo, c); const report = campaignReport(repo, c);
    const latest = attempts(repo, c).at(-1); need(timestamp(input.finishedAt) >= timestamp(latest?.result?.endedAt ?? latest?.startedAt ?? c.manifest.startedAt), 'finish-time-order');
    const final = { ...report, finishedAt: input.finishedAt, reason: input.reason };
    writeOnce(repo.primaryRoot, `${c.folder}/finish.json`, final);
    return { status: 'FINALIZED', ...final };
  });
}
export function reportCampaign({ root, campaignId }) {
  const repo = repository(root); const c = campaign(repo, campaignId); const report = campaignReport(repo, c);
  const filename = `${c.folder}/finish.json`;
  if (!existsSync(containedPath(repo.primaryRoot, filename, true))) return report;
  const final = read(repo.primaryRoot, filename); const { finishedAt, reason, ...recorded } = final;
  timestamp(finishedAt); textField(reason); need(canonical(recorded) === canonical(report), 'final-report-drift'); return final;
}
export function catalogReport({ root, deployment: target = null } = {}) {
  const repo = repository(root); const catalog = auditCatalog({ root: repo.currentRoot });
  const campaigns = containedPath(repo.primaryRoot, `${STORE}/campaigns`, true);
  const history = existsSync(campaigns) ? readdirSync(campaigns).map((id) => campaignReport(repo, campaign(repo, id))) : [];
  return { status: 'PASS', themes: catalog.themes, scenarios: catalog.scenarios.map((s) => {
    const all = history.flatMap((c) => c.selection.filter((row) => row.id === s.metadata.id).flatMap((row) => row.history.map((a) => ({ campaignId: c.campaignId, scenarioSha256: row.sha256, deployment: c.deployment, model: row.model, effort: row.effort, ...a })))).sort((a, b) => timestamp(a.startedAt) - timestamp(b.startedAt) || a.sequence - b.sequence);
    const applicable = target ? all.filter((a) => a.scenarioSha256 === s.sha256 && sameDeployment(a.deployment, target)) : [];
    return { id: s.metadata.id, title: s.metadata.title, theme: s.metadata.theme, revision: s.metadata.revision, status: s.metadata.status, sha256: s.sha256, latest: all.at(-1) ?? null, history: all, applicableLatest: applicable.at(-1) ?? null, durations: all.filter((a) => a.result && a.status !== 'NOT_RUN').map((a) => ({ durationMs: a.result.durationMs, outcome: a.status, model: a.model, effort: a.effort, scenarioSha256: a.scenarioSha256, deployment: a.deployment })) };
  }), coverageTarget: target, limitations: limits };
}

export function readRecipeInput(root, filename) { return read(root, filename); }
