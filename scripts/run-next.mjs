import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'start'].includes(command)) throw new Error('Commande Next inconnue.');
if ((process.env.HESTIA_MODE ?? 'demo') !== 'demo' || (process.env.HESTIA_ENV ?? 'dev') !== 'dev') {
  throw new Error('Fondation locale uniquement : mode demo, environnement dev requis.');
}
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', HESTIA_MODE: 'demo', HESTIA_ENV: 'dev' };
let entry = resolve('node_modules/next/dist/bin/next');
let parameters = [command, ...args];
if (command === 'dev') parameters.push('--hostname', '127.0.0.1');
if (command === 'start') {
  entry = resolve('.next/standalone/server.js');
  if (!existsSync(entry)) throw new Error('Construire la démo avec npm run build avant de la démarrer.');
  cpSync('public', '.next/standalone/public', { recursive: true });
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
  const portIndex = args.indexOf('--port');
  env.PORT = portIndex >= 0 ? args[portIndex + 1] : (env.PORT ?? '3000');
  if (!/^\d+$/.test(env.PORT) || Number(env.PORT) < 1024 || Number(env.PORT) > 65535) throw new Error('Port local invalide.');
  env.HOSTNAME = '127.0.0.1';
  parameters = [];
}
const child = spawn(process.execPath, [entry, ...parameters], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Le processus Next ne peut pas démarrer.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
