import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCatalog, beginAttempt, catalogReport, decide, finishCampaign, promote, propose, readRecipeInput, recordAttempt, reportCampaign, startCampaign } from './lib/browser-recipe.mjs';
import { checkRecipeDelivery } from './lib/browser-recipe-delivery.mjs';

export function main(args = process.argv.slice(2), cwd = process.cwd(), write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  try {
    const words = []; const options = {};
    for (let i = 0; i < args.length; i += 1) {
      if (args[i].startsWith('--')) { const key = args[i].slice(2); if (!['root', 'input'].includes(key) || options[key] || !args[i + 1]) throw new Error('invalid-options'); options[key] = args[++i]; }
      else words.push(args[i]);
    }
    const root = path.resolve(cwd, options.root ?? '.'); const command = words.join(' ');
    let result;
    if (['audit', 'catalog check'].includes(command)) { const audit = auditCatalog({ root }); result = { status: audit.status, count: audit.scenarios.length, themes: audit.themes, limitations: audit.limitations }; }
    else if (command === 'catalog list') result = catalogReport({ root, ...(options.input ? readRecipeInput(root, options.input) : {}) });
    else if (command === 'delivery check') {
      result = checkRecipeDelivery({ root, inputPath: options.input });
      write(result); return result.state === 'BLOCKED' ? 1 : 0;
    }
    else if (command === 'propose') result = propose({ root, input: options.input });
    else {
      const operations = { decision: decide, promote, 'campaigns start': startCampaign, 'campaigns begin-attempt': beginAttempt, 'campaigns record': recordAttempt, 'campaigns finish': finishCampaign };
      if (command === 'campaigns report') result = reportCampaign({ root, ...readRecipeInput(root, options.input) });
      else { if (!operations[command]) throw new Error('unknown-command'); result = operations[command]({ root, input: readRecipeInput(root, options.input) }); }
    }
    write(result); return 0;
  } catch (error) {
    // Never echo a parser error, an input value, a filename or a Git diagnostic.
    const code = /^[a-z][a-z0-9-]{1,80}$/.test(error.message) ? error.message : 'browser-recipe-operation-failed';
    write({ status: 'FAIL', code }); return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
