import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const tracePath = join(root, '.next/server/app/api/hestia/uploads/[id]/complete/route.js.nft.json');
const formats = [
  ['png', 'image/png', true], ['jpg', 'image/jpeg', true],
  ['webp', 'image/webp', true], ['pdf', 'application/pdf', true],
  ['heic', 'image/heic', false],
];
function inside(parent, child) {
  const path = relative(parent, child);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

let sandbox;
try {
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  if (trace.version !== 1 || !Array.isArray(trace.files) || !trace.files.length) {
    throw new Error('Invalid upload-complete NFT trace; run npm run build first.');
  }
  const temporaryRoot = realpathSync(tmpdir());
  if (inside(root, temporaryRoot)) throw new Error('Temporary directory must be outside the checkout.');
  sandbox = realpathSync(mkdtempSync(join(temporaryRoot, 'hestia-format-bundle-')));
  // Materialize this function's trace only. The standalone server's wider trace
  // would hide missing decoder dependencies, as it did before this check.
  for (const file of trace.files) {
    const source = resolve(dirname(tracePath), file);
    if (!inside(root, source) || !inside(root, realpathSync(source))) {
      throw new Error('NFT source escapes the checkout.');
    }
    const target = join(sandbox, relative(root, source));
    mkdirSync(dirname(target), { recursive: true });
    if (lstatSync(source).isSymbolicLink()) {
      const linkTarget = join(sandbox, relative(root, realpathSync(source)));
      symlinkSync(process.platform === 'win32' ? linkTarget : relative(dirname(target), linkTarget), target,
        process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      copyFileSync(source, target);
    }
  }
  // Also forbid an ancestor/global node_modules from making an incomplete
  // package pass. This hook applies to ESM and CommonJS resolution in Node 24.
  const hook = join(sandbox, 'bundle-boundary.mjs');
  writeFileSync(hook, `
import { registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith('file:')) {
    const path = relative(root, realpathSync(fileURLToPath(result.url)));
    if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) {
      throw new Error('Module resolution escaped the isolated function package.');
    }
  }
  return result;
} });
`);
  const worker = join(sandbox, 'src/server/formats/validate-worker.mjs');
  const results = [];
  for (const [extension, mediaType, previewSupported] of formats) {
    const child = spawnSync(process.execPath, [
      '--no-global-search-paths', '--max-old-space-size=256', '--import', pathToFileURL(hook).href, worker, mediaType,
    ], {
      cwd: sandbox,
      env: { NODE_ENV: 'production', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      input: readFileSync(join(root, `tests/fixtures/documents/synthetic.${extension}`)),
      timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true,
    });
    let result;
    try { result = JSON.parse(child.stdout?.toString() ?? ''); } catch { /* Report the bounded status below. */ }
    const passed = !child.error && child.status === 0 && result?.mediaType === mediaType
      && result?.previewSupported === previewSupported;
    results.push({ mediaType, status: passed ? 'PASS' : 'FAIL', exitCode: child.status, errorCode: child.error?.code ?? null });
  }
  console.log(JSON.stringify({ trace: relative(root, tracePath), files: trace.files.length, isolated: true, results }));
  if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
} catch (error) {
  console.error(`Format bundle check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Only this invocation's freshly created, resolved temporary directory.
  if (sandbox && inside(realpathSync(tmpdir()), sandbox) && !inside(root, sandbox)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
