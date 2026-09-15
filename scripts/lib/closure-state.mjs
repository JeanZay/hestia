import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from '../guard.mjs';
import { readJsonSafe, validateJsonSchema } from '../refinement-check.mjs';
import { captureCandidate } from './verification-evidence.mjs';

const REGISTRY = 'artifacts/closure/registry.json';
const PROTECTED = new Set(['main', 'develop']);
const ACTIONS = new Set(['inspect', 'resume', 'verify', 'start', 'finish', 'merge', 'cleanup']);
const schemaPath = fileURLToPath(new URL('../../harness/schemas/closure.schema.json', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const normalized = (value) => path.resolve(value).toLowerCase();
const samePath = (left, right) => normalized(left) === normalized(right);
const inside = (root, file) => samePath(root, file) || normalized(file).startsWith(`${normalized(root)}${path.sep}`);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function noLinks(absolute) {
  let current = path.parse(path.resolve(absolute)).root;
  for (const component of path.resolve(absolute).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) fail('linked-path');
  }
  return path.resolve(absolute);
}
function relative(value) {
  if (typeof value !== 'string' || !value || /[\\:\0*?\[\]]/.test(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))) fail('path-outside-primary');
  return value;
}
function git(root, args, accepted = [0]) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[name];
  try { return execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', '-c', `safe.directory=${path.resolve(root)}`, '-c', 'core.fsmonitor=false', ...args], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { if (accepted.includes(error.status)) return null; fail('git-inspection-unavailable'); }
}
function worktrees(root) {
  const result = []; let current = null;
  for (const token of git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0')) {
    if (!token) { if (current) result.push(current); current = null; continue; }
    if (token.startsWith('worktree ')) current = { path: token.slice(9), head: null, branch: null, locked: false, prunable: false };
    else if (current && token.startsWith('HEAD ')) current.head = token.slice(5);
    else if (current && token.startsWith('branch refs/heads/')) current.branch = token.slice(18);
    else if (current && token.startsWith('locked')) current.locked = true;
    else if (current && token.startsWith('prunable')) current.prunable = true;
  }
  if (!result.length) fail('no-primary-worktree');
  return result;
}
function repositoryUrl(value) {
  const match = value?.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return match ? `https://github.com/${match[1]}` : null;
}

/** Shared discovery comes from Git metadata, not the calling worktree's artifacts. */
export function discoverRepository(root) {
  noLinks(root);
  if (git(root, ['rev-parse', '--is-bare-repository']).trim() !== 'false') fail('bare-repository-unsupported');
  const currentRoot = noLinks(git(root, ['rev-parse', '--show-toplevel']).trim());
  const commonDir = noLinks(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  const primaryRoot = noLinks(worktrees(currentRoot)[0].path);
  if (!samePath(git(primaryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), commonDir)) fail('primary-common-dir-mismatch');
  const repository = repositoryUrl(git(currentRoot, ['config', '--get', 'remote.origin.url'], [0, 1]));
  return { root: currentRoot, currentRoot, primaryRoot, commonDir, sharedDir: path.join(primaryRoot, 'artifacts/closure'), registryPath: path.join(primaryRoot, REGISTRY), repository };
}

/** No file content from an external checkout is read solely because Git lists it. */
export function inventory(root, { allowExternalWorktrees = [] } = {}) {
  const discovered = discoverRepository(root);
  const listed = worktrees(discovered.currentRoot).map((item) => ({ ...item, inspectable: inside(discovered.primaryRoot, item.path) || allowExternalWorktrees.some((allowed) => samePath(allowed, item.path)) }));
  const branches = git(root, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads']).trim().split('\n').filter(Boolean).map((line) => {
    const [branch, head] = line.split('\0');
    return { branch, head, protected: PROTECTED.has(branch), worktrees: listed.filter((item) => item.branch === branch).map((item) => item.path).sort() };
  }).sort((left, right) => left.branch < right.branch ? -1 : 1);
  const stable = { branches, worktrees: listed.map(({ path: value, head, branch, locked, prunable }) => ({ path: value, head, branch, locked, prunable })).sort((left, right) => left.path < right.path ? -1 : 1) };
  return { ...discovered, branches, worktrees: listed, inventoryDigest: hash(JSON.stringify(stable)) };
}

