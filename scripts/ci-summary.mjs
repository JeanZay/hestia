import { appendFileSync, existsSync, readFileSync } from 'node:fs';

// Plain job summaries/logs avoid persistent artifact or Actions cache storage.
// The gate's status remains authoritative; absent evidence is never called PASS.
const lines = ['## Hestia — contrôles synthétiques', ''];
if (existsSync('artifacts/verification.json')) {
  const report = JSON.parse(readFileSync('artifacts/verification.json', 'utf8'));
  lines.push(`Démarrage : ${report.startedAt}. Node : ${report.node}. Plateforme : ${report.platform}.`, '', '| Étape | Résultat |', '| --- | --- |');
  for (const step of report.results) lines.push(`| ${step.name} | ${step.exitCode === 0 ? 'PASS' : 'FAIL'} |`);
} else {
  lines.push('Aucun rapport de vérification produit. Consulter la première étape en échec.');
}
if (existsSync('artifacts/source-manifest.json')) {
  const manifest = JSON.parse(readFileSync('artifacts/source-manifest.json', 'utf8'));
  lines.push('', `Candidat SHA-256 : \`${manifest.sourceDigest}\`. Commit : \`${manifest.commit}\`.`);
}
lines.push('', 'Preuves locales et CI uniquement. Aucun déploiement ni GO Production.', '');
const summary = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
else process.stdout.write(summary);
