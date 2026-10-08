import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { containedPath } from './verification-evidence.mjs';

/** Git metadata only: no closure/impact import and no remote command. */
export function discoverRecipeRepository(root) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  const git = (cwd, args) => execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', '-c', 'core.fsmonitor=false', ...args], { cwd, env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const currentRoot = git(root, ['rev-parse', '--show-toplevel']);
    const primaryRoot = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0')[0].slice(9);
    const common = (cwd) => realpathSync.native(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    if (common(currentRoot) !== common(primaryRoot)) throw new Error();
    // containedPath checks every ancestor, including both checkout roots.
    containedPath(currentRoot, '.git');
    containedPath(primaryRoot, '.git');
    return { currentRoot, primaryRoot, sharedDir: path.join(primaryRoot, 'artifacts/functional-browser') };
  } catch { throw new Error('browser-recipe-repository-unavailable'); }
}
