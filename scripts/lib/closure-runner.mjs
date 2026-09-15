import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJsonSafe } from '../refinement-check.mjs';
import { discoverRepository, inspectClosure } from './closure-state.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const shaPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const idPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const operationPattern = /^\d{13}-[a-f0-9-]{36}$/;
const requireCondition = (condition, code) => { if (!condition) throw new Error(code); };
const bytes = value => `${JSON.stringify(value, null, 2)}\n`;

/** Refuse linked ancestors as well as linked leaves before reading or creating state. */
function safePath(root, relative, missing = false) {
  requireCondition(typeof relative === 'string' && relative && !path.isAbsolute(relative), 'invalid-relative-path');
  const resolved = path.resolve(root, relative);
  const suffix = path.relative(path.resolve(root), resolved);
  requireCondition(suffix && !suffix.startsWith(`..${path.sep}`) && suffix !== '..' && !path.isAbsolute(suffix), 'outside-primary-root');
  let current = path.parse(resolved).root;
  for (const piece of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, piece);
    try { requireCondition(!lstatSync(current).isSymbolicLink(), 'linked-closure-path'); }
    catch (error) { if (missing && error.code === 'ENOENT') continue; throw error; }
  }
  return resolved;
}

function immutable(primaryRoot, relative, value) {
  const content = bytes(value);
  writeFileSync(safePath(primaryRoot, relative, true), content, { flag: 'wx' });
  return { path: relative, sha256: hash(content) };
}

function readRef(primaryRoot, reference) {
  requireCondition(reference && /^[a-f0-9]{64}$/.test(reference.sha256), 'invalid-reference');
  const file = safePath(primaryRoot, reference.path);
  requireCondition(hash(readFileSync(file)) === reference.sha256, 'reference-changed');
  return readJsonSafe(file);
}

function invoke(executable, args, root) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[name];
  try { return execFileSync(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
  catch { throw new Error('command-failed-or-outcome-unavailable'); }
}

function git(root, args) { return invoke('git', ['--no-replace-objects', '--no-lazy-fetch', ...args], root).trim(); }

export function acquireClosureLock(primaryRoot) {
  const relative = 'artifacts/closure/operation.lock';
  const lock = safePath(primaryRoot, relative, true);
  mkdirSync(safePath(primaryRoot, 'artifacts/closure', true), { recursive: true });
  try { mkdirSync(lock); } catch { throw new Error('closure-lock-present-or-unavailable'); }
  const token = randomUUID();
  const owner = { token, pid: process.pid, recordedAtUtc: new Date().toISOString() };
  try { immutable(primaryRoot, `${relative}/owner.json`, owner); }
  catch { throw new Error('closure-lock-incomplete-reconciliation-required'); }
  const release = () => {
    const current = readJsonSafe(safePath(primaryRoot, `${relative}/owner.json`));
    requireCondition(current.token === token, 'closure-lock-owner-changed');
    unlinkSync(safePath(primaryRoot, `${relative}/owner.json`));
    rmdirSync(safePath(primaryRoot, relative));
  };
  Object.defineProperty(release, 'token', { value: token });
  return release;
}

export function pendingOperations(primaryRoot) {
  const relative = 'artifacts/closure/operations';
  let names;
  try { names = readdirSync(safePath(primaryRoot, relative)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  requireCondition(names.length <= 10000, 'operation-inventory-limit');
  const pending = [];
  for (const name of names) {
    requireCondition(operationPattern.test(name), 'unknown-operation-directory');
    const directory = `${relative}/${name}`;
    requireCondition(lstatSync(safePath(primaryRoot, directory)).isDirectory(), 'invalid-operation-directory');
    let result;
    try { result = readJsonSafe(safePath(primaryRoot, `${directory}/result.json`)); }
    catch (error) { if (error.code === 'ENOENT' || !existsSync(path.join(primaryRoot, directory, 'result.json'))) { pending.push(name); continue; } throw error; }
    if (result.operationId !== name || result.status !== 'COMPLETED') pending.push(name);
  }
  return pending;
}

function operationDirectory(primaryRoot) {
  const operationId = `${Date.now()}-${randomUUID()}`;
  mkdirSync(safePath(primaryRoot, 'artifacts/closure/operations', true), { recursive: true });
  const relative = `artifacts/closure/operations/${operationId}`;
  mkdirSync(safePath(primaryRoot, relative, true));
  return { operationId, relative };
}

function replaceRegistry(primaryRoot, registry, operation) {
  const snapshot = immutable(primaryRoot, `${operation.relative}/registry-after.json`, registry);
  const temporary = `artifacts/closure/registry.${operation.operationId}.tmp`;
  immutable(primaryRoot, temporary, registry);
  renameSync(safePath(primaryRoot, temporary), safePath(primaryRoot, 'artifacts/closure/registry.json'));
  return snapshot;
}

function repositoryName(url) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
  requireCondition(Boolean(match), 'unsupported-repository-url');
  return match[1];
}

function pullNumber(repository, pr) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)$/.exec(pr);
  requireCondition(match && match[1].toLowerCase() === repository.toLowerCase(), 'pull-request-repository-mismatch');
  return match[2];
}

