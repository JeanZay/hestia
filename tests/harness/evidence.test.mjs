import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('source evidence includes new files and records the absence of a tracked deletion', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'hestia-evidence-test-'));
  const entry = fileURLToPath(new URL('../../scripts/evidence.mjs', import.meta.url));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: temporary });
    writeFileSync(path.join(temporary, '.gitignore'), 'artifacts/\n');
    writeFileSync(path.join(temporary, 'removed.txt'), 'SYNTHETIC OLD FILE\n');
    execFileSync('git', ['add', '--all'], { cwd: temporary });
    rmSync(path.join(temporary, 'removed.txt'));
    writeFileSync(path.join(temporary, 'new.txt'), 'SYNTHETIC NEW FILE\n');
    execFileSync(process.execPath, [entry], { cwd: temporary });
    const pointer = JSON.parse(readFileSync(path.join(temporary, 'artifacts/evidence-latest.json')));
    const report = JSON.parse(readFileSync(path.join(temporary, pointer.report.path)));
    assert.deepEqual(report.files.map(file => file.path), ['.gitignore', 'new.txt']);
    assert.match(report.sourceDigest, /^[a-f0-9]{64}$/);
    assert.equal(report.commit, null);
    assert.deepEqual(report.deletedFiles, ['removed.txt']);
    assert.equal(report.runId, pointer.runId);
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('hestia-evidence-test-'));
    rmSync(temporary, { recursive: true, force: true });
  }
});
