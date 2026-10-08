/** EXPERIMENTAL qualification only. No application import, DB, network or UI. */
import { createHash } from 'node:crypto';

export const RETENTION_MS = 168 * 60 * 60 * 1000;
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };
export const nameKey = name => name.trim().normalize('NFC').toLowerCase();
function cleanName(name) {
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) fail('INVALID_NAME');
  return name.trim();
}

export function createState(nodes = [], objects = [], policy = {}) {
  if (new Set(nodes.map(n => n.id)).size !== nodes.length) fail('DUPLICATE_ID');
  const state = { revision: 0, nodes: Object.fromEntries(nodes.map(n => [n.id, { status: 'active', ...clone(n) }])),
    objects: Object.fromEntries(objects.map(o => [o.documentId, clone(o)])), groups: {}, receipts: {}, policy: clone(policy) };
  assertStructure(state);
  return state;
}

export function assertStructure(state) {
  for (const node of Object.values(state.nodes)) {
    if (!['folder', 'document'].includes(node.type)) fail('INVALID_TYPE');
    if (node.type === 'document' && node.parentId === null) fail('DOCUMENT_NEEDS_FOLDER');
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      const parent = state.nodes[parentId];
      if (!parent || parent.type !== 'folder') fail('INVALID_PARENT');
      if (visited.has(parentId)) fail('CYCLE');
      visited.add(parentId); parentId = parent.parentId;
    }
    if (node.status === 'active' && node.parentId !== null && state.nodes[node.parentId].status !== 'active') fail('ACTIVE_UNDER_TRASH');
  }
  return true;
}

function subtree(state, rootId, activeOnly = false) {
  const result = [], pending = [rootId];
  while (pending.length) {
    const id = pending.pop(), node = state.nodes[id];
    if (!node || (activeOnly && node.status !== 'active')) continue;
    result.push(id);
    for (const child of Object.values(state.nodes)) if (child.parentId === id) pending.push(child.id);
  }
  return result.sort();
}
function active(state, id) {
  const node = state.nodes[id];
  if (!node || node.status !== 'active') fail('UNAVAILABLE');
  return node;
}
function destination(state, parentId, type) {
  if (parentId === null) { if (type === 'document') fail('DOCUMENT_NEEDS_FOLDER'); return; }
  if (active(state, parentId).type !== 'folder') fail('INVALID_PARENT');
}
function availableName(state, candidate) {
  if (candidate.type !== 'folder') return;
  const collision = Object.values(state.nodes).some(other => other.id !== candidate.id && other.status === 'active' && other.type === 'folder'
    && other.parentId === candidate.parentId && (candidate.parentId !== null || other.rootNamespace === candidate.rootNamespace)
    && nameKey(other.name) === nameKey(candidate.name));
  if (collision) fail('NAME_CONFLICT');
}

// Only an injected authority can approve a plan. It must inspect before/after,
// including changed access to still-live trash groups; no permissive default.
function prepare(state, actor, request, now, authority) {
  if (!Number.isSafeInteger(now) || !actor || !authority?.authorize || !authority?.stamp) fail('INVALID_CONTEXT');
  const next = clone(state), { action, id } = request;
  let affected = [], restoredMembers = [], groupId = null;
  if (action === 'create') {
    if (next.nodes[id]) fail('DUPLICATE_ID');
    destination(next, request.parentId, 'folder');
    next.nodes[id] = { id, type: 'folder', status: 'active', parentId: request.parentId, name: cleanName(request.name), rootNamespace: actor };
    affected = [id]; availableName(next, next.nodes[id]);
  } else if (action === 'rename') {
    const node = active(next, id);
    if (node.type !== 'folder') fail('INVALID_TYPE');
    node.name = cleanName(request.name); availableName(next, node); affected = [id];
  } else if (action === 'move') {
    const node = active(next, id);
    destination(next, request.parentId, node.type);
    affected = subtree(next, id); // Includes trash structure whose access could change.
    if (affected.includes(request.parentId)) fail('CYCLE');
    node.parentId = request.parentId;
    if (node.type === 'folder' && request.name !== undefined) node.name = cleanName(request.name);
    availableName(next, node);
  } else if (action === 'trash') {
    active(next, id);
    affected = subtree(next, id, true);
    groupId = `group:${next.revision + 1}:${id}`;
    next.groups[groupId] = { id: groupId, rootId: id, members: affected, deletedAt: now, expiresAt: now + RETENTION_MS, status: 'trashed' };
    for (const member of affected) Object.assign(next.nodes[member], { status: 'trashed', groupId });
  } else if (action === 'restore') {
    const group = next.groups[request.groupId];
    if (!group || group.status !== 'trashed' || now >= group.expiresAt) fail('UNAVAILABLE');
    groupId = group.id; restoredMembers = [...group.members]; affected = [...restoredMembers];
    for (const member of restoredMembers) if (next.nodes[member]?.status !== 'trashed' || next.nodes[member].groupId !== group.id) fail('GROUP_CONFLICT');
    const root = next.nodes[group.rootId];
    const parentId = request.parentId === undefined ? root.parentId : request.parentId;
    destination(next, parentId, root.type);
    if (subtree(next, root.id).includes(parentId)) fail('CYCLE');
    // Moving the restored root also changes ancestry for independent, older
    // trash groups. Authorize those still recoverable, but never restore them.
    if (parentId !== root.parentId) affected = [...new Set([...restoredMembers,
      ...subtree(state, root.id).filter(member => trashReadable(state, member, now))])].sort();
    root.parentId = parentId;
    if (request.name !== undefined) root.name = cleanName(request.name);
    for (const member of restoredMembers) { next.nodes[member].status = 'active'; delete next.nodes[member].groupId; }
    availableName(next, root); group.status = 'restored';
  } else fail('INVALID_ACTION');
  assertStructure(next);
  const context = { actor, request: clone(request), now, affected, restoredMembers, before: clone(state), after: clone(next) };
  if (authority.authorize(context) !== true) fail('UNAVAILABLE');
  // Stamp must cover current rights/epochs/expiry AND management validity. This
  // models an interface requirement, not a server-side permission proof.
  const stamp = authority.stamp(context);
  if (stamp === undefined) fail('INVALID_STAMP');
  return { next, affected, groupId, fingerprint: hash({ state, actor, request, affected, stamp }) };
}

