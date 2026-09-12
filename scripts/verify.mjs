import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const steps = [
  ['guard', ['scripts/guard.mjs']],
  ['refinement', ['scripts/refinement-check.mjs', 'harness/templates/refinement.template.json']],
  ['harness', ['--test', 'tests/harness/*.test.mjs']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--max-warnings=0']],
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run']],
  ['build', ['scripts/run-next.mjs', 'build']],
  ['browser', ['scripts/e2e.mjs']]
];
const report = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, results: [] };
mkdirSync('artifacts', { recursive: true });
for (const [name, args] of steps) {
  console.log(`\nHestia — ${name}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  report.results.push({ name, exitCode: result.status ?? 1, durationMs: Date.now() - start });
  writeFileSync('artifacts/verification.json', `${JSON.stringify(report, null, 2)}\n`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const evidence = spawnSync(process.execPath, ['scripts/evidence.mjs'], { stdio: 'inherit' });
if (evidence.status !== 0) process.exit(evidence.status ?? 1);
console.log('\nContrôles locaux terminés. Aucune validation distante ni autorisation Production.');
