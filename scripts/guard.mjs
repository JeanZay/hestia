import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
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
  return execFileSync('git', args, { cwd, encoding, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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

export function main(args = process.argv.slice(2), cwd = process.cwd(), write = (line) => process.stdout.write(`${line}\n`)) {
  if (args.some((argument) => !['--staged', '--pre-push'].includes(argument))) {
    write('Usage: node scripts/guard.mjs [--staged] [--pre-push]');
    return 2;
  }
  if (args.includes('--pre-push')) {
    write('Push refusé : la fondation Hestia autorise uniquement le travail local. Une décision explicite de publication et une évolution relue de ce hook sont nécessaires.');
    return 1;
  }
  try {
    const result = scanRepository(cwd, { staged: args.includes('--staged') });
    write(`Guard : ${result.inspectedCount} fichier(s), ${result.findings.length} signalement(s), ${result.uninspectedBinaryPaths.length} binaire(s) non inspecté(s). Détection partielle ; historique et fichiers ignorés non inspectés.`);
    for (const finding of result.findings) {
      write(redactOutput(JSON.stringify(finding)));
    }
    for (const filePath of result.uninspectedBinaryPaths) {
      write(redactOutput(JSON.stringify({ path: filePath, category: 'binary-not-inspected' })));
    }
    return result.findings.length > 0 ? 1 : 0;
  } catch {
    // Do not print command stderr: an unusual filename or tool error may contain private values.
    write('Guard impossible à terminer. Vérifier Git, les permissions et les fichiers ; aucune réussite déclarée.');
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
