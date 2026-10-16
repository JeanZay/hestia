import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { type Access, type Actor, HttpError, guarded, invalid, isUuid, json, privateHeaders, readActivity, response, textField, unavailable } from '../access';
import type { ObjectStore } from '../storage';
import type { StorageBudget } from '../storage/quota';
import { validateOriginal, FormatValidationError } from '../formats';
import { promoteInboxContent } from '../documents/revisions';
import { planCaptureDestination, type DestinationFolder } from '../capture/destination-plan';
import { loadFolderAccessGraph, folderAccessEvaluator } from '../permissions/service';
import { folderNameKey } from '../db/folder-name';
import { CAPABILITIES } from '../permissions/capabilities';
import { isValidComment } from '../../shared/capture-comment';
import type { CaptureDestination } from '../../shared/capture-contract';
import type { InboxAttachmentDto, InboxMessageDto, InboxPlacementInput, DocumentSummaryDto } from '../../shared/inbox-contract';
import { scanMime, parseHeaders, selectAttachments, MimeRejection } from './mime';
import { authenticateGoogle } from './authentication';
import { AcknowledgementFailure, minimalRejectionReason, type InboxAcknowledgementMessage } from './acknowledgement';
import { projectInboxAccess, inboxAccessLabel } from './access-projection';
import { canonicalEnvelope, canonicalTick, digest, readEnvelope, signedReply, signedTickReply, verifyEnvelope, verifyTick, type RelayEnvelope, type InboxTick } from './transport';

