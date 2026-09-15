import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from './guard.mjs';
import { captureCandidate } from './lib/verification-evidence.mjs';
import { computeDigests, readJsonSafe, validateJsonSchema, validateRefinement, validateTaskContract } from './refinement-check.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 1024 * 1024;
const domains = ['product', 'ux', 'security', 'architecture'];
const actions = ['resume', 'plan', 'execute'];
const limits = [
  'Contrôle local en lecture seule ; aucun accord humain authentifié, aucune permission accordée et aucun accès réseau.',
  'GitHub reste le seul backlog. Une capture datée ne constitue jamais une relecture distante en direct.',
  'La couverture déclarée est contrôlée ; son exhaustivité produit et la pertinence des décisions nécessitent une revue indépendante.',
  'Les empreintes prouvent les octets référencés ; les preuves déclarées ne prouvent pas leur exécution ni une livraison Dev ou Production.',
  'Une reprise valide permet de retrouver le contexte ; elle ne donne aucun GO de planification, publication ou exécution.',
];

function failure(code) { return Object.assign(new Error(code), { code }); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sameSet(left, right) { return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item)); }
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value; }

/** Bind the independent brief review to the exact scenarios examined as well. */
export function computeCoverageDigest(coverage) { return hash(JSON.stringify(canonical(coverage))); }

/** Relative paths only, with one unambiguous spelling on Windows and POSIX. */
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[:\0*?\[\]]/.test(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw failure('path-outside-root');
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw failure('path-outside-root');
  return value;
}

function contained(root, relative) {
  const target = path.resolve(root, relativePath(relative));
  const difference = path.relative(root, target);
  if (!difference || difference.startsWith(`..${path.sep}`) || difference === '..' || path.isAbsolute(difference)) throw failure('path-outside-root');
  return target;
}

/** Reads ignored references too; refuses linked parents before opening their contents. */
function readText(root, relative, { binaryAllowed = false } = {}) {
  const target = contained(root, relative);
  let descriptor;
  try {
    const diskRoot = path.parse(target).root;
    let current = diskRoot;
    for (const part of target.slice(diskRoot.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw failure('unsupported-link');
    }
    const before = lstatSync(target);
    if (!before.isFile() || before.size === 0 || before.size > MAX_BYTES) throw failure('file-size-or-type');
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw failure('file-changed-during-read');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(descriptor);
    if (!length || length > MAX_BYTES) throw failure('file-size-or-type');
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) throw failure('file-changed-during-read');
    const bytes = buffer.subarray(0, length);
    const inspected = inspectFile(relative, bytes);
    if ((!binaryAllowed && inspected.binary) || inspected.findings.length) throw failure('guard-rejected-input');
    return { text: binaryAllowed ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha256: hash(bytes) };
  } catch (error) {
    throw failure(error.code === 'ENOENT' ? 'reference-missing' : ['path-outside-root', 'unsupported-link', 'file-size-or-type', 'file-changed-during-read', 'guard-rejected-input'].includes(error.code) ? error.code : 'reference-unreadable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseJson(text) {
  const stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      stack.push({ object: token === '{', keys: new Set(), expectingKey: token === '{' });
      if (stack.length > 64) throw failure('data-depth-limit');
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)?.object) stack.at(-1).expectingKey = true;
    else if (token === ':' && stack.at(-1)?.object) stack.at(-1).expectingKey = false;
    else if (token.startsWith('"') && stack.at(-1)?.object && stack.at(-1).expectingKey) {
      const key = JSON.parse(token);
      if (stack.at(-1).keys.has(key)) throw failure('duplicate-json-key');
      stack.at(-1).keys.add(key);
      stack.at(-1).expectingKey = false;
    }
  }
  let value;
  try { value = JSON.parse(text); } catch { throw failure('invalid-json'); }
  if (inspectFile('', JSON.stringify(value)).findings.length) throw failure('guard-rejected-input');
  return value;
}

function fileReferences(checkpoint) {
  return [checkpoint?.refinement, checkpoint?.contract, ...(checkpoint?.sources ?? []).map((source) => source.file), checkpoint?.qualification?.review, checkpoint?.candidate?.manifest, ...(checkpoint?.observations ?? []).map((observation) => observation.file)].filter(Boolean);
}

