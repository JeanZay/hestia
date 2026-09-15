import path from 'node:path';
import { lstatSync } from 'node:fs';
import { beginRun, containedPath } from './lib/verification-evidence.mjs';

const root = process.cwd();
const argumentsList = process.argv.slice(2);
let invalidArguments = false;
let checkpoint = null;
if (argumentsList.length) {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--checkpoint' || !argumentsList[1]) invalidArguments = true;
  else checkpoint = path.relative(root, path.resolve(root, argumentsList[1])).split(path.sep).join('/');
  if (checkpoint === '') invalidArguments = true;
} else {
  try { lstatSync(path.join(root, 'artifacts/active-work.json')); checkpoint = 'artifacts/active-work.json'; }
  catch (error) { if (error.code !== 'ENOENT') invalidArguments = true; }
}
const steps = [
  ['guard', ['scripts/guard.mjs']],
  ['refinement', ['scripts/refinement-check.mjs', 'harness/templates/refinement.template.json']],
  ['lifecycle-template', ['scripts/lifecycle-check.mjs', '--checkpoint', 'harness/templates/lifecycle.template.json', '--root', root, '--action', 'resume']],
  ['lifecycle-active', checkpoint ? ['scripts/lifecycle-check.mjs', '--checkpoint', checkpoint, '--root', root, '--action', 'resume'] : []],
  ['harness', ['--test', 'tests/harness/*.test.mjs']],
  ['closure', ['scripts/closure.mjs', 'check', '--action', 'verify']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--max-warnings=0']],
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['unit', ['node_modules/vitest/vitest.mjs', 'run']],
  ['build', ['scripts/run-next.mjs', 'build']],
  ['browser', ['scripts/e2e.mjs']]
].map(([name, args]) => ({ name, args, ...(name === 'lifecycle-active' && !checkpoint ? { required: false, skipReason: 'no-checkpoint-provided' } : {}) }));
try {
  // Record this invocation before loading mutable validators or the runner.
  // Entry-point/bootstrap syntax failures are additionally caught by summary freshness checks.
  const run = beginRun(root, 'verification');
  const { readJsonSafe } = await import('./refinement-check.mjs');
  const { runVerification } = await import('./lib/verification-run.mjs');
  const { closureInputs } = await import('./lib/closure-state.mjs');
  const closureState = () => closureInputs(root);
  if (process.env.GITHUB_ACTIONS === 'true' && !closureState().present) {
    Object.assign(steps.find(step => step.name === 'closure'), { required: false, skipReason: 'clone-registry-absent-in-ci' });
  }
  let referencedFiles = null;
  if (checkpoint) {
    try { ({ referencedFiles } = await import('./lifecycle-check.mjs')); }
    catch { /* Recorded as unavailable candidate inputs in this run. */ }
  }
  const result = runVerification({
    root, steps, checkpoint, run, closureState,
    inputPaths: () => {
      if (invalidArguments) throw new Error('usage: verify.mjs [--checkpoint path]');
      if (!checkpoint) return [];
      if (!referencedFiles) throw new Error('checkpoint-reader-unavailable');
      const active = readJsonSafe(containedPath(root, checkpoint));
      return [checkpoint, ...referencedFiles(active)];
    },
  });
  console.log(`\nContrôles locaux : ${result.report.status}. Preuve figée : ${result.reference.path}.`);
  console.log('Aucune validation distante ni autorisation Production.');
  process.exitCode = result.exitCode;
} catch {
  console.error('Vérification interrompue : preuves indisponibles ou impossibles à conserver. Aucun PASS.');
  process.exitCode = 1;
}
