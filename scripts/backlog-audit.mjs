import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBacklog, collectBacklog } from './lib/backlog-audit.mjs';

export function main(args = process.argv.slice(2), { command, write = value => process.stdout.write(`${JSON.stringify(value)}\n`) } = {}) {
  try {
    const flags = new Map();
    for (let index = 0; index < args.length; index += 2) {
      if (!['--repo', '--project', '--owner'].includes(args[index]) || flags.has(args[index]) || !args[index + 1]) throw new Error('usage');
      flags.set(args[index], args[index + 1]);
    }
    const result = auditBacklog(collectBacklog({ repository: flags.get('--repo'), project: Number(flags.get('--project')), owner: flags.get('--owner'), command }));
    write(result);
    return result.findings.length ? 1 : 0;
  } catch {
    // Never echo gh errors, stdout or supplied values: public metadata only.
    write({ schemaVersion: 1, status: 'UNAVAILABLE', readOnly: true,
      reason: 'Lecture inaccessible, entrée invalide ou inventaire incomplet ; aucun audit réussi.',
      usage: 'node scripts/backlog-audit.mjs --repo OWNER/REPO --project NUMBER --owner OWNER' });
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
