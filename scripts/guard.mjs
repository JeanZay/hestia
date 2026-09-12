import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const blockedDirectory = /(?:^|\/)(?:private|originals|uploads|backups|family-data)(?:\/|$)/i;
const blockedFile = /(?:^|\/)(?:\.env(?:\..+)?|id_(?:rsa|ed25519)|credentials(?:\.[^/]*)?)$|\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)$/i;
const tokenPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['provider-token', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9_.-]{32,}/i],
];

/** Partial, deliberately conservative scanning. Findings never contain the value. */
export function inspectFile(filePath, content) {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const findings = [];
  const environmentExample = /(?:^|\/)\.env\.example$/i.test(normalizedPath);
  if (blockedDirectory.test(normalizedPath) || (blockedFile.test(normalizedPath) && !environmentExample)) {
    findings.push({ path: normalizedPath, category: 'private-path' });
  }

  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  // A NUL marks data we do not claim to inspect, including UTF-16 files.
  const binary = bytes.includes(0);
  if (!binary) {
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const [category, expression] of tokenPatterns) {
        if (expression.test(lines[index])) {
          findings.push({ path: normalizedPath, line: index + 1, category });
        }
      }
    }
  }
  return { findings, binary };
}

function git(cwd, args, encoding = 'utf8') {
  return execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', ...args], { cwd, encoding, maxBuffer: 64 * 1024 * 1024, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

const pushLimits = { inputBytes: 1024 * 1024, updates: 100, commits: 1000, entries: 100_000, blobs: 10_000, blobBytes: 4 * 1024 * 1024, totalBytes: 128 * 1024 * 1024 };
const objectId = '(?:[a-f0-9]{40}|[a-f0-9]{64})';
const updateLine = new RegExp(`^([^\\s\\0]+) (${objectId}) (refs/[^\\s\\0]+) (${objectId})$`);
const isZero = (value) => /^0+$/.test(value);

class GuardError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireLimit(condition, code) {
  if (!condition) throw new GuardError(code);
}

/** Git's pre-push input is data; only validated object IDs become Git arguments. */
export function parsePushUpdates(input) {
  requireLimit(typeof input === 'string' && Buffer.byteLength(input) <= pushLimits.inputBytes, 'push-input-limit');
  if (input === '') return [];
  const lines = input.replace(/\r?\n$/, '').split(/\r?\n/);
  requireLimit(lines.length <= pushLimits.updates, 'push-updates-limit');
  const destinations = new Set();
  return lines.map((line) => {
    const matched = updateLine.exec(line);
    requireLimit(Boolean(matched), 'invalid-push-input');
    const [, localRef, localSha, remoteRef, remoteSha] = matched;
    requireLimit(localSha.length === remoteSha.length && !destinations.has(remoteRef), 'invalid-push-input');
    requireLimit(isZero(localSha) ? localRef === '(delete)' && !isZero(remoteSha) : localRef !== '(delete)', 'invalid-push-input');
    destinations.add(remoteRef);
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

function readPushInput() {
  const chunks = [];
  let length = 0;
  while (true) {
    const chunk = Buffer.alloc(16 * 1024);
    const count = readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    length += count;
    requireLimit(length <= pushLimits.inputBytes, 'push-input-limit');
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function peelCommit(cwd, sha, failureCode) {
  try {
    return git(cwd, ['rev-parse', '--verify', `${sha}^{commit}`]).trim();
  } catch {
    throw new GuardError(failureCode);
  }
}

/** Inspect each distinct path/blob in every outgoing commit, never worktree copies. */
export function scanOutgoingCommits(cwd, input) {
  const updates = parsePushUpdates(input);
  const nonDeletions = updates.filter((update) => !isZero(update.localSha));
  const result = { updateCount: updates.length, commitCount: 0, inspectedCount: 0, findings: [], uninspectedBinaryPaths: [] };
  if (nonDeletions.length === 0) return result;

  // A truncated or grafted graph cannot prove which historical blobs are outgoing.
  requireLimit(git(cwd, ['rev-parse', '--is-shallow-repository']).trim() === 'false', 'incomplete-history');
  const graftsPath = path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'info/grafts']).trim());
  requireLimit(!existsSync(graftsPath) || readFileSync(graftsPath).length === 0, 'incomplete-history');
  const commits = new Set();
  for (const update of nonDeletions) {
    const head = peelCommit(cwd, update.localSha, 'local-commit-unavailable');
    const base = isZero(update.remoteSha) ? null : peelCommit(cwd, update.remoteSha, 'remote-base-unavailable');
    const args = ['rev-list', `--max-count=${pushLimits.commits + 1}`, head];
    if (base) args.push('--not', base);
    for (const sha of git(cwd, args).trim().split('\n').filter(Boolean)) {
      commits.add(sha);
      requireLimit(commits.size <= pushLimits.commits, 'push-commits-limit');
    }
  }
  result.commitCount = commits.size;
  const blobs = new Map();
  const versions = new Set();
  let entries = 0;
  let totalBytes = 0;
  for (const commitSha of commits) {
    for (const entry of nulList(git(cwd, ['ls-tree', '-r', '-z', '--full-tree', commitSha]))) {
      entries += 1;
      requireLimit(entries <= pushLimits.entries, 'push-tree-entries-limit');
      const tab = entry.indexOf('\t');
      requireLimit(tab !== -1, 'invalid-tree-entry');
      const [mode, type, blobSha] = entry.slice(0, tab).split(' ');
      const filePath = entry.slice(tab + 1);
      const version = `${mode}:${blobSha}:${filePath}`;
      if (versions.has(version)) continue;
      versions.add(version);
      if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
        result.findings.push({ commitSha, path: filePath, category: 'unsupported-link' });
        continue;
      }
      if (!blobs.has(blobSha)) {
        requireLimit(blobs.size < pushLimits.blobs, 'push-blobs-limit');
        const size = Number(git(cwd, ['cat-file', '-s', blobSha]).trim());
        requireLimit(Number.isSafeInteger(size) && size >= 0 && size <= pushLimits.blobBytes, 'push-blob-size-limit');
        totalBytes += size;
        requireLimit(totalBytes <= pushLimits.totalBytes, 'push-total-size-limit');
        blobs.set(blobSha, inspectFile('', git(cwd, ['cat-file', 'blob', blobSha], null)));
      }
      const content = blobs.get(blobSha);
      result.inspectedCount += 1;
      result.findings.push(...inspectFile(filePath, '').findings.map((finding) => ({ ...finding, commitSha })));
      result.findings.push(...content.findings.map((finding) => ({ ...finding, path: filePath, commitSha })));
      if (content.binary) result.uninspectedBinaryPaths.push(filePath);
    }
  }
  return result;
}

function nulList(value) {
  return value.split('\0').filter(Boolean);
}

function redactOutput(value) {
  let redacted = value;
  for (const [category, expression] of tokenPatterns) {
    redacted = redacted.replace(new RegExp(expression.source, `${expression.flags}g`), `[redacted:${category}]`);
  }
  return redacted;
}

/** Scan the actual index for commits, or the current non-ignored worktree. */
export function scanRepository(cwd, { staged = false } = {}) {
  const files = [...new Set(nulList(git(cwd, staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])))].sort();
  const findings = [];
  const uninspectedBinaryPaths = [];
  let inspectedCount = 0;

  for (const filePath of files) {
    let bytes;
    if (staged) {
      const metadata = git(cwd, ['ls-files', '--stage', '-z', '--', filePath]);
      if (metadata.startsWith('120000 ') || metadata.startsWith('160000 ')) {
        findings.push({ path: filePath, category: 'unsupported-link' });
        continue;
      }
      bytes = git(cwd, ['show', `:${filePath}`], null);
    } else {
      const absolute = path.resolve(cwd, filePath);
      const relative = path.relative(cwd, absolute);
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        findings.push({ path: filePath, category: 'outside-repository' });
        continue;
      }
      let metadata;
      try {
        // Check parents too: a tracked directory can be replaced by a symlink/junction.
        const parentParts = relative.split(path.sep).slice(0, -1);
        let parentPath = cwd;
        let linkedParent = false;
        for (const part of parentParts) {
          parentPath = path.join(parentPath, part);
          if (lstatSync(parentPath).isSymbolicLink()) {
            linkedParent = true;
            break;
          }
        }
        if (linkedParent) {
          findings.push({ path: filePath, category: 'unsupported-link' });
          continue;
        }
        metadata = lstatSync(absolute);
      } catch (error) {
        if (error.code === 'ENOENT') continue; // A tracked file deleted in the worktree.
        throw error;
      }
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        findings.push({ path: filePath, category: 'unsupported-link' });
        continue;
      }
      bytes = readFileSync(absolute);
    }
    const inspected = inspectFile(filePath, bytes);
    inspectedCount += 1;
    findings.push(...inspected.findings);
    if (inspected.binary) uninspectedBinaryPaths.push(filePath);
  }

  return { inspectedCount, findings, uninspectedBinaryPaths };
}

