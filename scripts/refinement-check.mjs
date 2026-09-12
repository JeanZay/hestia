import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from './guard.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const stages = ['exploration', 'brief-candidate', 'brief-validated', 'plan-proposed', 'publication-authorized', 'published', 'ready'];
const issueUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/;
const issueCommentUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*#issuecomment-[1-9][0-9]*$/;
const limits = [
  'Cohérence structurelle seulement ; la fidélité, la valeur verticale et la qualité des preuves nécessitent une revue humaine.',
  'Aucun accord humain authentifié, aucune permission accordée, aucun accès réseau, aucune publication.',
  'Lectures GitHub et dépendances : déclarations datées à revérifier en direct avant action ; publication ne signifie pas livraison.',
  'Questions et préparations bloquantes ont une portée globale ; seuls les handoffs sélectionnés deviennent prêts.',
  'Données synthétiques uniquement ; détection partielle du guard, sans garantie exhaustive de confidentialité.',
];

class RefinementError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function requireCondition(condition, code) {
  if (!condition) throw new RefinementError(code);
}

function canonical(value, depth = 0) {
  requireCondition(depth <= MAX_DEPTH, 'data-depth-limit');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  requireCondition(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'non-json-data');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}

function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function same(left, right) { return canonical(left) === canonical(right); }

/** Reject duplicate keys and excessive nesting before normal JSON parsing. */
function parseJson(text) {
  const stack = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const value = token[0];
    if (value === '{' || value === '[') {
      stack.push({ object: value === '{', keys: new Set(), expectingKey: value === '{' });
      requireCondition(stack.length <= MAX_DEPTH, 'data-depth-limit');
    } else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && stack.at(-1)?.object) stack.at(-1).expectingKey = true;
    else if (value === ':' && stack.at(-1)?.object) stack.at(-1).expectingKey = false;
    else if (value.startsWith('"') && stack.at(-1)?.object && stack.at(-1).expectingKey) {
      const key = JSON.parse(value);
      requireCondition(!stack.at(-1).keys.has(key), 'duplicate-json-key');
      stack.at(-1).keys.add(key);
      stack.at(-1).expectingKey = false;
    }
  }
  return JSON.parse(text);
}

