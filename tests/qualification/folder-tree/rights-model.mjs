// EXPERIMENTAL STUDY ONLY. No product import, SQL, HTTP, persistence or UI.
// Trusted synthetic state represents records a future server must validate.
import { createHash } from 'node:crypto';

export const CAPS = ['consulter', 'déposer', 'modifier', 'supprimer', 'partager', 'exporter', 'administrer'];
const managementCaps = ['partager', 'administrer'];
const end = grant => grant.expiresAt ?? Infinity;
const known = values => Array.isArray(values) && new Set(values).size === values.length && values.every(c => CAPS.includes(c));
const fail = () => { throw new Error('UNAVAILABLE'); };

export function ancestry(state, folderId) {
  const result = [], seen = new Set();
  for (let id = folderId; id !== null;) {
    const folder = state.folders.find(f => f.id === id);
    if (!folder || seen.has(id)) return null;
    seen.add(id); result.push(id); id = folder.parentId;
  }
  return result;
}

// Policy capabilities, including for trash scopes whose lifecycle gate is
// checked separately. This is NOT permission to read deleted content.
export function evaluate(state, folderId, userId, now) {
  const path = ancestry(state, folderId);
  const grants = new Map(state.grants.map(g => [g.id, g]));
  const members = new Map(state.members.map(m => [m.id, m]));
  const cut = (folder, sourceId) => (state.managementCuts ?? []).some(c => c.sourceReferenceId === sourceId
    && ancestry(state, folder)?.includes(c.folderId));
  const blocked = (folder, subject, cap) => {
    const route = ancestry(state, folder);
    return !route || state.restrictions.some(r => !r.lifted && route.includes(r.folderId) && r.userId === subject && r.caps.includes(cap));
  };
  function limit(id, seen = new Set()) {
    const g = grants.get(id);
    if (!g || seen.has(id) || !known(g.transmit) || !(Number.isFinite(end(g)) || end(g) === Infinity)) return null;
    if (!g.parentId) return { transmit: g.transmit, expiresAt: end(g) };
    const p = limit(g.parentId, new Set([...seen, id]));
    return p && { transmit: g.transmit.filter(c => p.transmit.includes(c)), expiresAt: Math.min(end(g), p.expiresAt) };
  }
  function valid(id, seen = new Set()) {
    const g = grants.get(id), member = g && members.get(g.userId);
    if (!g || seen.has(id) || g.revoked || !member?.active || member.epoch !== g.subjectEpoch || !CAPS.includes(g.cap)
      || !known(g.transmit) || !limit(id) || now >= end(g) || !ancestry(state, g.folderId)
      || (!managementCaps.includes(g.cap) && g.transmit.length)
      || !['direct', 'reference', 'delegated'].includes(g.kind)
      || (g.kind === 'delegated') !== Boolean(g.parentId)
      || (g.kind === 'reference' && g.cap !== 'administrer')
      || blocked(g.folderId, g.userId, g.cap)) return false;
    if (!g.parentId) return true;
    const p = grants.get(g.parentId), bound = limit(g.parentId);
    // Scope was established at issue time by issueGrant. It does not turn
    // into a free-standing direct grant if tree placement subsequently changes.
    return Boolean(p && managementCaps.includes(p.cap) && bound?.transmit.includes(g.cap)
      && !cut(g.folderId, p.id)
      && !blocked(g.folderId, p.userId, p.cap) && !blocked(g.folderId, p.userId, g.cap)
      && valid(p.id, new Set([...seen, id])));
  }
  function applicableAt(id, target, seen = new Set()) {
    const g = grants.get(id);
    if (!g || seen.has(id) || !valid(id) || cut(target, id) || blocked(target, g.userId, g.cap)) return false;
    if (!g.parentId) return true;
    const p = grants.get(g.parentId);
    return Boolean(p && !blocked(target, p.userId, g.cap) && applicableAt(p.id, target, new Set([...seen, id])));
  }
  const held = path ? state.grants.filter(g => path.includes(g.folderId) && g.userId === userId
    && applicableAt(g.id, folderId)) : [];
  const authorities = held.filter(g => managementCaps.includes(g.cap));
  function authorityFor(caps, adminOnly = false) {
    if (!known(caps)) return undefined;
    return authorities.find(g => (!adminOnly || g.cap === 'administrer')
      && caps.every(c => limit(g.id)?.transmit.includes(c) && !blocked(folderId, userId, c)));
  }
  return { capabilities: CAPS.filter(c => held.some(g => g.cap === c)), held, valid, limit, authorityFor };
}

