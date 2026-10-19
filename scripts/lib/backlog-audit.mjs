import { execFileSync } from 'node:child_process';

const requireCondition = (condition, code) => { if (!condition) throw new Error(code); };
const repoPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
// Exact supported vocabularies. Unknown fields still require an explicit mapping.
const statusMappings = [
  { pending: 'Todo', options: ['Todo', 'In Progress', 'Done'] },
  { pending: 'À faire', options: ['À faire', 'In Progress', 'Partiellement livré', 'Livré — à qualifier', 'Done'] },
];

/** Only named read commands are exposed. No shell, writes, or consent inference. */
export function collectBacklog({ repository, project, owner, command = (args) => execFileSync('gh', args, {
  encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
}) } = {}) {
  requireCondition(repoPattern.test(repository ?? ''), 'invalid-repository');
  requireCondition(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(owner ?? '') && Number.isSafeInteger(project) && project > 0, 'invalid-project');
  const startedAtUtc = new Date().toISOString();
  const pages = {};
  const readAll = (name, endpoint, fields) => {
    const records = []; const seen = new Set();
    for (let page = 1; page <= 100; page++) {
      const result = JSON.parse(command(['api', '--method', 'GET', `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`, '--jq', `map({${fields}})`]));
      requireCondition(Array.isArray(result) && result.length <= 100, 'invalid-api-page');
      for (const item of result) {
        requireCondition(Number.isSafeInteger(item.id) && !seen.has(item.id), 'duplicate-or-missing-record');
        seen.add(item.id); records.push(item);
      }
      if (result.length < 100) { pages[name] = page; return records; }
    }
    throw new Error('pagination-limit-incomplete');
  };
  // The Issues REST endpoint also returns PRs. Keep that marker until filtering.
  const issues = readAll('issues', `repos/${repository}/issues?state=all`, 'id,number,title,state,html_url,updated_at,pull_request');
  const pulls = readAll('pulls', `repos/${repository}/pulls?state=all`, 'id,number,title,body,merged_at,html_url');
  const comments = readAll('comments', `repos/${repository}/issues/comments`, 'id,issue_url,created_at,html_url');
  const board = JSON.parse(command(['project', 'item-list', String(project), '--owner', owner, '--limit', '10000', '--format', 'json']));
  requireCondition(Array.isArray(board.items) && Number.isSafeInteger(board.totalCount) && board.totalCount === board.items.length, 'project-inventory-incomplete');
  const fields = JSON.parse(command(['project', 'field-list', String(project), '--owner', owner, '--limit', '1000', '--format', 'json']));
  requireCondition(Array.isArray(fields.fields) && fields.totalCount === fields.fields.length, 'project-fields-incomplete');
  return { repository, project, owner, startedAtUtc, finishedAtUtc: new Date().toISOString(), pages,
    issues: issues.filter(item => !item.pull_request), pulls, comments, board, fields };
}