/** Also scans ignored dossiers; does not echo filenames, suspicious values or JSON parser messages. */
export function readJsonSafe(file) {
  let descriptor;
  try {
    const absolute = path.resolve(file);
    const root = path.parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      requireCondition(!lstatSync(current).isSymbolicLink(), 'unsupported-link');
    }
    const before = lstatSync(absolute);
    requireCondition(before.isFile(), 'not-regular-file');
    requireCondition(before.size > 0 && before.size <= MAX_BYTES, 'file-size-limit');
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    requireCondition(opened.isFile() && opened.ino === before.ino && opened.dev === before.dev, 'file-changed-during-read');
    requireCondition(opened.size > 0 && opened.size <= MAX_BYTES, 'file-size-limit');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    requireCondition(length > 0 && length <= MAX_BYTES, 'file-size-limit');
    const bytes = buffer.subarray(0, length);
    const inspected = inspectFile(absolute, bytes);
    requireCondition(!inspected.binary && inspected.findings.length === 0, 'guard-rejected-input');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = parseJson(text);
    // Decode JSON escapes before a second scan so an escaped token is not silently accepted.
    requireCondition(inspectFile('', canonical(value)).findings.length === 0, 'guard-rejected-input');
    return value;
  } catch (error) {
    throw new RefinementError(error instanceof RefinementError ? error.code : 'json-or-file-error');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const supportedKeywords = new Set(['$schema', '$ref', '$defs', 'title', 'description', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', 'anyOf']);

function resolveReference(reference, root, externalSchemas) {
  if (reference.startsWith('#/$defs/')) {
    const key = reference.slice('#/$defs/'.length);
    requireCondition(!key.includes('/') && Object.hasOwn(root.$defs ?? {}, key), 'schema-reference-unsupported');
    return { schema: root.$defs[key], root };
  }
  requireCondition(Object.hasOwn(externalSchemas, reference), 'schema-reference-unsupported');
  return { schema: externalSchemas[reference], root: externalSchemas[reference] };
}

function auditSchema(schema, root, externalSchemas, visited = new Set()) {
  requireCondition(schema && typeof schema === 'object' && !Array.isArray(schema), 'schema-unsupported');
  if (visited.has(schema)) return;
  visited.add(schema);
  requireCondition(Object.keys(schema).every((key) => supportedKeywords.has(key)), 'schema-keyword-unsupported');
  if (schema.$ref) {
    const reference = resolveReference(schema.$ref, root, externalSchemas);
    auditSchema(reference.schema, reference.root, externalSchemas, visited);
  }
  if (schema.format) requireCondition(schema.format === 'date-time', 'schema-format-unsupported');
  if (schema.additionalProperties !== undefined) requireCondition(typeof schema.additionalProperties === 'boolean', 'schema-unsupported');
  for (const child of Object.values(schema.properties ?? {})) auditSchema(child, root, externalSchemas, visited);
  for (const child of Object.values(schema.$defs ?? {})) auditSchema(child, root, externalSchemas, visited);
  if (schema.items) auditSchema(schema.items, root, externalSchemas, visited);
  for (const child of schema.anyOf ?? []) auditSchema(child, root, externalSchemas, visited);
}

function dateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

function checkSchema(value, schema, root, externalSchemas, location, errors, depth = 0) {
  requireCondition(depth <= MAX_DEPTH * 2, 'schema-depth-limit');
  const add = (code) => errors.push({ path: location, code });
  if (schema.$ref) {
    const reference = resolveReference(schema.$ref, root, externalSchemas);
    checkSchema(value, reference.schema, reference.root, externalSchemas, location, errors, depth + 1);
  }
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type) => matchesType(value, type))) {
    add('schema-type'); return;
  }
  if (Object.hasOwn(schema, 'const') && !same(value, schema.const)) add('schema-const');
  if (schema.enum && !schema.enum.some((item) => same(value, item))) add('schema-enum');
  if (schema.anyOf && !schema.anyOf.some((branch) => {
    const branchErrors = [];
    checkSchema(value, branch, root, externalSchemas, location, branchErrors, depth + 1);
    return branchErrors.length === 0;
  })) add('schema-anyOf');
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) add('schema-minLength');
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) add('schema-maxLength');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) add('schema-pattern');
    if (schema.format === 'date-time' && !dateTime(value)) add('schema-date-time-utc');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add('schema-minItems');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add('schema-maxItems');
    if (schema.items) value.forEach((item, index) => checkSchema(item, schema.items, root, externalSchemas, `${location}/${index}`, errors, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) add('schema-required');
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) add('schema-additionalProperties');
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) checkSchema(value[key], child, root, externalSchemas, `${location}/${key}`, errors, depth + 1);
    }
  }
}

/** Bounded JSON Schema subset; any unsupported keyword anywhere fails closed. */
export function validateJsonSchema(value, schema, externalSchemas = {}) {
  const errors = [];
  try {
    const serialized = canonical(value);
    requireCondition(Buffer.byteLength(serialized) <= MAX_BYTES, 'data-size-limit');
    requireCondition(inspectFile('', serialized).findings.length === 0, 'guard-rejected-input');
    auditSchema(schema, schema, externalSchemas);
    checkSchema(value, schema, schema, externalSchemas, '$', errors);
  } catch (error) {
    errors.push({ path: '$', code: error instanceof RefinementError ? error.code : 'validation-unavailable' });
  }
  return errors;
}

function schemas() {
  const contract = readJsonSafe(path.join(directory, '../harness/contracts/task-contract.schema.json'));
  const refinement = readJsonSafe(path.join(directory, '../harness/contracts/refinement.schema.json'));
  return { contract, refinement };
}

