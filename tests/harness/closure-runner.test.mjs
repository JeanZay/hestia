import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { acquireClosureLock, githubAdapter, pendingOperations, runClosure } from '../../scripts/lib/closure-runner.mjs';

const runnerUrl = new URL('../../scripts/lib/closure-runner.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('../../scripts/closure.mjs', import.meta.url));
const repositoryUrl = 'https://github.com/synthetic/hestia';
const now = () => new Date().toISOString();
const hash = content => createHash('sha256').update(content).digest('hex');
const nextAction = { owner: 'agent', action: 'Vérifier le lot synthétique.', support: 'Candidat synthétique.', expectedResponse: 'Preuves déterministes.', unblocks: 'Revue indépendante.' };
function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function read(root, relative) { return JSON.parse(readFileSync(path.join(root, relative), 'utf8')); }
function save(root, relative, value) {
  const content = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), content);
  return { path: relative, sha256: hash(content) };
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hestia-closure-runner-'));
  git(root, ['init', '--quiet', '-b', 'main']);
  save(root, '.gitignore', 'artifacts/\n');
  save(root, 'synthetic.txt', 'SYNTHETIC\n');
  git(root, ['add', '--all']);
  git(root, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Synthetic baseline']);
  git(root, ['remote', 'add', 'origin', repositoryUrl]);
  const head = git(root, ['rev-parse', 'HEAD']);
  const source = save(root, 'artifacts/closure/source.txt', 'SYNTHETIC AUTHORIZATION: start and close the bounded synthetic lot.\n');
  const registry = { schemaVersion: 1, repository: repositoryUrl, recordedAtUtc: now(), entries: [] };
  save(root, 'artifacts/closure/registry.json', registry);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hestia-closure-runner-'));
    rmSync(root, { recursive: true, force: true });
  });
  const discover = () => ({ primaryRoot: root, currentRoot: root, root, commonDir: path.join(root, '.git'), registryPath: path.join(root, 'artifacts/closure/registry.json') });
  const inspect = () => ({ valid: true, repository: discover(), registry: read(root, 'artifacts/closure/registry.json'), inventory: { worktrees: [{ path: root }], branches: [{ name: 'main', head }] }, diagnostics: [] });
  return { root, head, source, registry, discover, inspect };
}
function startRequest(f, branch = 'codex/synthetic', slug = 'synthetic') {
  const record = { kind: 'reservation', repository: repositoryUrl, lotId: 'synthetic', branch, target: 'main', baseHead: f.head, worktree: `artifacts/worktrees/${slug}`, paths: [`src/${slug}`], recordedAtUtc: now(), source: f.source, quote: 'SYNTHETIC AUTHORIZATION', nextAction };
  const reservation = save(f.root, `artifacts/closure/${slug}-reservation.json`, record);
  return { root: f.root, action: 'start', lotId: 'synthetic', branch, target: 'main', reservation: reservation.path, apply: true };
}
function mergeEntry(f) {
  const authorization = save(f.root, 'artifacts/closure/authorization.json', { kind: 'authorization', repository: repositoryUrl, branch: 'codex/synthetic', head: f.head, target: 'main', recordedAtUtc: now(), pr: `${repositoryUrl}/pull/1`, actions: ['merge'], source: f.source, quote: 'SYNTHETIC AUTHORIZATION' });
  const entry = { lotId: 'synthetic', branch: 'codex/synthetic', target: 'main', state: 'ready', reason: 'Synthetic ready.', source: f.source, candidate: { head: f.head, sourceDigest: 'a'.repeat(64) }, proofs: { validation: null, review: null }, authorization, disposition: null, reservation: null, nextAction };
  f.registry.entries.push(entry);
  save(f.root, 'artifacts/closure/registry.json', f.registry);
  return entry;
}
function remoteAdapter(f, overrides = {}) {
  const calls = [];
  return { calls,
    preflight(request) { calls.push('preflight'); return { ...request, targetHead: f.head, protectionDigest: 'b'.repeat(64), remoteStateVerified: true }; },
    merge() { calls.push('merge'); },
    confirm(request) { calls.push('confirm'); return { ...request, mergeCommit: 'c'.repeat(40), targetHead: 'd'.repeat(40), comparison: 'ahead', remoteStateVerified: true }; },
    ...overrides,
  };
}