export function preview(state, actor, request, now, authority) {
  const plan = prepare(state, actor, request, now, authority);
  return { fingerprint: plan.fingerprint, affected: plan.affected };
}

export function execute(state, actor, request, now, authority, confirmation, operationKey) {
  if (typeof operationKey !== 'string' || !operationKey || !actor) fail('INVALID_OPERATION_KEY');
  const receiptKey = JSON.stringify([actor, operationKey]), identity = hash(request);
  const receipt = state.receipts[receiptKey];
  if (receipt) {
    if (receipt.identity !== identity) fail('IDEMPOTENCY_CONFLICT');
    // A receipt says the prior effect committed, never that its resource is
    // currently readable/restored. Return no resource metadata on replay.
    return { state, result: { committed: true, replayed: true } };
  }
  const plan = prepare(state, actor, request, now, authority);
  if (!confirmation || confirmation.fingerprint !== plan.fingerprint) fail('STALE_PREVIEW');
  plan.next.revision++;
  plan.next.receipts[receiptKey] = { identity };
  return { state: plan.next, result: { committed: true, replayed: false, groupId: plan.groupId } };
}

export function readable(state, id) {
  const node = state.nodes[id];
  return Boolean(node && node.status === 'active'); // lifecycle only, never authorization
}
export function trashReadable(state, id, now) {
  const node = state.nodes[id], group = node && state.groups[node.groupId];
  return Boolean(node?.status === 'trashed' && group?.status === 'trashed' && now < group.expiresAt);
}
export function chargedBytes(state, owner) {
  return Object.values(state.objects).filter(o => !o.deleted && (owner === undefined || o.owner === owner)).reduce((sum, o) => sum + o.size, 0);
}

// Expiry makes structural tombstones, independently of physical object deletion.
// This internal model does not expose the tombstones through a user API.
export function expire(state, now) {
  const next = clone(state); let changed = false;
  for (const group of Object.values(next.groups)) {
    if (group.status !== 'trashed' || now < group.expiresAt) continue;
    for (const id of group.members) {
      const node = next.nodes[id];
      if (node.groupId !== group.id) fail('GROUP_CONFLICT');
      next.nodes[id] = { id, type: node.type, parentId: node.parentId, status: 'tombstone', groupId: group.id };
    }
    group.status = 'expired'; changed = true;
  }
  if (changed) next.revision++;
  assertStructure(next); return next;
}

// Simulates receipt of successful physical deletion, not S3 itself. Must never
// be wired as an application endpoint or used before actual storage confirmation.
export function confirmPhysicalDeletion(state, documentId) {
  if (state.nodes[documentId]?.status !== 'tombstone') fail('NOT_EXPIRED');
  const next = clone(state), object = next.objects[documentId];
  if (object && !object.deleted) { next.objects[documentId] = { documentId, deleted: true }; next.revision++; }
  return next;
}

export const snapshot = state => JSON.stringify(state);
export function restoreSnapshot(value) { const state = JSON.parse(value); assertStructure(state); return state; }
