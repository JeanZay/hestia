import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { handleMailRetry } from '../../scripts/neon-mail-retry.mjs';

const env = {
  AUTH_BASE_URL: 'https://synthetic.example', MAIL_WORKER_SECRET: 'worker-secret-sentinel-12345678901234567890',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-secret-sentinel-1234567890',
  HESTIA_EXPECTED_BRANCH: 'dev', NEON_BRANCH: 'dev', HESTIA_MAIL_TRIGGER_NAME: 'hestia-mail-retry',
};
const payload = () => ({ version: 1, invocation_id: 'inv-synthetic-1',
  trigger: { type: 'schedule', id: 'trigger-synthetic', name: 'hestia-mail-retry' },
  data: { scheduled_at: '2026-10-05T12:07:00Z' } });
function request(body = payload(), options = {}) {
  const { url = 'https://native.example/mail', headers = {}, ...rest } = options;
  return new Request(url, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-neon-trigger-invocation-id': 'inv-synthetic-1', ...headers,
  }, body: typeof body === 'string' ? body : JSON.stringify(body), ...rest });
}
let unexpectedCalls = 0;
const noNetwork = () => { unexpectedCalls++; throw Error('Unexpected outgoing request'); };
afterEach(() => { const calls = unexpectedCalls; unexpectedCalls = 0; assert.equal(calls, 0); });

test('valid native envelope calls the existing worker once with fixed destination and no body', async () => {
  let calls = 0; let cancelled = false;
  const response = await handleMailRetry(request(), env, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://synthetic.example/api/hestia/mail-worker');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined); assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { authorization: `Bearer ${env.MAIL_WORKER_SECRET}`,
      'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET });
    return { ok: true, status: 200, body: { cancel: async () => { cancelled = true; } } };
  });
  assert.equal(calls, 1); assert.equal(cancelled, true); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'PASS', httpStatus: 200,
    invocation_id: 'inv-synthetic-1', scheduled_at: '2026-10-05T12:07:00Z' });
});

test('route and provenance refusals do not read worker secrets or make outgoing requests', async () => {
  let secretReads = 0;
  const guarded = new Proxy(env, { get(target, key) {
    if (['MAIL_WORKER_SECRET', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'AUTH_BASE_URL'].includes(key)) { secretReads++; throw Error('Secret read before guard'); }
    return target[key];
  } });
  const requests = [new Request('https://native.example/mail'), request(payload(), { url: 'https://native.example/other' }),
    request(payload(), { url: 'https://native.example/mail?url=https://evil.example' }),
    request(payload(), { headers: { 'x-neon-trigger-invocation-id': '' } }),
    request(payload(), { headers: { 'x-neon-trigger-invocation-id': 'a'.repeat(201) } })];
  for (const req of requests) assert.ok((await handleMailRetry(req, guarded, noNetwork)).status >= 400);
  const child = new Proxy(guarded, { get(target, key) { return key === 'NEON_BRANCH' ? 'child' : target[key]; } });
  assert.equal((await handleMailRetry(request(), child, noNetwork)).status, 503);
  assert.equal(secretReads, 0);
});

test('strict envelope and bounded body reject malformed or expanded inputs without fetch', async () => {
  const cases = [null, [], {}, '{', ' '.repeat(4097),
    { ...payload(), version: 2 }, { ...payload(), invocation_id: 'different' },
    { ...payload(), url: 'https://evil.example' },
    ...[{ type: 'storage_object_created' }, { id: '' }, { name: 'other' }, { extra: true }]
      .map((change) => ({ ...payload(), trigger: { ...payload().trigger, ...change } })),
    ...['2026-02-30T12:00:00Z', '2026-10-05T12:07:00+00:00', 'secret-sentinel', '2026-10-05']
      .map((date) => ({ ...payload(), data: { scheduled_at: date } })),
    { ...payload(), data: { ...payload().data, secret: 'sentinel' } }];
  for (const body of cases) assert.equal((await handleMailRetry(request(body), env, noNetwork)).status, 400);
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-length': '4097' }, { 'content-length': '-1' }]) {
    assert.equal((await handleMailRetry(request(payload(), { headers }), env, noNetwork)).status, 400);
  }
  const bytes = new Uint8Array([0xff, 0xfe]);
  const req = request(payload());
  const invalidUtf8 = new Request(req.url, { method: 'POST', headers: req.headers, body: bytes });
  assert.equal((await handleMailRetry(invalidUtf8, env, noNetwork)).status, 400);
});

test('missing or malformed trusted configuration fails closed', async () => {
  const invalid = [
    { NEON_BRANCH: 'other' }, { HESTIA_EXPECTED_BRANCH: '' }, { HESTIA_MAIL_TRIGGER_NAME: '' },
    ...['http://synthetic.example', 'https://synthetic.example/', 'https://u:p@synthetic.example',
      'https://synthetic.example?x=1', 'https://synthetic.example#x', 'invalid']
      .map((AUTH_BASE_URL) => ({ AUTH_BASE_URL })),
    { MAIL_WORKER_SECRET: '' }, { MAIL_WORKER_SECRET: 'x'.repeat(31) }, { MAIL_WORKER_SECRET: 'x'.repeat(32) + '\n' },
    { VERCEL_AUTOMATION_BYPASS_SECRET: '' }, { VERCEL_AUTOMATION_BYPASS_SECRET: 'spaces are not allowed' },
  ];
  for (const config of invalid) assert.equal((await handleMailRetry(request(), { ...env, ...config }, noNetwork)).status, 503);
});

