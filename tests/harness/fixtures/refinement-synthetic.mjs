// Fabricated test approvals, Issues and observations. Never use as delivery evidence.
import { readFileSync } from 'node:fs';
import { computeDigests, renderBrief, renderIssueBody } from '../../../scripts/refinement-check.mjs';

export const fixtureRepo = 'https://github.com/example/hestia-fixture';
export const fixtureDate = '2026-09-12T14:00:00Z';
export const clone = (value) => structuredClone(value);

export function candidate() {
  const record = JSON.parse(readFileSync(new URL('../../../harness/templates/refinement.template.json', import.meta.url), 'utf8'));
  record.stage = 'brief-candidate';
  record.source = { original: 'Je veux retrouver mes exemples synthétiques même après avoir rechargé la page.', capturedAt: fixtureDate, reference: 'Scénario intégralement synthétique de test, aucune demande réelle.' };
  record.nuances = ['Le résultat doit persister au rechargement, sans document privé.'];
  record.plan.repository = fixtureRepo;
  record.plan.project = null;
  record.brief = {
    need: 'Retrouver les exemples synthétiques sélectionnés.',
    outcome: 'Après rechargement, retrouver les exemples préalablement retenus.',
    actors: ['Membre fictif du foyer de test'],
    scope: { included: ['Sélection et lecture des exemples embarqués.'], excluded: ['Import personnel, service distant et déploiement.'] },
    decisions: {
      product: [{ id: 'D_PRODUCT', status: 'accepted', statement: 'Conserver seulement les références des exemples embarqués.', rationale: 'Le test ne doit pas recevoir de données privées.', source: 'Décision synthétique du scénario, 2026-09-12.' }],
      ux: [{ id: 'D_UX', status: 'proposed', statement: 'Afficher une confirmation de sélection.', rationale: 'Expliquer le résultat du geste.', source: null }],
      security: [{ id: 'D_SECURITY', status: 'accepted', statement: 'Aucun contenu familial réel.', rationale: 'Limiter le jeu aux fixtures.', source: 'Contrat synthétique du scénario, 2026-09-12.' }],
      architecture: []
    },
    questions: [], hypotheses: [], risks: [], preparations: [],
    criteria: [{ id: 'C_KEEP', positive: 'La sélection du document synthétique est conservée après rechargement.', negative: 'Un identifiant extérieur au jeu embarqué est refusé.', evidence: 'Test de sélection, rechargement puis tentative avec référence inconnue.' }]
  };
  return record;
}

export function approval(digest) {
  return { author: 'Responsable SYNTHETIQUE de test', at: fixtureDate, source: 'ACCORD FABRIQUE POUR TEST UNIQUEMENT ; aucune autorisation réelle.', explicit: true, digest };
}

export function signBrief(record) {
  record.approvals.brief = approval(computeDigests(record).brief);
  return record;
}

export function refreshMutations(record) {
  const previousBrief = record.plan.mutations.find((mutation) => mutation.kind === 'publish-brief');
  const briefMutation = { key: 'publish_brief', kind: 'publish-brief', target: previousBrief?.target ?? `${fixtureRepo}/issues/3`, issueKey: previousBrief?.issueKey ?? null, payload: JSON.stringify({ body: renderBrief(record) }) };
  record.plan.mutations = [briefMutation];
  const issueMutations = record.plan.issues.map((issue) => ({
    key: `publish_${issue.key}`, kind: 'create-issue', target: fixtureRepo, issueKey: issue.key,
    payload: JSON.stringify({ title: issue.title, body: renderIssueBody(issue, record), labels: issue.labels })
  }));
  record.plan.mutations = [...issueMutations, briefMutation];
  for (const issue of record.plan.issues) {
    for (const dependency of issue.dependencies.filter((value) => !value.startsWith('https://'))) {
      record.plan.mutations.push({ key: `link_${issue.key}_${dependency}`, kind: 'link-dependency', target: fixtureRepo, issueKey: issue.key, payload: JSON.stringify({ relation: 'blocked-by', targetIssue: dependency }) });
    }
  }
  return record;
}

