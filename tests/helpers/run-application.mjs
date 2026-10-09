import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertPortAvailable, completeWithOwnedServer } from '../../scripts/e2e-lifecycle.mjs';
import { prepareBrowserDatabase } from './browser-database.mjs';

if (process.env.HESTIA_ENVIRONMENT !== 'local' || !process.env.HESTIA_TEST_RUN_ID
  || !/^\/hestia_test_/.test(new URL(process.env.DATABASE_URL).pathname)
  || new URL(process.env.DATABASE_URL).hostname !== '127.0.0.1') {
  throw new Error('Only the owned ephemeral test database is accepted.');
}
if (process.env.HESTIA_STORAGE_MODE !== 'local' || process.env.HESTIA_S3_BUCKET_ACCESS !== 'private'
  || new URL(process.env.AWS_ENDPOINT_URL_S3).hostname !== '127.0.0.1'
  || process.env.HESTIA_S3_BUCKET !== `hestia-test-${process.env.HESTIA_TEST_RUN_ID.slice('hestia-app-'.length)}`) {
  throw new Error('Only the owned ephemeral private object store is accepted.');
}
const temp = resolve('artifacts/playwright-temp');
mkdirSync(temp, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp,
  NEXT_TELEMETRY_DISABLED: '1', BETTER_AUTH_TELEMETRY: 'false' };
function start(entry, args, overrides = {}, cwd = process.cwd()) {
  const processChild = spawn(process.execPath, [resolve(entry), ...args], {
    cwd, stdio: 'inherit', env: { ...env, ...overrides },
  });
  const completion = new Promise(done => {
    processChild.once('error', () => done(1));
    processChild.once('exit', code => done(code ?? 1));
  });
  return { processChild, completion };
}
let current, server;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  current?.processChild.kill(signal);
  server?.processChild.kill(signal);
});
async function run(entry, args, overrides = {}) {
  current = start(entry, args, overrides);
  if (await current.completion !== 0) throw new Error('Application qualification step failed.');
}
try {
  await run('node_modules/vitest/vitest.mjs', ['run', '--config', 'tests/integration/vitest.config.ts']);
  if (!process.argv.includes('--integration-only')) {
    const entry = '.next/standalone/server.js';
    if (!existsSync(entry)) throw new Error('Run npm run build before browser qualification.');
    const browser = await prepareBrowserDatabase({ databaseUrl: env.DATABASE_URL,
      runId: env.HESTIA_TEST_RUN_ID, environment: env.HESTIA_ENVIRONMENT });
    const browserEnv = { DATABASE_URL: browser.databaseUrl };
    console.log(JSON.stringify({ runId: env.HESTIA_TEST_RUN_ID, browserDatabase: browser.databaseName,
      scope: 'owned-run-browser-phase', custody: browser.custody }));
    // The bucket remains owned by this run. SQL originals use unique immutable
    // keys; browser quota accounting starts in its separate database. Final
    // container/bucket cleanup remains the enclosing bench's responsibility.
    await run('node_modules/vitest/vitest.mjs', ['run', '--config', 'tests/helpers/bootstrap.config.ts'], browserEnv);
    cpSync('public', '.next/standalone/public', { recursive: true });
    cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
    await assertPortAvailable('127.0.0.1', 3210);
    // Exercise the packaged application, including traced decoder/worker assets,
    // without accidentally loading those files from the source checkout's cwd.
    server = start(entry, [], { ...browserEnv, HOSTNAME: '127.0.0.1', PORT: '3210', NODE_ENV: 'production' }, resolve('.next/standalone'));
    let ended = false;
    server.completion.then(() => { ended = true; });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ended; attempt++) {
      await new Promise(done => setTimeout(done, 100));
      try {
        const res = await fetch('http://127.0.0.1:3210/api/health', { signal: AbortSignal.timeout(500) });
        ready = res.ok && (await res.json()).application === 'hestia';
        if (ready) break;
      } catch { /* Only wait on this run's freshly spawned server. */ }
    }
    if (!ready || ended) throw new Error('Owned application server unavailable.');
    current = start('node_modules/@playwright/test/cli.js', ['test', ...process.argv.slice(2)], browserEnv);
    process.exitCode = await completeWithOwnedServer(current, server);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  server?.processChild.kill();
  if (server) {
    let timer;
    const ended = await Promise.race([
      server.completion.then(() => true),
      new Promise(done => { timer = setTimeout(() => done(false), 5000); }),
    ]);
    clearTimeout(timer);
    if (!ended) { process.exitCode = 1; server.processChild.unref(); }
  }
}
