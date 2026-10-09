import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile } from '../guard.mjs';
import { readJsonSafe, validateJsonSchema } from '../refinement-check.mjs';
import { containedPath, digest } from './verification-evidence.mjs';
import { auditCatalog, discoverRecipeRepository, parseScenario, reportCampaign } from './browser-recipe.mjs';
import { checkRecipeImpact } from './browser-recipe-impact.mjs';

const schemaPath = fileURLToPath(new URL('../../harness/schemas/browser-recipe-delivery.schema.json', import.meta.url));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { deliveryCode: code }); };
const identity = deployment => Object.fromEntries(['environment', 'id', 'commit', 'url'].map(key => [key, deployment[key]]));
const selectionIdentity = selection => selection.map(({ id, revision, contentSha256 }) => ({ id, revision, contentSha256 }));

/** The review covers the frozen baseline, proposals and impact references. */
export function recipeDeliveryScopeDigest(scope) { const copy = { ...scope }; delete copy.review; return digest(canonical(copy)); }
/** Admission adds approval metadata but does not change the chosen content. */
export function recipeDeliveryChoiceDigest(deployment, selection) { return digest(canonical({ deployment: identity(deployment), selection: selectionIdentity(selection) })); }

/** Read-only gate. It never records a decision, admits a recipe or runs a browser. */
export function checkRecipeDelivery({ root = process.cwd(), inputPath, now = new Date() } = {}) {
  const references = new Map();
  const output = { state: 'BLOCKED', manualReady: false, browserReady: false, scopeDigest: null, selection: [], diagnostics: [], references: [], reservations: [], consentAuthenticated: false, browserExecuted: false };
  const finish = (state, diagnostic) => {
    output.state = state; output.manualReady = state === 'READY_FOR_MANUAL'; output.browserReady = state === 'CAMPAIGN_REQUIRED';
    if (diagnostic) output.diagnostics.push(diagnostic);
    output.references = [...references].map(([file, sha256]) => ({ path: file, sha256 })).sort((a, b) => a.path.localeCompare(b.path));
    return output;
  };
  try {
    const schema = readJsonSafe(schemaPath);
    const validate = (value, name) => need(validateJsonSchema(value, { $ref: `#/$defs/${name}`, $defs: schema.$defs }).length === 0, `recipe-delivery-invalid-${name}`);
    const clock = now instanceof Date ? now.getTime() : Date.parse(now);
    need(Number.isFinite(clock), 'recipe-delivery-invalid-clock');
    const date = value => {
      const time = Date.parse(value);
      need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(time) && time <= clock && new Date(time).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), 'recipe-delivery-invalid-date');
      return time;
    };
    const read = (relative, expected, base = root) => {
      need(typeof relative === 'string' && !/[\\:\0*?]/.test(relative) && !relative.startsWith('/') && relative.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), 'recipe-delivery-invalid-path');
      const absolute = containedPath(base, relative); const before = lstatSync(absolute);
      need(before.isFile() && before.size > 0 && before.size <= 1024 * 1024, 'recipe-delivery-reference-size');
      let descriptor; let bytes;
      try {
        descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(descriptor); bytes = readFileSync(descriptor); const after = fstatSync(descriptor);
        need(opened.isFile() && before.ino === opened.ino && before.dev === opened.dev && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs && bytes.length <= 1024 * 1024, 'recipe-delivery-reference-changed');
      } finally { if (descriptor !== undefined) closeSync(descriptor); }
      const scan = inspectFile(relative, bytes);
      need(!scan.binary && scan.findings.length === 0, 'recipe-delivery-unsafe-reference');
      const sha256 = digest(bytes); need(!expected || expected === sha256, 'recipe-delivery-reference-drift');
      // Primary-root campaign files may live outside a linked checkout. Keep their
      // absolute path in returned evidence, never accept absolute input paths.
      const referencePath = path.resolve(base) === path.resolve(root) ? relative : absolute;
      need(!references.has(referencePath) || references.get(referencePath) === sha256, 'recipe-delivery-reference-changed');
      references.set(referencePath, sha256);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    };
    const ref = value => read(value.path, value.sha256);
    const json = (relative, expected, base = root) => {
      const text = read(relative, expected, base); const value = readJsonSafe(containedPath(base, relative));
      need(canonical(value) === canonical(JSON.parse(text)), 'recipe-delivery-reference-changed'); return value;
    };
    const input = json(inputPath); validate(input, 'input'); date(input.recordedAtUtc);
    const target = input.deployment;
    const url = new URL(target.url);
    need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'recipe-delivery-unsafe-url');
    ref(target.source); date(target.observedAt); ref(input.qa.source);
    const qaAt = date(input.qa.completedAt);
    need(input.qa.status === 'PASS', 'recipe-delivery-qa-required');
    const scope = json(input.scope.path, input.scope.sha256); validate(scope, 'scope'); const scopeAt = date(scope.recordedAtUtc);
    const review = json(scope.review.path, scope.review.sha256); validate(review, 'review');
    need(date(review.recordedAtUtc) >= scopeAt && review.scopeDigest === recipeDeliveryScopeDigest(scope), 'recipe-delivery-review-stale');
    need(review.status === 'PASS' && review.cleanContext && !scope.authors.some(author => author.toLowerCase() === review.reviewer.toLowerCase()), 'recipe-delivery-independent-review-required');
    need(scope.review.path !== input.scope.path && review.evidence.path !== scope.review.path && review.evidence.path !== input.scope.path, 'recipe-delivery-self-reference'); ref(review.evidence);
    const baseline = new Set(scope.baseline.map(item => item.id));
    need(baseline.size === scope.baseline.length && scope.baseline.every(item => Number.isSafeInteger(item.revision) && item.revision > 0), 'recipe-delivery-invalid-baseline');
    const added = new Set();
    for (const item of scope.impacts) {
      const analysis = json(item.path, item.sha256);
      const checked = checkRecipeImpact({ root, impactPath: item.path, candidate: analysis.candidate, now });
      for (const reference of checked.references) ref(reference);
      for (const conclusion of analysis.conclusions) if (conclusion.kind === 'added') for (const id of conclusion.scenarioIds) added.add(id);
      output.reservations.push(...checked.reservations);
    }
    const proposals = scope.proposals.map(item => ({ ...parseScenario(ref(item), { root, requireApproval: false }), path: item.path }));
    for (const item of proposals) for (const reference of item.metadata.references) if (!reference.startsWith('https://')) read(reference);
    need(new Set(proposals.map(item => item.metadata.id)).size === proposals.length, 'recipe-delivery-duplicate-proposal');
    const selected = proposals.filter(item => !baseline.has(item.metadata.id));
    need(selected.length === added.size && selected.every(item => added.has(item.metadata.id)) && [...added].every(id => !baseline.has(id)), 'recipe-delivery-added-coverage-incomplete');
    need(selected.every(item => item.metadata.status === 'active'), 'recipe-delivery-retired-proposal');
    output.selection = selected.map(item => ({ id: item.metadata.id, revision: item.metadata.revision, title: item.metadata.title, contentSha256: item.contentSha256, proposal: { path: item.path, sha256: item.sha256 }, outcome: 'NOT_RUN' }));
    output.scopeDigest = recipeDeliveryChoiceDigest(target, output.selection);
    if (!selected.length) return finish('READY_FOR_MANUAL', 'recipe-delivery-no-new-recipes');
    const choice = (reference, isOverride = false) => {
      const decision = json(reference.path, reference.sha256); validate(decision, isOverride ? 'override' : 'choice');
      need(decision.scopeDigest === output.scopeDigest, 'recipe-delivery-choice-stale');
      // completedAt identifies initial QA qualification. Refreshing a scope
      // review or rebuilding identical scope evidence does not reset the choice.
      need(date(decision.decidedAt) >= qaAt, 'recipe-delivery-choice-predates-qa');
      need(ref(decision.source).includes(decision.quote), 'recipe-delivery-choice-quote-missing');
      return decision;
    };
    if (!input.decision) return finish('CHOICE_REQUIRED', 'recipe-delivery-human-choice-required');
    let decision;
    try { decision = choice(input.decision); }
    catch (error) { return finish('CHOICE_REQUIRED', error.deliveryCode ?? 'recipe-delivery-choice-unavailable'); }
    const repo = discoverRecipeRepository(root);
    const campaignStore = 'artifacts/functional-browser/campaigns';
    const campaignDirectory = containedPath(repo.primaryRoot, campaignStore, true);
    // An incomplete or failed run cannot disappear merely by removing its
    // reference from the delivery dossier. Only inspect the local recipe store.
    if (existsSync(campaignDirectory)) {
      const ids = readdirSync(campaignDirectory); need(ids.length <= 1000, 'recipe-delivery-campaign-size');
      for (const id of ids) {
        need(/^[a-z0-9][a-z0-9-]{0,79}$/.test(id), 'recipe-delivery-invalid-campaign');
        const folder = `${campaignStore}/${id}`;
        const manifest = json(`${folder}/manifest.json`, undefined, repo.primaryRoot);
        if (canonical(identity(manifest.deployment)) !== canonical(identity(target)) || date(manifest.startedAt) < qaAt) continue;
        need(Array.isArray(manifest.selection), 'recipe-delivery-invalid-campaign');
        let applicable = false;
        for (const row of manifest.selection) {
          const proposal = selected.find(item => item.metadata.id === row.id && item.metadata.revision === row.revision);
          if (!proposal) continue;
          const snapshot = parseScenario(read(`${folder}/scenarios/${row.id}.md`, row.sha256, repo.primaryRoot));
          if (snapshot.contentSha256 === proposal.contentSha256) applicable = true;
        }
        if (applicable && !input.campaigns.some(item => item.id === id)) {
          output.reservations.push(`Campagne ${id} existante à rapprocher avant la remise manuelle.`);
          return finish('REDECISION_REQUIRED', 'recipe-delivery-existing-campaign-omitted');
        }
      }
    }
    if (decision.mode === 'manual' && input.campaigns.length === 0) {
      output.reservations.push('Browser Use non exécuté pour cette sélection ; remise manuelle choisie explicitement.');
      return finish('READY_FOR_MANUAL');
    }
    const catalog = auditCatalog({ root });
    const admitted = selected.map(item => catalog.scenarios.find(current => current.metadata.id === item.metadata.id && current.metadata.revision === item.metadata.revision && current.contentSha256 === item.contentSha256 && current.metadata.status === 'active'));
    for (const item of catalog.scenarios) { read(item.path, item.sha256); for (const reference of item.metadata.references) if (!reference.startsWith('https://')) read(reference); }
    if (admitted.some(item => !item)) return finish('ADMISSION_REQUIRED', 'recipe-delivery-exact-admission-required');
    if (!input.campaigns.length) return finish('CAMPAIGN_REQUIRED', 'recipe-delivery-campaign-not-run');
    const reports = [];
    need(new Set(input.campaigns.map(item => item.id)).size === input.campaigns.length, 'recipe-delivery-duplicate-campaign');
    for (const item of input.campaigns) {
      const folder = `artifacts/functional-browser/campaigns/${item.id}`;
      // Capture every supporting immutable campaign file; reportCampaign then
      // reconstructs results from the manifest, snapshots and attempt records.
      let count = 0;
      const capture = relative => {
        need(++count <= 10000, 'recipe-delivery-campaign-size');
        const absolute = containedPath(repo.primaryRoot, relative); const stat = lstatSync(absolute);
        if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) capture(`${relative}/${name}`);
        else read(relative, undefined, repo.primaryRoot);
      };
      capture(folder);
      const saved = json(item.report.path, item.report.sha256, item.report.path === `${folder}/finish.json` ? repo.primaryRoot : root);
      const report = reportCampaign({ root, campaignId: item.id });
      need(canonical(saved) === canonical(report), 'recipe-delivery-report-drift');
      const manifest = json(`${folder}/manifest.json`, undefined, repo.primaryRoot);
      const exact = canonical(identity(report.deployment)) === canonical(identity(target)) && report.deployment.verified && report.selection.length === admitted.length && report.selection.every((row, index) => row.id === admitted[index].metadata.id && row.revision === admitted[index].metadata.revision && row.sha256 === admitted[index].sha256);
      const startedAt = date(manifest.startedAt);
      const lastObservation = Math.max(startedAt, ...report.selection.flatMap(row => row.history.map(attempt => date(attempt.result?.endedAt ?? attempt.startedAt))));
      // Unfinished campaigns use a frozen reportCampaign snapshot and an
      // observation date. A later attempt invalidates that snapshot and choice.
      const finishedAt = date(report.finishedAt ?? item.observedAt);
      need(finishedAt >= lastObservation, 'recipe-delivery-observation-predates-results');
      const timely = startedAt >= date(decision.decidedAt) && finishedAt >= startedAt;
      reports.push({ report, reference: item.report, applicable: exact, exact: exact && timely, finishedAt });
    }
    reports.sort((a, b) => a.finishedAt - b.finishedAt);
    const latest = reports.at(-1);
    output.selection = output.selection.map(item => ({ ...item, outcome: latest.applicable ? latest.report.selection.find(row => row.id === item.id)?.outcome ?? 'NOT_RUN' : 'NOT_RUN' }));
    for (const item of reports) if (!item.exact || !item.report.allPassed || !item.report.complete || !item.report.finishedAt) output.reservations.push(`Campagne ${item.report.campaignId} : ${!item.applicable ? 'version ou sélection inapplicable' : item.report.selection.map(row => `${row.id}=${row.outcome}`).join(', ')}${!item.exact ? ' ; date ou portée inapplicable' : ''}${!item.report.finishedAt ? ' ; non finalisée' : ''}.`);
    if (decision.mode === 'browser' && latest.exact && latest.report.finishedAt && latest.report.allPassed && latest.report.complete && !latest.report.stopped) return finish('READY_FOR_MANUAL');
    if (input.manualOverride) {
      try {
        const override = choice(input.manualOverride, true);
        need(date(override.decidedAt) >= Math.max(...reports.map(item => item.finishedAt)), 'recipe-delivery-override-predates-results');
        need(canonical(override.reports) === canonical(input.campaigns.map(item => item.report)), 'recipe-delivery-override-reports-stale');
        output.reservations.push(...override.reservations);
        return finish('READY_FOR_MANUAL', 'recipe-delivery-explicit-manual-after-results');
      } catch (error) { return finish('REDECISION_REQUIRED', error.deliveryCode ?? 'recipe-delivery-override-unavailable'); }
    }
    return finish('REDECISION_REQUIRED', 'recipe-delivery-results-require-explicit-manual-or-remediation');
  } catch (error) { return finish('BLOCKED', error.deliveryCode ?? 'recipe-delivery-evidence-unavailable'); }
}
