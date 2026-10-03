import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudits } from '../../scripts/dependency-audit.mjs';

const chain = [
  ['eslint-config-next', '16.3.8', '16.3.8'], ['@next/eslint-plugin-next', '16.3.8', '3.3.1'],
  ['fast-glob', '3.3.1', '^4.0.4'], ['micromatch', '4.0.8', '^3.0.3'], ['braces', '3.0.3', null],
];
function counts(high = 0) { return { info: 0, low: 0, moderate: 0, high, critical: 0, total: high }; }
function clean() { return { status: 0, stdout: { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: counts() } } }; }
function fixture() {
  const vulnerabilities = {}, packages = { '': { devDependencies: { 'eslint-config-next': '16.3.8' }, dependencies: { next: '16.3.8' } } };
  for (let index = 0; index < chain.length; index++) {
    const [name, version, edge] = chain[index];
    packages[`node_modules/${name}`] = { version, dev: true,
      dependencies: edge ? { [chain[index + 1][0]]: edge } : {} };
    vulnerabilities[name] = { name, severity: 'high', isDirect: index === 0,
      nodes: [`node_modules/${name}`], effects: index ? [chain[index - 1][0]] : [],
      via: edge ? [chain[index + 1][0]] : [{ source: 1240992, name: 'braces', dependency: 'braces', severity: 'high', range: '<=3.0.3',
        url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }],
      fixAvailable: { name: 'eslint-config-next', version: '14.2.35', isSemVerMajor: true } };
  }
  return { full: { status: 1, stdout: { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts(5) } } },
    production: clean(), lock: { lockfileVersion: 3, packages }, installed: Object.fromEntries(chain.map(([name, version]) => [name, version])),
    now: new Date('2026-10-03T15:00:00.000Z') };
}
function blocked(input, pattern) {
  const result = evaluateAudits(input);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.technicalGatePassed, false);
  assert.equal(result.publicationAuthorized, false);
  assert.match(result.diagnostics.join(' '), pattern);
}

test('exact dev exception stays pending approval and preserves all five raw high alerts', () => {
  const result = evaluateAudits(fixture());
  assert.equal(result.status, 'EXCEPTION_PENDING_APPROVAL');
  assert.equal(result.technicalGatePassed, true);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(result.exception.approvalRequiredBeforeGitHub, true);
  assert.deepEqual(result.rawCounts, { full: counts(5), production: counts() });
});
test('genuinely clean audits pass without invoking an exception', () => {
  const input = fixture(); input.full = clean(); input.now = new Date('2027-01-01');
  const result = evaluateAudits(input);
  assert.equal(result.status, 'PASS'); assert.equal(result.exception, null);
});
test('unknown advisory is not hidden by the same package name', () => {
  const input = fixture(); input.full.stdout.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/GHSA-unknown';
  blocked(input, /Unknown or changed/);
});
test('second advisory on braces fails even if every package stays the same', () => {
  const input = fixture(); input.full.stdout.vulnerabilities.braces.via.push({ ...input.full.stdout.vulnerabilities.braces.via[0] });
  blocked(input, /one braces advisory/);
});
test('a production alert for the same package is never excepted', () => {
  const input = fixture(); input.production = structuredClone(input.full);
  blocked(input, /Production audit/);
});
test('a package that stops being development-only fails', () => {
  const input = fixture(); delete input.lock.packages['node_modules/braces'].dev;
  blocked(input, /development scope drift/);
});
test('a root production reference is refused even when the dev marker is wrong', () => {
  const input = fixture(); input.lock.packages[''].dependencies.braces = '3.0.3';
  blocked(input, /Production dependency/);
});
test('both installed and locked versions must remain exact', () => {
  const input = fixture(); input.installed.braces = '3.0.4'; blocked(input, /Version/);
  const changed = fixture(); changed.lock.packages['node_modules/fast-glob'].version = '3.3.2'; blocked(changed, /Version/);
});
test('unexpected nested copies and new consumers cannot reuse the exception', () => {
  const input = fixture(); input.lock.packages['node_modules/other/node_modules/braces'] = { version: '3.0.3', dev: true };
  blocked(input, /lockfile node/);
  const consumer = fixture(); consumer.lock.packages['node_modules/other'] = { dependencies: { braces: '3.0.3' } };
  blocked(consumer, /lockfile consumer/);
});
test('changed report nodes or advisory effect graph is refused', () => {
  const input = fixture(); input.full.stdout.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces');
  blocked(input, /Audit scope drift/);
  const effect = fixture(); effect.full.stdout.vulnerabilities.braces.effects.push('other'); blocked(effect, /effects/);
});
test('expiry is exclusive at 2026-11-03 UTC, and an invalid clock fails closed', () => {
  const input = fixture(); input.now = new Date('2026-11-03T00:00:00.000Z'); blocked(input, /expired/);
  const invalid = fixture(); invalid.now = 'not-a-date'; blocked(invalid, /expired/);
});
test('a new critical finding is not covered by a numeric allowance', () => {
  const input = fixture(); input.full.stdout.vulnerabilities.extra = { name: 'extra', severity: 'critical', via: ['braces'], effects: [], nodes: ['node_modules/extra'] };
  input.full.stdout.metadata.vulnerabilities.critical = 1; input.full.stdout.metadata.vulnerabilities.total++;
  blocked(input, /Unexpected high/);
});
test('malformed JSON, missing fields and falsified counters fail closed', () => {
  const invalid = fixture(); invalid.full.stdout = '{'; blocked(invalid, /invalid JSON/);
  const missing = fixture(); delete missing.full.stdout.metadata; blocked(missing, /invalid audit report/);
  const falseCount = fixture(); falseCount.full.stdout.metadata.vulnerabilities.high = 0; blocked(falseCount, /inconsistent counts/);
});
test('network failure, timeout, unexpected status and error-shaped JSON are never PASS', () => {
  const network = fixture(); network.full = { status: 1, stdout: '{"error":{"code":"ENOTFOUND"}}' }; blocked(network, /invalid audit report/);
  const timeout = fixture(); timeout.production.signal = 'SIGTERM'; blocked(timeout, /execution failed/);
  const status = fixture(); status.full.status = 2; blocked(status, /execution failed/);
  const masked = fixture(); masked.full.status = 0; blocked(masked, /unexpected audit exit/);
});
test('new remediation metadata demands reevaluation instead of continuing the old exception', () => {
  const input = fixture(); input.full.stdout.vulnerabilities.braces.fixAvailable = true;
  blocked(input, /Remediation metadata/);
});