/** No network is touched until these methods are explicitly called by --apply. */
export function githubAdapter({ root, gh = 'gh', command = invoke }) {
  const api = endpoint => JSON.parse(command(gh, ['api', '--method', 'GET', endpoint], root));
  return {
    preflight(request) {
      const repository = repositoryName(request.repository);
      const number = pullNumber(repository, request.pr);
      const pull = api(`repos/${repository}/pulls/${number}`);
      const target = api(`repos/${repository}/branches/${encodeURIComponent(request.target)}`);
      const protection = api(`repos/${repository}/branches/${encodeURIComponent(request.target)}/protection`);
      requireCondition(pull.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase() && pull.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase(), 'remote-repository-mismatch');
      requireCondition(pull.head.sha === request.head && pull.head.ref === request.branch && pull.base.ref === request.target && pull.html_url === request.pr, 'remote-candidate-mismatch');
      requireCondition(pull.state === 'open' && pull.merged === false && pull.draft === false && pull.mergeable === true && pull.mergeable_state === 'clean', 'remote-pull-not-mergeable');
      requireCondition(target.protected === true && protection.enforce_admins?.enabled === true && protection.allow_force_pushes?.enabled === false && protection.allow_deletions?.enabled === false && protection.required_conversation_resolution?.enabled === true && protection.required_pull_request_reviews && protection.required_status_checks?.strict === true, 'remote-protections-insufficient');
      const required = protection.required_status_checks.checks?.length ? protection.required_status_checks.checks : (protection.required_status_checks.contexts ?? []).map(context => ({ context, app_id: null }));
      requireCondition(required.length > 0 && required.length <= 100, 'remote-required-checks-missing');
      const checks = api(`repos/${repository}/commits/${request.head}/check-runs?per_page=100`);
      const statuses = api(`repos/${repository}/commits/${request.head}/status?per_page=100`);
      requireCondition(statuses.sha === request.head, 'remote-status-head-mismatch');
      requireCondition(checks.total_count <= 100 && statuses.total_count <= 100, 'remote-check-pagination-required');
      for (const expected of required) {
        const matched = checks.check_runs.filter(check => check.name === expected.context && (expected.app_id === null || expected.app_id === undefined || check.app?.id === expected.app_id));
        const status = statuses.statuses.filter(check => check.context === expected.context);
        const greenCheck = matched.length === 1 && matched[0].head_sha === request.head && matched[0].status === 'completed' && matched[0].conclusion === 'success';
        const greenStatus = (expected.app_id === null || expected.app_id === undefined) && status.length === 1 && status[0].state === 'success';
        requireCondition((greenCheck || greenStatus) && (matched.length === 0 || greenCheck) && (status.length === 0 || greenStatus), 'remote-required-check-not-successful');
      }
      requireCondition(shaPattern.test(target.commit?.sha), 'remote-target-sha-unavailable');
      return { repository: request.repository, pr: request.pr, head: request.head, branch: request.branch, target: request.target, targetHead: target.commit.sha, protectionDigest: hash(JSON.stringify(protection)), remoteStateVerified: true };
    },
    merge(request) { command(gh, ['pr', 'merge', request.pr, '--merge', '--match-head-commit', request.head], root); },
    confirm(request) {
      const repository = repositoryName(request.repository);
      const pull = api(`repos/${repository}/pulls/${pullNumber(repository, request.pr)}`);
      requireCondition(pull.merged === true && pull.state === 'closed' && pull.head?.sha === request.head && pull.base?.ref === request.target && pull.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase() && shaPattern.test(pull.merge_commit_sha), 'merge-not-confirmed');
      const target = api(`repos/${repository}/branches/${encodeURIComponent(request.target)}`);
      requireCondition(shaPattern.test(target.commit?.sha), 'remote-target-sha-unavailable');
      const comparison = api(`repos/${repository}/compare/${pull.merge_commit_sha}...${target.commit.sha}`);
      requireCondition(['ahead', 'identical'].includes(comparison.status) && comparison.merge_base_commit?.sha === pull.merge_commit_sha, 'merge-not-reached-target');
      return { ...request, mergeCommit: pull.merge_commit_sha, targetHead: target.commit.sha, comparison: comparison.status, recordedAtUtc: new Date().toISOString(), remoteStateVerified: true };
    },
  };
}

