import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClosure } from './lib/closure-runner.mjs';

export function main(args = process.argv.slice(2), cwd = process.cwd(), write = value => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  try {
    const command = args[0];
    if (!['status', 'check', 'start', 'finish', 'merge', 'cleanup'].includes(command)) throw new Error('usage');
    const options = { root: cwd, action: command === 'check' ? 'verify' : command, apply: false };
    const flags = new Set();
    for (let index = 1; index < args.length; index++) {
      const flag = args[index];
      if (flags.has(flag)) throw new Error('usage');
      flags.add(flag);
      if (flag === '--apply') { options.apply = true; continue; }
      const names = { '--action': 'action', '--root': 'root', '--lot': 'lotId', '--branch': 'branch', '--target': 'target', '--reservation': 'reservation' };
      if (!names[flag] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('usage');
      options[names[flag]] = args[++index];
    }
    if ((command !== 'check' && flags.has('--action')) || (['check', 'status'].includes(command) && options.apply)) throw new Error('usage');
    options.root = path.resolve(cwd, options.root);
    const result = runClosure(options);
    write(result);
    return result.valid ? 0 : 1;
  } catch (error) {
    const code = /^[a-z][a-z0-9-]+$/.test(error.message) ? error.message : 'closure-input-or-state-unavailable';
    write({ valid: false, applied: false, status: 'BLOCKED', code, usage: 'closure.mjs status | check --action verify|start|finish|merge|cleanup | start|finish|merge|cleanup --lot <id> [--apply] ; start requires --branch --target --reservation' });
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
