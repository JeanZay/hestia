import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { assertPortAvailable, completeWithOwnedServer } from '../../scripts/e2e-lifecycle.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('an occupied test port is refused without closing its existing owner', async () => {
  const existing = createServer();
  await new Promise(resolve => existing.listen(0, '127.0.0.1', resolve));
  try {
    const port = existing.address().port;
    await assert.rejects(assertPortAvailable('127.0.0.1', port), /aucun serveur existant/);
    assert.equal(existing.listening, true);
  } finally {
    await new Promise(resolve => existing.close(resolve));
  }
});

test('a free ephemeral port can be checked without keeping a listener alive', async () => {
  await assertPortAvailable('127.0.0.1', 0);
});

test('unexpected server failure defeats a later successful browser exit', async () => {
  const browser = deferred();
  const server = deferred();
  let stopped = 0;
  const result = completeWithOwnedServer({ completion: browser.promise, processChild: { kill() { stopped++; } } }, { completion: server.promise });
  server.resolve(1);
  assert.equal(await result, 1);
  browser.resolve(0);
  assert.equal(stopped, 1);
});

test('even an unexpected zero server exit invalidates ongoing browser tests', async () => {
  const browser = deferred();
  const server = deferred();
  const result = completeWithOwnedServer({ completion: browser.promise, processChild: { kill() {} } }, { completion: server.promise });
  server.resolve(0);
  assert.equal(await result, 1);
  browser.resolve(0);
});

test('browser outcome is preserved while the owned server is alive', async () => {
  for (const code of [0, 1]) {
    const browser = deferred();
    const server = deferred();
    let stopped = false;
    const result = completeWithOwnedServer({ completion: browser.promise, processChild: { kill() { stopped = true; } } }, { completion: server.promise });
    browser.resolve(code);
    assert.equal(await result, code);
    server.resolve(0); // Expected teardown after test completion.
    await Promise.resolve();
    assert.equal(stopped, false);
  }
});