export function main(args = process.argv.slice(2), cwd = process.cwd(), write = (line) => process.stdout.write(`${line}\n`), readInput = readPushInput) {
  const prePush = args[0] === '--pre-push';
  const validArguments = prePush
    ? args.length === 3 && args.slice(1).every((argument) => typeof argument === 'string' && argument.length > 0)
    : args.length === 0 || (args.length === 1 && args[0] === '--staged');
  if (!validArguments) {
    write('Usage: node scripts/guard.mjs [--staged] | --pre-push <remote-name> <remote-location> (refs sur stdin)');
    return 2;
  }
  try {
    const result = prePush ? scanOutgoingCommits(cwd, readInput()) : scanRepository(cwd, { staged: args.includes('--staged') });
    const scope = prePush ? `${result.commitCount} commit(s) sortant(s), ${result.updateCount} mise(s) à jour de refs. Détection partielle des blobs ; messages de commit et annotations de tag non inspectés.` : 'Détection partielle ; historique et fichiers ignorés non inspectés.';
    write(`Guard : ${result.inspectedCount} version(s) de fichier, ${result.findings.length} signalement(s), ${result.uninspectedBinaryPaths.length} version(s) binaire(s) non inspectée(s). ${scope}`);
    for (const finding of result.findings) {
      write(redactOutput(JSON.stringify(finding)));
    }
    for (const filePath of result.uninspectedBinaryPaths) {
      write(redactOutput(JSON.stringify({ path: filePath, category: 'binary-not-inspected' })));
    }
    return result.findings.length > 0 ? 1 : 0;
  } catch (error) {
    // Do not print command stderr: an unusual filename or tool error may contain private values.
    const code = error instanceof GuardError ? error.code : 'git-or-file-error';
    write(`Guard impossible à terminer (${code}). Vérifier les entrées, l'historique local, les limites et les permissions ; aucune réussite déclarée.`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
