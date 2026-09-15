import { beginRun, captureCandidate, writeLatest, writeRunJson } from './lib/verification-evidence.mjs';

// Standalone snapshots have their own namespace and can never become verification evidence.
try {
  if (process.argv.length !== 2) throw new Error('unsupported-arguments');
  const run = beginRun(process.cwd(), 'evidence');
  const manifest = captureCandidate({ root: process.cwd(), runId: run.runId, phase: 'snapshot' });
  const reference = writeRunJson(run, 'source-manifest.json', manifest);
  writeLatest(run, reference);
  console.log(`Source SHA-256: ${manifest.sourceDigest} (${manifest.files.length} files)`);
  console.log(`Preuve figée : ${reference.path}. Aucun contrôle exécuté par ce snapshot.`);
} catch {
  console.error('Snapshot indisponible : entrée, dépôt ou sortie non vérifiable. Aucune preuve PASS.');
  process.exitCode = 1;
}
