import { spawnSync } from 'node:child_process';
import { beginRun, captureCandidate, writeLatest, writeRunJson } from './verification-evidence.mjs';

/** Injectable execution is for deterministic harness tests; the CLI supplies the fixed suite. */
export function runVerification({ root, steps, checkpoint = null, inputPaths = () => [], env = process.env, run: suppliedRun = null, execute = args => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...env, NEXT_TELEMETRY_DISABLED: '1' } }) }) {
  const run = suppliedRun ?? beginRun(root, 'verification', env);
  const report = {
    schemaVersion: 2, runId: run.runId, startedAt: run.startedAt, completedAt: null, ciContext: run.ciContext,
    node: process.version, platform: process.platform, status: 'FAIL',
    activeCheckpoint: { path: checkpoint, status: checkpoint ? 'PENDING' : 'NOT_PERFORMED', reason: checkpoint ? null : 'no-checkpoint-provided' },
    candidate: { status: 'UNAVAILABLE', before: null, after: null },
    results: steps.map(step => ({ name: step.name, required: step.required !== false, status: 'NOT_PERFORMED', exitCode: null, durationMs: 0, reason: step.skipReason ?? 'earlier-step-not-completed' })),
    errors: [],
    limits: ['Contrôles synthétiques locaux ; aucune revue indépendante, permission, preuve Dev ou GO Production.', 'Identité observée avant et après les contrôles ; aucune garantie contre une modification transitoire restaurée entre ces observations.'],
  };
  if (!checkpoint) report.limits.push('Aucun checkpoint actif fourni : les dossiers locaux ignorés ne sont pas validés. Le template vérifie seulement un exemple synthétique.');
  const capture = phase => {
    try {
      const manifest = captureCandidate({ root, runId: run.runId, phase, inputPaths: inputPaths() });
      const reference = writeRunJson(run, `source-${phase}.json`, manifest);
      report.candidate[phase] = { ...reference, sourceDigest: manifest.sourceDigest, identityDigest: manifest.identityDigest };
      return manifest;
    } catch { report.errors.push(`candidate-${phase}-unavailable`); return null; }
  };
  const before = capture('before');
  if (before) {
    for (const [index, step] of steps.entries()) {
      if (step.skipReason) continue;
      console.log(`\nHestia — ${step.name}`);
      const started = Date.now();
      let result;
      try { result = execute(step.args); }
      catch { result = { status: 1, error: true }; }
      const exitCode = Number.isInteger(result?.status) ? result.status : 1;
      report.results[index] = { name: step.name, required: step.required !== false, status: exitCode === 0 && !result.error ? 'PASS' : 'FAIL', exitCode: exitCode === 0 && result.error ? 1 : exitCode, durationMs: Date.now() - started, reason: result.error ? 'process-unavailable' : result.signal ? 'process-interrupted' : null };
      if (step.name === 'lifecycle-active') report.activeCheckpoint.status = report.results[index].status;
      if (report.results[index].status !== 'PASS') break;
    }
  }
  const after = capture('after');
  report.candidate.status = !before || !after ? 'UNAVAILABLE' : before.identityDigest === after.identityDigest ? 'UNCHANGED' : 'CHANGED';
  if (report.candidate.status === 'CHANGED') report.errors.push('candidate-changed-during-verification');
  if (report.activeCheckpoint.status === 'PENDING') report.activeCheckpoint.status = 'NOT_PERFORMED';
  report.status = report.candidate.status === 'UNCHANGED' && report.errors.length === 0 && report.results.every(step => step.status === 'PASS' || (!step.required && step.status === 'NOT_PERFORMED')) ? 'PASS' : 'FAIL';
  report.completedAt = new Date().toISOString();
  const reference = writeRunJson(run, 'verification.json', report);
  writeLatest(run, reference);
  return { report, reference, exitCode: report.status === 'PASS' ? 0 : 1 };
}