/** Fixed inventory of this checkpoint's inputs, never a scan or a second backlog. */
export function referencedFiles(checkpoint) {
  return [...new Set(fileReferences(checkpoint).map((file) => relativePath(file.path)))].sort();
}

/** Detect parent/child claims and Windows case aliases across concurrent writers. */
export function ownershipConflicts(ownership) {
  const paths = ownership.flatMap((owner) => owner.paths.map((value) => ({ agent: owner.agent, value: relativePath(value).toLowerCase() })));
  const conflicts = [];
  for (let index = 0; index < paths.length; index++) {
    for (const other of paths.slice(index + 1)) {
      const current = paths[index];
      if (current.agent !== other.agent && (current.value === other.value || current.value.startsWith(`${other.value}/`) || other.value.startsWith(`${current.value}/`))) conflicts.push({ agents: [current.agent, other.agent], code: 'ownership-overlap' });
    }
  }
  return conflicts;
}

/** Diagnostics are scope-specific. No successful result authenticates consent or performs an action. */
export function validateLifecycle(checkpoint, { root = process.cwd(), action = 'resume', now = new Date() } = {}) {
  const diagnostics = [];
  const add = (level, code, location = '$') => {
    if (!diagnostics.some((item) => item.level === level && item.code === code && item.path === location)) diagnostics.push({ level, code, path: location });
  };
  const result = () => {
    const structuralValid = !diagnostics.some((item) => item.level === 'structure');
    const resumable = structuralValid && !diagnostics.some((item) => item.level === 'resume');
    const planningReadiness = resumable && !diagnostics.some((item) => item.level === 'plan');
    const executionReadiness = planningReadiness && !diagnostics.some((item) => item.level === 'execute');
    return { valid: { resume: resumable, plan: planningReadiness, execute: executionReadiness }[action] ?? false, action, structuralValid, resumable, planningReadiness, executionReadiness, humanConsentAuthenticated: false, remoteStateVerified: false, diagnostics, nextAction: resumable ? checkpoint.nextAction : null, limits };
  };
  if (!actions.includes(action)) { add('structure', 'unknown-action'); return result(); }
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(timestamp)) { add('structure', 'invalid-clock'); return result(); }
  const checkTime = (value, location, level = 'resume') => {
    if (!Number.isFinite(Date.parse(value)) || Date.parse(value) > timestamp) { add(level, 'future-or-invalid-date', location); return false; }
    return true;
  };
  let schema;
  try { schema = readJsonSafe(path.join(directory, '../harness/schemas/lifecycle.schema.json')); }
  catch { add('structure', 'schema-unavailable'); return result(); }
  for (const error of validateJsonSchema(checkpoint, schema)) add('structure', error.code, error.path);
  if (diagnostics.length) return result();
  const unique = (values, location) => { if (new Set(values).size !== values.length) add('resume', 'duplicate-identifier', location); };
  checkTime(checkpoint.recordedAtUtc, '$/recordedAtUtc');
  if (checkpoint.status !== 'active') add('resume', `checkpoint-${checkpoint.status}`, '$/status');
  if (checkpoint.templateOnly) add('plan', 'template-not-engaged', '$/templateOnly');
  for (const key of ['sources', 'agreements', 'observations']) unique(checkpoint[key].map((item) => item.id), `$/` + key);
  unique(checkpoint.qualification.coverage.map((item) => item.id), '$/qualification/coverage');
  unique(checkpoint.ownership.map((item) => item.agent), '$/ownership');
  unique(checkpoint.dependencyLevels.map((item) => item.url), '$/dependencyLevels');
  try { for (const conflict of ownershipConflicts(checkpoint.ownership)) add('resume', conflict.code, '$/ownership'); }
  catch (error) { add('resume', error.code, '$/ownership'); }

  const verified = new Map();
  for (const file of fileReferences(checkpoint)) {
    try {
      if (verified.has(file.path)) {
        if (verified.get(file.path).sha256 !== file.sha256) add('resume', 'conflicting-file-reference', '$/references');
        continue;
      }
      const content = readText(path.resolve(root), file.path);
      if (content.sha256 !== file.sha256) { add('resume', 'reference-digest-mismatch', '$/references'); continue; }
      verified.set(file.path, content);
    } catch (error) { add('resume', error.code, '$/references'); }
  }
  const readReferencedJson = (file, location) => {
    if (!verified.has(file.path)) return null;
    try { return parseJson(verified.get(file.path).text); }
    catch (error) { add('resume', error.code, location); return null; }
  };
  const record = readReferencedJson(checkpoint.refinement, '$/refinement');
  const contract = readReferencedJson(checkpoint.contract, '$/contract');
  if (record) for (const error of validateRefinement(record).errors) add('resume', `refinement-${error.code}`, `$/refinement${error.path.slice(1)}`);
  if (contract) for (const error of validateTaskContract(contract).errors) add('resume', `contract-${error.code}`, `$/contract${error.path.slice(1)}`);
  // Do not interpret malformed referenced structures after reporting their diagnostics.
  if (!record || !contract || diagnostics.some((item) => item.level === 'resume' && (item.path.startsWith('$/refinement') || item.path.startsWith('$/contract')))) return resultWithUnavailable();
  function resultWithUnavailable() { add('plan', 'context-unavailable'); add('execute', 'context-unavailable'); return result(); }

  const briefDigest = computeDigests(record).brief;
  const criteria = record.brief.criteria.map((item) => item.id);
  if (checkpoint.need.githubIssue !== null && !checkpoint.need.githubIssue.startsWith(`${record.plan.repository}/issues/`)) add('resume', 'need-repository-mismatch', '$/need/githubIssue');
  const briefMutation = record.plan.mutations.find((mutation) => mutation.kind === 'publish-brief');
  if (checkpoint.need.githubIssue !== null && briefMutation?.issueKey === null && briefMutation.target !== checkpoint.need.githubIssue) add('resume', 'need-brief-destination-mismatch', '$/need/githubIssue');
  const knownCriteria = (values, location) => {
    unique(values, location);
    if (values.some((id) => !criteria.includes(id))) add('resume', 'unknown-brief-criterion', location);
  };
  const sources = new Map(checkpoint.sources.map((source) => [source.id, source]));
  const sourceQuote = (sourceId, quote, location) => {
    const source = sources.get(sourceId);
    if (!source) { add('resume', 'source-not-registered', location); return false; }
    const content = verified.get(source.file.path);
    if (!content || !content.text.includes(quote)) { add('resume', 'source-quote-mismatch', location); return false; }
    return true;
  };
  for (const source of checkpoint.sources) checkTime(source.capturedAtUtc, '$/sources');
  // Old V1 dates are checked without rewriting the record or its historical digests.
  const walkDates = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['capturedAt', 'at', 'readAt', 'verifiedAt'].includes(key)) checkTime(child, '$/refinement');
      else if (child && typeof child === 'object') walkDates(child);
    }
  };
  walkDates(record);
  for (const agreement of checkpoint.agreements) {
    checkTime(agreement.recordedAtUtc, '$/agreements');
    unique(agreement.actions, '$/agreements/actions');
    sourceQuote(agreement.sourceId, agreement.quote, '$/agreements');
    if (agreement.briefDigest === briefDigest) knownCriteria(agreement.criterionIds, '$/agreements/criterionIds');
    else unique(agreement.criterionIds, '$/agreements/criterionIds');
    const scoped = agreement.actions.some((item) => item !== 'principle');
    if (scoped && (agreement.briefDigest === null || !agreement.criterionIds.length)) add('resume', 'agreement-scope-missing', '$/agreements');
    // A superseded agreement remains readable history. It cannot satisfy a current gate.
    if (agreement.status === 'active' && scoped && agreement.briefDigest !== briefDigest) add('plan', 'agreement-for-other-brief', '$/agreements');
  }
  const applicable = (agreement, kind) => agreement.status === 'active' && agreement.actions.includes(kind) && agreement.briefDigest === briefDigest;
  const coveredBy = (kind, ids = checkpoint.agreements.map((agreement) => agreement.id)) => new Set(checkpoint.agreements.filter((agreement) => ids.includes(agreement.id) && applicable(agreement, kind)).flatMap((agreement) => agreement.criterionIds));
  const fullyCovered = (covered, required = criteria) => required.length > 0 && required.every((id) => covered.has(id));
  if (!record.approvals.brief || !fullyCovered(coveredBy('brief'))) add('plan', 'brief-not-fully-approved', '$/agreements');
  if (!checkpoint.engagement) add('plan', 'need-not-engaged', '$/engagement');
  else {
    const engagement = checkpoint.engagement;
    knownCriteria(engagement.criterionIds, '$/engagement/criterionIds');
    unique(engagement.agreementIds, '$/engagement/agreementIds');
    if (engagement.briefDigest !== briefDigest || !sameSet(engagement.criterionIds, criteria)) add('plan', 'engagement-scope-mismatch', '$/engagement');
    if (engagement.agreementIds.some((id) => !checkpoint.agreements.some((agreement) => agreement.id === id && applicable(agreement, 'engage'))) || !fullyCovered(coveredBy('engage', engagement.agreementIds))) add('plan', 'engagement-agreement-missing', '$/engagement');
  }
  if (record.plan.issues.length && !checkpoint.engagement) add('plan', 'stories-before-engagement', '$/refinement/plan');
  if (record.stage !== 'ready') add('execute', 'refinement-not-ready', '$/refinement/stage');
  if (!fullyCovered(coveredBy('execute'))) add('execute', 'execution-agreement-missing', '$/agreements');
  if (!fullyCovered(coveredBy('publish'))) add('execute', 'publication-agreement-missing', '$/agreements');
  if (!record.readiness.handoffs.some((handoff) => JSON.stringify(canonical(handoff.contract)) === JSON.stringify(canonical(contract)))) add('execute', 'handoff-contract-mismatch', '$/contract');
  if (contract.deliveryTarget !== 'local') add('execute', 'external-delivery-requires-separate-gate', '$/contract/deliveryTarget');

  const qualification = checkpoint.qualification;
  if (qualification.status !== 'complete' || qualification.briefDigest !== briefDigest) add('plan', 'qualification-incomplete-or-stale', '$/qualification');
  for (const domain of domains) {
    if (!qualification.coverage.some((scenario) => scenario.domain === domain && scenario.status !== 'open')) add('plan', 'domain-not-covered', `$/qualification/coverage/${domain}`);
    for (const decision of record.brief.decisions[domain]) if (decision.status === 'proposed') add('plan', 'decision-unresolved', `$/refinement/brief/decisions/${domain}/${decision.id}`);
  }
  for (const criterion of criteria) for (const kind of ['nominal', 'negative']) {
    if (!qualification.coverage.some((scenario) => scenario.criterionIds.includes(criterion) && scenario.kind === kind && scenario.status === 'resolved')) add('plan', 'criterion-scenario-missing', `$/qualification/coverage/${criterion}/${kind}`);
  }
  for (const scenario of qualification.coverage) {
    knownCriteria(scenario.criterionIds, '$/qualification/coverage');
    unique(scenario.decisionRefs, '$/qualification/coverage/decisionRefs');
    if (scenario.status === 'open') add('plan', 'scenario-unresolved', `$/qualification/coverage/${scenario.id}`);
    else if (!scenario.resolution || !sourceQuote(scenario.resolution.sourceId, scenario.resolution.quote, '$/qualification/coverage/resolution')) add('plan', 'scenario-resolution-missing', '$/qualification/coverage');
    if (scenario.status === 'resolved' && !scenario.decisionRefs.length) add('plan', 'scenario-decision-missing', '$/qualification/coverage');
    for (const reference of scenario.decisionRefs) {
      const [domain, id] = reference.split(':');
      const decision = record.brief.decisions[domain]?.find((item) => item.id === id);
      if (!decision) add('resume', 'unknown-scenario-decision', '$/qualification/coverage');
      else if (scenario.status === 'resolved' && decision.status !== 'accepted') add('plan', 'scenario-decision-not-accepted', '$/qualification/coverage');
    }
  }
  if (record.brief.questions.some((question) => question.blocking && question.status !== 'answered')) add('plan', 'blocking-question-unresolved', '$/refinement/brief/questions');
  if (record.brief.preparations.some((preparation) => preparation.blocking && preparation.status !== 'completed')) add('plan', 'blocking-preparation-incomplete', '$/refinement/brief/preparations');
  if (record.brief.hypotheses.some((hypothesis) => hypothesis.status === 'untested')) add('plan', 'hypothesis-unexamined', '$/refinement/brief/hypotheses');
  if (record.brief.risks.some((risk) => risk.status === 'open')) add('plan', 'risk-unresolved', '$/refinement/brief/risks');
  if (!qualification.review) add('execute', 'brief-review-missing', '$/qualification/review');
  else {
    const review = readReferencedJson(qualification.review, '$/qualification/review');
    if (!review) add('execute', 'brief-review-unavailable', '$/qualification/review');
    else {
      const errors = validateJsonSchema(review, { ...schema.$defs.briefReview, $defs: schema.$defs });
      if (errors.length) add('execute', 'brief-review-invalid', '$/qualification/review');
      else {
        checkTime(review.reviewedAtUtc, '$/qualification/review');
        if (review.briefDigest !== briefDigest || review.coverageDigest !== computeCoverageDigest(qualification.coverage) || !sameSet(review.criterionIds, criteria)) add('execute', 'brief-review-stale-or-partial', '$/qualification/review');
        if (review.authors.some((author) => author.toLowerCase() === review.reviewer.identity.toLowerCase()) || review.verdict !== 'PASS' || review.openBlockingFindings !== 0) add('execute', 'brief-review-not-passed-independently', '$/qualification/review');
      }
    }
  }

  if (!checkpoint.candidate) add('execute', 'candidate-missing', '$/candidate');
  else {
    const candidate = checkpoint.candidate;
    if (candidate.environment !== 'local') add('execute', 'local-candidate-environment-required', '$/candidate/environment');
    checkTime(candidate.capturedAtUtc, '$/candidate');
    const manifest = readReferencedJson(candidate.manifest, '$/candidate/manifest');
    const manifestFiles = manifest?.files;
    if (!manifest || !Array.isArray(manifestFiles) || !manifestFiles.length || manifestFiles.length > 20000 || manifestFiles.some((file) => !file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))) add('resume', 'candidate-manifest-invalid', '$/candidate');
    else {
      unique(manifestFiles.map((file) => file.path.toLowerCase()), '$/candidate/manifest');
      const ordered = [...manifestFiles].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      const sourceDigest = hash(JSON.stringify(ordered));
      if (JSON.stringify(manifestFiles) !== JSON.stringify(ordered) || manifest.sourceDigest !== sourceDigest || candidate.sourceDigest !== sourceDigest) add('resume', 'candidate-digest-mismatch', '$/candidate');
      if (manifest.createdAt) checkTime(manifest.createdAt, '$/candidate/manifest');
      try {
        for (const file of manifestFiles) relativePath(file.path);
        const current = captureCandidate({ root: path.resolve(root), runId: 'lifecycle-inspection', phase: 'snapshot' });
        if (current.sourceDigest !== sourceDigest) {
          const known = new Map(manifestFiles.map((file) => [file.path, file.sha256]));
          if (current.files.some((file) => known.has(file.path) && known.get(file.path) !== file.sha256)) add('resume', 'candidate-file-changed', '$/candidate/manifest');
          if (!sameSet(current.files.map((file) => file.path), manifestFiles.map((file) => file.path))) add('resume', 'candidate-source-scope-changed', '$/candidate/manifest');
        }
        if ((Object.hasOwn(manifest, 'commit') && manifest.commit !== current.commit) || (Object.hasOwn(manifest, 'deletedFiles') && !sameSet(manifest.deletedFiles, current.deletedFiles))) add('resume', 'candidate-git-state-changed', '$/candidate/manifest');
      } catch (error) { add('resume', error.code === 'path-outside-root' ? error.code : 'candidate-inventory-unavailable', '$/candidate/manifest'); }
    }
  }

  const fresh = new Set();
  for (const observation of checkpoint.observations) {
    const observed = readReferencedJson(observation.file, '$/observations/file');
    const metadata = ['kind', 'subject', 'observedAtUtc', 'maxAgeSeconds', 'candidateDigest', 'environment', 'status'];
    if (!observed || metadata.some((field) => observed[field] !== observation[field]) || typeof observed.evidence !== 'string' || !observed.evidence.trim()) add('resume', 'observation-content-mismatch', '$/observations/file');
    const past = checkTime(observation.observedAtUtc, '$/observations');
    if (observation.maxAgeSeconds <= 0 || observation.maxAgeSeconds > 2592000) add('resume', 'invalid-observation-lifetime', '$/observations');
    const validAge = past && timestamp - Date.parse(observation.observedAtUtc) <= observation.maxAgeSeconds * 1000;
    if (!validAge) add('execute', 'observation-stale', '$/observations');
    else if (observation.status === 'satisfied') fresh.add(observation.id);
    if (['validation', 'review'].includes(observation.kind) && (!checkpoint.candidate || observation.candidateDigest !== checkpoint.candidate.sourceDigest || observation.environment !== checkpoint.candidate.environment)) add('execute', 'evidence-candidate-mismatch', '$/observations');
    if (observation.kind === 'dependency' && observation.candidateDigest === null) add('execute', 'dependency-candidate-missing', '$/observations');
    if (observation.kind === 'github' && (observation.environment !== 'GitHub' || observation.candidateDigest !== null)) add('resume', 'github-observation-shape', '$/observations');
  }
  if (checkpoint.need.githubIssue !== null && !checkpoint.observations.some((observation) => observation.kind === 'github' && observation.subject === checkpoint.need.githubIssue && fresh.has(observation.id))) add('execute', 'github-refresh-required', '$/observations');
  const levels = { local: 0, Dev: 1, Production: 2 };
  const selected = new Set(record.readiness.handoffs.map((handoff) => handoff.issueKey));
  for (const proof of record.readiness.dependencyEvidence.filter((proof) => selected.has(proof.issueKey))) {
    const requirement = checkpoint.dependencyLevels.find((item) => item.url === proof.url);
    if (!requirement || !checkpoint.observations.some((observation) => observation.kind === 'dependency' && observation.subject === proof.url && fresh.has(observation.id) && observation.candidateDigest !== null && levels[observation.environment] >= levels[requirement.environment])) add('execute', 'dependency-evidence-insufficient', '$/dependencyLevels');
  }
  return result();
}

