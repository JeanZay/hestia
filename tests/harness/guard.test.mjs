import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectFile, main, scanRepository } from '../../scripts/guard.mjs';

function withRepository(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'hestia-guard-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  try {
    git('init', '--quiet');
    return run(directory, git);
  } finally {
    // Only remove the fixed-prefix directory created by mkdtemp in the OS temp directory.
    const parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith('hestia-guard-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('known token formats are rejected without reporting the token value', () => {
  const syntheticTokens = [
    ['github-token', `ghp_${'x'.repeat(36)}`],
    ['provider-token', `sk-proj-${'x'.repeat(30)}`],
    ['aws-access-key', `AKIA${'X'.repeat(16)}`],
    ['bearer-token', `Bearer ${'x'.repeat(40)}`],
    ['private-key', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
  ];
  for (const [category, token] of syntheticTokens) {
    const result = inspectFile('src/example.ts', `first line\n${token}\n`);
    assert.ok(result.findings.some((finding) => finding.category === category));
    assert.equal(result.findings[0].line, 2);
    assert.ok(!JSON.stringify(result).includes(token));
  }
});

test('private storage paths and secret containers are refused across path separators', () => {
  for (const filePath of ['.env', '.env.local', 'nested/.env.production', 'private/profile.json', 'data\\originals\\scan.pdf', 'uploads/photo.jpg', 'backups/archive.zip', 'family-data/profile.json', 'id_ed25519', 'keys/device.pem', 'local.sqlite']) {
    assert.equal(inspectFile(filePath, '').findings[0]?.category, 'private-path', filePath);
  }
});

test('safe examples, source and integrity hashes are allowed but examples are still scanned', () => {
  for (const filePath of ['.env.example', 'src/profile.ts', 'docs/architecture.md']) {
    assert.deepEqual(inspectFile(filePath, `SYNTHETIC=true\nsha256: ${'a'.repeat(64)}`).findings, []);
  }
  assert.equal(inspectFile('.env.example', `ghp_${'x'.repeat(36)}`).findings[0].category, 'github-token');
});

test('binary content is explicitly uninspected and its private path is still refused', () => {
  const result = inspectFile('originals/photo.png', Buffer.from([0, 1, 2, 3]));
  assert.equal(result.binary, true);
  assert.equal(result.findings[0].category, 'private-path');
});

test('commit scanning uses staged bytes even if the worktree has been cleaned', () => withRepository((directory, git) => {
  const token = `ghp_${'x'.repeat(36)}`;
  writeFileSync(path.join(directory, 'example.txt'), token);
  git('add', 'example.txt');
  writeFileSync(path.join(directory, 'example.txt'), 'SYNTHETIC');
  assert.equal(scanRepository(directory, { staged: true }).findings[0].category, 'github-token');
  assert.deepEqual(scanRepository(directory).findings, []);
}));

test('staged safe content remains distinct from a changed unsafe worktree', () => withRepository((directory, git) => {
  writeFileSync(path.join(directory, 'example.txt'), 'SYNTHETIC');
  git('add', 'example.txt');
  writeFileSync(path.join(directory, 'example.txt'), `sk-${'x'.repeat(30)}`);
  assert.deepEqual(scanRepository(directory, { staged: true }).findings, []);
  assert.equal(scanRepository(directory).findings[0].category, 'provider-token');
}));

test('new non-ignored private files are included while ignored files stay outside coverage', () => withRepository((directory) => {
  writeFileSync(path.join(directory, '.gitignore'), 'ignored.txt\n');
  writeFileSync(path.join(directory, 'ignored.txt'), `ghp_${'x'.repeat(36)}`);
  mkdirSync(path.join(directory, 'private'));
  writeFileSync(path.join(directory, 'private', 'profile.json'), '{}');
  const result = scanRepository(directory);
  assert.equal(result.inspectedCount, 2);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, 'private/profile.json');
}));

test('staged symlinks are refused without reading their destination', () => withRepository((directory, git) => {
  // Populate the index directly so the invariant works without Windows symlink privileges.
  writeFileSync(path.join(directory, 'link-target.txt'), '../external-private.txt');
  const hash = git('hash-object', '-w', 'link-target.txt').toString().trim();
  git('update-index', '--add', '--cacheinfo', `120000,${hash},external-link`);
  const result = scanRepository(directory, { staged: true });
  assert.equal(result.findings[0].category, 'unsupported-link');
  assert.equal(result.inspectedCount, 0);
}));

test('tracked files beneath a replaced symlink directory are not read', () => withRepository((directory, git) => {
  const nested = path.join(directory, 'nested');
  const target = path.join(directory, 'target');
  mkdirSync(nested);
  mkdirSync(target);
  writeFileSync(path.join(nested, 'sample.txt'), 'SYNTHETIC');
  writeFileSync(path.join(target, 'sample.txt'), `ghp_${'x'.repeat(36)}`);
  writeFileSync(path.join(directory, '.gitignore'), 'target/\n');
  git('add', 'nested/sample.txt');
  assert.equal(path.dirname(path.resolve(nested)), path.resolve(directory));
  rmSync(nested, { recursive: true, force: true });
  symlinkSync(target, nested, 'junction');
  const result = scanRepository(directory);
  assert.ok(result.findings.some((finding) => finding.path === 'nested/sample.txt' && finding.category === 'unsupported-link'));
  assert.ok(!result.findings.some((finding) => finding.category === 'github-token'));
}));

test('CLI reports findings without exposing the synthetic token', () => withRepository((directory) => {
  const token = `ghp_${'x'.repeat(36)}`;
  writeFileSync(path.join(directory, 'sample.txt'), token);
  const output = [];
  assert.equal(main([], directory, (line) => output.push(line)), 1);
  assert.ok(output.some((line) => line.includes('github-token')));
  assert.ok(!output.join('\n').includes(token));
}));

test('recognized tokens in a reported filename are redacted too', () => withRepository((directory) => {
  const token = `ghp_${'x'.repeat(36)}`;
  mkdirSync(path.join(directory, 'private'));
  writeFileSync(path.join(directory, 'private', `${token}.txt`), 'SYNTHETIC');
  const output = [];
  assert.equal(main([], directory, (line) => output.push(line)), 1);
  assert.ok(!output.join('\n').includes(token));
  assert.ok(output.some((line) => line.includes('[redacted:github-token]')));
}));

test('pre-push requires the separate Git remote arguments', () => {
  const output = [];
  assert.equal(main(['--pre-push'], process.cwd(), (line) => output.push(line)), 2);
  assert.ok(output[0].includes('remote-name'));
});

test('unknown options and repository errors cannot be reported as success', () => {
  const output = [];
  assert.equal(main(['--allow-push'], process.cwd(), (line) => output.push(line)), 2);
  assert.equal(main([], path.join(os.tmpdir(), 'hestia-path-that-does-not-exist'), (line) => output.push(line)), 2);
  assert.ok(output.at(-1).includes('aucune réussite'));
});