export type InboxDependencies = {
 store: ObjectStore; budget: StorageBudget; environment?: string; address?: string; relaySecret?: string; relayActor?: string; relayEpoch?: number;
 clock?: (client: PoolClient) => Promise<Date>;
 authenticate?: typeof authenticateGoogle; validateOriginal?: typeof validateOriginal;
 enqueueAnalysis?: (client: PoolClient, source: { attachmentId: string; contentId: string; actorId: string; automaticAnalysis: boolean }) => Promise<void>;
 requestAnalysis?: (client: PoolClient, source: { attachmentId: string; contentId: string; actorId: string; idempotencyKey: string; version: number; commentVersion: number }) => Promise<void>;
 settingsChanged?: (client: PoolClient, actorId: string, settings: { enabled: boolean; automaticAnalysis: boolean }) => Promise<void>;
 readSummary?: (client: PoolClient, contentId: string) => Promise<DocumentSummaryDto>;
 acknowledge?: (message: InboxAcknowledgementMessage) => Promise<{ providerId: string }>;
 diagnostic?: (event: { operation: 'relay'; code: string }) => void;
};
type Event = { id: string; state: string; raw_sha256: string; raw_size: number; chunk_count: number; staging_until: Date; terminal_at: Date | null; owner_id: string | null; owner_epoch: number; departure_epoch: number; sender: string; subject: string; context: string; context_partial: boolean; excluded_inline: number; rejected: { fileName?: string; reason: string }[]; first_at: Date; lease_token: string | null; lease_until: Date | null };
type Attachment = { id: string; event_id: string; actor_id: string; departure_epoch: number; content_id: string; version: number; state: string; received_at: Date; discarded_until: Date | null; document_id: string | null; comment: string; comment_version: number; analysis: InboxAttachmentDto['analysis']; object_key: string; file_name: string; media_type: string; size: number; sha256: string; preview_supported: boolean; deleted_at: Date | null; purge_pending_at: Date | null };
const terminal = (state: string) => !['staging', 'processing'].includes(state);
const change = () => new HttpError(409, 'VERSION_CONFLICT', 'Les informations ou les accès ont changé. Actualisez puis confirmez.');
const method = (request: Request, ...allowed: string[]) => { if (!allowed.includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Action indisponible.'); };
const uuid = (value: unknown) => { if (!isUuid(value)) throw invalid(); return value; };
const numeric = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalid(); return Number(value); };

export function createInboxService(pool: Pool, access: Access, deps: InboxDependencies) {
 const { transaction, withActor, origin } = access;
 const clock = deps.clock ?? (async (client: PoolClient) => (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now);
 const configured = () => Boolean(deps.address && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(deps.address) && deps.relaySecret && deps.relaySecret.length >= 32 && deps.relayActor && /^[A-Za-z0-9_-]{1,100}$/.test(deps.relayActor) && Number.isSafeInteger(deps.relayEpoch) && deps.relayEpoch! >= 1 && ['dev', 'production'].includes(deps.environment ?? ''));
 async function member(client: PoolClient, actorId: string) { return (await client.query('SELECT m.*,u.email,u."emailVerified" FROM hestia_member m JOIN "user" u ON u.id=m.user_id WHERE m.user_id=$1 FOR UPDATE OF m', [actorId])).rows[0]; }
 async function owned(client: PoolClient, actor: Actor, id: string, content = true): Promise<Attachment> {
  if (!isUuid(id)) throw unavailable(); const m = await member(client, actor.id);
  const row = (await client.query<Attachment>(`SELECT a.*,c.object_key,c.file_name,c.media_type,c.size,c.sha256,c.preview_supported,c.deleted_at,c.purge_pending_at FROM hestia_inbox_attachment a JOIN hestia_content c ON c.id=a.content_id WHERE a.id=$1 AND a.actor_id=$2 AND a.departure_epoch=$3 FOR UPDATE OF a`, [id, actor.id, m.departure_epoch])).rows[0];
  if (!row || content && (row.state === 'staging' || row.state === 'purged' || row.state === 'placed' || row.deleted_at || row.purge_pending_at || row.state === 'discarded' && row.discarded_until! <= await clock(client))) throw unavailable(); return row;
 }
 async function attachmentDto(client: PoolClient, row: Attachment): Promise<InboxAttachmentDto> {
  return { id: row.id, messageId: row.event_id, version: row.version, fileName: row.file_name, mediaType: row.media_type, size: row.size, sha256: row.sha256, state: row.state as InboxAttachmentDto['state'], receivedAt: row.received_at.toISOString(), discardedUntil: row.discarded_until?.toISOString() ?? null, previewSupported: row.preview_supported, comment: row.comment, commentVersion: row.comment_version, summary: await deps.readSummary?.(client, row.content_id) ?? { status: 'unavailable' }, analysis: row.analysis };
 }
 async function operation<T>(id: string, action: () => Promise<T>, skip = false) {
  const client = await pool.connect(); let locked = false;
  try { locked = Boolean((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,4820)) AS locked', [id])).rows[0].locked); if (!locked) { if (skip) return undefined; throw new HttpError(409, 'INBOX_BUSY', 'Opération en cours. Vérifiez son résultat.'); } return await access.usingClient(client, action); }
  finally { try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,4820))', [id]); } finally { client.release(); } }
 }
 async function settings(client: PoolClient, actor: Actor) {
  await client.query('INSERT INTO hestia_inbox_settings(actor_id) VALUES($1) ON CONFLICT DO NOTHING', [actor.id]);
  const row = (await client.query('SELECT * FROM hestia_inbox_settings WHERE actor_id=$1', [actor.id])).rows[0];
  return { version: row.version, enabled: row.enabled, automaticAnalysis: row.automatic_analysis, address: configured() ? deps.address! : null, configured: configured() };
 }
 async function handleInboxSettings(request: Request) { return guarded(async () => {
  method(request, 'GET', 'PUT', 'PATCH'); if (request.method === 'GET') return response(await withActor(request, (client, actor) => settings(client, actor), readActivity(request)));
  origin(request); const input = await json(request, ['version', 'enabled', 'automaticAnalysis']); if (input.enabled !== undefined && typeof input.enabled !== 'boolean' || input.automaticAnalysis !== undefined && typeof input.automaticAnalysis !== 'boolean') throw invalid();
  return response(await withActor(request, async (client, actor) => { const prior = await settings(client, actor); if (prior.version !== numeric(input.version)) throw change(); if (input.enabled && !configured()) throw new HttpError(409, 'RECEPTION_UNAVAILABLE', 'La réception mail n’est pas encore configurée.'); const changed = { enabled: input.enabled as boolean | undefined ?? prior.enabled, automaticAnalysis: input.automaticAnalysis as boolean | undefined ?? prior.automaticAnalysis }; await client.query('UPDATE hestia_inbox_settings SET enabled=$2,automatic_analysis=$3,version=version+1 WHERE actor_id=$1', [actor.id, changed.enabled, changed.automaticAnalysis]); await deps.settingsChanged?.(client, actor.id, changed); return settings(client, actor); }));
 }); }
 async function handleInbox(request: Request) { return guarded(async () => {
  method(request, 'GET'); return response(await withActor(request, async (client, actor) => {
   const m = await member(client, actor.id), now = await clock(client);
   // Independent windows keep recovery available while the oldest pending work advances.
   const rows = (await client.query<Attachment>(`WITH pending AS (
     SELECT a.id,0 AS priority FROM hestia_inbox_attachment a JOIN hestia_content c ON c.id=a.content_id JOIN hestia_inbox_event e ON e.id=a.event_id
     WHERE a.actor_id=$1 AND a.departure_epoch=$2 AND a.state='pending' AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL
       AND COALESCE(e.attributed_actor_id,e.owner_id)=$1 AND e.departure_epoch=$2
     ORDER BY a.received_at,a.id LIMIT 50
    ), recoverable AS (
     SELECT a.id,1 AS priority FROM hestia_inbox_attachment a JOIN hestia_content c ON c.id=a.content_id JOIN hestia_inbox_event e ON e.id=a.event_id
     WHERE a.actor_id=$1 AND a.departure_epoch=$2 AND a.state='discarded' AND a.discarded_until>$3 AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL
       AND COALESCE(e.attributed_actor_id,e.owner_id)=$1 AND e.departure_epoch=$2
     ORDER BY a.discarded_until,a.received_at,a.id LIMIT 50
    ) SELECT a.*,c.object_key,c.file_name,c.media_type,c.size,c.sha256,c.preview_supported,c.deleted_at,c.purge_pending_at
      FROM (SELECT * FROM pending UNION ALL SELECT * FROM recoverable) selected
      JOIN hestia_inbox_attachment a ON a.id=selected.id JOIN hestia_content c ON c.id=a.content_id
      ORDER BY selected.priority,CASE WHEN a.state='discarded' THEN a.discarded_until END,a.received_at,a.id`, [actor.id, m.departure_epoch, now])).rows;
   const parentIds = [...new Set(rows.map(row => row.event_id))];
   type QueueEvent = Event & { acknowledgement: string };
   // A parent cannot be displaced by a notice, or by another attachment window.
   const parents = (await client.query<QueueEvent>(`SELECT e.*,COALESCE(k.state,'failed') AS acknowledgement FROM hestia_inbox_event e LEFT JOIN hestia_inbox_ack k ON k.event_id=e.id
     WHERE e.id=ANY($3::uuid[]) AND COALESCE(e.attributed_actor_id,e.owner_id)=$1 AND e.departure_epoch=$2 ORDER BY e.first_at,e.id LIMIT 100`, [actor.id, m.departure_epoch, parentIds])).rows;
   const notices = (await client.query<QueueEvent>(`SELECT e.*,COALESCE(k.state,'failed') AS acknowledgement FROM hestia_inbox_event e LEFT JOIN hestia_inbox_ack k ON k.event_id=e.id
     WHERE COALESCE(e.attributed_actor_id,e.owner_id)=$1 AND e.departure_epoch=$2 AND e.notice_until>$3
       AND NOT EXISTS(SELECT 1 FROM hestia_inbox_attachment a WHERE a.event_id=e.id AND (a.state='pending' OR a.state='discarded' AND a.discarded_until>$3))
     ORDER BY e.first_at,e.id LIMIT 100`, [actor.id, m.departure_epoch, now])).rows;
   const count = Number((await client.query("SELECT count(*) FROM hestia_inbox_attachment WHERE actor_id=$1 AND departure_epoch=$2 AND state='pending'", [actor.id, m.departure_epoch])).rows[0].count);
   const messageDto = (row: QueueEvent): InboxMessageDto => ({ id: row.id, receivedAt: row.first_at.toISOString(), sender: row.sender ?? '', subject: row.subject ?? '', context: row.context ?? '', contextPartial: row.context_partial, outcome: row.state as InboxMessageDto['outcome'], excludedInline: row.excluded_inline, rejected: row.rejected, acknowledgement: (['sending', 'pending'].includes(row.acknowledgement) ? 'pending' : row.acknowledgement === 'cancelled' ? 'failed' : row.acknowledgement) as InboxMessageDto['acknowledgement'] });
   const queue = { pendingCount: count, receptionAvailable: configured(), messages: [] as InboxMessageDto[], attachments: [] as InboxAttachmentDto[] };
   const availableParents = new Map(parents.map(row => [row.id, messageDto(row)])), included = new Set<string>();
   // Complete DTOs are never truncated. Stop only between attachment+parent pairs,
   // below Vercel's4.5MB response ceiling; leave every omitted row durable for the next advance.
   const maximumBytes = 3 * 1024 * 1024; let usedBytes = Buffer.byteLength(JSON.stringify(queue));
   const append = async (selected: Attachment[], ceiling: number) => {
    for (const row of selected) {
     const parent = availableParents.get(row.event_id); if (!parent) continue;
     const item = await attachmentDto(client, row), parentBytes = included.has(parent.id) ? 0 : Buffer.byteLength(JSON.stringify(parent)) + 1;
     const bytes = Buffer.byteLength(JSON.stringify(item)) + 1 + parentBytes;
     if (usedBytes + bytes > ceiling) break;
     if (!included.has(parent.id)) { queue.messages.push(parent); included.add(parent.id); }
     queue.attachments.push(item); usedBytes += bytes;
    }
   };
   const pending = rows.filter(row => row.state === 'pending'), recoverable = rows.filter(row => row.state === 'discarded');
   await append(pending, recoverable.length ? Math.floor(maximumBytes / 2) : maximumBytes);
   await append(recoverable, maximumBytes);
   for (const row of notices) { if (included.has(row.id)) continue; const item = messageDto(row), bytes = Buffer.byteLength(JSON.stringify(item)) + 1; if (usedBytes + bytes > maximumBytes) break; queue.messages.push(item); included.add(row.id); usedBytes += bytes; }
   return queue;
  }, readActivity(request)));
 }); }
 async function handleInboxAttachment(request: Request, id: string) { return guarded(async () => { method(request, 'GET'); return response(await withActor(request, async (client, actor) => ({ attachment: await attachmentDto(client, await owned(client, actor, id)) }), readActivity(request))); }); }
 async function handleInboxMessageHide(request: Request, id: string) { return guarded(async () => {
  method(request, 'POST'); origin(request); uuid(id); return response(await withActor(request, async (client, actor) => { const m = await member(client, actor.id), now = await clock(client); const event = (await client.query('SELECT id FROM hestia_inbox_event WHERE id=$1 AND COALESCE(attributed_actor_id,owner_id)=$2 AND departure_epoch=$3 FOR UPDATE', [id, actor.id, m.departure_epoch])).rows[0]; if (!event) throw unavailable(); if ((await client.query("SELECT 1 FROM hestia_inbox_attachment WHERE event_id=$1 AND (state='pending' OR state='discarded' AND discarded_until>$2) LIMIT 1", [id, now])).rowCount) throw change(); await client.query('UPDATE hestia_inbox_event SET notice_until=NULL WHERE id=$1', [id]); return { hidden: true }; }));
 }); }
 async function handleInboxComment(request: Request, id: string) { return guarded(async () => {
  method(request, 'PUT', 'PATCH'); origin(request); const input = await json(request, ['version', 'commentVersion', 'comment']); if (!isValidComment(input.comment)) throw invalid();
  return response(await withActor(request, async (client, actor) => { const row = await owned(client, actor, id); if (row.state !== 'pending' || input.version !== undefined && row.version !== numeric(input.version) || row.comment_version !== numeric(input.commentVersion)) throw change(); await client.query("UPDATE hestia_inbox_attachment SET comment=$2,comment_version=comment_version+1,analysis='{\"status\":\"stale\",\"suggestions\":[]}' WHERE id=$1", [id, input.comment]); return { comment: input.comment, commentVersion: row.comment_version + 1 }; }));
 }); }
 async function handleInboxAnalyze(request: Request, id: string) { return guarded(async () => {
  method(request, 'POST'); origin(request); const input = await json(request, ['version', 'idempotencyKey']), key = uuid(input.idempotencyKey);
  return response(await withActor(request, async (client, actor) => { const row = await owned(client, actor, id); if (row.state !== 'pending' || row.version !== numeric(input.version)) throw change(); if (!deps.requestAnalysis) throw new HttpError(409, 'ANALYSIS_UNAVAILABLE', 'L’analyse est indisponible. Le classement manuel reste possible.'); await deps.requestAnalysis(client, { attachmentId: id, contentId: row.content_id, actorId: actor.id, idempotencyKey: key, version: row.version, commentVersion: row.comment_version }); return { attachment: await attachmentDto(client, await owned(client, actor, id)) }; }));
 }); }
 async function mutateState(request: Request, id: string, restoring: boolean) { return guarded(async () => {
  method(request, 'POST'); origin(request); const input = await json(request, ['version', 'idempotencyKey']), key = uuid(input.idempotencyKey), identity = digest(JSON.stringify([id, input.version, restoring]));
  return (await operation(id, () => withActor(request, async (client, actor) => {
   const m = await member(client, actor.id), receipt = (await client.query('SELECT * FROM hestia_inbox_receipt WHERE actor_id=$1 AND departure_epoch=$2 AND operation_id=$3', [actor.id, m.departure_epoch, key])).rows[0];
   if (receipt) { if (receipt.identity_sha256 !== identity || receipt.attachment_id !== id) throw change(); return response(receipt.result); }
   const row = await owned(client, actor, id), now = await clock(client); if (row.version !== numeric(input.version) || row.state !== (restoring ? 'discarded' : 'pending')) throw change();
   await client.query('UPDATE hestia_inbox_attachment SET state=$2,version=version+1,discarded_until=$3 WHERE id=$1', [id, restoring ? 'pending' : 'discarded', restoring ? null : new Date(now.getTime() + 168 * 3600000)]);
   const result = { status: restoring ? 'pending' : 'discarded', attachmentId: id, version: row.version + 1 }; await client.query('INSERT INTO hestia_inbox_receipt(actor_id,departure_epoch,operation_id,attachment_id,identity_sha256,result) VALUES($1,$2,$3,$4,$5,$6)', [actor.id, m.departure_epoch, key, id, identity, result]); return response(result);
  })))!;
 }); }
 async function handleInboxContent(request: Request, id: string) { return guarded(async () => {
  method(request, 'GET'); const row = await withActor(request, (client, actor) => owned(client, actor, id), readActivity(request));
  const inline = new URL(request.url).searchParams.get('preview') === 'true'; if (inline && !row.preview_supported) throw unavailable();
  const bytes = await readObject(row.object_key, row.size, row.sha256);
  await withActor(request, async (client, actor) => { const current = await owned(client, actor, id); if (current.content_id !== row.content_id) throw unavailable(); }, false);
  const headers = privateHeaders(); headers.set('content-type', row.media_type); headers.set('content-length', String(bytes.length)); headers.set('content-security-policy', "default-src 'none'; sandbox"); headers.set('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.file_name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`); return new Response(bytes, { headers });
 }); }
 async function readObject(key: string, size: number, sha256: string) { const output = new Uint8Array(size); for (let offset = 0; offset < size; offset += 2 * 1024 * 1024) { const length = Math.min(2 * 1024 * 1024, size - offset), chunk = await deps.store.getRange(key, offset, offset + length - 1); if (chunk.length !== length) throw unavailable(); output.set(chunk, offset); } if (digest(output) !== sha256) throw unavailable(); return output; }
 function placement(input: Record<string, unknown>): InboxPlacementInput {
  const destination = input.destination as CaptureDestination;
  if (!destination || typeof destination !== 'object' || !['existing', 'create'].includes(destination.kind)) throw invalid();
  if (destination.kind === 'existing') { if (Object.keys(destination).sort().join() !== 'folderId,kind') throw invalid(); uuid(destination.folderId); }
  else { if (Object.keys(destination).sort().join() !== 'kind,levels,parentId' || destination.parentId !== null && !isUuid(destination.parentId) || !Array.isArray(destination.levels) || destination.levels.length < 1 || destination.levels.length > 20) throw invalid(); destination.levels = destination.levels.map(value => textField(value, 120)); }
  if (input.mode !== 'add' && input.mode !== 'replace') throw invalid();
  if (input.mode === 'replace') { uuid(input.documentId); numeric(input.documentVersion); }
  if (input.mode === 'add' && (input.documentId !== undefined || input.documentVersion !== undefined)) throw invalid();
  return { version: numeric(input.version), destination, mode: input.mode, ...(input.title === undefined ? {} : { title: textField(input.title, 200) }), ...(input.mode === 'replace' ? { documentId: input.documentId as string, documentVersion: input.documentVersion as number } : {}) };
 }
 async function plan(client: PoolClient, actor: Actor, row: Attachment, input: InboxPlacementInput) {
  const graph = await loadFolderAccessGraph(client); graph.now = (await clock(client)).getTime(); const evaluate = folderAccessEvaluator(graph, actor.id);
  const rows = (await client.query<DestinationFolder>('SELECT id,name,parent_folder_id,version FROM hestia_folder WHERE trashed_at IS NULL ORDER BY id LIMIT 10001')).rows;
  const planned = planCaptureDestination(input.destination, rows, id => evaluate(id).capabilities);
  const duplicates = [];
  const visibleFolders = rows.filter(folder => evaluate(folder.id).capabilities.includes('consulter')).map(folder => folder.id);
  const candidates = (await client.query('SELECT id,folder_id,version,title,size,sha256 FROM hestia_document WHERE trashed_at IS NULL AND purged_at IS NULL AND ((size=$1 AND sha256=$2) OR title=$3) AND folder_id=ANY($4::uuid[]) ORDER BY id LIMIT 10001', [row.size, row.sha256, input.title ?? row.file_name, visibleFolders])).rows;
  if (candidates.length > 10000) throw new HttpError(503, 'RESOURCE_LIMIT', 'Trop de documents consultables pour cette opération.');
  for (const doc of candidates) {
   const caps = evaluate(doc.folder_id).capabilities; if (!caps.includes('consulter')) continue;
   duplicates.push({ kind: doc.size === row.size && doc.sha256 === row.sha256 ? 'identical' as const : 'same_name' as const, documentId: doc.id, documentVersion: doc.version, title: doc.title, path: visiblePath(doc.folder_id, rows, evaluate), canReplace: caps.includes('modifier') });
  }
  duplicates.sort((left, right) => left.documentId === right.documentId ? left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0 : left.documentId < right.documentId ? -1 : 1);
  if (input.mode === 'replace') { const target = (await client.query('SELECT id,folder_id,version FROM hestia_document WHERE id=$1 AND trashed_at IS NULL AND purged_at IS NULL', [input.documentId])).rows[0]; if (!target || target.version !== input.documentVersion || !['consulter', 'modifier'].every(cap => evaluate(target.folder_id).capabilities.includes(cap)) || !planned.allExist || planned.baseId !== target.folder_id) throw change(); }
  const projected = projectInboxAccess(graph, actor, planned.baseId);
  // Adding despite a collision confirms the exact visible candidates shown. Hidden documents never enter this snapshot or its capacity bound.
  const policy = digest(JSON.stringify([row.id, row.version, row.comment_version, planned.identity, planned.missing, rows.map(folder => [folder.id, evaluate(folder.id).capabilities]), projected, graph.grants, graph.restrictions, graph.cuts, duplicates, input]));
  return { planned, policy, preview: { exactPath: planned.path.map(item => item.name).join(' / '), accessLabel: inboxAccessLabel(projected, planned.baseId === null), access: projected, createsFolders: Boolean(planned.missing.length), duplicates, destination: input.destination, mode: input.mode, ...(input.documentId ? { documentId: input.documentId, documentVersion: input.documentVersion } : {}) } };
 }
 function visiblePath(id: string, rows: DestinationFolder[], evaluate: ReturnType<typeof folderAccessEvaluator>) { const names = []; const seen = new Set(); let current = rows.find(row => row.id === id); while (current && !seen.has(current.id) && evaluate(current.id).capabilities.includes('consulter')) { seen.add(current.id); names.unshift(current.name); current = rows.find(row => row.id === current!.parent_folder_id); } return names.join(' / '); }
 const placementKeys = ['version', 'destination', 'mode', 'documentId', 'documentVersion', 'title'];
 async function handleInboxPreview(request: Request, id: string) { return guarded(async () => {
  method(request, 'POST'); origin(request); const input = placement(await json(request, placementKeys));
  return response(await withActor(request, async (client, actor) => { const row = await owned(client, actor, id); if (row.state !== 'pending' || row.version !== input.version) throw change(); const result = await plan(client, actor, row, input), token = randomBytes(32).toString('base64url'), m = await member(client, actor.id), now = await clock(client);
   await client.query('DELETE FROM hestia_inbox_preview WHERE attachment_id=$1 AND (expires_at<=$2 OR token IN(SELECT token FROM hestia_inbox_preview WHERE attachment_id=$1 ORDER BY expires_at DESC OFFSET 19))', [id, now]);
   await client.query('INSERT INTO hestia_inbox_preview(token,actor_id,actor_epoch,attachment_id,identity_sha256,policy_sha256,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [token, actor.id, m.epoch, id, digest(JSON.stringify(input)), result.policy, new Date(now.getTime() + 15 * 60000)]); return { ...result.preview, previewToken: token };
  }));
 }); }
 async function previous(client: PoolClient, actor: Actor, id: string, key: string, identity: string) { const m = await member(client, actor.id); const prior = (await client.query('SELECT * FROM hestia_inbox_receipt WHERE actor_id=$1 AND departure_epoch=$2 AND operation_id=$3', [actor.id, m.departure_epoch, key])).rows[0]; if (!prior) return null; if (prior.attachment_id !== id || prior.identity_sha256 !== identity) throw change(); if (prior.result.documentId) { const doc = (await client.query('SELECT folder_id FROM hestia_document WHERE id=$1 AND trashed_at IS NULL AND purged_at IS NULL', [prior.result.documentId])).rows[0]; const graph = await loadFolderAccessGraph(client); if (!doc || !folderAccessEvaluator(graph, actor.id)(doc.folder_id).capabilities.includes('consulter')) throw unavailable(); } return prior.result; }
 async function handleInboxPlace(request: Request, id: string) { return guarded(async () => {
  method(request, 'POST'); origin(request); const raw = await json(request, [...placementKeys, 'previewToken', 'idempotencyKey']), input = placement(raw), key = uuid(raw.idempotencyKey); if (typeof raw.previewToken !== 'string') throw invalid(); const identity = digest(JSON.stringify([id, input, raw.previewToken]));
  return (await operation(id, () => withActor(request, async (client, actor) => {
   const prior = await previous(client, actor, id, key, identity); if (prior) return response(prior);
   const row = await owned(client, actor, id); if (row.state !== 'pending' || row.version !== input.version) throw change(); const result = await plan(client, actor, row, input), m = await member(client, actor.id), now = await clock(client);
   const preview = (await client.query('SELECT * FROM hestia_inbox_preview WHERE token=$1 AND actor_id=$2 AND attachment_id=$3', [raw.previewToken, actor.id, id])).rows[0];
   if (!preview || preview.actor_epoch !== m.epoch || preview.expires_at <= now || preview.identity_sha256 !== digest(JSON.stringify(input)) || preview.policy_sha256 !== result.policy) throw change();
   await deps.budget.lock(client); let folderId = result.planned.baseId;
   for (const name of result.planned.missing) { const child = randomUUID(); await client.query('INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id) VALUES($1,$2,$3,$4,$5)', [child, name, folderNameKey(name), actor.id, folderId]);
    if (!folderId) { for (const capability of CAPABILITIES) await client.query('INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,transmit,author_id,subject_epoch,batch_id) VALUES($1,$2,$3,$4,$5,$6,$3,$7,$2)', [randomUUID(), child, actor.id, capability, capability === 'administrer' ? 'reference' : 'direct', capability === 'administrer' ? [...CAPABILITIES] : capability === 'partager' ? CAPABILITIES.filter(cap => cap !== 'administrer') : [], m.departure_epoch]); await client.query("UPDATE hestia_folder SET reference_grant_id=(SELECT id FROM hestia_grant WHERE folder_id=$1 AND kind='reference' AND revoked_at IS NULL) WHERE id=$1", [child]); } folderId = child;
   }
   if (!folderId) throw invalid(); const promoted = await promoteInboxContent(client, actor, { contentId: row.content_id, folderId, title: input.title ?? row.file_name, ...(input.mode === 'replace' ? { documentId: input.documentId, documentVersion: input.documentVersion } : {}) }, deps.budget);
   const receipt = { status: 'recorded', documentId: promoted.documentId, attachmentId: id }; await client.query("UPDATE hestia_inbox_attachment SET state='placed',document_id=$2,version=version+1,comment='',analysis='{\"status\":\"unavailable\",\"suggestions\":[]}' WHERE id=$1", [id, promoted.documentId]);
   await client.query('INSERT INTO hestia_inbox_receipt(actor_id,departure_epoch,operation_id,attachment_id,identity_sha256,result,committed_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [actor.id, m.departure_epoch, key, id, identity, receipt, now]); return response(receipt);
  })))!;
 }); }
 async function handleInboxOperation(request: Request, operationId: string, pathAttachmentId?: string) { return guarded(async () => {
  method(request, 'POST'); origin(request); const raw = await json(request, [...placementKeys, 'previewToken', 'idempotencyKey', 'attachmentId']), id = uuid(raw.attachmentId), key = uuid(raw.idempotencyKey); if (key !== uuid(operationId) || typeof raw.previewToken !== 'string') throw invalid(); const input = placement(raw), identity = digest(JSON.stringify([id, input, raw.previewToken]));
  const routeId = pathAttachmentId ?? /^\/api\/hestia\/inbox\/([^/]+)\/operations\/[^/]+$/.exec(new URL(request.url).pathname)?.[1]; if (routeId !== undefined && uuid(routeId) !== id) throw invalid();
  await withActor(request, async (client, actor) => { await owned(client, actor, id, false); });
  const result = await operation(id, () => withActor(request, async (client, actor) => await previous(client, actor, id, key, identity) ?? { status: 'not-recorded' }), true); return response(result ?? { status: 'in-progress' });
 }); }
 async function relayEvent(client: PoolClient, envelope: RelayEnvelope) {
  const now = await clock(client), hashedId = digest(envelope.gmailId);
  let event = (await client.query<Event>('SELECT * FROM hestia_inbox_event WHERE environment=$1 AND relay_actor=$2 AND gmail_id_sha256=$3 FOR UPDATE', [deps.environment, deps.relayActor, hashedId])).rows[0];
  if (!event) {
   const counts = (await client.query("SELECT count(*)::integer AS total,count(*) FILTER(WHERE first_at>$2)::integer AS daily FROM hestia_inbox_event WHERE environment=$1", [deps.environment, new Date(now.getTime() - 86400000)])).rows[0];
   if (counts.total >= 1000000 || counts.daily >= 1000) throw new HttpError(429, 'RELAY_LIMIT', 'Capacité de réception atteinte.');
   event = (await client.query<Event>('INSERT INTO hestia_inbox_event(id,environment,relay_actor,gmail_id_sha256,raw_sha256,raw_size,chunk_count,configuration_epoch,first_at,staging_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [randomUUID(), deps.environment, deps.relayActor, hashedId, envelope.rawSha256, envelope.rawSize, envelope.chunks, envelope.epoch, now, new Date(now.getTime() + 86400000)])).rows[0];
  }
  if (event.raw_sha256 !== envelope.rawSha256 || event.raw_size !== envelope.rawSize || event.chunk_count !== envelope.chunks) throw new HttpError(409, 'RELAY_CONFLICT', 'Message incompatible.'); return event;
 }
 async function handleInboxRelay(request: Request) { return guarded(async () => {
  try {
  if (!configured()) throw new HttpError(503, 'RELAY_UNAVAILABLE', 'Réception indisponible.');
  const envelope = await readEnvelope(request), now = await transaction(clock), bytes = verifyEnvelope(envelope, request.headers.get('x-hestia-signature') ?? '', { environment: deps.environment!, relayActor: deps.relayActor!, relayEpoch: deps.relayEpoch!, relaySecret: deps.relaySecret! }, now);
  const event = await transaction(async client => {
   const identity = digest(canonicalEnvelope(envelope));
   const old = (await client.query('SELECT request_sha256 FROM hestia_inbox_nonce WHERE environment=$1 AND actor=$2 AND nonce=$3', [deps.environment, deps.relayActor, envelope.nonce])).rows[0];
   if (old && old.request_sha256 !== identity) throw invalid();
   await client.query('INSERT INTO hestia_inbox_nonce(environment,actor,nonce,request_sha256,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [deps.environment, deps.relayActor, envelope.nonce, identity, new Date(now.getTime() + 600000)]); return relayEvent(client, envelope);
  });
  const result = await operation(`relay/${event.id}`, async () => {
   if (envelope.operation === 'reject') await transaction(async client => { const current = await relayEvent(client, envelope); if (!terminal(current.state)) await client.query("UPDATE hestia_inbox_event SET state='message_rejected',terminal_at=$2,rejected='[{\"reason\":\"unsupported_raw_profile\"}]' WHERE id=$1", [event.id, await clock(client)]); });
   if (envelope.operation === 'chunk') {
    const reserved = await transaction(async client => {
     const current = await relayEvent(client, envelope); if (terminal(current.state)) return null;
     if (current.state === 'processing') throw new HttpError(409, 'RELAY_BUSY', 'Réception en cours.');
     if (current.staging_until <= await clock(client)) {
      // A new staging session is allowed only after every expired physical fragment was deleted.
      if ((await client.query('SELECT 1 FROM hestia_inbox_chunk WHERE event_id=$1 AND deleted_at IS NULL LIMIT 1', [event.id])).rowCount) throw new HttpError(409, 'STAGING_EXPIRED', 'Nettoyage en cours. Réessayez.');
      await client.query('DELETE FROM hestia_inbox_chunk WHERE event_id=$1', [event.id]); await client.query('UPDATE hestia_inbox_event SET staging_until=$2 WHERE id=$1', [event.id, new Date((await clock(client)).getTime() + 86400000)]);
     }
     const prior = (await client.query('SELECT * FROM hestia_inbox_chunk WHERE event_id=$1 AND chunk_index=$2', [event.id, envelope.index])).rows[0];
     if (prior) { if (prior.sha256 !== envelope.chunkSha256 || prior.size !== bytes.length || prior.deleted_at || prior.purge_pending_at) throw change(); return prior.ready ? null : prior; }
     await deps.budget.assertAdditional(client, [{ ownerId: '', bytes: bytes.length }]);
     return (await client.query('INSERT INTO hestia_inbox_chunk(event_id,chunk_index,object_key,size,sha256) VALUES($1,$2,$3,$4,$5) RETURNING *', [event.id, envelope.index, `inbox-raw/${event.id}/${randomUUID()}`, bytes.length, envelope.chunkSha256])).rows[0];
    });
    if (reserved) { await deps.store.put(reserved.object_key, bytes, 'application/octet-stream'); await transaction(async client => { const current = await relayEvent(client, envelope); if (current.state !== 'staging' || current.staging_until <= await clock(client)) throw change(); const changed = await client.query('UPDATE hestia_inbox_chunk SET ready=true WHERE event_id=$1 AND chunk_index=$2 AND deleted_at IS NULL AND purge_pending_at IS NULL', [event.id, envelope.index]); if (!changed.rowCount) throw change(); }); }
   }
   if (envelope.operation === 'process') await processRelayUnlocked(event.id);
   return transaction(async client => { const current = await relayEvent(client, envelope); const stored = Number((await client.query('SELECT count(*) FROM hestia_inbox_chunk WHERE event_id=$1 AND ready AND deleted_at IS NULL', [event.id])).rows[0].count); return { eventId: event.id, transport: stored === current.chunk_count ? 'stored' : 'incomplete', storedChunks: stored, terminal: terminal(current.state), outcome: terminal(current.state) ? current.state : 'pending' }; });
  });
  return response(signedReply(envelope, result, deps.relaySecret!));
  } catch (error) { const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'INTERNAL'; deps.diagnostic?.({ operation: 'relay', code }); throw error; }
 }); }
 async function handleInboxTick(request: Request) { return guarded(async () => {
  method(request, 'POST'); if (!configured()) throw new HttpError(503, 'RELAY_UNAVAILABLE', 'Réception indisponible.');
  const value = await json(request, ['environment', 'actor', 'epoch', 'timestamp', 'nonce']) as InboxTick;
  await transaction(async client => {
   const now = await clock(client); verifyTick(value, request.headers.get('x-hestia-signature') ?? '', { environment: deps.environment!, relayActor: deps.relayActor!, relayEpoch: deps.relayEpoch!, relaySecret: deps.relaySecret! }, now);
   await client.query('DELETE FROM hestia_inbox_nonce WHERE environment=$1 AND actor=$2 AND expires_at<=$3', [deps.environment, deps.relayActor, now]);
   const count = Number((await client.query('SELECT count(*) FROM hestia_inbox_nonce WHERE environment=$1 AND actor=$2', [deps.environment, deps.relayActor])).rows[0].count);
   if (count >= 10000) throw new HttpError(429, 'RELAY_LIMIT', 'Capacité de réception atteinte.');
   const recorded = await client.query('INSERT INTO hestia_inbox_nonce(environment,actor,nonce,request_sha256,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [deps.environment, deps.relayActor, value.nonce, digest(canonicalTick(value)), new Date(now.getTime() + 600000)]);
   if (!recorded.rowCount) throw new HttpError(409, 'RELAY_REPLAY', 'Cette impulsion a déjà été reçue.');
  });
  return response(signedTickReply(value, { accepted: true }, deps.relaySecret!));
 }); }
 async function processRelay(messageId: string) { if (!isUuid(messageId)) throw invalid(); return operation(`relay/${messageId}`, () => processRelayUnlocked(messageId), true); }
 async function processRelayUnlocked(messageId: string) {
  const lease = randomUUID();
  const initial = await transaction(async client => {
   const event = (await client.query<Event>('SELECT * FROM hestia_inbox_event WHERE id=$1 FOR UPDATE', [messageId])).rows[0]; if (!event || terminal(event.state)) return null;
   const now = await clock(client); if (event.staging_until <= now || event.state === 'processing' && event.lease_until! > now) return null;
   const chunks = (await client.query('SELECT * FROM hestia_inbox_chunk WHERE event_id=$1 AND ready AND deleted_at IS NULL AND purge_pending_at IS NULL ORDER BY chunk_index', [messageId])).rows;
   if (chunks.length !== event.chunk_count || chunks.reduce((sum, part) => sum + part.size, 0) !== event.raw_size || chunks.some((part, index) => part.chunk_index !== index)) return null;
   await client.query("UPDATE hestia_inbox_event SET state='processing',lease_token=$2,lease_until=$3 WHERE id=$1", [messageId, lease, new Date(Math.min(event.staging_until.getTime(), now.getTime() + 5 * 60000))]); return { event, chunks };
  }); if (!initial) return;
  let admitted: { actorId: string; epoch: number; departureEpoch: number; email: string; automatic: boolean; quotaRejected: boolean } | null = null;
  const fence = async (client: PoolClient) => {
   const current = (await client.query<Event>('SELECT * FROM hestia_inbox_event WHERE id=$1 FOR UPDATE', [messageId])).rows[0]; const now = await clock(client);
   if (!current || current.state !== 'processing' || current.lease_token !== lease || current.lease_until! <= now || current.staging_until <= now) throw change();
   if (admitted) { const m = await member(client, admitted.actorId), s = (await client.query('SELECT enabled FROM hestia_inbox_settings WHERE actor_id=$1', [admitted.actorId])).rows[0]; if (!m?.active || m.recovering || !m.emailVerified || m.epoch !== admitted.epoch || m.departure_epoch !== admitted.departureEpoch || m.email !== admitted.email || !s?.enabled) throw new MimeRejection('sender_rejected'); }
  };
  const finalize = async (state: string, details?: ReturnType<typeof selectAttachments>, reason?: string) => transaction(async client => {
   await fence(client); const now = await clock(client);
   const published = (await client.query("UPDATE hestia_inbox_attachment SET state='pending' WHERE event_id=$1 AND state='staging' AND ready RETURNING id,content_id", [messageId])).rows;
   const accepted = Number((await client.query("SELECT count(*) FROM hestia_inbox_attachment WHERE event_id=$1 AND state='pending'", [messageId])).rows[0].count);
   await client.query('UPDATE hestia_inbox_event SET state=$2,terminal_at=$3,lease_token=NULL,lease_until=NULL,excluded_inline=$4,rejected=$5,notice_until=$6 WHERE id=$1', [messageId, state, now, details?.excludedInline ?? null, JSON.stringify(details?.rejected ?? (reason ? [{ reason: minimalRejectionReason(reason) }] : [])), !accepted && admitted ? new Date(now.getTime() + 7 * 86400000) : null]);
   if (admitted) await client.query('INSERT INTO hestia_inbox_ack(id,event_id,actor_id,actor_epoch,email,accepted,rejected,outcome,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_id) DO NOTHING', [randomUUID(), messageId, admitted.actorId, admitted.epoch, admitted.email, accepted, details?.rejected.length ?? 0, state, now]);
   if (admitted) { const current = (await client.query('SELECT automatic_analysis FROM hestia_inbox_settings WHERE actor_id=$1', [admitted.actorId])).rows[0]; for (const row of published) await deps.enqueueAnalysis?.(client, { attachmentId: row.id, contentId: row.content_id, actorId: admitted.actorId, automaticAnalysis: admitted.automatic && current.automatic_analysis }); }
  });
  try {
   const raw = new Uint8Array(initial.event.raw_size); let offset = 0;
   for (const part of initial.chunks) { const bytes = await readObject(part.object_key, part.size, part.sha256); raw.set(bytes, offset); offset += bytes.length; }
   if (digest(raw) !== initial.event.raw_sha256) throw new MimeRejection('raw_integrity');
   const split = Buffer.from(raw).indexOf('\r\n\r\n'); if (split < 0 || split > 65536) throw new MimeRejection('message_headers');
   const headerBytes = raw.subarray(0, split); if (headerBytes.some(byte => byte > 126 || byte < 32 && ![9, 10, 13].includes(byte))) throw new MimeRejection('message_headers');
   const parsedHeaders = parseHeaders(Buffer.from(headerBytes).toString('ascii'), true), headerInventory = { headers: parsedHeaders.headers, headerRows: parsedHeaders.rows, parts: [] };
   const proof = await (deps.authenticate ?? authenticateGoogle)(raw, headerInventory, deps.address!, await transaction(clock));
   admitted = await transaction(async client => {
    await fence(client);
    const result = (await client.query('SELECT m.*,u.email,u."emailVerified",s.enabled,s.automatic_analysis FROM hestia_member m JOIN "user" u ON u.id=m.user_id JOIN hestia_inbox_settings s ON s.actor_id=m.user_id WHERE u.email=$1 FOR UPDATE OF m', [proof.sender])).rows[0];
    if (!result?.active || result.recovering || !result.emailVerified || !result.enabled) throw new MimeRejection('sender_rejected');
    if (initial.event.owner_id && (initial.event.owner_id !== result.user_id || initial.event.departure_epoch !== result.departure_epoch || initial.event.owner_epoch !== result.epoch)) throw new MimeRejection('sender_rejected');
    let quotaRejected = false;
    try { if (initial.event.owner_id === result.user_id) await deps.budget.assertAdditional(client, [{ ownerId: result.user_id, bytes: 0 }]); else await deps.budget.transfer(client, '', result.user_id, initial.event.raw_size); }
    catch (error) { if (!(error instanceof HttpError) || error.code !== 'QUOTA_EXCEEDED') throw error; quotaRejected = true; }
    await client.query('UPDATE hestia_inbox_event SET owner_id=$2,attributed_actor_id=$7,owner_epoch=$3,departure_epoch=$4,sender=$5,subject=$6 WHERE id=$1', [messageId, quotaRejected ? initial.event.owner_id : result.user_id, result.epoch, result.departure_epoch, result.email, parsedHeaders.headers.get('subject')!.slice(0, 500), result.user_id]);
    return { actorId: result.user_id, epoch: result.epoch, departureEpoch: result.departure_epoch, email: result.email, automatic: result.automatic_analysis, quotaRejected };
   });
   if (admitted.quotaRejected) { await finalize('message_rejected', undefined, 'quota_exceeded'); return; }
   const inventory = scanMime(raw);
   const selected = selectAttachments(inventory);
   await transaction(async client => { await fence(client); await client.query('UPDATE hestia_inbox_event SET context=$2,context_partial=$3 WHERE id=$1', [messageId, selected.context, selected.contextPartial]); });
   for (const item of selected.attachments) {
    const existing = await transaction(async client => { await fence(client); return (await client.query('SELECT a.*,c.object_key FROM hestia_inbox_attachment a JOIN hestia_content c ON c.id=a.content_id WHERE a.event_id=$1 AND a.position=$2', [messageId, item.position])).rows[0]; });
    if (existing?.ready) continue;
    let previewSupported = false, mediaType = item.mediaType;
    // Known file signatures/extensions cannot escape their decoder by claiming an opaque MIME type.
    if (item.bytes.subarray(0, 5).toString('ascii') === '%PDF-' || /\.pdf$/i.test(item.fileName)) mediaType = 'application/pdf';
    else if (item.bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || /\.png$/i.test(item.fileName)) mediaType = 'image/png';
    else if (item.bytes[0] === 255 && item.bytes[1] === 216 || /\.jpe?g$/i.test(item.fileName)) mediaType = 'image/jpeg';
    else if (/\.webp$/i.test(item.fileName)) mediaType = 'image/webp';
    else if (/\.hei[cf]$/i.test(item.fileName)) mediaType = 'image/heic';
    try { if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mediaType)) { const valid = await (deps.validateOriginal ?? validateOriginal)(item.bytes, mediaType); previewSupported = valid.previewSupported; mediaType = valid.mediaType; } }
    catch (error) { if (!(error instanceof FormatValidationError) || error.code === 'validation_unavailable') throw error; selected.rejected.push({ fileName: item.fileName, reason: 'invalid_file' }); continue; }
    let target = existing;
    try { if (!target) target = await transaction(async client => {
     await fence(client); await deps.budget.assertAdditional(client, [{ ownerId: admitted!.actorId, bytes: item.bytes.length }]); const contentId = randomUUID(), id = randomUUID(), objectKey = `inbox/${messageId}/${randomUUID()}`;
     await client.query('INSERT INTO hestia_content(id,object_key,owner_id,size,sha256,media_type,file_name,preview_supported) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [contentId, objectKey, admitted!.actorId, item.bytes.length, item.sha256, mediaType, item.fileName, previewSupported]);
     await client.query('INSERT INTO hestia_inbox_attachment(id,event_id,position,actor_id,departure_epoch,content_id,received_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, messageId, item.position, admitted!.actorId, admitted!.departureEpoch, contentId, await clock(client)]); return { id, content_id: contentId, object_key: objectKey };
    }); } catch (error) { if (error instanceof HttpError && error.code === 'QUOTA_EXCEEDED') { selected.rejected.push({ fileName: item.fileName, reason: 'quota_exceeded' }); continue; } throw error; }
    await deps.store.put(target.object_key, item.bytes, mediaType);
    await transaction(async client => { await fence(client); await client.query("UPDATE hestia_inbox_attachment SET ready=true WHERE id=$1 AND state='staging'", [target.id]); });
   }
   const count = await transaction(async client => Number((await client.query("SELECT count(*) FROM hestia_inbox_attachment WHERE event_id=$1 AND ready", [messageId])).rows[0].count));
   await finalize(count ? selected.rejected.length ? 'partial' : 'accepted' : selected.rejected.length ? 'all_rejected' : 'no_attachments', selected);
  } catch (error) {
   if (error instanceof MimeRejection) {
    // Invalid/revoked admission never keeps an owner or acknowledgement. Staged bytes stay charged until confirmed deletion.
    if (!admitted || error.reason === 'sender_rejected') {
     admitted = null;
     await transaction(async client => { await fence(client); const now = await clock(client); await client.query("UPDATE hestia_inbox_event SET state='sender_rejected',terminal_at=$2,owner_id=NULL,attributed_actor_id=NULL,owner_epoch=NULL,departure_epoch=NULL,sender=NULL,subject=NULL,context=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1", [messageId, now]); });
    } else await finalize('message_rejected', undefined, error.reason);
   } else {
    await transaction(async client => { await client.query("UPDATE hestia_inbox_event SET state='staging',lease_token=NULL,lease_until=NULL WHERE id=$1 AND state='processing' AND lease_token=$2", [messageId, lease]); }); throw error;
   }
  }
 }
 async function assertInboxTranscription(client: PoolClient, actor: Actor, id: string) { const row = await owned(client, actor, id); if (row.state !== 'pending') throw unavailable(); const m = await member(client, actor.id); if (!m.active || m.recovering) throw unavailable(); return { inboxAttachmentId: id, actorId: actor.id, actorEpoch: m.epoch, departureEpoch: m.departure_epoch, attachmentVersion: row.version, commentVersion: row.comment_version }; }
 async function cleanup() {
  const rawRows = await transaction(async client => {
   const now = await clock(client); await client.query('DELETE FROM hestia_inbox_nonce WHERE expires_at<=$1', [now]); await client.query('DELETE FROM hestia_inbox_preview WHERE expires_at<=$1', [now]);
   const rows = (await client.query(`SELECT c.* FROM hestia_inbox_chunk c JOIN hestia_inbox_event e ON e.id=c.event_id WHERE c.deleted_at IS NULL AND (e.terminal_at<=$1 OR e.staging_until<=$1) AND (e.lease_until IS NULL OR e.lease_until<=$1) ORDER BY e.first_at LIMIT 100`, [now])).rows;
   for (const row of rows) await client.query('UPDATE hestia_inbox_chunk SET purge_pending_at=COALESCE(purge_pending_at,$3) WHERE event_id=$1 AND chunk_index=$2', [row.event_id, row.chunk_index, now]); return rows;
  });
  let deleted = 0;
  for (const row of rawRows) { try { await operation(`relay/${row.event_id}`, async () => { await deps.store.delete(row.object_key); await transaction(async client => { await client.query('UPDATE hestia_inbox_chunk SET deleted_at=$3 WHERE event_id=$1 AND chunk_index=$2 AND deleted_at IS NULL', [row.event_id, row.chunk_index, await clock(client)]); }); deleted++; }, true); } catch { /* Retain physical quota and retry from the ledger. */ } }
  const contentRows = await transaction(async client => {
   const now = await clock(client);
   const rows = (await client.query(`SELECT a.id,a.event_id,a.content_id,c.object_key FROM hestia_inbox_attachment a JOIN hestia_content c ON c.id=a.content_id JOIN hestia_member m ON m.user_id=a.actor_id JOIN hestia_inbox_event e ON e.id=a.event_id WHERE c.deleted_at IS NULL AND (a.state='discarded' AND a.discarded_until<=$1 AND m.active AND a.departure_epoch=m.departure_epoch OR a.state='staging' AND (e.staging_until<=$1 OR e.state='sender_rejected')) AND NOT EXISTS(SELECT 1 FROM hestia_document_revision r WHERE r.content_id=c.id) LIMIT 100`, [now])).rows;
   for (const row of rows) await client.query('UPDATE hestia_content SET purge_pending_at=COALESCE(purge_pending_at,$2) WHERE id=$1', [row.content_id, now]); return rows;
  });
  for (const row of contentRows) { try { await operation(`relay/${row.event_id}`, async () => { await deps.store.delete(row.object_key); await transaction(async client => { const now = await clock(client); await client.query('UPDATE hestia_content SET deleted_at=$2,file_name=NULL WHERE id=$1', [row.content_id, now]); if ((await client.query("SELECT to_regclass('hestia_content_summary') AS table_name")).rows[0].table_name) await client.query('DELETE FROM hestia_content_summary WHERE content_id=$1', [row.content_id]); await client.query("UPDATE hestia_inbox_attachment SET state='purged',version=version+1,comment='',analysis='{\"status\":\"unavailable\",\"suggestions\":[]}' WHERE id=$1", [row.id]); }); deleted++; }, true); } catch { /* Do not release unconfirmed bytes. */ } }
  await transaction(async client => {
   const now = await clock(client);
   await client.query(`UPDATE hestia_inbox_event e SET sender=NULL,subject=NULL,context=NULL,rejected=(SELECT COALESCE(jsonb_agg(jsonb_build_object('reason',r->>'reason')),'[]') FROM jsonb_array_elements(e.rejected) r),context_purged_at=$1 WHERE terminal_at<=$1 AND context_purged_at IS NULL AND NOT EXISTS(SELECT 1 FROM hestia_inbox_attachment a WHERE a.event_id=e.id AND (a.state='pending' OR a.state='discarded' AND a.discarded_until>$1))`, [now]);
   await client.query("UPDATE hestia_inbox_ack SET state='unknown',lease_token=NULL,lease_until=NULL WHERE state='sending' AND lease_until<=$1", [now]);
   await client.query(`UPDATE hestia_inbox_ack k SET email='' WHERE state IN ('sent','failed','unknown','cancelled') AND created_at<$1`, [new Date(now.getTime() - 7 * 86400000)]);
  }); return { deleted };
 }
 async function runAcknowledgements(limit = 1) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw invalid();
  if (!deps.acknowledge) return { attempted: 0 }; let attempted = 0;
  for (let count = 0; count < limit; count++) {
   const token = randomUUID(), ack = await transaction(async client => {
    const now = await clock(client);
    // Identity mail always wins the shared sending window. A small independent cap protects daily allowances.
    if ((await client.query("SELECT 1 FROM hestia_mail_outbox WHERE state IN ('pending','sending') LIMIT 1")).rowCount) return null;
    if (Number((await client.query("SELECT count(*) FROM hestia_inbox_ack WHERE first_attempt_at>$1", [new Date(now.getTime() - 86400000)])).rows[0].count) >= 20) return null;
    const row = (await client.query("SELECT * FROM hestia_inbox_ack WHERE state='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0]; if (!row) return null;
    const m = await member(client, row.actor_id);
    if (!m?.active || m.recovering || !m.emailVerified || m.epoch !== row.actor_epoch || m.email !== row.email) { await client.query("UPDATE hestia_inbox_ack SET state='cancelled' WHERE id=$1", [row.id]); return null; }
    const event = (await client.query('SELECT rejected FROM hestia_inbox_event WHERE id=$1', [row.event_id])).rows[0];
    const reasons = Array.isArray(event?.rejected) ? event.rejected.slice(0, 200).flatMap((item: unknown) => item && typeof item === 'object' && 'reason' in item && typeof item.reason === 'string' ? [minimalRejectionReason(item.reason)] : []) : [];
    await client.query("UPDATE hestia_inbox_ack SET state='sending',lease_token=$2,lease_until=$3,first_attempt_at=COALESCE(first_attempt_at,$4),attempts=attempts+1 WHERE id=$1", [row.id, token, new Date(now.getTime() + 60000), now]); return { ...row, reasons };
   }); if (!ack) break; attempted++;
   try { const current = await transaction(async client => { const m = await member(client, ack.actor_id); if (!m?.active || m.recovering || !m.emailVerified || m.epoch !== ack.actor_epoch || m.email !== ack.email) { await client.query("UPDATE hestia_inbox_ack SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2", [ack.id, token]); return false; } return Boolean((await client.query("SELECT id FROM hestia_inbox_ack WHERE id=$1 AND state='sending' AND lease_token=$2 AND lease_until>$3", [ack.id, token, await clock(client)])).rowCount); }); if (!current) continue; const sent = await deps.acknowledge({ id: ack.id, email: ack.email, outcome: ack.outcome, accepted: ack.accepted, rejected: ack.rejected, reasons: ack.reasons }); await transaction(async client => { await client.query("UPDATE hestia_inbox_ack SET state='sent',provider_id=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND state='sending' AND lease_token=$2", [ack.id, token, sent.providerId]); }); }
   catch (error) { await transaction(async client => { await client.query("UPDATE hestia_inbox_ack SET state=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND state='sending' AND lease_token=$2", [ack.id, token, error instanceof AcknowledgementFailure && error.known ? 'failed' : 'unknown']); }); }
  } return { attempted };
 }
 return { handleInboxSettings, handleInbox, handleInboxAttachment, handleInboxMessageHide, handleInboxComment, handleInboxAnalyze, handleInboxDiscard: (request: Request, id: string) => mutateState(request, id, false), handleInboxRestore: (request: Request, id: string) => mutateState(request, id, true), handleInboxPreview, handleInboxPlace, handleInboxOperation, handleInboxContent, handleInboxRelay, handleInboxTick, processRelay, cleanup, runAcknowledgements, assertInboxTranscription };
}
