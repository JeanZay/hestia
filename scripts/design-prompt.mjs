import { pathToFileURL } from 'node:url';
import { auditCatalog, checkDossier, inspectDossier, refreshSources } from './lib/design-prompt.mjs';

export async function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  const expected = { refresh: ['--root', '--out'], inspect: ['--root', '--dossier'], check: ['--root', '--dossier'], audit: ['--root'] }[action];
  try {
    if (!expected || rest.length % 2) throw new Error('usage: refresh --out <new-artifacts-directory> | inspect --dossier <file> | check --dossier <file> | audit [--root <directory>]');
    const options = {};
    for (let index = 0; index < rest.length; index += 2) {
      const key = rest[index];
      if (!expected.includes(key) || Object.hasOwn(options, key.slice(2)) || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error('invalid-or-duplicate-option');
      options[key.slice(2)] = rest[index + 1];
    }
    if ((action === 'refresh' && !options.out) || (['inspect', 'check'].includes(action) && !options.dossier)) throw new Error('required-option-missing');
    const result = await ({ refresh: refreshSources, inspect: inspectDossier, check: checkDossier, audit: auditCatalog }[action])(options);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    const code = /^[a-z][a-z0-9:-]{2,100}$/.test(error.code ?? '') ? error.code : /^[a-z][a-z0-9-]{2,100}$/.test(error.message ?? '') ? error.message : 'design-prompt-check-failed';
    console.log(JSON.stringify({ status: 'BLOCKED', action: action ?? null, handoffAllowed: false, remoteStateVerified: false, errors: [code] }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