export function validateTaskContract(contract) {
  try {
    const { contract: schema } = schemas();
    const errors = validateJsonSchema(contract, schema);
    if (errors.length === 0 && contract.githubIssue !== null && !issueUrl.test(contract.githubIssue)) errors.push({ path: '$/githubIssue', code: 'github-issue-url-required' });
    return { valid: errors.length === 0, errors, limits };
  } catch (error) {
    return { valid: false, errors: [{ path: '$', code: error instanceof RefinementError ? error.code : 'validation-unavailable' }], limits };
  }
}

/** Field order is irrelevant; array order and every textual byte remain significant. */
export function computeDigests(record) {
  const brief = digest({ version: record.version, dataPolicy: record.dataPolicy, destinations: { repository: record.plan.repository, project: record.plan.project }, source: record.source, nuances: record.nuances, brief: record.brief });
  return { brief, publication: digest({ brief, plan: record.plan }), mutations: Object.fromEntries(record.plan.mutations.map((mutation) => [mutation.key, digest(mutation)])) };
}

/** The narrative remains intact; the exact proposed body includes the contract's observable fields. */
export function renderIssueBody(issue, record) {
  const bullets = (values) => values.map((value) => `- ${value}`).join('\n');
  const briefMutation = record.plan.mutations.find((mutation) => mutation.kind === 'publish-brief');
  const destinationIssue = record.plan.issues.find((item) => item.key === briefMutation?.issueKey);
  const briefDestination = briefMutation?.issueKey === null
    ? `[Issue accueillant le brief](${briefMutation.target})`
    : destinationIssue ? `Issue prévue « ${destinationIssue.title} » (clé ${destinationIssue.key}).` : 'Destination du brief à définir avant publication.';
  return `${issue.body}\n\n## Périmètre inclus\n\n${bullets(issue.scope.included)}\n\n## Hors périmètre\n\n${bullets(issue.scope.excluded)}\n\n## Chemins possédés\n\n${bullets(issue.scope.ownedPaths)}\n\n## Critères et preuves\n\n${issue.criteria.map((criterion) => `### ${criterion.id}\n\n- Positif : ${criterion.positive}\n- Négatif : ${criterion.negative}\n- Preuve attendue : ${criterion.evidence}`).join('\n\n')}\n\n## Contrôles\n\n${bullets(issue.validation)}\n\n## Dépendances\n\n${issue.dependencies.length ? bullets(issue.dependencies) : 'Aucune.'}\n\n## Traçabilité du brief\n\nVersion SHA-256 du brief : ${computeDigests(record).brief}\n\n${briefDestination}\n\nLe handoff fournit l'URL exacte relue du commentaire contenant ce brief complet.\n\nCritères du brief couverts :\n\n${bullets(issue.briefCriteria)}`;
}

