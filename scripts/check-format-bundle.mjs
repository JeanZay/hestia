import { fork, spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const tracePaths = [
  'uploads/[id]/complete', 'capture/[id]/prepare',
  'capture/[id]/content', 'capture/[id]/pages/[pageId]/complete',
].map(route => join(root, '.next/server/app/api/hestia', route, 'route.js.nft.json'));
const formats = [
  ['png', 'image/png', true], ['jpg', 'image/jpeg', true],
  ['webp', 'image/webp', true], ['pdf', 'application/pdf', true],
  ['heic', 'image/heic', false],
];
function inside(parent, child) {
  const path = relative(parent, child);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function renderProbe(sandbox, hook) {
  const source = readFileSync(join(root, 'tests/fixtures/documents/synthetic.png'));
  const pages = ['first', 'second'].map(id => ({ id, version: 1, mediaType: 'image/png', size: source.length,
    sha256: '', width: 0, height: 0, rotation: 90, crop: { t: 5, r: 10, b: 5, l: 10 } }));
  return new Promise(resolveResult => {
    const child = fork(join(sandbox, 'src/server/capture/render-worker.mjs'), [], {
      cwd: sandbox, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      execArgv: ['--no-global-search-paths', '--max-old-space-size=256', '--import', pathToFileURL(hook).href],
      env: { NODE_ENV: 'production', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    let result; let errorCode = null; let reads = 0;
    const timer = setTimeout(() => { errorCode = 'TIMEOUT'; child.kill(); }, 95_000);
    child.on('error', error => { errorCode = error.code ?? 'PROCESS_ERROR'; });
    child.on('message', message => {
      if (typeof message?.read === 'string' && message.read === pages[reads]?.id) { reads++; child.send({ bytes: source }, error => { if (error) { errorCode = 'IPC_ERROR'; child.kill(); } }); }
      else if (message?.result) result = message.result;
      else { errorCode = 'INVALID_PROTOCOL'; child.kill(); }
    });
    child.on('close', code => {
      clearTimeout(timer);
      const bytes = result?.bytes;
      const passed = !errorCode && code === 0 && reads === 2 && bytes instanceof Uint8Array
        && bytes.length > 0 && bytes.length <= 20 * 1024 * 1024
        && Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-'
        && result.mediaType === 'application/pdf' && result.pageCount === 2;
      resolveResult({ status: passed ? 'PASS' : 'FAIL', exitCode: code, errorCode,
        ...(passed ? { bytes: bytes.length, pages: result.pageCount, peakRssKiB: result.peakRssKiB } : {}) });
    });
    child.send({ pages, format: 'pdf', inspect: false }, error => { if (error) { errorCode = 'IPC_ERROR'; child.kill(); } });
  });
}

async function checkTrace(tracePath) {
 let sandbox;
 try {
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  if (trace.version !== 1 || !Array.isArray(trace.files) || !trace.files.length) {
    throw new Error('Invalid function NFT trace; run npm run build first.');
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
  if (tracePath !== tracePaths[0]) results.push({ mediaType: 'capture/multipage-pdf', ...await renderProbe(sandbox, hook) });
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
}
for (const tracePath of tracePaths) await checkTrace(tracePath);