/** Reads an explicit checkpoint under root; never follows a path outside that root. */
export function inspectCheckpoint(file, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  try {
    const relative = path.isAbsolute(file) ? path.relative(root, file).split(path.sep).join('/') : file;
    const checkpoint = parseJson(readText(root, relative).text);
    return validateLifecycle(checkpoint, { ...options, root });
  } catch (error) {
    return { valid: false, action: options.action ?? 'resume', structuralValid: false, resumable: false, planningReadiness: false, executionReadiness: false, humanConsentAuthenticated: false, remoteStateVerified: false, diagnostics: [{ level: 'structure', code: error.code ?? 'checkpoint-unavailable', path: '$' }], nextAction: null, limits };
  }
}

export function main(args = process.argv.slice(2), cwd = process.cwd(), write = (line) => process.stdout.write(`${line}\n`)) {
  const options = new Map();
  if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !['--checkpoint', '--root', '--action'].includes(value))) return usage();
  for (let index = 0; index < args.length; index += 2) {
    if (options.has(args[index]) || !args[index + 1]) return usage();
    options.set(args[index], args[index + 1]);
  }
  const file = options.get('--checkpoint');
  const action = options.get('--action') ?? 'resume';
  if (!file || !actions.includes(action)) return usage();
  const result = inspectCheckpoint(file, { root: path.resolve(cwd, options.get('--root') ?? '.'), action });
  write(JSON.stringify(result));
  return result.valid ? 0 : 1;
  function usage() { write('Usage: node scripts/lifecycle-check.mjs --checkpoint <json> [--root <repo>] [--action resume|plan|execute]'); return 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
