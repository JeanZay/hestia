// Local synthetic application checks. Owns only this run's labelled resources.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTGRES_IMAGE, resolvePostgresImage, assertPostgresContainerImage } from './postgres-image.mjs';
import { startS3Bench, stopS3Bench } from './s3-bench.mjs';
import { waitForContainerRemoval } from './container-removal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runner = path.join(root, 'tests/helpers/run-application.mjs');
const image = POSTGRES_IMAGE;
const suffix = randomBytes(8).toString('hex');
const runId = `hestia-app-${suffix}`;
const database = `hestia_test_${suffix}`;
const user = 'hestia_test';
const password = randomBytes(32).toString('hex');
const authSecret = randomBytes(48).toString('hex');
const testPassword = randomBytes(32).toString('hex');
const accessKey = randomBytes(16).toString('hex');
const secretKey = randomBytes(32).toString('hex');
const secrets = [password, authSecret, testPassword, accessKey, secretKey];
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[EPHEMERAL_REDACTED]'), value);
const systemKeys = new Set(['systemroot', 'windir', 'temp', 'tmp', 'tmpdir', 'path', 'pathext', 'comspec', 'home', 'userprofile', 'localappdata', 'appdata', 'programfiles', 'programfiles(x86)', 'programdata']);
const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key.toLowerCase())));
const dockerEnv = { ...systemEnv, POSTGRES_PASSWORD: password, RUSTFS_ACCESS_KEY: accessKey, RUSTFS_SECRET_KEY: secretKey };
const receipt = { runId, at: new Date().toISOString(), image, scope: 'ephemeral-local-only', repairPerformed: false };
let network, container, child, interrupted = false, exitCode = 1;

function docker(args, timeout = 30000) {
  const result = spawnSync('docker', args, { env: dockerEnv, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw Error(`DOCKER_${args[0].toUpperCase()}_FAILED`);
  return result.stdout.trim();
}

function inventory() {
  return docker(['ps', '-a', '--no-trunc', '--format', '{{json .}}']).split('\n').filter(Boolean).map(line => {
    const item = JSON.parse(line);
    return { id: item.ID, name: item.Names, image: item.Image, state: item.State };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { env: systemEnv, encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0) child.kill('SIGKILL');
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

function interrupt() {
  interrupted = true;
  stopChild();
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

async function runApplication(env) {
  return await new Promise(resolve => {
    child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    });
    let outputBytes = 0, failure;
    const finishStreams = [];
    for (const [input, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      // Keep incomplete lines intact so credentials split across chunks are redacted.
      let pending = '';
      input.setEncoding('utf8');
      input.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > 24 * 1024 * 1024) {
          failure = 'APPLICATION_OUTPUT_LIMIT';
          stopChild();
          return;
        }
        pending += chunk;
        const end = pending.lastIndexOf('\n');
        if (end !== -1) {
          output.write(redact(pending.slice(0, end + 1)));
          pending = pending.slice(end + 1);
        }
      });
      finishStreams.push(() => output.write(redact(pending)));
    }
    const timeout = setTimeout(() => { failure = 'APPLICATION_TIMEOUT'; stopChild(); }, 600000);
    const progress = setInterval(() => console.log(JSON.stringify({ runId, application: 'running' })), 15000);
    child.on('error', () => { failure = 'APPLICATION_SPAWN_FAILED'; });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      clearInterval(progress);
      finishStreams.forEach(flush => flush());
      if (failure) receipt.error = failure;
      if (signal) receipt.childSignal = signal;
      resolve(failure || interrupted ? 1 : (code ?? 1));
    });
  });
}

