import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const EXCEPTION = Object.freeze({
  advisory: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  expiresAt: '2026-11-03T00:00:00.000Z',
  chain: [
    ['eslint-config-next', '16.3.8', '16.3.8'],
    ['@next/eslint-plugin-next', '16.3.8', '3.3.1'],
    ['fast-glob', '3.3.1', '^4.0.4'],
    ['micromatch', '4.0.8', '^3.0.3'],
    ['braces', '3.0.3', null],
  ],
});
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

function readReport(run, label) {
  requireCondition(record(run) && !run.error && !run.signal && [0, 1].includes(run.status), `${label}: execution failed`);
  let report;
  try { report = typeof run.stdout === 'string' ? JSON.parse(run.stdout) : run.stdout; }
  catch { throw new Error(`${label}: invalid JSON`); }
  requireCondition(record(report) && !report.error && report.auditReportVersion === 2 && record(report.vulnerabilities)
    && record(report.metadata?.vulnerabilities), `${label}: invalid audit report`);
  const counts = report.metadata.vulnerabilities;
  const actual = Object.fromEntries(severities.map(severity => [severity, 0]));
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    requireCondition(record(item) && item.name === name && severities.includes(item.severity)
      && Array.isArray(item.via) && item.via.length > 0 && Array.isArray(item.effects)
      && Array.isArray(item.nodes) && item.nodes.length > 0, `${label}: malformed vulnerability`);
    actual[item.severity]++;
  }
  for (const severity of severities) requireCondition(Number.isSafeInteger(counts[severity]) && counts[severity] === actual[severity], `${label}: inconsistent counts`);
  requireCondition(counts.total === Object.values(actual).reduce((sum, count) => sum + count, 0), `${label}: inconsistent total`);
  const expectedExit = counts.high + counts.critical > 0 ? 1 : 0;
  requireCondition(run.status === expectedExit, `${label}: unexpected audit exit code`);
  return report;
}

export function evaluateAudits({ full, production, lock, installed, now = new Date() }) {
  const result = {
    status: 'BLOCKED', technicalGatePassed: false, publicationAuthorized: false,
    exception: null, rawCounts: { full: null, production: null }, diagnostics: [],
  };
  try {
    const fullReport = readReport(full, 'full');
    result.rawCounts.full = fullReport.metadata.vulnerabilities;
    const productionReport = readReport(production, 'production');
    result.rawCounts.production = productionReport.metadata.vulnerabilities;
    requireCondition(productionReport.metadata.vulnerabilities.total === 0, 'Production audit must contain no alert');
    const high = Object.entries(fullReport.vulnerabilities).filter(([, item]) => ['high', 'critical'].includes(item.severity));
    if (high.length === 0) {
      result.status = 'PASS';
      result.technicalGatePassed = true;
      return result;
    }
    const instant = new Date(now).getTime();
    requireCondition(Number.isFinite(instant) && instant < Date.parse(EXCEPTION.expiresAt), 'Development exception expired');
    requireCondition(record(lock?.packages) && lock.lockfileVersion === 3, 'Lockfile v3 required');
    requireCondition(record(installed), 'Installed package versions required');
    const names = EXCEPTION.chain.map(([name]) => name);
    requireCondition(same(high.map(([name]) => name).sort(), [...names].sort()), 'Unexpected high/critical dependency');
    requireCondition(same(Object.keys(fullReport.vulnerabilities).sort(), [...names].sort()), 'Exception requires exactly one advisory chain');
    const root = lock.packages[''];
    requireCondition(root?.devDependencies?.['eslint-config-next'] === '16.3.8', 'Expected exact development root dependency');
    for (let index = 0; index < EXCEPTION.chain.length; index++) {
      const [name, version, edge] = EXCEPTION.chain[index];
      const node = `node_modules/${name}`;
      const entry = lock.packages[node];
      requireCondition(entry?.dev === true && entry.version === version && installed[name] === version, `Version or development scope drift: ${name}`);
      requireCondition(!root.dependencies?.[name] && !root.optionalDependencies?.[name], `Production dependency: ${name}`);
      const copies = Object.keys(lock.packages).filter(key => key === node || key.endsWith(`/${node}`));
      requireCondition(same(copies, [node]), `Unexpected lockfile node: ${name}`);
      const consumers = Object.entries(lock.packages).filter(([, value]) => value.dependencies?.[name]
        || value.optionalDependencies?.[name]).map(([key]) => key);
      requireCondition(same(consumers, index === 0 ? [] : [`node_modules/${names[index - 1]}`]), `Unexpected lockfile consumer: ${name}`);
      const item = fullReport.vulnerabilities[name];
      requireCondition(item.severity === 'high' && item.isDirect === (index === 0) && same(item.nodes, [node]), `Audit scope drift: ${name}`);
      requireCondition(same(item.effects, index === 0 ? [] : [names[index - 1]]), `Unexpected advisory effects: ${name}`);
      requireCondition(same(item.fixAvailable, { name: 'eslint-config-next', version: '14.2.35', isSemVerMajor: true }), `Remediation metadata changed: ${name}`);
      if (index < names.length - 1) {
        requireCondition(entry.dependencies?.[names[index + 1]] === edge && same(item.via, [names[index + 1]]), `Unexpected dependency edge: ${name}`);
      } else {
        requireCondition(item.via.length === 1 && record(item.via[0]), 'Expected one braces advisory');
        const advisory = item.via[0];
        requireCondition(advisory.url === EXCEPTION.advisory && advisory.name === 'braces' && advisory.dependency === 'braces'
          && advisory.severity === 'high' && advisory.range === '<=3.0.3', 'Unknown or changed braces advisory');
      }
    }
    result.status = 'EXCEPTION_PENDING_APPROVAL';
    result.technicalGatePassed = true;
    result.exception = { advisory: EXCEPTION.advisory, expiresAt: EXCEPTION.expiresAt,
      scope: 'Exact development-only eslint-config-next chain', approvalRequiredBeforeGitHub: true };
    return result;
  } catch (error) {
    result.diagnostics.push(error instanceof Error ? error.message : 'Audit validation failed');
    return result;
  }
}

function audit(root, production) {
  const args = ['audit', '--json', '--audit-level=high', ...(production ? ['--omit=dev'] : [])];
  const options = { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 20_000_000, windowsHide: true };
  // Only these constant arguments enter cmd.exe; no report or repository text
  // is interpreted as shell syntax. This never installs or fixes packages.
  const run = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], options)
    : spawnSync('npm', args, options);
  return { status: run.status, signal: run.signal, error: Boolean(run.error), stdout: run.stdout };
}

export function runDependencyAudit(root = process.cwd()) {
  const full = audit(root, false), production = audit(root, true);
  let lock, installed;
  try {
    lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    installed = Object.fromEntries(EXCEPTION.chain.map(([name]) => [name,
      JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version]));
  } catch { /* A missing/unreadable exception inventory cannot grant an exception. */ }
  return evaluateAudits({ full, production, lock, installed });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/dependency-audit.mjs');
    process.exitCode = 1;
  } else {
    const result = runDependencyAudit();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.technicalGatePassed ? 0 : 1;
  }
}
