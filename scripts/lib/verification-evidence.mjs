import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectFile } from '../guard.mjs';

const runPattern = /^\d{13}-[a-f0-9-]{36}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const outputPattern = /^artifacts\/(?:verification-runs\/|evidence-runs\/|(?:verification|evidence)-latest\.json(?:\.|$))/;

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }

/** Every component is checked: a symlinked parent is as unsafe as a linked file. */
export function containedPath(root, relative, allowMissing = false) {
  requireCondition(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative), 'path-must-be-relative');
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relative);
  const normalized = path.relative(absoluteRoot, absolute);
  requireCondition(normalized && normalized !== '..' && !normalized.startsWith(`..${path.sep}`) && !path.isAbsolute(normalized), 'path-outside-root');
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { requireCondition(!lstatSync(current).isSymbolicLink(), 'linked-input-or-output'); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') continue; throw error; }
  }
  return absolute;
}

function readBytes(root, relative) {
  const absolute = containedPath(root, relative);
  const before = lstatSync(absolute);
  requireCondition(before.isFile() && before.size <= 32 * 1024 * 1024, 'unsupported-evidence-input');
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    requireCondition(opened.isFile() && opened.ino === before.ino && opened.dev === before.dev, 'input-changed-during-read');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    requireCondition(bytes.length <= 32 * 1024 * 1024 && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs, 'input-changed-during-read');
    return bytes;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function git(root, args) {
  return execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function fileEntry(root, relative, scan = false) {
  const normalized = path.relative(path.resolve(root), containedPath(root, relative)).split(path.sep).join('/');
  // Hashes never retain source contents; names are scanned too before persistence.
  requireCondition(inspectFile('', normalized).findings.length === 0 && inspectFile(normalized, '').findings.length === 0, 'unsafe-evidence-path');
  const bytes = readBytes(root, normalized);
  if (scan) {
    const inspection = inspectFile(normalized, bytes);
    requireCondition(!inspection.binary && inspection.findings.length === 0, 'guard-rejected-active-input');
  }
  return { path: normalized, sha256: digest(bytes) };
}

/** Git inputs plus explicitly designated ignored dossiers; no family directory discovery. */
export function captureCandidate({ root, runId, phase, inputPaths = [] }) {
  const listed = [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
  requireCondition(listed.length <= 100_000 && inputPaths.length <= 10_000, 'candidate-file-limit');
  const files = [];
  const deletedFiles = [];
  for (const relative of listed) {
    requireCondition(!outputPattern.test(relative), 'evidence-output-not-ignored');
    try { files.push(fileEntry(root, relative)); }
    catch (error) { if (error.code === 'ENOENT') deletedFiles.push(relative); else throw error; }
  }
  const activeInputs = [...new Map(inputPaths.map(relative => { const entry = fileEntry(root, relative, true); return [entry.path, entry]; })).values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  let commit = null;
  try { commit = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']); }
  catch (error) { if (error.status !== 1) throw new Error('commit-identity-unavailable'); }
  requireCondition(commit === null || /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit), 'commit-identity-invalid');
  const sourceDigest = digest(JSON.stringify(files));
  const inputDigest = digest(JSON.stringify(activeInputs));
  const identityDigest = digest(JSON.stringify({ commit, sourceDigest, inputDigest, deletedFiles }));
  return { schemaVersion: 2, runId, phase, createdAt: new Date().toISOString(), commit, sourceDigest, inputDigest, identityDigest, files, activeInputs, deletedFiles };
}

export function ciContext(env = process.env) {
  return Object.fromEntries(['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_SHA', 'RUNNER_OS'].map(key => [key, env[key] ?? null]));
}

export function beginRun(root, kind, env = process.env) {
  requireCondition(['verification', 'evidence'].includes(kind), 'invalid-run-kind');
  const runId = `${Date.now()}-${randomUUID()}`;
  const parent = `artifacts/${kind}-runs`;
  mkdirSync(containedPath(root, parent, true), { recursive: true });
  const directory = `${parent}/${runId}`;
  mkdirSync(containedPath(root, directory, true));
  const run = { root, runId, kind, directory, startedAt: new Date().toISOString(), ciContext: ciContext(env) };
  writeRunJson(run, 'started.json', { schemaVersion: 2, runId, kind, startedAt: run.startedAt, ciContext: run.ciContext });
  // Establish the new run before any capture/test. An interrupted run cannot borrow an older PASS.
  writeLatest(run, null);
  return run;
}

export function writeRunJson(run, name, value) {
  requireCondition(/^[a-z][a-z-]*\.json$/.test(name), 'invalid-evidence-name');
  const relative = `${run.directory}/${name}`;
  const bytes = jsonBytes(value);
  writeFileSync(containedPath(run.root, relative, true), bytes, { flag: 'wx' });
  return { path: relative, sha256: digest(bytes) };
}

export function writeLatest(run, report) {
  const pointer = { schemaVersion: 2, runId: run.runId, kind: run.kind, directory: run.directory, startedAt: run.startedAt, ciContext: run.ciContext, report };
  const relative = `artifacts/${run.kind}-latest.json`;
  if (report) {
    // A slower earlier verification must not replace a later invocation's locator.
    const current = JSON.parse(readBytes(run.root, relative).toString('utf8'));
    if (current.runId !== run.runId) return;
  }
  const temporary = `${relative}.${run.runId}.tmp`;
  writeFileSync(containedPath(run.root, temporary, true), jsonBytes(pointer), { flag: 'wx' });
  renameSync(containedPath(run.root, temporary), containedPath(run.root, relative, true));
}

function readReference(root, reference, expectedPath) {
  requireCondition(reference?.path === expectedPath && hashPattern.test(reference.sha256), 'evidence-reference-mismatch');
  const bytes = readBytes(root, reference.path);
  requireCondition(digest(bytes) === reference.sha256, 'evidence-hash-mismatch');
  return JSON.parse(bytes.toString('utf8'));
}

function validateManifest(manifest, runId, phase) {
  requireCondition(manifest.schemaVersion === 2 && manifest.runId === runId && manifest.phase === phase, 'manifest-run-mismatch');
  for (const entries of [manifest.files, manifest.activeInputs]) {
    requireCondition(Array.isArray(entries), 'manifest-files-invalid');
    let previous = null;
    for (const entry of entries) {
      requireCondition(typeof entry.path === 'string' && hashPattern.test(entry.sha256) && (previous === null || previous < entry.path), 'manifest-files-invalid');
      previous = entry.path;
    }
  }
  requireCondition(Array.isArray(manifest.deletedFiles) && manifest.deletedFiles.every(value => typeof value === 'string'), 'manifest-deletions-invalid');
  requireCondition(manifest.sourceDigest === digest(JSON.stringify(manifest.files)) && manifest.inputDigest === digest(JSON.stringify(manifest.activeInputs)), 'manifest-digest-mismatch');
  const identity = { commit: manifest.commit, sourceDigest: manifest.sourceDigest, inputDigest: manifest.inputDigest, deletedFiles: manifest.deletedFiles };
  requireCondition(manifest.identityDigest === digest(JSON.stringify(identity)), 'manifest-identity-mismatch');
}

/** A latest index is only a locator; all immutable records must agree before display. */
export function readVerificationRun(root, env = process.env) {
  const pointer = JSON.parse(readBytes(root, 'artifacts/verification-latest.json').toString('utf8'));
  requireCondition(pointer.schemaVersion === 2 && pointer.kind === 'verification' && runPattern.test(pointer.runId), 'verification-pointer-invalid');
  const directory = `artifacts/verification-runs/${pointer.runId}`;
  requireCondition(pointer.directory === directory && pointer.report, 'verification-incomplete');
  if (env.GITHUB_ACTIONS === 'true') requireCondition(JSON.stringify(pointer.ciContext) === JSON.stringify(ciContext(env)), 'verification-other-ci-run');
  const report = readReference(root, pointer.report, `${directory}/verification.json`);
  requireCondition(report.schemaVersion === 2 && report.runId === pointer.runId && report.startedAt === pointer.startedAt && JSON.stringify(report.ciContext) === JSON.stringify(pointer.ciContext), 'verification-run-mismatch');
  requireCondition(['PASS', 'FAIL'].includes(report.status) && Array.isArray(report.results), 'verification-report-invalid');
  const manifests = {};
  for (const phase of ['before', 'after']) {
    if (report.candidate[phase] === null) continue;
    const manifest = readReference(root, report.candidate[phase], `${directory}/source-${phase}.json`);
    validateManifest(manifest, report.runId, phase);
    requireCondition(report.candidate[phase].sourceDigest === manifest.sourceDigest && report.candidate[phase].identityDigest === manifest.identityDigest, 'verification-candidate-mismatch');
    manifests[phase] = manifest;
  }
  const actualIdentity = !manifests.before || !manifests.after ? 'UNAVAILABLE' : manifests.before.identityDigest === manifests.after.identityDigest ? 'UNCHANGED' : 'CHANGED';
  requireCondition(report.candidate.status === actualIdentity, 'verification-identity-mismatch');
  for (const step of report.results) {
    requireCondition(['PASS', 'FAIL', 'NOT_PERFORMED'].includes(step.status) && typeof step.required === 'boolean', 'verification-step-invalid');
    requireCondition(step.status === 'PASS' ? step.exitCode === 0 : step.status === 'NOT_PERFORMED' ? step.exitCode === null : Number.isInteger(step.exitCode) && step.exitCode !== 0, 'verification-step-invalid');
  }
  const actualStatus = actualIdentity === 'UNCHANGED' && report.results.every(step => step.status === 'PASS' || (!step.required && step.status === 'NOT_PERFORMED')) && report.errors.length === 0 ? 'PASS' : 'FAIL';
  requireCondition(report.status === actualStatus, 'verification-status-mismatch');
  if (manifests.after) {
    // An entry-point syntax/import failure may happen before any new run can be written.
    // Historical consistency alone therefore cannot establish a current result.
    if (report.activeCheckpoint.path !== null) requireCondition(manifests.after.activeInputs.some(entry => entry.path === report.activeCheckpoint.path), 'verification-checkpoint-identity-missing');
    const current = captureCandidate({ root, runId: report.runId, phase: 'summary', inputPaths: manifests.after.activeInputs.map(entry => entry.path) });
    requireCondition(current.identityDigest === manifests.after.identityDigest, 'verification-candidate-stale');
    if (report.activeCheckpoint.path === null) {
      try { lstatSync(containedPath(root, 'artifacts/active-work.json')); }
      catch (error) { if (error.code === 'ENOENT') return { report, manifests }; throw error; }
      throw new Error('verification-active-checkpoint-unverified');
    }
  }
  return { report, manifests };
}