export function plan() {
  const record = candidate();
  record.stage = 'plan-proposed';
  record.plan.issues = [
    { key: 'keep', title: 'Retrouver une sélection synthétique après rechargement', body: 'Un membre fictif choisit un exemple embarqué puis le retrouve.', labels: ['fixture'], scope: { included: ['Sélection synthétique persistante.'], excluded: ['Document privé ou appel externe.'], ownedPaths: ['src/domain/synthetic-selection.ts'] }, briefCriteria: ['C_KEEP'], criteria: clone(record.brief.criteria), validation: ['Test intégré sélection et rechargement avec refus de référence inconnue.'], dependencies: [`${fixtureRepo}/issues/7`] },
    { key: 'clear', title: 'Effacer volontairement une sélection synthétique', body: 'Le membre fictif remet sa sélection à zéro.', labels: ['fixture'], scope: { included: ['Effacement explicite des références sélectionnées.'], excluded: ['Effacement de document ou déploiement.'], ownedPaths: ['src/domain/synthetic-clear.ts'] }, briefCriteria: ['C_KEEP'], criteria: [{ id: 'C_CLEAR', positive: 'Après confirmation, aucune référence sélectionnée ne revient au rechargement.', negative: 'Annuler la confirmation conserve la sélection.', evidence: 'Parcours confirmer et annuler puis recharger.' }], validation: ['Test du parcours confirmation et annulation.'], dependencies: ['keep'] }
  ];
  record.plan.order = ['keep', 'clear'];
  record.readiness.dependencyEvidence = [{ issueKey: 'keep', dependency: `${fixtureRepo}/issues/7`, url: `${fixtureRepo}/issues/7`, verifiedAt: fixtureDate, state: 'satisfied', evidence: 'OBSERVATION FABRIQUEE : fixture locale connue, candidat synthetic-v1, tests réussis dans le scénario.' }];
  refreshMutations(record);
  return signBrief(record);
}

export function authorized() {
  const record = plan();
  record.stage = 'publication-authorized';
  record.approvals.publication = approval(computeDigests(record).publication);
  return record;
}

export function published() {
  const record = authorized();
  record.stage = 'published';
  const digests = computeDigests(record);
  const urls = new Map(record.plan.issues.map((issue, i) => [issue.key, `${fixtureRepo}/issues/${101 + i}`]));
  record.publication.receipts = record.plan.mutations.map((mutation) => ({ mutationKey: mutation.key, url: mutation.kind === 'publish-brief' ? `${fixtureRepo}/issues/3#issuecomment-500` : urls.get(mutation.issueKey), readAt: fixtureDate, evidence: 'RELECTURE FABRIQUEE : contenu exact et relations vérifiés dans la simulation uniquement.', digest: digests.mutations[mutation.key] }));
  return record;
}

export function handoff(record, issueKey) {
  const issue = record.plan.issues.find((entry) => entry.key === issueKey);
  const mutation = record.plan.mutations.find((entry) => entry.issueKey === issueKey && ['create-issue', 'update-issue'].includes(entry.kind));
  const receipt = record.publication.receipts.find((entry) => entry.mutationKey === mutation.key);
  const briefReceipt = record.publication.receipts.find((entry) => entry.mutationKey === 'publish_brief');
  return { issueKey, authorizationConfirmedSeparately: true, briefReference: { url: briefReceipt.url, digest: computeDigests(record).brief }, contract: {
    id: `synthetic-${issueKey}`, objective: issue.title, githubIssue: receipt.url,
    scope: clone(issue.scope), dataPolicy: 'synthetic-only',
    authorization: { source: 'AUTORISATION EXECUTION FABRIQUEE DISTINCTE : test local synthétique, 2026-09-12.', allowedActions: ['Implémenter et vérifier localement ce scénario synthétique.'], forbiddenActions: ['GitHub, données familiales, réseau, coûts et déploiements.'] },
    acceptanceCriteria: issue.criteria.flatMap((criterion) => [criterion.positive, criterion.negative]), validation: clone(issue.validation),
    independentReview: { required: true, reviewerMustDifferFromAuthor: true, cleanContext: true, candidateIdentity: 'commit-sha-and-worktree-or-sha256-manifest' }, deliveryTarget: 'local'
  } };
}

export function ready() {
  const record = published();
  record.stage = 'ready';
  record.readiness.handoffs = [handoff(record, 'keep')];
  return record;
}