test('checks never write a registry or call the remote adapter without explicit apply', t => {
  const f = fixture(t);
  mergeEntry(f);
  const original = readFileSync(path.join(f.root, 'artifacts/closure/registry.json'));
  const remote = remoteAdapter(f);
  const result = runClosure({ root: f.root, action: 'merge', lotId: 'synthetic' }, { ...f, remote });
  assert.equal(result.applied, false);
  assert.equal(result.remoteStateVerified, false);
  assert.deepEqual(remote.calls, []);
  assert.deepEqual(readFileSync(path.join(f.root, 'artifacts/closure/registry.json')), original);
  assert.equal(existsSync(path.join(f.root, 'artifacts/closure/operations')), false);
});

test('a gate refusal happens before any remote call or worktree mutation', t => {
  const f = fixture(t);
  mergeEntry(f);
  const remote = remoteAdapter(f);
  const result = runClosure({ root: f.root, action: 'merge', lotId: 'synthetic', apply: true }, { ...f, inspect: () => ({ ...f.inspect(), valid: false, diagnostics: [{ code: 'independent-proof-missing' }] }), remote });
  assert.equal(result.valid, false);
  assert.deepEqual(remote.calls, []);
  assert.equal(existsSync(path.join(f.root, 'artifacts/closure/operations')), false);
  assert.equal(existsSync(path.join(f.root, 'artifacts/closure/operation.lock')), false);
});

test('start creates a real bounded worktree and records its branch under the shared lock', t => {
  const f = fixture(t);
  const request = startRequest(f);
  const result = runClosure(request, f);
  assert.equal(result.status, 'COMPLETED', JSON.stringify(result));
  assert.equal(git(path.join(f.root, 'artifacts/worktrees/synthetic'), ['branch', '--show-current']), 'codex/synthetic');
  const registry = read(f.root, 'artifacts/closure/registry.json');
  assert.equal(registry.entries[0].state, 'working');
  assert.equal(registry.entries[0].branch, 'codex/synthetic');
  const operation = `artifacts/closure/operations/${result.operationId}`;
  assert.equal(read(f.root, `${operation}/intent.json`).action, 'start');
  assert.equal(read(f.root, `${operation}/result.json`).status, 'COMPLETED');
  assert.deepEqual(pendingOperations(f.root), []);
});

