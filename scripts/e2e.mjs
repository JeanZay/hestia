import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertPortAvailable, completeWithOwnedServer } from './e2e-lifecycle.mjs';

// Own the server directly: Playwright's Windows process-tree teardown requires
// privileges unavailable in some sandboxes. Only this runner's children are stopped.
const temporaryDirectory = resolve('artifacts/playwright-temp');
mkdirSync(temporaryDirectory, { recursive: true });
const env = { ...process.env, TEMP: temporaryDirectory, TMP: temporaryDirectory, TMPDIR: temporaryDirectory, NEXT_TELEMETRY_DISABLED: '1' };
if ((env.HESTIA_MODE ?? 'demo') !== 'demo' || (env.HESTIA_ENV ?? 'dev') !== 'dev') throw new Error('Tests synthétiques : mode demo et environnement dev requis.');
const serverEntry = resolve('.next/standalone/server.js');
if (!existsSync(serverEntry)) throw new Error('Exécuter npm run build avant les tests navigateur.');
cpSync('public', '.next/standalone/public', { recursive: true });
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });

function start(entry, args, processEnv) {
  const processChild = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', env: processEnv });
  const completion = new Promise(resolveExit => {
    processChild.once('error', () => resolveExit(1));
    processChild.once('exit', code => resolveExit(code ?? 1));
  });
  return { processChild, completion };
}

let tests;
await assertPortAvailable('127.0.0.1', 3210);
const server = start(serverEntry, [], { ...env, HOSTNAME: '127.0.0.1', PORT: '3210' });
let serverEnded = false;
server.completion.then(() => { serverEnded = true; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  tests?.processChild.kill(signal);
  server.processChild.kill(signal);
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !serverEnded; attempt++) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    if (serverEnded) break;
    try {
      const response = await fetch('http://127.0.0.1:3210/api/health', { signal: AbortSignal.timeout(500) });
      const body = await response.json();
      ready = response.ok && body.mode === 'demo' && body.synthetic === true;
      if (ready) break;
    } catch { /* Wait only for this freshly spawned local server. */ }
  }
  if (!ready || serverEnded) throw new Error('Serveur de test indisponible ; vérifier que le port local 3210 est libre.');
  tests = start(resolve('node_modules/@playwright/test/cli.js'), ['test', ...process.argv.slice(2)], env);
  process.exitCode = await completeWithOwnedServer(tests, server);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  server.processChild.kill();
  let deadline;
  const ended = await Promise.race([
    server.completion.then(() => true),
    new Promise(resolveTimeout => { deadline = setTimeout(() => resolveTimeout(false), 5000); })
  ]);
  clearTimeout(deadline);
  if (!ended) {
    console.error('Le serveur de cette exécution ne s’est pas arrêté. Aucun autre processus ne sera arrêté.');
    process.exitCode = 1;
    server.processChild.unref();
  }
}