function fingerprint(gate) { return hash(JSON.stringify({ registry: gate.registry, inventory: gate.inventory })); }

function refused(code, details = {}) { return { valid: false, applied: false, status: 'BLOCKED', code, remoteStateVerified: false, consentAuthenticated: false, ...details }; }

function startDestination(repository, reservation, inventory) {
  requireCondition(/^artifacts\/worktrees\/[a-z0-9][a-z0-9-]{0,79}$/.test(reservation.worktree), 'start-destination-not-bounded');
  const destination = safePath(repository.primaryRoot, reservation.worktree, true);
  requireCondition(!existsSync(destination), 'start-destination-exists');
  for (const worktree of inventory.worktrees ?? []) {
    const worktreePath = worktree.path ?? worktree.root;
    if (!worktreePath || path.resolve(worktreePath).toLowerCase() === path.resolve(repository.primaryRoot).toLowerCase()) continue;
    const relative = path.relative(path.resolve(worktreePath), destination).toLowerCase();
    const reverse = path.relative(destination, path.resolve(worktreePath)).toLowerCase();
    requireCondition(relative && (relative === '..' || relative.startsWith(`..${path.sep}`)) && reverse && (reverse === '..' || reverse.startsWith(`..${path.sep}`)), 'start-destination-overlaps-worktree');
  }
  return destination;
}