/** Full versioned brief for an approved GitHub comment, never a local parallel backlog. */
export function renderBrief(record) {
  const { brief, source } = record;
  const bullets = (values) => values.length ? values.map((value) => `- ${value}`).join('\n') : 'Aucun élément consigné.';
  const optional = (value) => value ?? 'Non renseigné.';
  const section = (title, body) => `## ${title}\n\n${body}`;
  const items = (values, render) => values.length ? values.map(render).join('\n\n') : 'Aucun élément consigné.';
  const status = { proposed: 'proposé', accepted: 'accepté', deferred: 'différé', open: 'ouvert', answered: 'répondu', untested: 'non testé', supported: 'étayé', rejected: 'rejeté', resolved: 'résolu', needed: 'nécessaire', completed: 'terminé' };
  const blocking = (value) => value ? 'oui' : 'non';
  return [
    '# Brief Hestia',
    `Version du format : ${record.version}\n\nEmpreinte SHA-256 du brief : ${computeDigests(record).brief}\n\nPolitique de données : ${record.dataPolicy}\n\nDépôt : ${record.plan.repository}\n\nProject : ${record.plan.project ?? 'Aucun.'}`,
    section('Source originale', `Date de capture : ${source.capturedAt}\n\nRéférence : ${source.reference}\n\n${source.original}`),
    section('Nuances conservées', bullets(record.nuances)),
    section('Besoin reformulé', brief.need),
    section('Résultat observable', brief.outcome),
    section('Acteurs', bullets(brief.actors)),
    section('Périmètre inclus', bullets(brief.scope.included)),
    section('Hors périmètre', bullets(brief.scope.excluded)),
    ...[['product', 'Produit'], ['ux', 'UX'], ['security', 'Sécurité'], ['architecture', 'Architecture']].map(([domain, label]) => section(`Décisions — ${label}`, items(brief.decisions[domain], (item) => `### ${item.id} — ${status[item.status]}\n\n${item.statement}\n\nMotif : ${item.rationale}\n\nSource de décision : ${optional(item.source)}`))),
    section('Questions et reports', items(brief.questions, (item) => `### ${item.id} — ${status[item.status]}\n\nDomaine : ${item.domain}\n\nBloquante : ${blocking(item.blocking)}\n\n${item.text}\n\nRéponse : ${optional(item.answer)}\n\nPreuve de réponse ou de report : ${optional(item.evidence)}`)),
    section('Hypothèses', items(brief.hypotheses, (item) => `### ${item.id} — ${status[item.status]}\n\n${item.statement}\n\nPreuve : ${optional(item.evidence)}`)),
    section('Risques', items(brief.risks, (item) => `### ${item.id} — ${status[item.status]}\n\n${item.description}\n\nRéduction du risque : ${item.mitigation}\n\nPreuve ou décision : ${optional(item.evidence)}`)),
    section('Critères et preuves attendues', items(brief.criteria, (item) => `### ${item.id}\n\n- Positif : ${item.positive}\n- Négatif : ${item.negative}\n- Preuve attendue : ${item.evidence}`)),
    section('Préparations conditionnelles', items(brief.preparations, (item) => `### ${item.id} — ${item.kind} — ${status[item.status]}\n\nMotif : ${item.reason}\n\nBloquante : ${blocking(item.blocking)}\n\nPreuve ou motif de report : ${optional(item.evidence)}`)),
  ].join('\n\n');
}