export function issueGrant(state, input, now) {
  const { folderId, actorId, userId, cap, authorityId, id, transmit = [], expiresAt = null } = input;
  const access = evaluate(state, folderId, actorId, now);
  const authority = access.held.find(g => g.id === authorityId && managementCaps.includes(g.cap));
  const subject = state.members.find(m => m.id === userId);
  const bound = authority && access.limit(authority.id);
  const direct = authority?.kind === 'reference' && authority.folderId === folderId;
  if (!authority || !subject?.active || userId === actorId || authority.lineage.includes(userId)
    || !known([cap]) || !known(transmit) || !bound || !bound.transmit.includes(cap)
    || !access.authorityFor([cap, ...transmit].filter((c, i, a) => a.indexOf(c) === i))
    || !transmit.every(c => bound.transmit.includes(c)) || transmit.includes('administrer')
    || (!managementCaps.includes(cap) && transmit.length) || (cap === 'administrer' && !direct)
    || !((expiresAt ?? Infinity) > now) || (expiresAt ?? Infinity) > bound.expiresAt
    || state.grants.some(g => g.id === id)) fail();
  const next = structuredClone(state);
  next.grants.push({ id, folderId, userId, cap, transmit, expiresAt, revoked: false,
    subjectEpoch: subject.epoch, kind: direct ? 'direct' : 'delegated',
    parentId: direct ? null : authority.id, lineage: [...new Set([...authority.lineage, actorId])], authorId: actorId });
  return next;
}

export function changeRestriction(state, { id, folderId, actorId, userId, caps, lift = false }, now) {
  if (!caps.length || !known(caps) || !state.members.some(m => m.id === userId)
    || !evaluate(state, folderId, actorId, now).authorityFor(caps, true)) fail();
  const next = structuredClone(state), existing = next.restrictions.find(r => r.id === id);
  // Restriction removal must use its own anchor, never a descendant's authority.
  if (lift) {
    if (!existing || existing.folderId !== folderId || existing.userId !== userId
      || existing.caps.some(c => !caps.includes(c))) fail();
    existing.lifted = true;
  } else {
    if (existing) fail();
    next.restrictions.push({ id, folderId, userId, caps: [...caps], lifted: false });
  }
  return next;
}

export function createChild(state, { id, name, parentId, actorId }, now) {
  const access = evaluate(state, parentId, actorId, now);
  if (!['consulter', 'modifier'].every(c => access.capabilities.includes(c)) || state.folders.some(f => f.id === id)) fail();
  const parent = state.folders.find(f => f.id === parentId), next = structuredClone(state);
  // The creator is provenance only. No grants or management powers are minted.
  next.folders.push({ id, name, parentId, createdBy: actorId,
    governance: parent.governance && { ...parent.governance, mode: 'inherited' } });
  return next;
}

export function managementFrame(state, folderId, now) {
  const folder = state.folders.find(f => f.id === folderId), frame = folder?.governance;
  if (!frame || !ancestry(state, folderId)?.includes(frame.anchorFolderId)) return null;
  const g = state.grants.find(g => g.id === frame.referenceId);
  if (!g || g.kind !== 'reference' || g.folderId !== frame.anchorFolderId || !attestedReference(state, g)) return null;
  const access = evaluate(state, folderId, g.userId, now);
  if (!access.held.some(held => held.id === g.id && held.cap === 'administrer')) return null;
  return { referenceId: g.id, holderId: g.userId, transmit: access.limit(g.id).transmit };
}

// Hypothesis only: deliberately NOT a move command or authorization boundary.
// Complete move preview, scope/visibility authorization and transaction checks
// belong to the independently qualified lifecycle model and future server.
export function placementHypothesis(state, folderId, parentId) {
  const next = structuredClone(state), folder = next.folders.find(f => f.id === folderId);
  if (!folder || (parentId !== null && !next.folders.some(f => f.id === parentId))) fail();
  folder.parentId = parentId;
  if (!ancestry(next, folderId)) fail();
  return next;
}

export function visibleEntry(state, folderId, userId, now) {
  if (!evaluate(state, folderId, userId, now).capabilities.includes('consulter')) return null;
  const folder = state.folders.find(f => f.id === folderId);
  // Direct entry contains no inaccessible ancestor names, ids, path or counts.
  return { id: folder.id, name: folder.name };
}