export function runClosure(options, dependencies = {}) {
  const { root = process.cwd(), action = 'status', apply = false, lotId, branch, target, reservation: reservationPath } = options;
  requireCondition(['status', 'verify', 'start', 'finish', 'merge', 'cleanup'].includes(action), 'unsupported-closure-action');
  requireCondition(!lotId || idPattern.test(lotId), 'invalid-lot-id');
  const discover = dependencies.discover ?? discoverRepository;
  const inspect = dependencies.inspect ?? inspectClosure;
  const repository = discover(root);
  const primaryRoot = repository.primaryRoot;
  const reservation = reservationPath ? { path: reservationPath, sha256: hash(readFileSync(safePath(primaryRoot, reservationPath))) } : undefined;
  const request = { root, action: action === 'status' ? 'verify' : action, lotId, branch, target, reservation };
  if (!apply) {
    const gate = inspect(request);
    const pending = pendingOperations(primaryRoot);
    let locked = false;
    try { lstatSync(safePath(primaryRoot, 'artifacts/closure/operation.lock')); locked = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const diagnostics = [...(gate.diagnostics ?? []), ...(locked ? [{ code: 'closure-lock-present-reconciliation-required', blocking: true }] : []), ...(pending.length ? [{ code: 'pending-operation-reconciliation-required', blocking: true }] : [])];
    return { ...gate, valid: gate.valid && pending.length === 0 && !locked, diagnostics, applied: false, lockPresent: locked, pendingOperations: pending, cleanupPerformed: false, remoteStateVerified: false, consentAuthenticated: false };
  }
  if (['status', 'verify'].includes(action)) return refused('read-only-action');
  if (action === 'cleanup') return refused('cleanup-not-automated-no-files-deleted', { cleanupPerformed: false });
  requireCondition(idPattern.test(lotId ?? ''), 'explicit-lot-required');
  const release = acquireClosureLock(primaryRoot);
  const lockedRequest = { ...request, lockToken: release.token };
  let operation = null;
  let settled = false;
  try {
    requireCondition(pendingOperations(primaryRoot).length === 0, 'pending-operation-reconciliation-required');
    const gate = inspect(lockedRequest);
    if (!gate.valid) { settled = true; return refused('closure-preflight-refused', { diagnostics: gate.diagnostics }); }
    const registryDigest = hash(readFileSync(safePath(primaryRoot, 'artifacts/closure/registry.json')));
    const registry = structuredClone(gate.registry);
    const selectedBranch = branch ?? gate.lot?.branch ?? gate.entry?.branch;
    const entry = registry.entries.find(item => item.lotId === lotId && (!selectedBranch || item.branch === selectedBranch));
    let preparation;
    let remote;
    let destination;
    let reservationRecord;
    if (action === 'start') {
      requireCondition(/^codex\/[a-z0-9][a-z0-9-]{0,79}$/.test(branch) && idPattern.test(lotId) && ['main', 'develop'].includes(target), 'invalid-start-request');
      reservationRecord = readRef(primaryRoot, reservation);
      requireCondition(reservationRecord.branch === branch && reservationRecord.lotId === lotId && reservationRecord.target === target && shaPattern.test(reservationRecord.baseHead), 'reservation-request-mismatch');
      requireCondition(git(root, ['rev-parse', '--verify', `refs/heads/${target}`]) === reservationRecord.baseHead, 'reservation-base-changed');
      destination = startDestination(repository, reservationRecord, gate.inventory);
      preparation = { branch, target, baseHead: reservationRecord.baseHead, worktree: reservationRecord.worktree, ownedPaths: reservationRecord.paths };
    } else if (action === 'finish') {
      preparation = readRef(primaryRoot, entry.disposition);
      requireCondition(['ready', 'blocked', 'deferred', 'abandoned', 'merged'].includes(preparation.kind), 'finish-disposition-invalid');
    } else {
      const authorization = readRef(primaryRoot, entry.authorization);
      preparation = { repository: registry.repository, pr: authorization.pr, branch: entry.branch, target: entry.target, head: entry.candidate.head };
      remote = dependencies.remote ?? githubAdapter({ root });
      const first = remote.preflight(preparation);
      const second = remote.preflight(preparation);
      requireCondition(first.remoteStateVerified === true && second.remoteStateVerified === true && hash(JSON.stringify(first)) === hash(JSON.stringify(second)), 'remote-preflight-changed');
    }
    const rechecked = inspect(lockedRequest);
    requireCondition(rechecked.valid && fingerprint(rechecked) === fingerprint(gate), 'closure-state-changed');
    if (action === 'start') startDestination(repository, reservationRecord, rechecked.inventory);
    operation = operationDirectory(primaryRoot);
    immutable(primaryRoot, `${operation.relative}/intent.json`, { schemaVersion: 1, operationId: operation.operationId, action, lotId, branch: branch ?? entry.branch, recordedAtUtc: new Date().toISOString(), beforeDigest: fingerprint(gate), preparation });
    let effect;
    if (action === 'start') {
      const create = dependencies.createWorktree ?? ((args) => git(root, args));
      create(['worktree', 'add', '-b', branch, destination, reservationRecord.baseHead]);
      requireCondition(git(destination, ['rev-parse', '--verify', 'HEAD']) === reservationRecord.baseHead && git(destination, ['branch', '--show-current']) === branch, 'created-worktree-not-confirmed');
      registry.entries.push({ lotId, branch, target, state: 'working', reason: 'Lot démarré par commande encadrée ; clôture obligatoire.', source: reservationRecord.source, candidate: null, proofs: { validation: null, review: null }, authorization: null, disposition: null, reservation, nextAction: reservationRecord.nextAction });
      effect = { branch, worktree: reservationRecord.worktree, head: reservationRecord.baseHead };
    } else if (action === 'finish') {
      entry.state = preparation.kind === 'abandoned' ? 'deferred' : preparation.kind;
      entry.reason = preparation.reason;
      effect = { state: entry.state, disposition: preparation.kind };
    } else {
      remote.merge(preparation);
      effect = remote.confirm(preparation);
      requireCondition(effect.remoteStateVerified === true && effect.head === preparation.head && effect.target === preparation.target && shaPattern.test(effect.mergeCommit), 'merge-result-unconfirmed');
      requireCondition(['ahead', 'identical'].includes(effect.comparison) && shaPattern.test(effect.targetHead), 'merge-target-receipt-unavailable');
      const receipt = { kind: 'remote-merge-receipt', repository: registry.repository, pr: preparation.pr, branch: entry.branch, head: entry.candidate.head, target: entry.target, mergeCommit: effect.mergeCommit, targetHead: effect.targetHead, recordedAtUtc: new Date().toISOString(), merged: true, comparison: effect.comparison };
      const remoteReceipt = immutable(primaryRoot, `${operation.relative}/remote-merge-receipt.json`, receipt);
      const disposition = { kind: 'merged', repository: registry.repository, branch: entry.branch, head: entry.candidate.head, target: entry.target, recordedAtUtc: new Date().toISOString(), pr: preparation.pr, reason: 'PR fusionnée ; commit confirmé dans la cible distante.', authorization: entry.authorization, mergeCommit: effect.mergeCommit, remoteReceipt };
      entry.disposition = immutable(primaryRoot, `${operation.relative}/disposition.json`, disposition);
      entry.state = 'merged';
      entry.reason = disposition.reason;
      entry.nextAction = { owner: 'agent', action: 'Réconcilier la cible locale et préserver les preuves ; vérifier les autorisations avant toute mise à jour du backlog ou tout nettoyage.', support: `${preparation.pr} ; cible ${entry.target} ; commit ${effect.mergeCommit}.`, expectedResponse: 'État local et distant rapproché, preuves préservées et périmètre des actions suivantes vérifié.', unblocks: 'Clôture technique et seules actions suivantes effectivement autorisées.' };
    }
    registry.recordedAtUtc = new Date().toISOString();
    requireCondition(hash(readFileSync(safePath(primaryRoot, 'artifacts/closure/registry.json'))) === registryDigest, 'registry-changed-during-operation');
    const snapshot = replaceRegistry(primaryRoot, registry, operation);
    const result = { schemaVersion: 1, operationId: operation.operationId, status: 'COMPLETED', action, recordedAtUtc: new Date().toISOString(), registry: snapshot, effect };
    immutable(primaryRoot, `${operation.relative}/result.json`, result);
    settled = true;
    return { valid: true, applied: true, status: 'COMPLETED', action, operationId: operation.operationId, effect, cleanupPerformed: false, remoteStateVerified: action === 'merge', consentAuthenticated: false };
  } catch (error) {
    if (operation) {
      try { immutable(primaryRoot, `${operation.relative}/result.json`, { schemaVersion: 1, operationId: operation.operationId, status: 'AMBIGUOUS', action, recordedAtUtc: new Date().toISOString(), reason: 'Réconcilier Git, registre et éventuel état GitHub avant toute nouvelle action ; aucune relance automatique.' }); settled = true; }
      catch { /* Keep the lock if the ambiguous outcome cannot be durably recorded. */ }
    } else settled = true;
    const code = /^[a-z][a-z0-9-]+$/.test(error.message) ? error.message : 'closure-operation-unavailable';
    return refused(operation ? 'operation-ambiguous-reconciliation-required' : code, { operationId: operation?.operationId ?? null, cleanupPerformed: false });
  } finally { if (settled) release(); }
}
