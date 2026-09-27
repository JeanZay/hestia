// Read-only pre-install audit of the exact spike lock, not a security certification.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url)));
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'];
const entries = Object.entries(lock.packages).filter(([name]) => name);
const results = [];
for (let i = 0; i < entries.length; i += 6) {
  results.push(...await Promise.all(entries.slice(i, i + 6).map(async ([path, entry]) => {
    const name = path.split('node_modules/').at(-1);
    if (!entry.resolved?.startsWith('https://registry.npmjs.org/') || !entry.integrity?.startsWith('sha512-')) throw Error('Unapproved source or integrity');
    const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw Error(`Registry HTTP ${response.status}`);
    const compressed = Buffer.from(await response.arrayBuffer());
    if (compressed.length > 20000000 || 'sha512-' + createHash('sha512').update(compressed).digest('base64') !== entry.integrity) throw Error('Archive integrity or size');
    const tar = gunzipSync(compressed, { maxOutputLength: 128000000 });
    const files = [];
    let pkg;
    for (let offset = 0; offset + 512 <= tar.length;) {
      const block = tar.subarray(offset, offset + 512);
      if (block.every(b => b === 0)) break;
      const string = (start, length) => block.subarray(start, start + length).toString().replace(/\0.*$/s, '');
      const prefix = string(345, 155), leaf = string(0, 100);
      const file = prefix ? prefix + '/' + leaf : leaf;
      const size = Number.parseInt(string(124, 12).trim(), 8) || 0;
      const type = string(156, 1);
      if (!file.startsWith('package/') || file.includes('\\') || file.split('/').includes('..') || /[:\x00-\x1f]/.test(file) || !['', '0', '5'].includes(type) || size > 20000000 || offset + 512 + size > tar.length) throw Error(`Unsafe archive ${name}`);
      const bytes = tar.subarray(offset + 512, offset + 512 + size);
      if (file === 'package/package.json') pkg = JSON.parse(bytes);
      files.push({ path: file, size, sha256: createHash('sha256').update(bytes).digest('hex'), license: /(?:^|\/)(?:license|licence|copying|notice)(?:\.|$)/i.test(file), licenseHeader: /(?:^|\/)(?:license|licence|copying|notice)(?:\.|$)/i.test(file) ? bytes.toString('utf8').slice(0, 160) : undefined });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (!pkg || pkg.name !== name || pkg.version !== entry.version) throw Error('Archive identity');
    const scripts = Object.fromEntries(lifecycle.filter(key => pkg.scripts?.[key]).map(key => [key, pkg.scripts[key]]));
    return { name, version: entry.version, integrityVerified: true, packageLicense: pkg.license, lockLicense: entry.license, engines: pkg.engines ?? {}, lifecycleScripts: scripts, scripts: pkg.scripts ?? {}, fileCount: files.length, unpackedBytes: files.reduce((sum, f) => sum + f.size, 0), licenses: files.filter(f => f.license) };
  })));
}
console.log(JSON.stringify({ at: new Date().toISOString(), lockSha256: createHash('sha256').update(readFileSync(new URL('./package-lock.json', import.meta.url))).digest('hex'), packageCount: results.length, results, limits: ['Integrity against npm lock, not a verified publisher signature.', 'Archive inventory and scripts/licenses inspection, not source security audit.', 'No files extracted, package installed or lifecycle script run.'] }, null, 2));
