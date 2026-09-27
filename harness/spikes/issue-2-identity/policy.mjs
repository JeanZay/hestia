/**
 * Experimental, in-memory oracle for rights-matrix-study-v2 O01–O10.
 * Not a product authorization server. Fixtures and sessionFor/controls/snapshot
 * are trusted test setup; ONLY execute/stream model an untrusted command surface.
 * No authentication, PostgreSQL serialization, G01–G13 protocol, durable audit,
 * storage engine, or real transport is qualified by this synchronous model.
 */
export const CAPABILITIES = Object.freeze([
  'consulter', 'déposer', 'modifier', 'supprimer', 'partager', 'exporter', 'administrer',
]);
export const POLICY_LIMITS = Object.freeze({ maxChunkBytes: 64, maxDepth: 64 });
const REQUIREMENTS = Object.freeze({
  O01: ['consulter'], O02: ['déposer'], O03: ['consulter', 'modifier'],
  O04: ['consulter', 'modifier', 'déposer'], O05: ['consulter', 'supprimer'],
  O06: ['partager'], O07: ['consulter', 'exporter'], O08: ['administrer'],
  O09: ['administrer'], O10: ['administrer'],
});
const FIELDS = Object.freeze({
  O01: ['resourceId'], O02: ['folderId', 'requestId', 'content', 'title'],
  O03: ['resourceId', 'version', 'patch'],
  O04: ['resourceId', 'version', 'content', 'title'], O05: ['resourceId'],
  O06: ['folderId', 'authorityId', 'subject', 'capability', 'expiresAt', 'transmit'],
  O07: ['resourceId'],
  O08: ['folderId', 'authorityId', 'subject', 'capability', 'expiresAt', 'transmit'],
  O09: ['folderId', 'action', 'subject', 'grantId', 'expiresAt', 'transmit'],
  O10: ['folderId', 'authorityId', 'grantId'],
});
const deny = () => ({ allowed: false, code: 'DENIED' });
const copy = (x) => structuredClone(x);
const identifier = (x) => typeof x === 'string' && x.length > 0 && x.length <= 128;
const instant = (x) => Number.isSafeInteger(x) && x >= 0;
const expiry = (x) => x === null || instant(x);
const caps = (x) => Array.isArray(x) && new Set(x).size === x.length && x.every((c) => CAPABILITIES.includes(c));
const closed = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).every((k) => keys.includes(k));
const terminal = (x) => x === null ? Infinity : x;