export function policyFingerprint(state) {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

export function checkedIssue(state, input, expectedFingerprint, now) {
  if (policyFingerprint(state) !== expectedFingerprint) throw new Error('STALE');
  // Time is not a hash field: expiration is rechecked at execution time.
  return issueGrant(state, input, now);
}

// Historical attestation uses the source envelope captured by the explicit
// transmission, not a dependency on the former holder's continuing activity.
export function attestedReference(state, reference, seen = new Set()) {
  const folder = state.folders.find(f => f.id === reference?.folderId);
  if (!folder || !reference || seen.has(reference.id) || reference.kind !== 'reference'
    || reference.cap !== 'administrer' || reference.parentId || reference.lineage.length || !known(reference.transmit)) return false;
  if (reference.origin === 'initial') return reference.userId === folder.createdBy && reference.authorId === folder.createdBy;
  const event = state.referenceEvents?.find(e => e.referenceId === reference.id);
  if (!event || !['transfer', 'nominate'].includes(event.mode) || event.folderId !== reference.folderId
    || event.nomineeId !== reference.userId || event.nomineeEpoch !== reference.subjectEpoch
    || event.actorId !== reference.authorId || !reference.transmit.every(c => event.source.transmit.includes(c))
    || end(reference) > end(event.source)) return false;
  return attestedReference(state, event.source, new Set([...seen, reference.id]));
}

export function transmitManagement(state, { folderId, actorId, nomineeId, referenceId, newReferenceId,
  expectedFingerprint, mode = 'transfer' }, now) {
  if (policyFingerprint(state) !== expectedFingerprint) throw new Error('STALE');
  const folder = state.folders.find(f => f.id === folderId), frame = folder?.governance;
  const source = state.grants.find(g => g.id === referenceId);
  const actor = state.members.find(m => m.id === actorId), nominee = state.members.find(m => m.id === nomineeId);
  const holder = state.members.find(m => m.id === source?.userId);
  const access = evaluate(state, folderId, actorId, now), bound = source && access.limit(source.id);
  if (!frame || frame.referenceId !== referenceId || !source || !attestedReference(state, source)
    || !actor?.active || !nominee?.active || !holder || !bound || !(bound.expiresAt > now)
    || !ancestry(state, folderId)?.includes(frame.anchorFolderId) || !['transfer', 'nominate'].includes(mode)
    || state.grants.some(g => g.id === newReferenceId)) fail();
  if (mode === 'transfer') {
    if (actorId !== source.userId || nomineeId === actorId || !managementFrame(state, folderId, now)) fail();
  } else if (!['admin', 'owner'].includes(actor.role) || !source.revoked || holder.epoch <= source.subjectEpoch
    || managementFrame(state, folderId, now)) fail();

  const next = structuredClone(state), sourceCopy = next.grants.find(g => g.id === source.id);
  const local = source.folderId === folderId;
  // Revoking an inherited source globally would break the parent and siblings.
  // Cut only its authority/dependency in the explicitly transmitted subtree.
  if (local) sourceCopy.revoked = true;
  else (next.managementCuts ??= []).push({ folderId, sourceReferenceId: source.id });
  if (!evaluate(next, folderId, nomineeId, now).capabilities.includes('consulter')) fail();

  const replacement = { id: newReferenceId, folderId, userId: nomineeId, cap: 'administrer', kind: 'reference',
    parentId: null, transmit: [...bound.transmit], lineage: [], origin: mode === 'transfer' ? 'reference-transfer' : 'reference-succession',
    authorId: actorId, subjectEpoch: nominee.epoch, expiresAt: Number.isFinite(bound.expiresAt) ? bound.expiresAt : null, revoked: false };
  next.grants.push(replacement);
  (next.referenceEvents ??= []).push({ referenceId: replacement.id, folderId, actorId, nomineeId, nomineeEpoch: nominee.epoch,
    mode, source: structuredClone(source), inheritedScope: !local });
  // Only the inherited frames belonging to the transmitted source are rebound.
  // Independent references nested below retain their own authority and history.
  for (const target of next.folders) {
    if (ancestry(next, target.id)?.includes(folderId) && target.governance?.referenceId === source.id) {
      target.governance = { mode: target.id === folderId ? 'own' : 'inherited', referenceId: replacement.id, anchorFolderId: folderId };
    }
  }
  return next;
}