function readBounded(root, value) {
  const absolute = noLinks(path.resolve(root, relative(value)));
  if (!inside(root, absolute) || samePath(root, absolute)) fail('path-outside-primary');
  const before = lstatSync(absolute);
  if (!before.isFile() || !before.size || before.size > 1024 * 1024) fail('reference-size-or-type');
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor); const buffer = Buffer.alloc(1024 * 1024 + 1); let length = 0;
    while (length < buffer.length) { const count = readSync(descriptor, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor);
    if (!opened.isFile() || before.ino !== opened.ino || before.dev !== opened.dev || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs || length > 1024 * 1024) fail('reference-changed-or-oversize');
    const bytes = buffer.subarray(0, length); const scanned = inspectFile(value, bytes);
    if (scanned.binary || scanned.findings.length) fail('guard-rejected-reference');
    return { absolute, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha256: hash(bytes) };
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
function context(discovered) {
  const schema = readJsonSafe(schemaPath); const inputs = new Map();
  function load(reference, type = null) {
    if (!reference || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? '')) fail('reference-required');
    const read = readBounded(discovered.primaryRoot, reference.path);
    if (read.sha256 !== reference.sha256) fail('reference-digest-mismatch');
    if (inputs.has(reference.path) && inputs.get(reference.path) !== read.sha256) fail('conflicting-reference');
    inputs.set(reference.path, read.sha256);
    if (!type) return read.text;
    const value = readJsonSafe(read.absolute);
    if (!same(value, JSON.parse(read.text))) fail('reference-changed-during-parse');
    if (type !== 'json' && validateJsonSchema(value, { $ref: `#/$defs/${type}`, $defs: schema.$defs }).length) fail(`invalid-${type}`);
    return value;
  }
  let read;
  try { read = readBounded(discovered.primaryRoot, REGISTRY); }
  catch (error) { if (error.code === 'ENOENT') return { present: false, inputs, load }; throw error; }
  if (git(discovered.primaryRoot, ['check-ignore', '--no-index', '-q', REGISTRY], [0, 1]) === null || git(discovered.primaryRoot, ['ls-files', '--error-unmatch', REGISTRY], [0, 1]) !== null) fail('registry-must-be-ignored');
  const registry = readJsonSafe(read.absolute);
  if (!same(registry, JSON.parse(read.text))) fail('registry-changed-during-parse');
  if (validateJsonSchema(registry, schema).length) fail('invalid-registry');
  inputs.set(REGISTRY, read.sha256);
  const documents = new Map();
  for (const entry of registry.entries) {
    load(entry.source);
    const docs = {};
    for (const kind of ['validation', 'review']) if (entry.proofs[kind]) {
      docs[kind] = load(entry.proofs[kind], kind);
      if (docs[kind].evidence.path === entry.proofs[kind].path) fail('evidence-cannot-be-wrapper');
      if (kind === 'review') load(docs[kind].evidence);
      else {
        const proof = docs.validation; const report = load(proof.evidence, 'json');
        const evidenceRoot = proof.evidenceRoot === '.' ? '' : `${relative(proof.evidenceRoot)}/`;
        if (!proof.evidence.path.startsWith(evidenceRoot)) fail('validation-evidence-root-mismatch');
        if (report.schemaVersion !== 2 || report.status !== 'PASS' || !Array.isArray(report.errors) || report.errors.length || report.candidate?.status !== 'UNCHANGED' || !Array.isArray(report.results) || !report.results.length || report.results.some((step) => !(step.status === 'PASS' && step.exitCode === 0) && !(step.required === false && step.status === 'NOT_PERFORMED' && step.exitCode === null))) fail('validation-report-not-passed');
        for (const phase of ['before', 'after']) {
          const reference = report.candidate[phase];
          if (!reference) fail('validation-manifest-missing');
          const manifest = load({ path: `${evidenceRoot}${relative(reference.path)}`, sha256: reference.sha256 }, 'json');
          if (manifest.commit !== proof.head || manifest.sourceDigest !== proof.sourceDigest || !Array.isArray(manifest.files) || hash(JSON.stringify(manifest.files)) !== proof.sourceDigest) fail('validation-manifest-candidate-mismatch');
        }
      }
    }
    if (entry.authorization) docs.authorization = load(entry.authorization, 'authorization');
    if (entry.reservation) docs.reservation = load(entry.reservation, 'reservation');
    if (entry.disposition) docs.disposition = load(entry.disposition, 'disposition');
    if (docs.disposition?.authorization) docs.dispositionAuthorization = load(docs.disposition.authorization, 'authorization');
    if (docs.disposition?.remoteReceipt) docs.remoteReceipt = load(docs.disposition.remoteReceipt, 'remoteReceipt');
    for (const doc of [docs.authorization, docs.dispositionAuthorization, docs.reservation].filter(Boolean)) if (!load(doc.source).includes(doc.quote)) fail('source-quote-mismatch');
    for (const preserved of docs.disposition?.preserved ?? []) load(preserved.copy);
    documents.set(entry.branch, docs);
  }
  return { present: true, registry, documents, inputs, load };
}