test('real start CLI uses core reservations and refuses shared source ownership despite distinct destinations', t => {
  const f = fixture(t);
  const first = startRequest(f);
  const args = request => [cli, 'start', '--root', request.root, '--lot', request.lotId, '--branch', request.branch, '--target', request.target, '--reservation', request.reservation, '--apply'];
  const created = spawnSync(process.execPath, args(first), { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const parallel = startRequest(f, 'codex/parallel', 'parallel');
  const second = spawnSync(process.execPath, args(parallel), { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const conflicting = startRequest(f, 'codex/conflicting', 'conflicting');
  const reservation = read(f.root, conflicting.reservation);
  reservation.paths = ['src/synthetic/child.ts'];
  save(f.root, conflicting.reservation, reservation);
  const rejected = spawnSync(process.execPath, args(conflicting), { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /parallel-reservation-overlap/);
  assert.equal(existsSync(path.join(f.root, 'artifacts/worktrees/conflicting')), false);
  assert.equal(git(f.root, ['branch', '--list', 'codex/conflicting']), '');
  assert.equal(read(f.root, 'artifacts/closure/registry.json').entries.length, 2);
});

test('start refuses an existing destination and an inventory that changes under the lock', t => {
  const f = fixture(t);
  const request = startRequest(f);
  mkdirSync(path.join(f.root, 'artifacts/worktrees/synthetic'), { recursive: true });
  let calls = 0;
  const blocked = runClosure(request, { ...f, createWorktree: () => { calls++; } });
  assert.equal(blocked.code, 'start-destination-exists');
  const other = startRequest(f, 'codex/other', 'other');
  let inspections = 0;
  const changed = runClosure(other, { ...f, inspect: () => ({ ...f.inspect(), inventory: { worktrees: [{ path: f.root }], version: inspections++ } }), createWorktree: () => { calls++; } });
  assert.equal(changed.code, 'closure-state-changed');
  assert.equal(calls, 0);
});

test('two real processes cannot hold the clone lock concurrently', async t => {
  const f = fixture(t);
  const script = `import { acquireClosureLock } from ${JSON.stringify(runnerUrl)}; const release = acquireClosureLock(process.argv[1]); process.stdout.write('locked\\n'); process.stdin.once('data', () => { release(); process.exit(0); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const competing = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acquireClosureLock } from ${JSON.stringify(runnerUrl)}; acquireClosureLock(process.argv[1]);`, f.root], { encoding: 'utf8' });
    assert.equal(competing.status, 1);
    assert.match(competing.stderr, /closure-lock-present-or-unavailable/);
    const checked = runClosure({ root: f.root, action: 'status' }, f);
    assert.equal(checked.valid, false);
    assert.equal(checked.lockPresent, true);
    assert.ok(checked.diagnostics.some(item => item.code === 'closure-lock-present-reconciliation-required'));
    child.stdin.write('release\n');
    await once(child, 'exit');
    const release = acquireClosureLock(f.root);
    release();
  } finally { if (child.exitCode === null) child.kill(); }
});

test('partial start preserves the orphan branch visibly and blocks automatic replay', t => {
  const f = fixture(t);
  const request = startRequest(f);
  let attempts = 0;
  const result = runClosure(request, { ...f, createWorktree: () => { attempts++; git(f.root, ['branch', request.branch, f.head]); throw new Error('synthetic-after-branch-failure'); } });
  assert.equal(result.code, 'operation-ambiguous-reconciliation-required');
  assert.equal(git(f.root, ['rev-parse', `refs/heads/${request.branch}`]), f.head);
  assert.equal(pendingOperations(f.root).length, 1);
  const replay = runClosure(request, { ...f, createWorktree: () => { attempts++; } });
  assert.equal(replay.code, 'pending-operation-reconciliation-required');
  assert.equal(attempts, 1);
});

test('a real process interrupted after intention leaves a lock and cannot replay', t => {
  const f = fixture(t);
  const request = startRequest(f);
  const script = `import { runClosure } from ${JSON.stringify(runnerUrl)}; import { readFileSync } from 'node:fs'; const options = JSON.parse(process.argv[1]); const root = options.root; const discover = () => ({ primaryRoot: root }); const inspect = () => ({ valid:true, registry:JSON.parse(readFileSync(root+'/artifacts/closure/registry.json')), inventory:{worktrees:[{path:root}]}, diagnostics:[] }); runClosure(options, {discover,inspect,createWorktree:()=>process.exit(19)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(request)], { encoding: 'utf8' });
  assert.equal(result.status, 19, result.stderr);
  assert.equal(pendingOperations(f.root).length, 1);
  assert.throws(() => runClosure(request, f), /closure-lock-present-or-unavailable/);
});

test('finish persists a real disposition transition without changing Git', t => {
  const f = fixture(t);
  const entry = mergeEntry(f);
  entry.state = 'working';
  entry.disposition = save(f.root, 'artifacts/closure/ready.json', { kind: 'ready', reason: 'Synthetic ready disposition.' });
  save(f.root, 'artifacts/closure/registry.json', f.registry);
  const result = runClosure({ root: f.root, action: 'finish', lotId: 'synthetic', apply: true }, f);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(read(f.root, 'artifacts/closure/registry.json').entries[0].state, 'ready');
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.head);
  const updated = read(f.root, 'artifacts/closure/registry.json');
  updated.entries[0].disposition = save(f.root, 'artifacts/closure/abandoned.json', { kind: 'abandoned', reason: 'Synthetic abandonment.' });
  save(f.root, 'artifacts/closure/registry.json', updated);
  const abandoned = runClosure({ root: f.root, action: 'finish', lotId: 'synthetic', apply: true }, f);
  assert.equal(abandoned.status, 'COMPLETED');
  assert.equal(read(f.root, 'artifacts/closure/registry.json').entries[0].state, 'deferred');
});

test('real finish CLI refuses an unsupported ready claim, then persists a justified blocked disposition', t => {
  const f = fixture(t);
  const request = startRequest(f);
  const started = spawnSync(process.execPath, [cli, 'start', '--root', f.root, '--lot', request.lotId, '--branch', request.branch, '--target', request.target, '--reservation', request.reservation, '--apply'], { encoding: 'utf8' });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const registry = read(f.root, 'artifacts/closure/registry.json');
  const disposition = { kind: 'ready', repository: repositoryUrl, branch: request.branch, head: f.head, target: 'main', recordedAtUtc: now(), pr: null, reason: 'Synthetic claim without technical proof.', authorization: null, mergeCommit: null, remoteReceipt: null };
  registry.entries[0].disposition = save(f.root, 'artifacts/closure/disposition.json', disposition);
  save(f.root, 'artifacts/closure/registry.json', registry);
  const args = [cli, 'finish', '--root', f.root, '--lot', 'synthetic', '--apply'];
  const unsupported = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(unsupported.status, 1);
  assert.equal(read(f.root, 'artifacts/closure/registry.json').entries[0].state, 'working');
  disposition.kind = 'blocked';
  disposition.reason = 'Synthetic technical proofs remain absent.';
  registry.entries[0].disposition = save(f.root, 'artifacts/closure/blocked-disposition.json', disposition);
  save(f.root, 'artifacts/closure/registry.json', registry);
  const finished = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(finished.status, 0, finished.stdout + finished.stderr);
  assert.equal(read(f.root, 'artifacts/closure/registry.json').entries[0].state, 'blocked');
});

test('merge requires two stable preflights then records actual confirmation and target receipt', t => {
  const f = fixture(t);
  mergeEntry(f);
  const remote = remoteAdapter(f);
  const result = runClosure({ root: f.root, action: 'merge', lotId: 'synthetic', apply: true }, { ...f, remote });
  assert.equal(result.status, 'COMPLETED', JSON.stringify(result));
  assert.deepEqual(remote.calls, ['preflight', 'preflight', 'merge', 'confirm']);
  const entry = read(f.root, 'artifacts/closure/registry.json').entries[0];
  assert.equal(entry.state, 'merged');
  const disposition = read(f.root, entry.disposition.path);
  const receipt = read(f.root, disposition.remoteReceipt.path);
  assert.equal(receipt.mergeCommit, 'c'.repeat(40));
  assert.equal(receipt.targetHead, 'd'.repeat(40));
  assert.equal(receipt.merged, true);
  assert.equal(entry.nextAction.owner, 'agent');
  assert.match(entry.nextAction.action, /vérifier les autorisations/);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.head);
});

test('a failed or unconfirmed merge is ambiguous and never automatically submitted twice', t => {
  const f = fixture(t);
  mergeEntry(f);
  const remote = remoteAdapter(f, { confirm() { throw new Error('synthetic-uncertain-result'); } });
  const request = { root: f.root, action: 'merge', lotId: 'synthetic', apply: true };
  const result = runClosure(request, { ...f, remote });
  assert.equal(result.code, 'operation-ambiguous-reconciliation-required');
  const replay = runClosure(request, { ...f, remote });
  assert.equal(replay.code, 'pending-operation-reconciliation-required');
  assert.equal(remote.calls.filter(call => call === 'merge').length, 1);
  assert.equal(read(f.root, 'artifacts/closure/registry.json').entries[0].state, 'ready');
});

test('cleanup apply is explicitly unavailable and leaves ignored data untouched', t => {
  const f = fixture(t);
  save(f.root, 'artifacts/valuable.txt', 'SYNTHETIC PRESERVE');
  const result = runClosure({ root: f.root, action: 'cleanup', lotId: 'synthetic', apply: true }, f);
  assert.equal(result.valid, false);
  assert.equal(result.cleanupPerformed, false);
  assert.equal(readFileSync(path.join(f.root, 'artifacts/valuable.txt'), 'utf8'), 'SYNTHETIC PRESERVE');
});

test('GitHub adapter checks real response shapes, uses SHA match and confirms ancestry', () => {
  const head = 'a'.repeat(40), mergeCommit = 'b'.repeat(40), targetHead = 'c'.repeat(40);
  const request = { repository: repositoryUrl, pr: `${repositoryUrl}/pull/1`, branch: 'codex/synthetic', target: 'main', head };
  let merged = false;
  const calls = [];
  const command = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === 'pr') { merged = true; return ''; }
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    const endpoint = args[3];
    if (endpoint.endsWith('/pulls/1')) return JSON.stringify({ state: merged ? 'closed' : 'open', merged, draft: false, mergeable: true, mergeable_state: 'clean', html_url: request.pr, head: { sha: head, ref: request.branch, repo: { full_name: 'synthetic/hestia' } }, base: { ref: 'main', repo: { full_name: 'synthetic/hestia' } }, merge_commit_sha: merged ? mergeCommit : null });
    if (endpoint.endsWith('/protection')) return JSON.stringify({ enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, required_conversation_resolution: { enabled: true }, required_pull_request_reviews: {}, required_status_checks: { strict: true, checks: [{ context: 'verify', app_id: 1 }] } });
    if (endpoint.endsWith('/branches/main')) return JSON.stringify({ protected: true, commit: { sha: targetHead } });
    if (endpoint.includes('/check-runs')) return JSON.stringify({ total_count: 1, check_runs: [{ name: 'verify', app: { id: 1 }, head_sha: head, status: 'completed', conclusion: 'success' }] });
    if (endpoint.includes('/status?')) return JSON.stringify({ sha: head, total_count: 0, statuses: [] });
    if (endpoint.includes('/compare/')) return JSON.stringify({ status: 'ahead', merge_base_commit: { sha: mergeCommit } });
    throw new Error('unexpected-endpoint');
  };
  const remote = githubAdapter({ root: '.', command });
  assert.equal(remote.preflight(request).remoteStateVerified, true);
  remote.merge(request);
  assert.deepEqual(calls.find(call => call.args[0] === 'pr').args, ['pr', 'merge', request.pr, '--merge', '--match-head-commit', head]);
  assert.equal(remote.confirm(request).mergeCommit, mergeCommit);
  assert.throws(() => remote.preflight({ ...request, head: 'd'.repeat(40) }), /remote-candidate-mismatch/);
  assert.ok(calls.every(call => !call.args.some(arg => ['--admin', '--auto', '--delete-branch'].includes(arg))));
});

test('real CLI reports an absent local registry as blocked and never creates it', t => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'artifacts/closure/registry.json'));
  const result = spawnSync(process.execPath, [cli, 'check', '--action', 'verify', '--root', f.root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.equal(existsSync(path.join(f.root, 'artifacts/closure/registry.json')), false);
  assert.equal(readdirSync(path.join(f.root, 'artifacts/closure')).includes('operations'), false);
});

test('stable hooks check an older worktree without requiring a duplicated harness inside it', t => {
  const f = fixture(t);
  const old = path.join(f.root, 'artifacts/worktrees/old');
  git(f.root, ['worktree', 'add', '-b', 'codex/old', old, f.head]);
  assert.equal(existsSync(path.join(old, 'scripts/closure.mjs')), false);
  const stable = path.join(f.root, 'artifacts/stable-harness');
  const source = fileURLToPath(new URL('../../', import.meta.url));
  for (const directory of ['scripts', 'harness', '.githooks']) cpSync(path.join(source, directory), path.join(stable, directory), { recursive: true });
  for (const hook of ['pre-commit', 'pre-push']) chmodSync(path.join(stable, '.githooks', hook), 0o755);
  save(old, 'synthetic.txt', 'SYNTHETIC LOCAL CHANGE\n');
  git(old, ['add', 'synthetic.txt']);
  const flags = ['-c', `core.hooksPath=${path.join(stable, '.githooks')}`, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid'];
  const commit = spawnSync('git', [...flags, 'commit', '-m', 'Must be refused'], { cwd: old, encoding: 'utf8' });
  assert.notEqual(commit.status, 0);
  assert.match(commit.stdout + commit.stderr, /"valid":false/);
  assert.doesNotMatch(commit.stdout + commit.stderr, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
  assert.equal(git(old, ['rev-parse', 'HEAD']), f.head);
  const bare = path.join(f.root, 'artifacts/bare-synthetic.git');
  git(f.root, ['init', '--bare', '--quiet', bare]);
  git(old, ['remote', 'add', 'local-synthetic', bare]);
  const push = spawnSync('git', [...flags, 'push', '--dry-run', 'local-synthetic', 'HEAD:refs/heads/main'], { cwd: old, encoding: 'utf8' });
  assert.notEqual(push.status, 0);
  assert.match(push.stdout + push.stderr, /"valid":false/);
  assert.doesNotMatch(push.stdout + push.stderr, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
  assert.equal(git(bare, ['for-each-ref', '--format=%(refname)']), '');
});
