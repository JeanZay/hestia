import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Covers tracked AND untracked deliverables in a repository with no initial commit.
// Excludes this output and volatile local artifacts via .gitignore.
const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))].filter(path => existsSync(path)).sort();
const files = paths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const sourceDigest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
let commit = null;
try { commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Initial foundation has no parent commit. */ }
const report = { createdAt: new Date().toISOString(), sourceDigest, commit, files };
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/source-manifest.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Source SHA-256: ${sourceDigest} (${files.length} files)`);