function operationState(actual, loaded) {
  const directory = (value) => {
    try { const absolute = noLinks(path.join(actual.primaryRoot, value)); if (!lstatSync(absolute).isDirectory()) fail('invalid-operation-directory'); return readdirSync(absolute).sort(); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const read = (value) => { const file = readBounded(actual.primaryRoot, value); return loaded.load({ path: value, sha256: file.sha256 }, 'json'); };
  const lockNames = directory('artifacts/closure/operation.lock');
  let owner = null;
  for (const name of lockNames ?? []) { const value = `artifacts/closure/operation.lock/${relative(name)}`; if (name === 'owner.json') owner = read(value); else { const file = readBounded(actual.primaryRoot, value); loaded.load({ path: value, sha256: file.sha256 }); } }
  const lock = { present: lockNames !== null, complete: Boolean(lockNames?.length === 1 && owner && /^[a-f0-9-]{36}$/.test(owner.token) && Number.isInteger(owner.pid) && Number.isFinite(Date.parse(owner.recordedAtUtc))), files: lockNames ?? [] };
  const names = directory('artifacts/closure/operations'); const entries = [];
  if ((names?.length ?? 0) > 1000) fail('operation-inventory-limit');
  for (const name of names ?? []) {
    if (!/^\d{13}-[a-f0-9-]{36}$/.test(name)) fail('invalid-operation-id');
    const base = `artifacts/closure/operations/${name}`; const files = directory(base); const docs = {};
    if (!files || files.length > 8) fail('operation-file-limit');
    for (const file of files) {
      if (!['intent.json', 'result.json', 'registry-before.json', 'registry-after.json', 'remote-merge-receipt.json', 'disposition.json'].includes(file)) fail('unknown-operation-file');
      docs[file] = read(`${base}/${file}`);
    }
    const intent = docs['intent.json']; const result = docs['result.json'];
    let complete = Boolean(intent?.schemaVersion === 1 && intent.operationId === name && ['start', 'finish', 'merge'].includes(intent.action) && result?.schemaVersion === 1 && result.operationId === name && result.action === intent.action && result.status === 'COMPLETED');
    if (complete) {
      const reference = result.registry;
      complete = Boolean(reference?.path === `${base}/registry-after.json` && reference.sha256 === loaded.inputs.get(reference.path) && docs['registry-after.json']);
    }
    entries.push({ id: name, complete, status: result?.status === 'COMPLETED' ? 'COMPLETED' : result?.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'INCOMPLETE', files });
  }
  return { lock, operations: { present: names !== null, entries }, owner };
}

/** Frozen inputs for before/after evidence. Missing registry is observable, never initialized. */
export function closureInputs(root) {
  const actual = inventory(root); const loaded = context(actual);
  const { lock, operations } = operationState(actual, loaded);
  return { registry: REGISTRY, present: loaded.present, files: [...loaded.inputs].map(([value, sha256]) => ({ path: value, sha256 })).sort((left, right) => left.path < right.path ? -1 : 1), inventoryDigest: actual.inventoryDigest, lock, operations };
}

/** Read-only gates. The mutation runner must independently validate live GitHub state. */
export function inspectClosure({ root = process.cwd(), action = 'inspect', branch, lotId, target = 'main', reservation = null, now = new Date(), allowExternalWorktrees = [], lockToken = null } = {}) {
  const diagnostics = []; let actual = null; let loaded = null; let lot = null; let requiredAction = null;
  const add = (code, affected = branch ?? null, blocking = true) => { if (!diagnostics.some((item) => item.code === code && item.branch === affected)) diagnostics.push({ code, branch: affected, blocking }); };
  const finish = () => ({ valid: !diagnostics.some((item) => item.blocking), action, diagnostics, repository: actual, inventory: actual, registry: loaded?.registry ?? null, sharedDir: actual?.sharedDir ?? null, lot, entry: lot, documents: lot ? loaded?.documents?.get(lot.branch) ?? null : null, nextAction: diagnostics.some((item) => item.blocking) ? null : lot?.nextAction ?? null, requiredAction, consentAuthenticated: false, remoteStateVerified: false, limitations: ['Contrôles locaux en lecture seule ; aucun PASS ne crée une permission.', 'Les reçus distants sont des preuves enregistrées à rapprocher du réseau avant mutation.', 'Registre technique uniquement ; GitHub demeure le backlog.'] });
  try {
    if (!ACTIONS.has(action)) fail('unknown-action');
    const clock = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(clock)) fail('invalid-clock');
    actual = inventory(root, { allowExternalWorktrees }); loaded = context(actual);
    const journal = operationState(actual, loaded);
    if (journal.lock.present && !(journal.lock.complete && ['start', 'finish', 'merge'].includes(action) && journal.owner.pid === process.pid && journal.owner.token === lockToken)) add('closure-lock-present-reconciliation-required');
    if (journal.operations.entries.some((entry) => !entry.complete)) add('pending-operation-reconciliation-required');
    if (!loaded.present) { add('registry-missing'); return finish(); }
    const { registry, documents, load } = loaded;
    const currentBranches = new Map(actual.branches.map((item) => [item.branch, item]));
    const entries = new Map();
    const current = actual.worktrees.find((item) => samePath(item.path, actual.currentRoot));
    const selected = branch ? registry.entries.find((entry) => entry.branch === branch) : lotId ? registry.entries.filter((entry) => entry.lotId === lotId) : registry.entries.find((entry) => entry.branch === current?.branch);
    if (Array.isArray(selected)) { if (selected.length === 1) lot = selected[0]; else add('branch-selection-required'); } else lot = selected ?? null;
    if (lotId && lot && lot.lotId !== lotId) add('lot-branch-mismatch');
    const effectiveState = (entry) => action === 'finish' && entry === lot && documents.get(entry.branch).disposition ? (documents.get(entry.branch).disposition.kind === 'abandoned' ? 'deferred' : documents.get(entry.branch).disposition.kind) : entry.state;
    const dated = (doc, affected) => { if (!Number.isFinite(Date.parse(doc.recordedAtUtc)) || Date.parse(doc.recordedAtUtc) > clock) add('future-or-invalid-date', affected); };
    const exact = (doc, entry, head = entry.candidate?.head ?? currentBranches.get(entry.branch)?.head) => doc.repository === registry.repository && doc.branch === entry.branch && doc.target === entry.target && doc.head === head;
    const authorization = (doc, entry, intent, pr = null) => Boolean(doc && exact(doc, entry) && doc.actions.includes(intent) && doc.pr === pr);
    dated(registry, null);
    if (actual.repository !== null && actual.repository !== registry.repository) add('repository-mismatch', null);
    for (const entry of registry.entries) {
      const state = effectiveState(entry);
      if (entries.has(entry.branch)) add('duplicate-branch', entry.branch);
      entries.set(entry.branch, entry);
      if (PROTECTED.has(entry.branch) || entry.branch === entry.target) add('protected-or-self-target', entry.branch);
      if (!currentBranches.has(entry.target)) add('target-branch-missing', entry.branch);
      const found = currentBranches.get(entry.branch); const docs = documents.get(entry.branch);
      if (!found && state !== 'merged') add('registered-branch-missing', entry.branch);
      if (entry.candidate && found && entry.candidate.head !== found.head) add('candidate-head-drift', entry.branch);
      for (const doc of Object.values(docs)) dated(doc, entry.branch);
      for (const name of ['validation', 'review', 'authorization', 'disposition', 'dispositionAuthorization', 'remoteReceipt']) if (docs[name] && !exact(docs[name], entry)) add(`${name}-candidate-mismatch`, entry.branch);
      if (docs.disposition?.pr && !docs.disposition.pr.startsWith(`${registry.repository}/pull/`)) add('disposition-pr-mismatch', entry.branch);
      if (state !== 'working' && (!docs.disposition || ![state, ...(state === 'deferred' ? ['abandoned'] : [])].includes(docs.disposition.kind))) add('state-disposition-missing', entry.branch);
      if (state === 'deferred' && !authorization(docs.dispositionAuthorization, entry, docs.disposition?.kind === 'abandoned' ? 'abandon' : 'defer', docs.disposition?.pr ?? null)) add('deferral-not-explicitly-authorized', entry.branch);
      if (docs.reservation && (docs.reservation.repository !== registry.repository || docs.reservation.branch !== entry.branch || docs.reservation.lotId !== entry.lotId || docs.reservation.target !== entry.target)) add('reservation-entry-mismatch', entry.branch);
      if (['ready', 'merged'].includes(state)) {
        if (!entry.candidate || !docs.validation || !docs.review) add('candidate-proofs-missing', entry.branch);
        if (docs.validation && (docs.validation.status !== 'PASS' || docs.validation.sourceDigest !== entry.candidate?.sourceDigest || docs.validation.checks.some((check) => check.status !== 'PASS' || check.exitCode !== 0))) add('validation-not-passed', entry.branch);
        if (docs.review && (docs.review.status !== 'PASS' || docs.review.sourceDigest !== entry.candidate?.sourceDigest || docs.review.openBlockingFindings !== 0 || docs.review.authors.some((author) => author.toLowerCase() === docs.review.reviewer.identity.toLowerCase()))) add('independent-review-not-passed', entry.branch);
      }
      if (state === 'merged') {
        const receipt = docs.remoteReceipt; const disposition = docs.disposition;
        if (!receipt || !disposition || receipt.pr !== disposition.pr || receipt.mergeCommit !== disposition.mergeCommit || (receipt.comparison === 'identical' && receipt.targetHead !== receipt.mergeCommit) || !authorization(docs.authorization, entry, 'merge', disposition.pr)) add('merge-not-confirmed', entry.branch);
      }
    }
    for (const found of actual.branches.filter((item) => !item.protected && !entries.has(item.branch))) add('unknown-work-branch', found.branch, !['inspect', 'resume', 'finish'].includes(action));
    if (actual.worktrees.some((item) => item.branch === null)) add('detached-worktree-unregistered', null, !['inspect', 'resume'].includes(action));
    if (lot) {
      const state = effectiveState(lot); const docs = documents.get(lot.branch);
      const kind = state === 'ready' ? (authorization(docs.authorization, lot, 'merge', docs.disposition?.pr ?? null) ? 'execute-approved-merge' : 'request-integration-approval') : ({ working: 'complete-work', blocked: 'resolve-blocker', deferred: 'retain-deferred-work', merged: 'reconcile-local-and-preserve' })[state];
      requiredAction = { kind, branch: lot.branch, head: lot.candidate?.head ?? currentBranches.get(lot.branch)?.head ?? null, target: lot.target, pr: docs.disposition?.pr ?? null };
    }
    const safeWorktree = (entry) => {
      const candidates = actual.worktrees.filter((item) => item.branch === entry.branch);
      if (candidates.length !== 1 || !candidates[0].inspectable || candidates[0].locked || candidates[0].prunable) fail('worktree-inspection-not-allowed');
      noLinks(candidates[0].path);
      if (!samePath(git(candidates[0].path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), actual.commonDir)) fail('worktree-common-dir-mismatch');
      return candidates[0].path;
    };
    for (const entry of registry.entries.filter((item) => effectiveState(item) === 'ready' && item.candidate)) {
      try { const snapshot = captureCandidate({ root: safeWorktree(entry), runId: 'closure-inspection', phase: 'snapshot' }); if (snapshot.commit !== entry.candidate.head || snapshot.sourceDigest !== entry.candidate.sourceDigest) add('candidate-source-drift', entry.branch); }
      catch { add('candidate-source-unverified', entry.branch); }
    }
    if (action === 'start') {
      if (!branch || !lotId || currentBranches.has(branch) || PROTECTED.has(branch) || !branch.startsWith('codex/')) add('new-work-branch-required');
      else if (git(root, ['check-ref-format', `refs/heads/${branch}`], [0, 1]) === null) add('invalid-new-branch');
      if (!reservation) add('reservation-required');
      else {
        const proposed = load(reservation, 'reservation'); dated(proposed, branch);
        if (!load(proposed.source).includes(proposed.quote)) add('source-quote-mismatch');
        if (proposed.repository !== registry.repository || proposed.branch !== branch || proposed.lotId !== lotId || proposed.target !== target || proposed.baseHead !== currentBranches.get(target)?.head) add('reservation-start-mismatch');
        for (const ownedPath of proposed.paths) relative(ownedPath);
        if (!/^artifacts\/worktrees\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(proposed.worktree)) add('reservation-destination-invalid');
        else {
          const destination = path.resolve(actual.primaryRoot, proposed.worktree);
          if (actual.worktrees.some((item) => samePath(item.path, destination))) add('reservation-destination-exists');
          let checked = actual.primaryRoot;
          for (const component of proposed.worktree.split('/')) {
            checked = path.join(checked, component);
            try { const stat = lstatSync(checked); if (stat.isSymbolicLink()) fail('linked-path'); if (samePath(checked, destination)) add('reservation-destination-exists'); }
            catch (error) { if (error.code === 'ENOENT') break; throw error; }
          }
        }
        for (const entry of registry.entries.filter((item) => !['merged', 'deferred'].includes(item.state))) {
          if (entry.lotId !== lotId || entry.state !== 'working') { add('previous-lot-awaits-closure', entry.branch); continue; }
          const owned = documents.get(entry.branch).reservation;
          if (!owned) add('parallel-reservation-required', entry.branch);
          else for (const existing of owned.paths) for (const requested of proposed.paths) {
            const left = relative(existing).toLowerCase(); const right = relative(requested).toLowerCase();
            if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) add('parallel-reservation-overlap', entry.branch);
          }
        }
      }
    } else if (['finish', 'merge', 'cleanup'].includes(action)) {
      if (!lot) { add('lot-selection-required'); return finish(); }
      const docs = documents.get(lot.branch);
      if (action === 'finish') {
        const state = effectiveState(lot);
        if (state === 'working' || (state === 'ready' && (docs.disposition?.kind !== 'ready' || lot.nextAction.owner !== 'Amaury'))) add('lot-not-finished', lot.branch);
        if (state === 'ready' && authorization(docs.authorization, lot, 'merge', docs.disposition?.pr ?? null)) add('authorized-integration-still-pending', lot.branch);
      }
      if (action === 'merge') {
        if (lot.state !== 'ready' || !lot.candidate || !docs.disposition?.pr || !authorization(docs.authorization, lot, 'merge', docs.disposition.pr)) add('exact-merge-approval-required', lot.branch);
        if (actual.repository !== registry.repository) add('repository-remote-unverified', lot.branch);
        try { if (git(safeWorktree(lot), ['status', '--porcelain', '--untracked-files=all']).trim()) add('merge-worktree-dirty', lot.branch); } catch { add('merge-worktree-unverified', lot.branch); }
      }
      if (action === 'cleanup') {
        const approval = docs.dispositionAuthorization ?? docs.authorization;
        if (!(lot.state === 'merged' || (lot.state === 'deferred' && docs.disposition?.kind === 'abandoned')) || !authorization(approval, lot, 'cleanup', docs.disposition?.pr ?? null)) add('cleanup-approval-required', lot.branch);
        try {
          const checkout = safeWorktree(lot);
          if (samePath(checkout, actual.primaryRoot)) fail('primary-worktree-protected');
          if (git(checkout, ['status', '--porcelain', '--untracked-files=no']).trim()) add('cleanup-tracked-changes', lot.branch);
          const others = [...new Set([...git(checkout, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'), ...git(checkout, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0')].filter(Boolean))];
          if (others.length > 10000) fail('cleanup-inventory-limit');
          for (const file of others) {
            const preserved = docs.disposition?.preserved?.find((item) => item.path === file);
            if (!preserved || inside(checkout, path.resolve(actual.primaryRoot, relative(preserved.copy.path)))) { add('cleanup-content-not-preserved', lot.branch); continue; }
            const original = readBounded(checkout, file); const copy = readBounded(actual.primaryRoot, preserved.copy.path);
            if (original.sha256 !== preserved.sha256 || copy.sha256 !== preserved.sha256 || copy.sha256 !== preserved.copy.sha256) add('cleanup-preservation-mismatch', lot.branch);
          }
        } catch (error) { add(error.code ?? 'cleanup-inspection-unavailable', lot.branch); }
      }
    }
  } catch (error) { add(error.code ?? 'closure-inspection-unavailable'); }
  return finish();
}
