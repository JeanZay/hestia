import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from '../guard.mjs';
import { readJsonSafe, validateJsonSchema } from '../refinement-check.mjs';
import { captureCandidate, containedPath, digest } from './verification-evidence.mjs';

const schemaPath = fileURLToPath(new URL('../../harness/schemas/browser-recipe-impact.schema.json', import.meta.url));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireCondition = (condition, code) => { if (!condition) fail(code); };
const safeRelative = value => {
  requireCondition(typeof value === 'string' && value.length > 0 && !/[\\:\0*?]/.test(value) && !path.posix.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), 'recipe-impact-invalid-path');
  return value;
};

// The review is a separate immutable document. Its digest covers all analysis
// fields except the reference back to that review, avoiding a hash cycle.
export function recipeImpactDigest(impact) {
  const analysis = { ...impact };
  delete analysis.review;
  return digest(JSON.stringify(analysis));
}

export function recipePolicyPath(branch) {
  requireCondition(typeof branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch), 'recipe-policy-invalid-branch');
  return `artifacts/closure/browser-recipe/${digest(branch)}.json`;
}

export function validateRecipePolicy(policy) {
  const schema = readJsonSafe(schemaPath);
  requireCondition(validateJsonSchema(policy, { $ref: '#/$defs/policy', $defs: schema.$defs }).length === 0, 'recipe-policy-invalid');
  return policy;
}

/** Read-only, local evidence validation. No catalogue promotion or consent inferred. */
export function checkRecipeImpact({ root = process.cwd(), impactPath, candidate, now = new Date() } = {}) {
  const schema = readJsonSafe(schemaPath);
  const references = new Map();
  const read = (relative, expected) => {
    safeRelative(relative);
    const absolute = containedPath(root, relative);
    const stat = lstatSync(absolute);
    requireCondition(stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024, 'recipe-impact-reference-size');
    let descriptor; let bytes;
    try {
      descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = fstatSync(descriptor);
      const buffer = Buffer.alloc(1024 * 1024 + 1); let length = 0;
      while (length < buffer.length) { const count = readSync(descriptor, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
      const after = fstatSync(descriptor);
      requireCondition(opened.isFile() && stat.ino === opened.ino && stat.dev === opened.dev && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs && length <= 1024 * 1024, 'recipe-impact-reference-changed');
      bytes = buffer.subarray(0, length);
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
    const inspection = inspectFile(relative, bytes);
    requireCondition(!inspection.binary && inspection.findings.length === 0, 'recipe-impact-unsafe-reference');
    const sha256 = digest(bytes);
    requireCondition(!expected || sha256 === expected, 'recipe-impact-reference-drift');
    requireCondition(!references.has(relative) || references.get(relative) === sha256, 'recipe-impact-conflicting-reference');
    references.set(relative, sha256);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  const reference = value => read(value.path, value.sha256);
  const json = (relative, text) => {
    const value = readJsonSafe(containedPath(root, relative));
    requireCondition(JSON.stringify(value) === JSON.stringify(JSON.parse(text)), 'recipe-impact-reference-changed');
    return value;
  };
  const impact = json(impactPath, read(impactPath));
  requireCondition(validateJsonSchema(impact, schema).length === 0, 'recipe-impact-invalid-analysis');
  const review = json(impact.review.path, reference(impact.review));
  requireCondition(validateJsonSchema(review, { $ref: '#/$defs/review', $defs: schema.$defs }).length === 0, 'recipe-impact-invalid-review');
  const clock = now instanceof Date ? now.getTime() : Date.parse(now);
  requireCondition(Number.isFinite(clock) && [impact, review].every(item => Number.isFinite(Date.parse(item.recordedAtUtc)) && Date.parse(item.recordedAtUtc) <= clock) && Date.parse(review.recordedAtUtc) >= Date.parse(impact.recordedAtUtc), 'recipe-impact-invalid-date');
  requireCondition(impact.review.path !== impactPath && review.evidence.path !== impact.review.path && review.evidence.path !== impactPath, 'recipe-impact-self-reference');
  requireCondition(review.analysisDigest === recipeImpactDigest(impact), 'recipe-impact-review-stale');
  requireCondition(review.status === 'PASS' && review.openBlockingFindings === 0 && !impact.authors.some(author => author.toLowerCase() === review.reviewer.identity.toLowerCase()), 'recipe-impact-review-not-passed');
  reference(impact.source);
  reference(review.evidence);
  const ids = new Set();
  for (const conclusion of impact.conclusions) {
    requireCondition(conclusion.kind === 'no-impact' ? impact.conclusions.length === 1 && conclusion.scenarioIds.length === 0 : conclusion.scenarioIds.length > 0, 'recipe-impact-conclusion-invalid');
    for (const id of conclusion.scenarioIds) {
      requireCondition(!ids.has(id.toLowerCase()), 'recipe-impact-duplicate-scenario');
      ids.add(id.toLowerCase());
    }
    for (const item of conclusion.references) reference(item);
  }
  const actual = candidate ?? captureCandidate({ root, runId: 'recipe-impact', phase: 'snapshot' });
  requireCondition(impact.candidate.head === (actual.head ?? actual.commit) && impact.candidate.sourceDigest === actual.sourceDigest, 'recipe-impact-candidate-stale');
  // Analysis/review must remain outside the source manifest whose digest they
  // contain. verify captures these separately in activeInputs.
  if (actual.files) requireCondition(!actual.files.some(item => [impactPath, impact.review.path].includes(item.path)), 'recipe-impact-must-be-ignored');
  return { status: 'PASS', impact, review, references: [...references].map(([file, sha256]) => ({ path: file, sha256 })).sort((a, b) => a.path.localeCompare(b.path)), consentAuthenticated: false, browserExecuted: false, reservations: impact.reservations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 2 && args[0] === 'check', 'recipe-impact-usage-check-path');
    const result = checkRecipeImpact({ impactPath: args[1] });
    console.log(JSON.stringify({ status: result.status, reservations: result.reservations.length, consentAuthenticated: false, browserExecuted: false }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', code: error.code ?? 'recipe-impact-unavailable' }));
    process.exitCode = 1;
  }
}
