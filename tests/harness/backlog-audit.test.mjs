import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditBacklog, collectBacklog, referencedIssues } from '../../scripts/lib/backlog-audit.mjs';
import { main } from '../../scripts/backlog-audit.mjs';

const repository = 'synthetic/hestia';
const url = 'https://github.com/synthetic/hestia/issues/1';
const fields = { fields: [{ name: 'Status', options: ['Todo', 'In Progress', 'Done'].map(name => ({ name })) }], totalCount: 1 };
function fixture() {
  return { repository, startedAtUtc: '2026-10-19T12:00:00.000Z', finishedAtUtc: '2026-10-19T12:01:00.000Z',
    issues: [{ number: 1, state: 'open', html_url: url }],
    pulls: [{ number: 2, merged_at: '2026-10-18T12:00:00Z', body: 'Refs #1', html_url: 'https://github.com/synthetic/hestia/pull/2' }],
    comments: [], board: { items: [{ status: 'Todo', content: { type: 'Issue', number: 1, url } }], totalCount: 1 }, fields };
}
function adapter(overrides = {}) {
  const calls = [];
  const command = args => {
    calls.push(args);
    if (args[0] === 'project') return JSON.stringify(args[1] === 'field-list' ? (overrides.fields ?? fields) : (overrides.board ?? { items: [], totalCount: 0 }));
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    const endpoint = args[3];
    const kind = endpoint.includes('/issues/comments') ? 'comments' : endpoint.includes('/pulls?') ? 'pulls' : 'issues';
    const page = Number(endpoint.match(/[&?]page=(\d+)/)[1]);
    return JSON.stringify(overrides[kind]?.(page) ?? []);
  };
  return { calls, command };
}
const options = command => ({ repository, project: 3, owner: 'synthetic', command });

test('reports stale Todo and missing follow-up without inferring completion or mutating input', () => {
  const snapshot = fixture(); const before = JSON.stringify(snapshot); const result = auditBacklog(snapshot);
  assert.deepEqual(result.findings.map(item => item.code), ['todo-with-merged-reference', 'no-comment-after-linked-merge']);
  assert.equal(result.status, 'REVIEW_REQUIRED'); assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify(snapshot), before);
});
test('partial delivery with pending acceptance can remain open In Progress; recent comment is no proof', () => {
  const snapshot = fixture(); snapshot.board.items[0].status = 'In Progress';
  snapshot.comments.push({ issue_url: 'https://api.github.com/repos/synthetic/hestia/issues/1', created_at: '2026-10-19T12:00:00Z', html_url: `${url}#issuecomment-3` });
  const result = auditBacklog(snapshot);
  assert.deepEqual(result.findings, []); assert.equal(result.status, 'NO_STRUCTURAL_SIGNAL');
  assert.match(result.limitations.join(' '), /commentaire récent peut être sans rapport/);
  assert.equal(result.linkedOpenIssues.length, 1);
});
test('detects Issue/Project mismatch, absence, duplicate and unknown status without automatic changes', () => {
  for (const [items, state, code] of [
    [[{ status: 'Done', content: { type: 'Issue', number: 1, url } }], 'open', 'issue-project-state-mismatch'],
    [[{ status: 'Todo', content: { type: 'Issue', number: 1, url } }], 'closed', 'issue-project-state-mismatch'],
    [[], 'open', 'project-item-absent-or-archived'],
    [Array(2).fill({ status: 'Todo', content: { type: 'Issue', number: 1, url } }), 'open', 'duplicate-project-item'],
    [[{ status: 'Custom', content: { type: 'Issue', number: 1, url } }], 'open', 'project-item-status-missing-or-unknown'],
  ]) {
    const snapshot = fixture(); snapshot.board = { items, totalCount: items.length }; snapshot.issues[0].state = state;
    assert.ok(auditBacklog(snapshot).findings.some(item => item.code === code));
  }
});
test('actual custom Project field options require an explicit mapping', () => {
  const snapshot = fixture(); snapshot.fields = { fields: [{ name: 'Status', options: [{ name: 'Terminé' }] }], totalCount: 1 };
  assert.ok(auditBacklog(snapshot).findings.some(item => item.code === 'project-status-requires-mapping'));
  assert.ok(!auditBacklog(snapshot).findings.some(item => item.code === 'todo-with-merged-reference'));
});
test('text references stay local; native links not inspected are explicitly outside coverage', () => {
  assert.deepEqual(referencedIssues('Refs #1; https://github.com/synthetic/hestia/issues/3 ; other/repo#9 https://github.com/other/repo/issues/8 https://example.invalid/#7', repository), [1, 3]);
  const snapshot = fixture(); snapshot.pulls[0].body = ''; snapshot.pulls[0].closingIssuesReferences = [{ number: 1 }];
  const result = auditBacklog(snapshot);
  assert.equal(result.mergedPullsWithoutTextReference.length, 1);
  assert.match(result.limitations.join(' '), /Associations natives PR\/Issue.*non inventoriés/);
});
test('independently paginates Issues, PRs and comments, filters PRs from Issues, and invokes reads only', () => {
  for (const kind of ['issues', 'pulls', 'comments']) {
    const io = adapter({ [kind]: page => page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id, pull_request: id === 0 ? {} : null })) : [] });
    const result = collectBacklog(options(io.command));
    assert.equal(result.pages[kind], 2); assert.equal(result[kind].length, kind === 'issues' ? 99 : 100);
    assert.ok(io.calls.every(args => args[0] === 'api' ? args[2] === 'GET' : ['item-list', 'field-list'].includes(args[1])));
  }
});
test('rejects duplicate pages, exhausted pagination, incomplete Project items or fields, and failed API', () => {
  const rows = Array.from({ length: 100 }, (_, id) => ({ id }));
  for (const config of [
    { issues: () => rows },
    { comments: page => rows.map(row => ({ id: row.id + page * 100 })) },
    { board: { items: [], totalCount: 1 } },
    { fields: { fields: [], totalCount: 1 } },
  ]) assert.throws(() => collectBacklog(options(adapter(config).command)));
  const outputs = [];
  assert.equal(main(['--repo', repository, '--owner', 'synthetic', '--project', '3'], { command: () => { throw new Error('private CLI error'); }, write: value => outputs.push(value) }), 2);
  assert.equal(outputs[0].status, 'UNAVAILABLE'); assert.ok(!JSON.stringify(outputs).includes('private CLI error'));
});
test('CLI rejects unknown flags and invalid repositories before any command', () => {
  let calls = 0;
  for (const args of [['--apply', 'true'], ['--repo', '-malicious/repo', '--project', '3', '--owner', 'synthetic']]) {
    assert.equal(main(args, { command: () => { calls++; throw new Error('must not execute'); }, write: () => {} }), 2);
  }
  assert.equal(calls, 0);
});