try {
  if (!fs.existsSync(runner)) throw Error('APPLICATION_RUNNER_MISSING');
  receipt.before = inventory();
  const resolvedImage = resolvePostgresImage(JSON.parse(docker(['image', 'inspect', image])));
  receipt.resolvedImage = resolvedImage;
  network = docker(['network', 'create', '--opt', 'com.docker.network.bridge.enable_ip_masquerade=false', '--opt', 'com.docker.network.bridge.enable_icc=false', '--label', `hestia.qualification=${runId}`, runId]);
  container = docker(['run', '--detach', '--rm', '--pull', 'never', '--name', runId, '--label', `hestia.qualification=${runId}`, '--network', network,
    '--memory', '1536m', '--cpus', '1', '--pids-limit', '128', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=1073741824',
    '--env', `POSTGRES_USER=${user}`, '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image, '-c', 'shared_buffers=32MB', '-c', 'max_connections=40']);
  receipt.containerId = container;
  receipt.networkId = network;
  const info = JSON.parse(docker(['inspect', container]))[0];
  const netInfo = JSON.parse(docker(['network', 'inspect', network]))[0];
  assertPostgresContainerImage(info.Image, resolvedImage.id);
  const bindings = info.NetworkSettings.Ports['5432/tcp'];
  receipt.isolation = {
    owned: info.Config.Labels['hestia.qualification'] === runId,
    image: info.Image, bindings, mounts: info.Mounts.map(mount => ({ type: mount.Type, destination: mount.Destination })),
    tmpfs: info.HostConfig.Tmpfs, networkOptions: netInfo.Options,
  };
  if (!receipt.isolation.owned || bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
    || info.Mounts.some(mount => mount.Type !== 'tmpfs') || !info.HostConfig.Tmpfs['/var/lib/postgresql/data']
    || netInfo.Labels['hestia.qualification'] !== runId || netInfo.Options['com.docker.network.bridge.enable_ip_masquerade'] !== 'false'
    || netInfo.Options['com.docker.network.bridge.enable_icc'] !== 'false') throw Error('ISOLATION_MISMATCH');
  const port = Number(bindings[0].HostPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('INVALID_PORT');
  let ready = false;
  for (let attempt = 0; attempt < 80 && !interrupted; attempt++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '--host', '127.0.0.1', '-U', user, '-d', database], { env: dockerEnv, encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (interrupted) throw Error('RUN_INTERRUPTED');
  if (!ready) throw Error('POSTGRES_NOT_READY');
  const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, connectionTimeoutMillis: 5000 });
  try {
    await pool.query('CREATE TABLE hestia_bench_marker(run_id text PRIMARY KEY)');
    await pool.query('INSERT INTO hestia_bench_marker VALUES ($1)', [runId]);
    receipt.version = (await pool.query('SELECT version() AS version')).rows[0].version;
    receipt.settings = (await pool.query("SELECT current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS synchronous_commit")).rows[0];
  } finally { await pool.end(); }
  Object.assign(receipt, { hostBinding: '127.0.0.1', port, database, storage: 'tmpfs-only' });
  console.log(JSON.stringify({ runId, database, host: '127.0.0.1', port, storage: receipt.storage }));
  if (interrupted) throw Error('RUN_INTERRUPTED');
  const s3 = await startS3Bench({ docker, runId, network, accessKey, secretKey, interrupted: () => interrupted });
  receipt.s3 = s3.receipt;
  exitCode = await runApplication({
    ...systemEnv, ...s3.env, DATABASE_URL: databaseUrl, AUTH_SECRET: authSecret, AUTH_BASE_URL: 'http://127.0.0.1:3210',
    HESTIA_ENVIRONMENT: 'local', HESTIA_TEST_PASSWORD: testPassword, HESTIA_TEST_RUN_ID: runId,
    NODE_ENV: 'test', BETTER_AUTH_TELEMETRY: 'false', NEXT_TELEMETRY_DISABLED: '1',
  });
  receipt.applicationExitCode = exitCode;
} catch (error) {
  receipt.error = /^[A-Z_]+$/.test(error.message) ? error.message : 'APPLICATION_BENCH_FAILED';
  console.error(receipt.error);
} finally {
  stopChild();
  try {
    receipt.s3Removed = await stopS3Bench(docker, runId);
    // Recover exact owned IDs if a Docker command completed after its client timed out.
    const matches = docker(['ps', '-a', '--no-trunc', '--filter', `name=^/${runId}$`, '--format', '{{.ID}}']).split('\n').filter(Boolean);
    if (matches.length > 1) throw Error('OWNERSHIP_MISMATCH');
    if (matches.length) {
      const current = JSON.parse(docker(['inspect', matches[0]]))[0];
      if ((container && current.Id !== container) || current.Config.Labels['hestia.qualification'] !== runId || current.Name !== `/${runId}`) throw Error('OWNERSHIP_MISMATCH');
      container = current.Id;
      docker(['stop', '--time', '3', container]);
    }
    receipt.containerRemoved = await waitForContainerRemoval(docker, runId, container ?? null);
    const networks = docker(['network', 'ls', '--no-trunc', '--filter', `name=^${runId}$`, '--format', '{{.ID}}']).split('\n').filter(Boolean);
    if (networks.length > 1) throw Error('OWNERSHIP_MISMATCH');
    if (networks.length) {
      const current = JSON.parse(docker(['network', 'inspect', networks[0]]))[0];
      if ((network && current.Id !== network) || current.Name !== runId || current.Labels['hestia.qualification'] !== runId || Object.keys(current.Containers ?? {}).length !== 0) throw Error('OWNERSHIP_MISMATCH');
      network = current.Id;
      docker(['network', 'rm', network]);
    }
    receipt.networkRemoved = docker(['network', 'ls', '--no-trunc', '--filter', `name=^${runId}$`, '--format', '{{.ID}}']) === '';
    receipt.after = inventory();
    receipt.preexistingUnchanged = receipt.before !== undefined && receipt.before.every(before => receipt.after.some(after => JSON.stringify(before) === JSON.stringify(after)));
    // Unrelated services may restart autonomously during a run. Preserve their
    // exact identity and definition; report runtime transitions separately.
    receipt.preexistingPreserved = receipt.before !== undefined && receipt.before.every(before => receipt.after.some(after =>
      before.id === after.id && before.name === after.name && before.image === after.image));
    receipt.preexistingStateChanges = (receipt.before ?? []).flatMap(before => {
      const after = receipt.after.find(item => item.id === before.id);
      return after && after.state !== before.state ? [{ id: before.id, name: before.name, before: before.state, after: after.state }] : [];
    });
    receipt.preservationScope = 'Same container IDs, names and images; observed runtime state transitions do not establish causality.';
    if (!receipt.preexistingPreserved || !receipt.containerRemoved || !receipt.s3Removed || !receipt.networkRemoved) exitCode = 1;
  } catch {
    receipt.cleanup = 'FAILED_REQUIRES_RECONCILIATION';
    exitCode = 1;
  }
  receipt.finalExitCode = exitCode;
  receipt.completedAt = new Date().toISOString();
  const output = path.join(root, 'artifacts/pg-runs', runId);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'runtime.json'), redact(JSON.stringify(receipt, null, 2)) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ runtimeReceipt: `artifacts/pg-runs/${runId}/runtime.json`, exitCode, containerRemoved: receipt.containerRemoved, networkRemoved: receipt.networkRemoved, preexistingPreserved: receipt.preexistingPreserved, preexistingUnchanged: receipt.preexistingUnchanged, preexistingStateChanges: receipt.preexistingStateChanges }));
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
process.exitCode = exitCode;
