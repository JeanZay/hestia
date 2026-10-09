import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareBrowserDatabase } from '../helpers/browser-database.mjs';

const runId = 'hestia-app-0123456789abcdef';
const sourceName = 'hestia_test_0123456789abcdef';
const databaseName = `${sourceName}_browser`;
const context = { environment: 'local', runId,
  databaseUrl: `postgresql://hestia_test:synthetic-only@127.0.0.1:5432/${sourceName}` };

function fake({ marker = [{ run_id: runId }], sourceIdentity = sourceName, destinationIdentity = databaseName,
  collision = false, destinationFailure = false, closeFailure = false, tableCount = 0 } = {}) {
  const connections = [], queries = [], ended = [];
  const createPool = async options => {
    const index = connections.length;
    connections.push(new URL(options.connectionString));
    return {
      async query(sql, values) {
        queries.push({ index, sql, values });
        if (sql === 'SELECT current_database() AS name')
          return { rows: [{ name: index === 0 ? sourceIdentity : destinationIdentity }] };
        if (sql === 'SELECT run_id FROM hestia_bench_marker') return { rows: marker };
        if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: tableCount }] };
        if (sql.startsWith('CREATE DATABASE') && collision) throw new Error('Synthetic duplicate database');
        if (index === 1 && sql.startsWith('CREATE TABLE') && destinationFailure)
          throw new Error(`Driver details must stay private: ${context.databaseUrl}`);
        return { rows: [] };
      },
      async end() { ended.push(index); if (closeFailure) throw new Error(context.databaseUrl); },
    };
  };
  return { createPool, connections, queries, ended };
}

test('browser database is newly created after source custody and retains only connection settings', async () => {
  const f = fake(), result = await prepareBrowserDatabase(context, f);
  const source = new URL(context.databaseUrl), destination = new URL(result.databaseUrl);
  assert.equal(result.databaseName, databaseName);
  assert.equal(destination.pathname, `/${databaseName}`);
  destination.pathname = source.pathname;
  assert.equal(destination.href, source.href);
  assert.deepEqual(f.queries.map(q => q.sql), [
    'SELECT current_database() AS name', 'SELECT run_id FROM hestia_bench_marker',
    `CREATE DATABASE "${databaseName}"`, 'SELECT current_database() AS name',
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    'CREATE TABLE hestia_bench_marker(run_id text PRIMARY KEY)', 'INSERT INTO hestia_bench_marker(run_id) VALUES($1)',
    'SELECT run_id FROM hestia_bench_marker',
  ]);
  assert.deepEqual(f.queries.at(-2).values, [runId]);
  assert.deepEqual(result.custody, { sourceVerified: true, destinationVerified: true, initialPublicTableCount: 0, markerVerified: true });
  assert.deepEqual(f.ended.sort(), [0, 1]);
});

test('invalid environment, host, run identity, username, source database or connection options open no pool', async () => {
  const invalid = [
    { environment: 'dev' }, { runId: 'hestia-app-not-owned' },
    { databaseUrl: context.databaseUrl.replace('127.0.0.1', 'remote.invalid') },
    { databaseUrl: context.databaseUrl.replace('hestia_test:', 'other:') },
    { databaseUrl: context.databaseUrl.replace(sourceName, `${sourceName}_browser`) },
    { databaseUrl: `${context.databaseUrl}?options=unexpected` },
    { databaseUrl: context.databaseUrl.replace(':5432', '') },
  ];
  for (const changed of invalid) {
    const f = fake();
    await assert.rejects(prepareBrowserDatabase({ ...context, ...changed }, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
    assert.equal(f.connections.length, 0);
    assert.equal(f.queries.length, 0);
  }
});

test('missing, wrong or ambiguous source custody prevents every database creation', async () => {
  for (const config of [{ marker: [] }, { marker: [{ run_id: 'other-run' }] },
    { marker: [{ run_id: runId }, { run_id: 'other-run' }] }, { sourceIdentity: 'other-database' }]) {
    const f = fake(config);
    await assert.rejects(prepareBrowserDatabase(context, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
    assert.equal(f.queries.some(q => q.sql.startsWith('CREATE')), false);
    assert.deepEqual(f.ended, [0]);
  }
});

test('an existing destination is neither reused nor dropped after CREATE fails', async () => {
  const f = fake({ collision: true });
  await assert.rejects(prepareBrowserDatabase(context, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
  assert.equal(f.connections.length, 1);
  assert.equal(f.queries.some(q => /DROP|IF NOT EXISTS|TRUNCATE/i.test(q.sql)), false);
  assert.deepEqual(f.ended, [0]);
});

test('wrong destination identity writes no marker and closes both connections', async () => {
  const f = fake({ destinationIdentity: 'other-database' });
  await assert.rejects(prepareBrowserDatabase(context, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
  assert.equal(f.queries.some(q => q.index === 1 && /CREATE|INSERT/.test(q.sql)), false);
  assert.deepEqual(f.ended.sort(), [0, 1]);
});

test('an unexpected table in the new database is refused before bootstrap custody', async () => {
  const f = fake({ tableCount: 1 });
  await assert.rejects(prepareBrowserDatabase(context, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
  assert.equal(f.queries.some(q => q.index === 1 && /CREATE|INSERT/.test(q.sql)), false);
  assert.deepEqual(f.ended.sort(), [0, 1]);
});

test('partial creation failures remain generic and close both pools without destructive retry', async () => {
  const f = fake({ destinationFailure: true });
  await assert.rejects(prepareBrowserDatabase(context, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
  assert.deepEqual(f.ended.sort(), [0, 1]);
  assert.equal(f.queries.some(q => /DROP|TRUNCATE/i.test(q.sql)), false);
});

test('pool cleanup errors cannot leak connection details or return a success', async () => {
  const f = fake({ closeFailure: true });
  await assert.rejects(prepareBrowserDatabase(context, f), { message: 'BROWSER_DATABASE_ISOLATION_FAILED' });
  assert.deepEqual(f.ended.sort(), [0, 1]);
});