function checkSemantics(record, digests) {
  const errors = [];
  const add = (location, code) => errors.push({ path: location, code });
  const require = (condition, location, code) => { if (!condition) add(location, code); };
  const unique = (values, location) => require(new Set(values).size === values.length, location, 'duplicate-identifier');
  const stage = stages.indexOf(record.stage);
  const { brief, plan, approvals, publication, readiness } = record;
  if (stage >= 1) {
    require(brief.actors.length > 0 && brief.scope.included.length > 0 && brief.scope.excluded.length > 0 && brief.criteria.length > 0, '$/brief', 'brief-incomplete');
  }
  for (const domain of Object.keys(brief.decisions)) {
    unique(brief.decisions[domain].map((item) => item.id), `$/brief/decisions/${domain}`);
    brief.decisions[domain].forEach((item, index) => {
      require(item.status === 'proposed' || item.source !== null, `$/brief/decisions/${domain}/${index}`, 'decision-source-required');
    });
  }
  for (const group of ['questions', 'hypotheses', 'risks', 'criteria', 'preparations']) unique(brief[group].map((item) => item.id), `$/brief/${group}`);
  brief.questions.forEach((question, index) => {
    require(question.status === 'open' || (question.evidence !== null && (question.status === 'deferred' || question.answer !== null)), `$/brief/questions/${index}`, 'question-resolution-evidence-required');
    if (stage >= 2) require(!question.blocking || question.status === 'answered', `$/brief/questions/${index}`, 'blocking-question-unresolved');
  });
  brief.hypotheses.forEach((item, index) => require(item.status === 'untested' || item.evidence !== null, `$/brief/hypotheses/${index}`, 'hypothesis-evidence-required'));
  brief.risks.forEach((item, index) => require(item.status === 'open' || item.evidence !== null, `$/brief/risks/${index}`, 'risk-evidence-required'));
  brief.preparations.forEach((item, index) => {
    require(!['completed', 'deferred'].includes(item.status) || item.evidence !== null, `$/brief/preparations/${index}`, 'preparation-evidence-required');
    if (stage === 6) require(!item.blocking || item.status === 'completed', `$/brief/preparations/${index}`, 'blocking-preparation-incomplete');
  });
  for (const [kind, minimum] of [['brief', 2], ['publication', 4]]) {
    const approval = approvals[kind];
    require(stage < minimum || approval !== null, `$/approvals/${kind}`, 'approval-required');
    require(stage >= minimum || approval === null, `$/approvals/${kind}`, 'approval-before-stage');
    if (approval) {
      require(approval.digest === digests[kind], `$/approvals/${kind}/digest`, 'approval-stale');
      require(Date.parse(approval.at) >= Date.parse(record.source.capturedAt), `$/approvals/${kind}/at`, 'approval-before-source');
    }
  }
  if (approvals.brief && approvals.publication) require(Date.parse(approvals.publication.at) >= Date.parse(approvals.brief.at), '$/approvals/publication/at', 'publication-before-brief');
  require(stage >= 3 || (plan.issues.length === 0 && plan.order.length === 0 && plan.mutations.length === 0 && readiness.dependencyEvidence.length === 0), '$/plan', 'plan-before-validation');
  require(stage < 3 || (plan.issues.length > 0 && plan.mutations.length > 0), '$/plan', 'plan-empty');
  require(stage >= 4 || publication.receipts.length === 0, '$/publication/receipts', 'receipt-before-publication-authorization');
  require(stage === 6 || readiness.handoffs.length === 0, '$/readiness/handoffs', 'handoff-before-ready');
  require(stage !== 6 || readiness.handoffs.length > 0, '$/readiness/handoffs', 'ready-selection-empty');

  const issues = new Map(plan.issues.map((issue) => [issue.key, issue]));
  unique(plan.issues.map((item) => item.key), '$/plan/issues');
  unique(plan.order, '$/plan/order');
  require(plan.order.length === issues.size && plan.order.every((key) => issues.has(key)), '$/plan/order', 'order-not-exact');
  const positions = new Map(plan.order.map((key, index) => [key, index]));
  const briefCriteria = new Set(brief.criteria.map((item) => item.id));
  const coveredCriteria = new Set();
  plan.issues.forEach((issue, index) => {
    const location = `$/plan/issues/${index}`;
    unique(issue.dependencies, `${location}/dependencies`);
    unique(issue.criteria.map((item) => item.id), `${location}/criteria`);
    unique(issue.briefCriteria, `${location}/briefCriteria`);
    for (const criterion of issue.briefCriteria) {
      require(briefCriteria.has(criterion), `${location}/briefCriteria`, 'unknown-brief-criterion');
      coveredCriteria.add(criterion);
    }
    for (const target of issue.dependencies) {
      require(issueUrl.test(target) || issues.has(target), `${location}/dependencies`, 'unknown-dependency');
      if (issues.has(target)) require(positions.get(target) < positions.get(issue.key), `${location}/dependencies`, 'dependency-order');
      else if (issueUrl.test(target)) require(readiness.dependencyEvidence.some((proof) => proof.issueKey === issue.key && proof.dependency === target && proof.url === target), `${location}/dependencies`, 'external-dependency-unverified');
    }
  });
  if (stage >= 3) require([...briefCriteria].every((key) => coveredCriteria.has(key)), '$/plan/issues', 'brief-criterion-uncovered');

  const mutations = new Map(plan.mutations.map((mutation) => [mutation.key, mutation]));
  unique(plan.mutations.map((item) => item.key), '$/plan/mutations');
  const briefMutations = plan.mutations.filter((mutation) => mutation.kind === 'publish-brief');
  if (stage >= 3) require(briefMutations.length === 1, '$/plan/mutations', 'exactly-one-published-brief-required');
  const issueMutations = new Map();
  const relations = [];
  plan.mutations.forEach((mutation, index) => {
    const location = `$/plan/mutations/${index}`;
    const issue = issues.get(mutation.issueKey);
    require(Boolean(issue) || (mutation.kind === 'publish-brief' && mutation.issueKey === null), `${location}/issueKey`, 'unknown-mutation-issue');
    if (!issue && !(mutation.kind === 'publish-brief' && mutation.issueKey === null)) return;
    let payload;
    try { payload = parseJson(mutation.payload); } catch { add(`${location}/payload`, 'mutation-json-required'); return; }
    requireCondition(inspectFile('', canonical(payload)).findings.length === 0, 'guard-rejected-input');
    if (mutation.kind === 'publish-brief') {
      require(same(payload, { body: renderBrief(record) }), `${location}/payload`, 'brief-payload-mismatch');
      require(mutation.issueKey === null ? issueUrl.test(mutation.target) && mutation.target.startsWith(`${plan.repository}/issues/`) : mutation.target === plan.repository, `${location}/target`, 'brief-destination-mismatch');
    } else if (['create-issue', 'update-issue'].includes(mutation.kind)) {
      require(!issueMutations.has(issue.key), location, 'duplicate-issue-mutation');
      issueMutations.set(issue.key, mutation);
      require(same(payload, { title: issue.title, body: renderIssueBody(issue, record), labels: issue.labels }), `${location}/payload`, 'issue-payload-mismatch');
      require(mutation.kind === 'create-issue' ? mutation.target === plan.repository : issueUrl.test(mutation.target) && mutation.target.startsWith(`${plan.repository}/issues/`), `${location}/target`, 'mutation-destination-mismatch');
    } else if (mutation.kind === 'project-update') {
      require(plan.project !== null && mutation.target === plan.project, `${location}/target`, 'mutation-destination-mismatch');
      require(payload && typeof payload === 'object' && same(Object.keys(payload).sort(), ['field', 'value']) && typeof payload.field === 'string' && payload.field.trim().length > 0 && (payload.value === null || typeof payload.value === 'string'), `${location}/payload`, 'project-payload-invalid');
    } else {
      require(mutation.target === plan.repository, `${location}/target`, 'mutation-destination-mismatch');
      require(payload && typeof payload === 'object' && same(Object.keys(payload).sort(), ['relation', 'targetIssue']) && ['parent', 'blocked-by'].includes(payload.relation) && typeof payload.targetIssue === 'string' && (issues.has(payload.targetIssue) || issueUrl.test(payload.targetIssue)) && payload.targetIssue !== issue.key, `${location}/payload`, 'relation-payload-invalid');
      if (payload?.relation === 'blocked-by') require(issue.dependencies.includes(payload.targetIssue), `${location}/payload`, 'relation-dependency-mismatch');
      if (payload && ['parent', 'blocked-by'].includes(payload.relation) && typeof payload.targetIssue === 'string') relations.push({ issueKey: issue.key, ...payload });
    }
  });
  if (stage >= 3) require([...issues.keys()].every((key) => issueMutations.has(key)), '$/plan/mutations', 'issue-mutation-missing');
  const updateTargets = [...issueMutations.values()].filter((mutation) => mutation.kind === 'update-issue');
  unique(updateTargets.map((mutation) => mutation.target), '$/plan/mutations');

  unique(publication.receipts.map((item) => item.mutationKey), '$/publication/receipts');
  const receipts = new Map(publication.receipts.map((item) => [item.mutationKey, item]));
  const issueReceipts = new Map();
  publication.receipts.forEach((receipt, index) => {
    const location = `$/publication/receipts/${index}`;
    const mutation = mutations.get(receipt.mutationKey);
    require(Boolean(mutation), location, 'unknown-receipt-mutation');
    if (!mutation) return;
    require(receipt.digest === digests.mutations[mutation.key], `${location}/digest`, 'receipt-stale');
    require(approvals.publication !== null && Date.parse(receipt.readAt) >= Date.parse(approvals.publication.at), `${location}/readAt`, 'receipt-before-approval');
    if (['create-issue', 'update-issue'].includes(mutation.kind)) {
      require(issueUrl.test(receipt.url) && receipt.url.startsWith(`${plan.repository}/issues/`), `${location}/url`, 'receipt-destination-mismatch');
      if (mutation.kind === 'update-issue') require(receipt.url === mutation.target, `${location}/url`, 'receipt-destination-mismatch');
      issueReceipts.set(mutation.issueKey, receipt);
    } else if (mutation.kind === 'project-update') require(receipt.url === mutation.target, `${location}/url`, 'receipt-destination-mismatch');
    else if (mutation.kind !== 'publish-brief') require(issueUrl.test(receipt.url) && receipt.url.startsWith(`${plan.repository}/issues/`), `${location}/url`, 'receipt-destination-mismatch');
  });
  unique([...issueReceipts.values()].map((item) => item.url), '$/publication/receipts');
  publication.receipts.forEach((receipt, index) => {
    const mutation = mutations.get(receipt.mutationKey);
    if (mutation?.kind === 'link-dependency') require(receipt.url === issueReceipts.get(mutation.issueKey)?.url, `$/publication/receipts/${index}/url`, 'relation-receipt-issue-mismatch');
    if (mutation?.kind === 'publish-brief') {
      const destination = mutation.issueKey === null ? mutation.target : issueReceipts.get(mutation.issueKey)?.url;
      require(Boolean(destination) && issueCommentUrl.test(receipt.url) && receipt.url.split('#')[0] === destination, `$/publication/receipts/${index}/url`, 'brief-receipt-destination-mismatch');
    }
  });
  if (stage >= 5) require(plan.mutations.every((item) => receipts.has(item.key)), '$/publication/receipts', 'publication-incomplete');

  // Resolve both pre-existing updates and newly created/read-back URLs before graph checks.
  const aliases = new Map(updateTargets.map((mutation) => [mutation.target, mutation.issueKey]));
  for (const [key, receipt] of issueReceipts) {
    require(!aliases.has(receipt.url) || aliases.get(receipt.url) === key, '$/publication/receipts', 'ambiguous-issue-url');
    aliases.set(receipt.url, key);
  }
  const localKey = (target) => aliases.get(target) ?? target;
  unique(relations.map((relation) => `${relation.issueKey}:${relation.relation}:${localKey(relation.targetIssue)}`), '$/plan/mutations');
  const active = new Set();
  const visited = new Set();
  function visit(key) {
    if (active.has(key)) { add('$/plan/issues', 'dependency-cycle'); return; }
    if (visited.has(key)) return;
    active.add(key);
    for (const target of issues.get(key).dependencies.map(localKey)) if (issues.has(target)) visit(target);
    active.delete(key); visited.add(key);
  }
  for (const issue of plan.issues) {
    unique(issue.dependencies.map(localKey), '$/plan/issues');
    for (const target of issue.dependencies.map(localKey)) {
      require(target !== issue.key, '$/plan/issues', 'self-dependency');
      if (issues.has(target)) {
        require(positions.get(target) < positions.get(issue.key), '$/plan/issues', 'dependency-order');
        require(relations.some((relation) => relation.issueKey === issue.key && relation.relation === 'blocked-by' && localKey(relation.targetIssue) === target), '$/plan/mutations', 'internal-dependency-link-missing');
      }
    }
    visit(issue.key);
  }
  const parents = new Map();
  for (const relation of relations.filter((item) => item.relation === 'parent')) {
    const target = localKey(relation.targetIssue);
    require(target !== relation.issueKey, '$/plan/mutations', 'self-parent');
    require(!parents.has(relation.issueKey), '$/plan/mutations', 'multiple-parents');
    parents.set(relation.issueKey, target);
  }
  for (const key of parents.keys()) {
    const seen = new Set();
    let current = key;
    while (parents.has(current)) {
      if (seen.has(current)) { add('$/plan/mutations', 'parent-cycle'); break; }
      seen.add(current); current = parents.get(current);
    }
  }

  unique(readiness.dependencyEvidence.map((item) => `${item.issueKey}:${item.dependency}`), '$/readiness/dependencyEvidence');
  readiness.dependencyEvidence.forEach((proof, index) => {
    const location = `$/readiness/dependencyEvidence/${index}`;
    require(issues.get(proof.issueKey)?.dependencies.includes(proof.dependency), location, 'unplanned-dependency-proof');
    require(Date.parse(proof.verifiedAt) >= Date.parse(record.source.capturedAt), `${location}/verifiedAt`, 'dependency-proof-before-source');
    if (issueUrl.test(proof.dependency)) require(proof.url === proof.dependency, `${location}/url`, 'dependency-proof-url-mismatch');
    else require(issueReceipts.get(proof.dependency)?.url === proof.url, `${location}/url`, 'internal-dependency-unpublished');
  });
  unique(readiness.handoffs.map((item) => item.issueKey), '$/readiness/handoffs');
  readiness.handoffs.forEach((handoff, index) => {
    const location = `$/readiness/handoffs/${index}`;
    const issue = issues.get(handoff.issueKey);
    require(Boolean(issue), location, 'unknown-handoff-issue');
    if (!issue) return;
    const receipt = issueReceipts.get(issue.key);
    require(Boolean(receipt), location, 'handoff-issue-unpublished');
    const briefReceipt = briefMutations.length === 1 ? receipts.get(briefMutations[0].key) : undefined;
    require(Boolean(briefReceipt) && handoff.briefReference.url === briefReceipt.url && handoff.briefReference.digest === digests.brief, `${location}/briefReference`, 'handoff-brief-reference-mismatch');
    require(handoff.contract.githubIssue === receipt?.url && handoff.contract.objective === issue.title && same(handoff.contract.scope, issue.scope) && same(handoff.contract.acceptanceCriteria, issue.criteria.flatMap((item) => [item.positive, item.negative])) && same(handoff.contract.validation, issue.validation), `${location}/contract`, 'handoff-contract-mismatch');
    require(handoff.contract.authorization.source !== approvals.publication?.source, `${location}/contract/authorization`, 'execution-authorization-not-distinct');
    for (const target of issue.dependencies) require(readiness.dependencyEvidence.some((proof) => proof.issueKey === issue.key && proof.dependency === target && proof.state === 'satisfied'), location, 'handoff-dependency-unsatisfied');
  });
  return errors;
}