export function createPolicyHarness(fixture, { now = () => 0 } = {}) {
  // This constructor is deliberately NOT an import endpoint for user grants.
  const state = copy(fixture);
  for (const key of ['members', 'folders', 'resources', 'grants']) {
    if (!Array.isArray(state[key]) || state[key].some((x) => !identifier(x.id))
      || new Set(state[key].map((x) => x.id)).size !== state[key].length) {
      throw new TypeError(`Invalid trusted fixture: ${key}`);
    }
  }
  const members = new Map(state.members.map((x) => [x.id, x]));
  const folders = new Map(state.folders.map((x) => [x.id, x]));
  const resources = new Map(state.resources.map((x) => [x.id, x]));
  const grants = new Map(state.grants.map((x) => [x.id, {
    ...x, parent: x.parent ?? null, expiresAt: x.expiresAt ?? null,
    transmit: x.transmit ?? [], revoked: x.revoked ?? false,
    lineage: x.lineage ?? [], origin: 'trusted-fixture',
  }]));
  const sessions = new WeakMap();
  const sessionEpochs = new Map(state.members.map((x) => [x.id, 0]));
  const receipts = new Map();
  let serial = 0;
  const time = () => { const t = now(); if (!instant(t)) throw new TypeError('Invalid test clock'); return t; };
  const active = (id) => members.get(id)?.active === true;
  const openFolder = (id) => folders.get(id)?.state === 'active';
  const nextId = (prefix, collection) => {
    let id;
    do { id = `${prefix}-${++serial}`; } while (collection.has(id));
    return id;
  };
  function actorFor(handle) {
    const session = handle && typeof handle === 'object' ? sessions.get(handle) : undefined;
    return session && active(session.id) && session.epoch === sessionEpochs.get(session.id) ? session.id : null;
  }
  function limits(id, visited = new Set()) {
    const g = grants.get(id);
    if (!g || visited.has(id) || visited.size >= POLICY_LIMITS.maxDepth
      || !caps(g.transmit) || !expiry(g.expiresAt)) return null;
    if (g.parent === null) return { transmit: g.transmit, end: terminal(g.expiresAt) };
    const parent = limits(g.parent, new Set([...visited, id]));
    return parent && { transmit: g.transmit.filter((c) => parent.transmit.includes(c)),
      end: Math.min(terminal(g.expiresAt), parent.end) };
  }
  function validGrant(id, at, visited = new Set()) {
    const g = grants.get(id);
    if (!g || visited.has(id) || visited.size >= POLICY_LIMITS.maxDepth || g.revoked
      || !active(g.subject) || !openFolder(g.folderId) || !CAPABILITIES.includes(g.capability)
      || !caps(g.transmit) || !expiry(g.expiresAt) || at >= terminal(g.expiresAt)) return false;
    if (g.kind === 'reference') {
      if (g.capability !== 'administrer' || g.parent !== null
        || folders.get(g.folderId)?.referenceGrantId !== id) return false;
    } else if (!['direct', 'delegated'].includes(g.kind)) return false;
    if (g.parent !== null) {
      const p = grants.get(g.parent);
      const bound = limits(g.parent);
      if (!p || p.folderId !== g.folderId || !['partager', 'administrer'].includes(p.capability)
        || !bound || !bound.transmit.includes(g.capability)) return false;
      return validGrant(p.id, at, new Set([...visited, id]));
    }
    // Only setup/reference issuance creates independent records; client commands
    // cannot choose kind, origin, parent, lineage, or their own identifier.
    return g.kind !== 'delegated';
  }
  function has(actor, folderId, capability, at) {
    return active(actor) && openFolder(folderId) && [...grants.values()].some((g) =>
      g.subject === actor && g.folderId === folderId && g.capability === capability && validGrant(g.id, at));
  }
  function reference(actor, folderId, at) {
    const id = folders.get(folderId)?.referenceGrantId;
    const g = grants.get(id);
    return g?.subject === actor && validGrant(id, at) ? g : null;
  }
  function source(actor, command, capability, at) {
    const g = grants.get(command.authorityId);
    return g?.subject === actor && g.folderId === command.folderId
      && g.capability === capability && validGrant(g.id, at) ? g : null;
  }
  function protectedGrant(g) {
    const f = folders.get(g?.folderId);
    return g?.kind === 'reference' || (f?.kind === 'personal' && f.holder === g?.subject
      && ['consulter', 'administrer'].includes(g.capability));
  }
  function sourcesFor(id, visited = new Set()) {
    const r = resources.get(id);
    if (!r || r.deleted || visited.has(id) || visited.size >= POLICY_LIMITS.maxDepth
      || !openFolder(r.folderId)) return null;
    if (r.sourceIds === undefined) return [r];
    if (!Array.isArray(r.sourceIds) || r.sourceIds.length === 0) return null;
    const rows = r.sourceIds.map((child) => sourcesFor(child, new Set([...visited, id])));
    return rows.some((x) => x === null) ? null : [r, ...rows.flat()];
  }
  function canResource(actor, id, required, at) {
    const sources = sourcesFor(id);
    return sources !== null && sources.every((r) => required.every((c) => has(actor, r.folderId, c, at)));
  }
  function storeGrant(actor, authority, command) {
    const id = nextId('grant', grants);
    const direct = authority.kind === 'reference';
    const record = {
      id, subject: command.subject, folderId: authority.folderId, capability: command.capability,
      transmit: copy(command.transmit ?? []), expiresAt: command.expiresAt ?? null,
      kind: direct ? 'direct' : 'delegated', parent: direct ? null : authority.id,
      origin: direct ? 'reference-command' : 'delegation-command', author: actor,
      lineage: [...new Set([...authority.lineage, authority.subject])], revoked: false,
    };
    grants.set(id, record);
    return { allowed: true, grantId: id };
  }
  function mayIssue(actor, authority, command, at) {
    const transmit = command.transmit ?? [];
    const end = command.expiresAt ?? null;
    const bound = authority && limits(authority.id);
    if (!authority || !active(command.subject) || !CAPABILITIES.includes(command.capability)
      || command.subject === actor || authority.lineage.includes(command.subject)
      || !bound || !caps(transmit) || !expiry(end) || !bound.transmit.includes(command.capability)
      || !transmit.every((c) => bound.transmit.includes(c)) || transmit.includes('administrer')
      || terminal(end) <= at || terminal(end) > bound.end
      || (!['partager', 'administrer'].includes(command.capability) && transmit.length)) return false;
    return true;
  }
  function reduceOrRevokeMandate(actor, command, at) {
    const authority = reference(actor, command.folderId, at);
    const target = grants.get(command.grantId);
    if (!authority || !target || target.folderId !== command.folderId || target.revoked
      || target.capability !== 'administrer' || protectedGrant(target)) return deny();
    if (command.action === 'revoke') { target.revoked = true; return { allowed: true }; }
    if (command.action !== 'reduce') return deny();
    const transmit = command.transmit ?? target.transmit;
    const end = command.expiresAt === undefined ? target.expiresAt : command.expiresAt;
    if (!caps(transmit) || !transmit.every((c) => target.transmit.includes(c)) || !expiry(end)
      || terminal(end) > terminal(target.expiresAt)) return deny();
    target.transmit = copy(transmit);
    target.expiresAt = end;
    return { allowed: true };
  }
  function execute(handle, command) {
    const actor = actorFor(handle);
    const op = command?.operation;
    if (!actor || !Object.hasOwn(FIELDS, op) || !closed(command, ['operation', ...FIELDS[op]])) return deny();
    const at = time();
    if (op === 'O01' || op === 'O07') {
      if (!canResource(actor, command.resourceId, REQUIREMENTS[op], at)) return deny();
      const r = resources.get(command.resourceId);
      return { allowed: true, content: r.content, title: r.title, metadata: copy(r.metadata ?? {}) };
    }
    if (op === 'O02') {
      if (!has(actor, command.folderId, 'déposer', at) || !identifier(command.requestId)
        || typeof command.content !== 'string' || typeof command.title !== 'string') return deny();
      const key = JSON.stringify([actor, command.folderId, command.requestId]);
      const signature = JSON.stringify([command.content, command.title]);
      if (receipts.has(key)) {
        const receipt = receipts.get(key);
        return receipt.signature === signature ? copy(receipt.response) : deny();
      }
      const f = folders.get(command.folderId);
      const size = new TextEncoder().encode(command.content).length;
      if (!Number.isSafeInteger(f.used) || !Number.isSafeInteger(f.quota) || f.used < 0
        || f.quota < 0 || f.used + size > f.quota) return deny();
      const id = nextId('resource', resources);
      resources.set(id, { id, folderId: f.id, content: command.content, original: command.content,
        title: command.title, metadata: {}, version: 1, deleted: false });
      f.used += size;
      const response = { allowed: true, requestReference: command.requestId };
      receipts.set(key, { signature, response });
      return copy(response);
    }
    if (['O03', 'O04', 'O05'].includes(op)) {
      const r = resources.get(command.resourceId);
      if (!r || r.sourceIds !== undefined || !canResource(actor, r.id, REQUIREMENTS[op], at)) return deny();
      if (op === 'O05') { r.deleted = true; return { allowed: true }; }
      if (command.version !== r.version) return deny();
      if (op === 'O03') {
        if (!closed(command.patch, ['label']) || typeof command.patch.label !== 'string') return deny();
        r.metadata = { ...r.metadata, label: command.patch.label };
        r.version += 1;
        return { allowed: true, version: r.version };
      }
      if (typeof command.content !== 'string' || typeof command.title !== 'string') return deny();
      const f = folders.get(r.folderId);
      const size = new TextEncoder().encode(command.content).length;
      if (!Number.isSafeInteger(f.used) || !Number.isSafeInteger(f.quota) || f.used < 0
        || f.quota < 0 || f.used + size > f.quota) return deny();
      const id = nextId('resource', resources);
      resources.set(id, { id, folderId: r.folderId, content: command.content, original: command.content,
        previousId: r.id, title: command.title, metadata: {}, version: 1, deleted: false });
      f.used += size;
      return { allowed: true, resourceId: id };
    }
    if (op === 'O06' || op === 'O08') {
      const authority = source(actor, command, REQUIREMENTS[op][0], at);
      if (command.capability === 'administrer' || !mayIssue(actor, authority, command, at)) return deny();
      return storeGrant(actor, authority, command);
    }
    if (op === 'O09') {
      if (command.action !== 'create') return reduceOrRevokeMandate(actor, command, at);
      const authority = reference(actor, command.folderId, at);
      const grantCommand = { ...command, capability: 'administrer' };
      if (!mayIssue(actor, authority, grantCommand, at) || (command.transmit ?? []).includes('administrer')) return deny();
      return storeGrant(actor, authority, grantCommand);
    }
    const target = grants.get(command.grantId);
    if (!target || target.folderId !== command.folderId || protectedGrant(target)) return deny();
    if (target.capability === 'administrer') {
      return reduceOrRevokeMandate(actor, { ...command, action: 'revoke' }, at);
    }
    const authority = source(actor, command, 'administrer', at);
    if (!authority || !limits(authority.id)?.transmit.includes(target.capability)) return deny();
    target.revoked = true;
    return { allowed: true };
  }
  function* stream(handle, { resourceId, operation = 'O07', chunkBytes = 4, ...unknown }) {
    if (Object.keys(unknown).length || !['O01', 'O07'].includes(operation)
      || !Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > POLICY_LIMITS.maxChunkBytes) {
      yield deny(); return;
    }
    const initial = execute(handle, { operation, resourceId });
    if (!initial.allowed) { yield deny(); return; }
    const bytes = new TextEncoder().encode(initial.content);
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      if (!execute(handle, { operation, resourceId }).allowed) { yield deny(); return; }
      yield { allowed: true, bytes: bytes.slice(offset, offset + chunkBytes) };
    }
  }
  return Object.freeze({
    execute, stream,
    sessionFor(memberId) {
      if (!active(memberId)) throw new TypeError('Unknown or inactive fixture member');
      const handle = Object.freeze({}); sessions.set(handle, { id: memberId, epoch: sessionEpochs.get(memberId) }); return handle;
    },
    snapshot() { return copy({ members: [...members.values()], folders: [...folders.values()],
      resources: [...resources.values()], grants: [...grants.values()] }); },
    // Trusted fixture controls simulate external committed state. They are not
    // user operations and do not qualify G-protocol or database concurrency.
    controls: Object.freeze({
      setActive(id, activeState) {
        if (!members.has(id) || typeof activeState !== 'boolean') throw new TypeError();
        members.get(id).active = activeState;
        if (!activeState) {
          sessionEpochs.set(id, sessionEpochs.get(id) + 1);
          // A committed departure retires held grants, not merely the session.
          // Restoring a fixture account cannot revive its old mandate children.
          // Grants issued independently to OTHER subjects keep their provenance.
          for (const g of grants.values()) if (g.subject === id) g.revoked = true;
        }
      },
      setRole(id, role) { if (!members.has(id) || !['owner', 'admin', 'member'].includes(role)) throw new TypeError(); members.get(id).role = role; },
      setFolderState(id, status) { if (!folders.has(id) || !['active', 'deleted'].includes(status)) throw new TypeError(); folders.get(id).state = status; },
      adminProjection(handle, folderId) {
        const actor = actorFor(handle); const f = folders.get(folderId);
        if (!actor || !['owner', 'admin'].includes(members.get(actor).role) || f?.kind !== 'personal') return deny();
        return { allowed: true, member: f.holder, volume: f.used, quota: f.quota, state: f.state };
      },
      succeed(handle, folderId, subject) {
        const actor = actorFor(handle); const f = folders.get(folderId); const at = time();
        if (!actor || !['owner', 'admin'].includes(members.get(actor).role) || f?.kind !== 'shared'
          || !active(subject) || !has(subject, folderId, 'consulter', at)
          || [...grants.values()].some((g) => g.folderId === folderId && g.capability === 'administrer' && validGrant(g.id, at))) return deny();
        const old = grants.get(f.referenceGrantId);
        if (!old || !caps(old.transmit)) return deny();
        const id = nextId('grant', grants);
        grants.set(id, { id, subject, folderId, capability: 'administrer', kind: 'reference', parent: null,
          transmit: copy(old.transmit), lineage: [], expiresAt: null, revoked: false, origin: 'fixture-succession' });
        f.referenceGrantId = id;
        return { allowed: true, grantId: id };
      },
    }),
  });
}