test('chunked and stalled bodies stay bounded even without Content-Length', async (t) => {
  let cancelled = false;
  const chunks = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4096)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  const original = request();
  const oversized = new Request(original.url, { method: 'POST', headers: original.headers, body: chunks, duplex: 'half' });
  assert.equal((await handleMailRetry(oversized, env, noNetwork)).status, 400);
  assert.equal(cancelled, true);
  let bodyTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    bodyTimeout = milliseconds; queueMicrotask(callback); return undefined;
  });
  let stalledCancelled = false;
  const stalled = new ReadableStream({ cancel() { stalledCancelled = true; } });
  const pending = new Request(original.url, { method: 'POST', headers: original.headers, body: stalled, duplex: 'half' });
  assert.equal((await handleMailRetry(pending, env, noNetwork)).status, 400);
  assert.equal(bodyTimeout, 5000); assert.equal(stalledCancelled, true);
});

test('HTTP failures, redirect refusal and raw exceptions expose no secrets and never retry', async () => {
  for (const status of [301, 401, 429, 500]) {
    let calls = 0;
    const response = await handleMailRetry(request(), env, async () => {
      calls++; return new Response('remote-secret-sentinel', { status });
    });
    assert.equal(response.status, 503); assert.equal(calls, 1);
    assert.equal((await response.json()).httpStatus, status);
  }
  let calls = 0;
  const response = await handleMailRetry(request(), env, async () => {
    calls++; throw Error(`${env.MAIL_WORKER_SECRET}:${env.VERCEL_AUTOMATION_BYPASS_SECRET}`);
  });
  const text = await response.text();
  assert.equal(calls, 1); assert.equal(response.status, 503);
  assert.ok(!text.includes('sentinel')); assert.ok(!text.includes('Bearer'));
});

test('worker timeout stays 55 seconds, aborts outbound call and cannot return PASS', async (t) => {
  const controller = new AbortController(); let milliseconds;
  t.mock.method(AbortSignal, 'timeout', (value) => { milliseconds = value; return controller.signal; });
  let calls = 0;
  const result = handleMailRetry(request(), env, async (_, options) => {
    calls++;
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(Error('timeout-secret-sentinel')), { once: true });
      queueMicrotask(() => controller.abort());
    });
  });
  const response = await result;
  assert.equal(milliseconds, 55000); assert.equal(calls, 1); assert.equal(response.status, 503);
  assert.equal((await response.json()).httpStatus, null);
});

test('concurrent deliveries each invoke once; outbox locking remains the existing server responsibility', async () => {
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 4 }, () => handleMailRetry(request(), env, async () => {
    calls++; await Promise.resolve(); return new Response(null, { status: 200 });
  })));
  assert.equal(calls, 4); assert.ok(results.every((result) => result.status === 200));
});

test('cadence evidence contains only validated metadata; no error, headers or secrets', async () => {
  const records = [];
  const record = (metadata) => records.push(metadata);
  await handleMailRetry(request(payload(), { headers: { 'x-neon-trigger-invocation-id': '' } }), env, noNetwork, record);
  assert.equal(records.length, 0);
  const response = await handleMailRetry(request(), env, async () => {
    throw Error(`${env.MAIL_WORKER_SECRET}:${env.VERCEL_AUTOMATION_BYPASS_SECRET}`);
  }, record);
  assert.equal(response.status, 503);
  assert.deepEqual(records, [{ invocationId: 'inv-synthetic-1', triggerId: 'trigger-synthetic',
    scheduledAt: '2026-10-05T12:07:00Z', status: 'FAILED', httpStatus: null }]);
  const success = await handleMailRetry(request(), env, async () => new Response(null, { status: 200 }),
    () => { throw Error('log-provider-secret-sentinel'); });
  assert.equal(success.status, 200);
});

test('cold import of the exact three-file package makes no fetch and writes no log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hestia-neon-relay-'));
  try {
    await mkdir(join(directory, 'scripts'));
    for (const file of ['neon-mail-retry.mjs', 'mail-worker.mjs']) {
      await writeFile(join(directory, 'scripts', file), await readFile(new URL(`../../scripts/${file}`, import.meta.url)));
    }
    await writeFile(join(directory, 'index.mjs'), "export { default } from './scripts/neon-mail-retry.mjs';\n");
    await writeFile(join(directory, 'guard.mjs'), "globalThis.fetch = () => { process.exitCode = 9; throw Error('Unexpected fetch'); };\n");
    const result = spawnSync(process.execPath, ['--import', './guard.mjs', 'index.mjs'], {
      cwd: directory, encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env },
    });
    assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
