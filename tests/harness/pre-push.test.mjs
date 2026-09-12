import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { main, parsePushUpdates, scanOutgoingCommits } from '../../scripts/guard.mjs';

const zero = '0'.repeat(40);
const line = (head, base = zero, remote = 'refs/heads/main') => `refs/heads/local ${head} ${remote} ${base}\n`;

function withRepository(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'hestia-push-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().trim();
  try {
    git('init', '--quiet');
    const emptyHooks = path.join(directory, '.git', 'fixture-empty-hooks');
    mkdirSync(emptyHooks);
    const authorArgs = ['-c', 'user.name=Synthetic fixture', '-c', 'user.email=hestia@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', `core.hooksPath=${emptyHooks}`];
    const commit = () => {
      git(...authorArgs, 'commit', '--quiet', '-m', 'Synthetic fixture');
      return git('rev-parse', 'HEAD');
    };
    const save = (name, content) => {
      writeFileSync(path.join(directory, name), content);
      git('add', '--', name);
      return commit();
    };
    return run({ directory, git, commit, save, authorArgs });
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('hestia-push-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a new remote receives full clean history, unaffected by uncommitted worktree content', () => withRepository(({ directory, save }) => {
  save('sample.txt', 'SYNTHETIC VERSION ONE');
  const head = save('sample.txt', 'SYNTHETIC VERSION TWO');
  writeFileSync(path.join(directory, 'sample.txt'), `ghp_${'x'.repeat(36)}`);
  const result = scanOutgoingCommits(directory, line(head));
  assert.equal(result.commitCount, 2);
  assert.equal(result.inspectedCount, 2);
  assert.deepEqual(result.findings, []);
  const output = [];
  assert.equal(main(['--pre-push', 'origin', 'https://example.invalid/a repo.git'], directory, (value) => output.push(value), () => line(head)), 0);
  assert.ok(output[0].includes('2 commit(s) sortant(s)'));
}));

test('an introduced then deleted secret is detected in all outgoing history', () => withRepository(({ directory, git, save, commit }) => {
  const base = save('sample.txt', 'SYNTHETIC');
  const leak = save('removed.txt', `ghp_${'x'.repeat(36)}`);
  git('rm', '--quiet', 'removed.txt');
  const head = commit();
  for (const remoteBase of [zero, base]) {
    const result = scanOutgoingCommits(directory, line(head, remoteBase));
    const finding = result.findings.find((entry) => entry.category === 'github-token');
    assert.equal(finding?.commitSha, leak);
    assert.equal(finding?.path, 'removed.txt');
    assert.equal(main(['--pre-push', 'origin', 'https://example.invalid/repo.git'], directory, () => {}, () => line(head, remoteBase)), 1);
  }
}));

test('a normal branch update scans old..new and does not reclassify remote history as outgoing', () => withRepository(({ directory, save }) => {
  const old = save('sample.txt', `ghp_${'x'.repeat(36)}`);
  const head = save('sample.txt', 'SYNTHETIC SAFE REPLACEMENT');
  const result = scanOutgoingCommits(directory, line(head, old, 'refs/heads/feature'));
  assert.equal(result.commitCount, 1);
  assert.equal(result.inspectedCount, 1);
  assert.deepEqual(result.findings, []);
}));

test('every pushed ref is covered even when its commit is not the checked-out head', () => withRepository(({ directory, git, save }) => {
  const base = save('sample.txt', 'SYNTHETIC');
  const unsafe = save('sample.txt', `sk-${'x'.repeat(30)}`);
  git('checkout', '--quiet', '--detach', base);
  const safe = save('sample.txt', 'SYNTHETIC ALTERNATIVE');
  const result = scanOutgoingCommits(directory, line(safe, base, 'refs/heads/safe') + line(unsafe, base, 'refs/heads/other'));
  assert.equal(result.updateCount, 2);
  assert.equal(result.commitCount, 2);
  assert.equal(result.findings[0]?.category, 'provider-token');
  assert.equal(result.findings[0]?.commitSha, unsafe);
}));

test('a remote base absent locally fails closed with a sanitized reason', () => withRepository(({ directory, save }) => {
  const head = save('sample.txt', 'SYNTHETIC');
  const output = [];
  const privateRemote = `https://ghp_${'x'.repeat(36)}@example.invalid/repo.git`;
  assert.equal(main(['--pre-push', 'origin', privateRemote], directory, (value) => output.push(value), () => line(head, 'f'.repeat(40))), 2);
  assert.ok(output[0].includes('remote-base-unavailable'));
  assert.ok(!output.join('\n').includes(privateRemote));
  assert.ok(!output.join('\n').includes('ghp_'));
}));

test('invalid, duplicate, inconsistent, or oversized ref input cannot pass', () => {
  const sha = 'a'.repeat(40);
  for (const input of ['garbage', line('--help'), line(sha).replace('refs/heads/main', '--all'), line(sha) + '\n', line(sha) + line(sha), `(delete) ${sha} refs/heads/main ${zero}\n`, line(zero), 'x'.repeat(1024 * 1024 + 1), line(sha).repeat(101)]) {
    assert.throws(() => parsePushUpdates(input));
  }
  assert.equal(main(['--pre-push', 'origin', 'https://example.invalid/repo.git'], process.cwd(), () => {}, () => 'invalid'), 2);
});

test('deleted refs and an empty no-op do not publish blobs or trigger a blanket refusal', () => {
  for (const input of ['', `(delete) ${zero} refs/heads/old ${'f'.repeat(40)}\n`]) {
    const result = scanOutgoingCommits(process.cwd(), input);
    assert.equal(result.commitCount, 0);
    assert.deepEqual(result.findings, []);
    assert.equal(main(['--pre-push', 'origin', 'https://example.invalid/repo.git'], process.cwd(), () => {}, () => input), 0);
  }
});

test('an outgoing symlink is refused without opening its untracked destination', () => withRepository(({ directory, git, commit, save }) => {
  save('sample.txt', 'SYNTHETIC');
  writeFileSync(path.join(directory, 'outside-fixture.txt'), `ghp_${'x'.repeat(36)}`);
  writeFileSync(path.join(directory, 'link-name.txt'), 'outside-fixture.txt');
  const blob = git('hash-object', '-w', 'link-name.txt');
  git('update-index', '--add', '--cacheinfo', `120000,${blob},link-to-outside`);
  const head = commit();
  const result = scanOutgoingCommits(directory, line(head));
  assert.equal(result.findings[0]?.category, 'unsupported-link');
  assert.ok(!result.findings.some((finding) => finding.category === 'github-token'));
}));

test('annotated tags are peeled to commits and their entire new history is inspected', () => withRepository(({ directory, git, save, authorArgs }) => {
  save('sample.txt', 'SYNTHETIC');
  save('sample.txt', `ghp_${'x'.repeat(36)}`);
  git(...authorArgs, 'tag', '-a', 'v-test', '-m', 'Synthetic tag');
  const tag = git('rev-parse', 'v-test');
  const result = scanOutgoingCommits(directory, `refs/tags/v-test ${tag} refs/tags/v-test ${zero}\n`);
  assert.equal(result.commitCount, 2);
  assert.equal(result.findings[0]?.category, 'github-token');
}));

test('oversized historical blobs return an explicit incomplete check, not a silent skip', () => withRepository(({ directory, save }) => {
  const head = save('large.txt', Buffer.alloc(4 * 1024 * 1024 + 1, 'a'));
  const output = [];
  assert.equal(main(['--pre-push', 'origin', 'https://example.invalid/repo.git'], directory, (value) => output.push(value), () => line(head)), 2);
  assert.ok(output[0].includes('push-blob-size-limit'));
}));

test('Git replacement objects cannot hide the original outgoing secret', () => withRepository(({ directory, git, save }) => {
  const original = save('sample.txt', `ghp_${'x'.repeat(36)}`);
  const clean = save('sample.txt', 'SYNTHETIC');
  git('replace', original, clean);
  const result = scanOutgoingCommits(directory, line(original));
  assert.equal(result.findings[0]?.category, 'github-token');
}));

test('a shallow graph cannot masquerade as fully inspected outgoing history', () => withRepository(({ directory, save }) => {
  const head = save('sample.txt', 'SYNTHETIC');
  writeFileSync(path.join(directory, '.git', 'shallow'), `${head}\n`);
  const output = [];
  assert.equal(main(['--pre-push', 'origin', 'https://example.invalid/repo.git'], directory, (value) => output.push(value), () => line(head)), 2);
  assert.ok(output[0].includes('incomplete-history'));
}));

test('the Node entry point consumes actual stdin and preserves remote arguments as data', () => withRepository(({ directory, save }) => {
  const head = save('sample.txt', 'SYNTHETIC');
  const script = fileURLToPath(new URL('../../scripts/guard.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [script, '--pre-push', 'origin name', 'https://example.invalid/space repo.git'], { cwd: directory, input: line(head), encoding: 'utf8' });
  assert.ok(output.includes('1 commit(s) sortant(s)'));
  assert.ok(output.includes('0 signalement(s)'));
}));
