import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeMailWorker } from '../../scripts/mail-worker.mjs';
test('CLI targets only the fixed worker endpoint and never returns provider contents', async () => {
  let options;
  const env = { AUTH_BASE_URL: 'https://hestia.example.invalid', MAIL_WORKER_SECRET: 'synthetic-worker-credential-000000', VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass' };
  const result = await invokeMailWorker(env, async (url, input) => {
    assert.equal(url.href, 'https://hestia.example.invalid/api/hestia/mail-worker');options = input;
    return new Response('untrusted sensitive echo', { status: 503 });
  });
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
  assert.equal(options.headers.authorization, `Bearer ${env.MAIL_WORKER_SECRET}`);
  assert.equal(options.headers['x-vercel-protection-bypass'], env.VERCEL_AUTOMATION_BYPASS_SECRET);
  assert.deepEqual(result, { status: 'FAILED', httpStatus: 503 });
});
test('CLI rejects insecure or credential-bearing origins without network', async () => {
  for (const origin of ['http://hestia.example.invalid', 'https://user:password@hestia.example.invalid', 'https://hestia.example.invalid/path', 'https://hestia.example.invalid?secret=x']) {
    const result = await invokeMailWorker({ AUTH_BASE_URL: origin, MAIL_WORKER_SECRET: 'synthetic-worker-credential-000000' }, () => { throw Error('must not call'); });
    assert.deepEqual(result, { status: 'FAILED', httpStatus: null });
  }
});
