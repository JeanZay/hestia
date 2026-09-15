import { appendFileSync } from 'node:fs';
import { readVerificationRun } from './lib/verification-evidence.mjs';

// Summary output never joins a current failure with an unrelated historical manifest.
const lines = ['## Hestia — contrôles synthétiques', ''];
try {
  let closureState = null;
  try { const { closureInputs } = await import('./lib/closure-state.mjs'); closureState = () => closureInputs(process.cwd()); }
  catch { /* A report with closure evidence fails closed when its reader is unavailable. */ }
  const { report, manifests } = readVerificationRun(process.cwd(), process.env, { closureState });
  lines.push(`Exécution : ${report.runId}. Résultat : ${report.status}.`, `Démarrage : ${report.startedAt}. Fin : ${report.completedAt}. Node : ${report.node}. Plateforme : ${report.platform}.`, '', '| Étape | Résultat |', '| --- | --- |');
  for (const step of report.results) lines.push(`| ${step.name} | ${step.status}${step.reason ? ` (${step.reason})` : ''} |`);
  lines.push('', `Stabilité du candidat : ${report.candidate.status}.`);
  if (report.closure) lines.push(`Stabilité de l'état de clôture partagé : ${report.closure.status}.`);
  if (manifests.after) lines.push(`Candidat après contrôles SHA-256 : \`${manifests.after.sourceDigest}\`. Commit : \`${manifests.after.commit}\`.`);
  for (const limit of report.limits) lines.push('', limit);
} catch {
  lines.push('Aucune preuve de vérification courante et cohérente disponible : rapport absent, incomplet, modifié, candidat ou dossier actif changé, ou autre exécution. Consulter la première étape en échec.');
  process.exitCode = 1;
}
lines.push('', 'Aucun déploiement ni GO Production.', '');
const summary = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
else process.stdout.write(summary);