export function validateRefinement(record) {
  try {
    const { refinement, contract } = schemas();
    const errors = validateJsonSchema(record, refinement, { 'task-contract.schema.json': contract });
    if (errors.length > 0) return { valid: false, errors, digests: null, limits };
    const digests = computeDigests(record);
    errors.push(...checkSemantics(record, digests));
    return { valid: errors.length === 0, errors, digests, limits };
  } catch (error) {
    return { valid: false, errors: [{ path: '$', code: error instanceof RefinementError ? error.code : 'validation-unavailable' }], digests: null, limits };
  }
}

export function main(args = process.argv.slice(2), cwd = process.cwd(), write = (line) => process.stdout.write(`${line}\n`)) {
  const mode = args.length === 2 ? args[0] : 'check';
  const file = args.length === 2 ? args[1] : args[0];
  if (!file || !((args.length === 1 && !file.startsWith('--')) || (args.length === 2 && ['--digests', '--contract'].includes(mode)))) {
    write('Usage: node scripts/refinement-check.mjs <dossier.json> | --digests <dossier.json> | --contract <contrat.json>');
    return 2;
  }
  try {
    const value = readJsonSafe(path.resolve(cwd, file));
    const result = mode === '--contract' ? validateTaskContract(value) : validateRefinement(value);
    if (mode === '--digests' && result.digests) {
      write(JSON.stringify({ digests: result.digests, limits }));
      return 0; // Preparing fingerprints is not validating stage or granting approval.
    }
    write(JSON.stringify(result));
    return result.valid ? 0 : 1;
  } catch (error) {
    write(JSON.stringify({ valid: false, errors: [{ path: '$', code: error instanceof RefinementError ? error.code : 'validation-unavailable' }], limits }));
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
