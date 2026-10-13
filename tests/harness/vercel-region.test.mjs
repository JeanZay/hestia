import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertFrankfurtConfig, assertVercelDeployment, projectVercelConfig } from '../../scripts/lib/vercel-region.mjs';

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const buildCommand = 'node scripts/guard.mjs && npm run build';
const overrides = { buildCommand };
const configPath = 'vercel.operator.json';
const args = ['deploy', 'source', '--local-config', 'vercel.operator.json', '--target', 'preview'];
const check = (deploymentConfig, extra = {}) => assertVercelDeployment({ sourceConfig: config, deploymentConfig, overrides, configPath, args, ...extra });

test('versioned configuration pins Frankfurt and preserves the maintenance schedule', () => {
  assert.deepEqual(config, { regions: ['fra1'], crons: [{ path: '/api/hestia/maintenance', schedule: '0 3 * * *' }] });
  assert.doesNotThrow(() => assertFrankfurtConfig(config));
});

test('operator projection retains all versioned properties and the exact build guard', () => {
  const source = { ...config, headers: [{ source: '/example', headers: [{ key: 'X-Test', value: 'synthetic' }] }], functions: { 'api/test.ts': { maxDuration: 30 } } };
  const projected = projectVercelConfig(source, overrides);
  assert.deepEqual(projected, { ...source, buildCommand });
  assert.doesNotThrow(() => assertVercelDeployment({ sourceConfig: source, deploymentConfig: JSON.parse(JSON.stringify(projected)), overrides, configPath, args }));
});

test('projection owns its nested data and accepts frozen inputs without mutating them', () => {
  const source = Object.freeze({ regions: Object.freeze(['fra1']), crons: Object.freeze([Object.freeze({ path: '/example', schedule: '0 3 * * *' })]) });
  const options = Object.freeze({ crons: Object.freeze([]), buildCommand });
  const projected = projectVercelConfig(source, options);
  projected.regions.push('iad1'); projected.crons.push({ path: '/other', schedule: '0 4 * * *' });
  assert.deepEqual(source.regions, ['fra1']);
  assert.deepEqual(options.crons, []);
  assert.equal(source.crons[0].path, '/example');
});

test('explicit operator cron choice is retained and is checked before launch', () => {
  const choices = { buildCommand, crons: [] };
  const projected = projectVercelConfig(config, choices);
  assert.deepEqual(projected.crons, []);
  assert.doesNotThrow(() => check(projected, { overrides: choices }));
  assert.throws(() => check(projected), /PROJECTION_DRIFT/);
});

test('missing, foreign or multiple regions cannot fall back to project defaults', () => {
  for (const regions of [undefined, [], ['iad1'], ['fra1', 'iad1'], 'fra1']) {
    assert.throws(() => projectVercelConfig({ ...config, regions }), /FRANKFURT_REQUIRED/);
    assert.throws(() => check({ ...projectVercelConfig(config, overrides), regions }), /FRANKFURT_REQUIRED/);
  }
});

test('per-function and failover overrides cannot silently move work elsewhere', () => {
  for (const additional of [
    { functions: { 'api/test.ts': { regions: ['iad1'] } } },
    { functions: { 'api/test.ts': { functionFailoverRegions: ['iad1'] } } },
    { functionFailoverRegions: ['iad1'] },
    { functions: null }, { functions: { 'api/test.ts': null } },
  ]) assert.throws(() => projectVercelConfig({ ...config, ...additional }));
  assert.doesNotThrow(() => projectVercelConfig({ ...config, functions: { 'api/test.ts': { regions: ['fra1'] } } }));
});

test('a legacy stripped projection or a changed build/cron is refused before launch', () => {
  const projected = projectVercelConfig(config, overrides);
  for (const changed of [{ buildCommand }, { ...projected, buildCommand: 'npm run build' }, { ...projected, crons: [] }, { ...projected, trailingSlash: true }]) {
    assert.throws(() => check(changed));
  }
});

test('actual CLI overrides cannot contradict the projection or use unqualified prebuilt output', () => {
  const projected = projectVercelConfig(config, overrides);
  for (const flags of [['--regions', 'fra1'], ['--regions=fra1']]) assert.doesNotThrow(() => check(projected, { args: [...args, ...flags] }));
  for (const flags of [['--regions'], ['--regions', 'iad1'], ['--regions=iad1'], ['--regions', 'fra1,iad1'], ['-r', 'iad1'], ['--regions', 'fra1', '--regions', 'iad1'], ['--prebuilt'], ['--prebuilt=true']]) {
    assert.throws(() => check(projected, { args: [...args, ...flags] }));
  }
  assert.throws(() => check(projected, { args: undefined }), /ARGV_REQUIRED/);
});

test('invalid operator choices cannot silently drop or overwrite controls', () => {
  for (const choices of [null, { regions: ['iad1'] }, { buildCommand: '' }, { buildCommand: 'x'.repeat(257) }, { buildCommand: undefined }, { crons: null }, { crons: [{}] }]) {
    assert.throws(() => projectVercelConfig(config, choices));
  }
  assert.throws(() => projectVercelConfig({ ...config, missing: undefined }), /JSON_CONFIG_REQUIRED/);
});

test('the admitted config path must be the unique actual CLI local configuration', () => {
  const projected = projectVercelConfig(config, overrides);
  for (const extra of [{ args: ['deploy', 'source'] }, { configPath: undefined }, { configPath: 'other.json' },
    ...[['--local-config', 'other.json'], ['--local-config=other.json'], ['-A', 'other.json'], ['-Aother.json']].map(flags => ({ args: [...args, ...flags] }))]) {
    assert.throws(() => check(projected, extra));
  }
});