/** References are candidates for human/agent review, never proof of completion. */
export function referencedIssues(body, repository) {
  const found = new Set();
  // Remove URLs and cross-repository shorthand before resolving local #numbers.
  const text = (body ?? '').replace(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)\b/gi,
    (url, repo, number) => { if (repo.toLowerCase() === repository.toLowerCase()) found.add(Number(number)); return ' '; })
    .replace(/https?:\/\/\S+/g, ' ').replace(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+/g, ' ');
  for (const match of text.matchAll(/(?:^|[^\w/#])#([1-9]\d*)\b/g)) found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

export function auditBacklog(snapshot) {
  const { repository, issues, pulls, comments, board } = snapshot;
  requireCondition(repoPattern.test(repository ?? '') && [issues, pulls, comments, board?.items].every(Array.isArray), 'invalid-snapshot');
  requireCondition(board.totalCount === board.items.length, 'project-inventory-incomplete');
  const findings = []; const linkedOpenIssues = []; const mergedPullsWithoutTextReference = [];
  const statusFields = snapshot.fields?.fields?.filter(field => field.name === 'Status') ?? [];
  const statusOptions = statusFields.length === 1 ? statusFields[0].options?.map(option => option.name) : [];
  const statusMapping = statusMappings.find(mapping => statusOptions?.length === mapping.options.length && mapping.options.every(value => statusOptions.includes(value)));
  const knownMapping = Boolean(statusMapping);
  if (!knownMapping) findings.push({ code: 'project-status-requires-mapping', issue: null, url: null });
  const localItems = board.items.filter(item => item.content?.type === 'Issue' && item.content.url?.startsWith(`https://github.com/${repository}/issues/`));
  const merged = pulls.filter(pr => pr.merged_at).map(pr => ({ ...pr, references: referencedIssues(pr.body, repository) }));
  for (const pr of merged.filter(pr => pr.references.length === 0)) mergedPullsWithoutTextReference.push({ number: pr.number, url: pr.html_url, title: pr.title });
  for (const issue of issues) {
    requireCondition(Number.isSafeInteger(issue.number) && ['open', 'closed'].includes(issue.state), 'invalid-issue');
    const items = localItems.filter(item => item.content.number === issue.number);
    const add = code => findings.push({ code, issue: issue.number, url: issue.html_url });
    if (items.length !== 1) add(items.length ? 'duplicate-project-item' : 'project-item-absent-or-archived');
    const status = items[0]?.status ?? null;
    if (items.length && !statusOptions?.includes(status)) add('project-item-status-missing-or-unknown');
    if (knownMapping && ((issue.state === 'open' && status === 'Done') || (issue.state === 'closed' && statusMapping.options.includes(status) && status !== 'Done'))) add('issue-project-state-mismatch');
    const linked = merged.filter(pr => pr.references.includes(issue.number));
    if (issue.state !== 'open' || !linked.length) continue;
    const latestMerge = linked.map(pr => pr.merged_at).sort().at(-1);
    const followUp = comments.filter(comment => comment.issue_url === `https://api.github.com/repos/${repository}/issues/${issue.number}` && comment.created_at >= latestMerge);
    linkedOpenIssues.push({ number: issue.number, url: issue.html_url, projectStatus: status,
      mergedPullsMentioningIssue: linked.map(pr => ({ number: pr.number, url: pr.html_url })),
      commentsAfterLatestLinkedMerge: followUp.map(comment => comment.html_url),
      interpretation: 'Lire critères, commentaires et preuves ; la fusion ou une mention ne prouve ni livraison ni acceptation.' });
    if (knownMapping && status === statusMapping.pending) add('todo-with-merged-reference');
    if (!followUp.length) add('no-comment-after-linked-merge');
  }
  return { schemaVersion: 1, repository, observedFromUtc: snapshot.startedAtUtc, observedToUtc: snapshot.finishedAtUtc,
    status: findings.length ? 'REVIEW_REQUIRED' : 'NO_STRUCTURAL_SIGNAL', readOnly: true,
    counts: { issues: issues.length, openIssues: issues.filter(item => item.state === 'open').length, mergedPulls: merged.length, projectItems: board.totalCount },
    projectStatusOptions: statusOptions ?? [], findings, linkedOpenIssues, mergedPullsWithoutTextReference,
    limitations: ['Lectures successives, sans snapshot atomique de GitHub.',
      'Les mentions textuelles incluent parents, dépendances et exclusions ; leur rôle doit être instruit.',
      'Un commentaire récent peut être sans rapport ; son contenu et les critères restent à lire.',
      'Partiellement livré désigne un reste à réaliser ; Livré — à qualifier désigne des contrôles ou preuves restants. Ces libellés ne prouvent pas la couverture des critères.',
      'Associations natives PR/Issue, parents/enfants et archives Project non inventoriés ; les références textuelles seules sont couvertes.',
      'Une PR sans référence textuelle peut avoir un lien natif ou relever du harnais ; aucune absence d’Issue n’est déduite.',
      'Aucun contrôle des critères métier, du code ou des environnements ; aucune clôture ni mutation autorisée par ce rapport.'] };
}
