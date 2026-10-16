import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { type Access, type Actor, guarded, HttpError, invalid, isUuid, json, privateHeaders, readActivity, response, textField, unavailable } from '../access';
import type { ObjectStore } from '../storage';
import { createStorageBudget, type StorageBudget } from '../storage/quota';
import { getFolderAccess } from '../permissions/service';
import type { DocumentRevisionDto, DocumentSummaryDto } from '../../shared/inbox-contract';

const RANGE_LIMIT = 2 * 1024 * 1024;
const versionConflict = () => new HttpError(409, 'VERSION_CONFLICT', 'Ce document a changé. Actualisez-le avant de réessayer.');
type Content = { id: string; object_key: string; owner_id: string; size: number; sha256: string; media_type: string; file_name: string;
  preview_supported: boolean; deleted_at: Date | null; purge_pending_at: Date | null };
type Document = { id: string; folder_id: string; owner_id: string; current_revision_id: string; version: number; trashed_at: Date | null; purged_at: Date | null };
type Revision = Content & { revision_id: string; created_at: Date; recoverable_until: Date | null; summary_status?: string; summary_text?: string };

export function contentSummary(status: unknown, text: unknown): DocumentSummaryDto {
  const supported = ['pending', 'running', 'ready', 'unavailable', 'unknown'];
  if (typeof status !== 'string' || !supported.includes(status)) return { status: 'unavailable' };
  if (status === 'ready') return typeof text === 'string' && text.trim() && [...text].length <= 200
    ? { status: 'ready', text } : { status: 'unavailable' };
  return { status: status as DocumentSummaryDto['status'] };
}

/** Caller owns the admission transaction and the same idempotent inbox receipt. No network I/O. */
export async function promoteInboxContent(client: PoolClient, actor: Actor, input: {
  contentId: string; folderId: string; title: string; documentId?: string; documentVersion?: number;
}, budget: StorageBudget): Promise<{ documentId: string; revisionId: string; version: number }> {
  await budget.lock(client);
  const rights = await getFolderAccess(client, actor.id, input.folderId);
  const required = input.documentId ? ['consulter', 'modifier'] : ['déposer'];
  if (required.some(right => !rights.capabilities.includes(right))) throw unavailable();
  let target: Document | undefined;
  if (input.documentId) {
    target = (await client.query<Document>('SELECT * FROM hestia_document WHERE id=$1 FOR UPDATE', [input.documentId])).rows[0];
    if (!target || target.folder_id !== input.folderId || target.trashed_at || target.purged_at) throw unavailable();
    if (target.version !== input.documentVersion || target.version >= 2147483647) throw versionConflict();
  }
  const content = (await client.query<Content>('SELECT * FROM hestia_content WHERE id=$1 FOR UPDATE', [input.contentId])).rows[0];
  if (!content || content.owner_id !== actor.id || content.deleted_at || content.purge_pending_at) throw unavailable();
  // A private arrival is published once. Receipt replay belongs to the caller.
  if ((await client.query('SELECT id FROM hestia_document_revision WHERE content_id=$1', [content.id])).rowCount) throw versionConflict();
  const ownerId = target?.owner_id ?? rights.ownerId;
  await budget.transfer(client, content.owner_id, ownerId, content.size);
  const title = textField(input.title, 200);
  await client.query('UPDATE hestia_content SET owner_id=$2 WHERE id=$1', [content.id, ownerId]);
  const documentId = target?.id ?? randomUUID();
  // Maintain the existing object/document FK and maintenance receipts; no copy.
  const legacy = (await client.query('SELECT object_key FROM hestia_upload_object WHERE object_key=$1 AND deleted_at IS NULL AND ready', [content.object_key])).rows[0];
  if (!legacy) {
    const uploadId = randomUUID();
    await client.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,final_key,reservation_released)
      VALUES($1,$2,$3,$4,$1,$5,$6,$7,$8,$9,$5,'mail','completed',$10,true)`,
    [uploadId, actor.id, input.folderId, ownerId, content.sha256, title, content.file_name, content.media_type, content.size, content.object_key]);
    await client.query(`INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready) VALUES($1,$2,'original',$3,$4,true)`,
      [content.object_key, uploadId, content.size, content.sha256]);
  }
  let result: { current_revision_id: string; version: number };
  if (target) {
    result = (await client.query(`UPDATE hestia_document SET object_key=$2,file_name=$3,media_type=$4,size=$5,sha256=$6,
      preview_supported=$7,source='mail',version=version+1 WHERE id=$1 RETURNING current_revision_id,version`,
    [target.id, content.object_key, content.file_name, content.media_type, content.size, content.sha256, content.preview_supported])).rows[0];
  } else {
    result = (await client.query(`INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'mail',$11,$12) RETURNING current_revision_id,version`,
    [documentId, input.folderId, ownerId, actor.id, actor.name, title, content.file_name, content.media_type, content.size, content.sha256, content.object_key, content.preview_supported])).rows[0];
  }
  await client.query('UPDATE hestia_upload SET document_id=$2 WHERE final_key=$1 AND status=\'completed\'', [content.object_key, documentId]);
  const finalRights=await getFolderAccess(client,actor.id,input.folderId);
  if(required.some(right=>!finalRights.capabilities.includes(right)))throw unavailable();
  return { documentId, revisionId: result.current_revision_id, version: result.version };
}

export function createRevisionsService(pool: Pool, access: Access, dependencies: {
  store: ObjectStore; now?: () => Date; budget?: StorageBudget;
}) {
  const budget = dependencies.budget ?? createStorageBudget();
  const clock = async (client: PoolClient) => dependencies.now?.() ?? (await client.query<{now: Date}>('SELECT clock_timestamp() AS now')).rows[0].now;
  async function document(client: PoolClient, actor: Actor, id: string, required: string[], write = false) {
    const first = (await client.query<Document>('SELECT * FROM hestia_document WHERE id=$1', [id])).rows[0];
    if (!first || first.trashed_at || first.purged_at) throw unavailable();
    const rights = await getFolderAccess(client, actor.id, first.folder_id);
    if (required.some(right => !rights.capabilities.includes(right))) throw unavailable();
    const row = (await client.query<Document>(`SELECT * FROM hestia_document WHERE id=$1 AND trashed_at IS NULL AND purged_at IS NULL FOR ${write ? 'UPDATE' : 'SHARE'}`, [id])).rows[0];
    if (!row) throw unavailable();
    return { row, rights };
  }
  async function revision(client: PoolClient, doc: Document, revisionId: string) {
    const row = (await client.query<Revision>(`SELECT c.*,r.id AS revision_id,r.created_at,r.recoverable_until
      FROM hestia_document_revision r JOIN hestia_content c ON c.id=r.content_id
      WHERE r.document_id=$1 AND r.id=$2 AND c.deleted_at IS NULL AND c.purge_pending_at IS NULL FOR SHARE OF r,c`, [doc.id, revisionId])).rows[0];
    const now = await clock(client);
    if (!row || (doc.current_revision_id !== revisionId && (!row.recoverable_until || row.recoverable_until.getTime() <= now.getTime()))) throw unavailable();
    return row;
  }
  function handleDocumentVersions(request: Request, id: string) {
    return guarded(async () => {
      if (!isUuid(id)) throw unavailable();
      return response(await access.withActor(request, async (client, actor) => {
        const { row: doc, rights } = await document(client, actor, id, ['consulter']);
        const now = await clock(client);
        const rows = (await client.query<Revision>(`WITH selected AS (
          (SELECT r.id FROM hestia_document_revision r WHERE r.document_id=$1 AND (r.id=$2 OR r.recoverable_until>$3)
            ORDER BY (r.id=$2) DESC,r.created_at DESC,r.id LIMIT 1001)
          UNION ALL
          (SELECT r.id FROM hestia_document_revision r WHERE r.document_id=$1 AND r.id<>$2 AND (r.recoverable_until IS NULL OR r.recoverable_until<=$3)
            ORDER BY r.created_at DESC,r.id LIMIT 100)
          ) SELECT c.*,r.id AS revision_id,r.created_at,r.recoverable_until,s.status AS summary_status,s.text AS summary_text
          FROM hestia_document_revision r JOIN hestia_content c ON c.id=r.content_id LEFT JOIN hestia_content_summary s ON s.content_id=c.id
          JOIN selected ON selected.id=r.id ORDER BY r.created_at DESC,r.id`, [id,doc.current_revision_id,now])).rows;
        if (rows.filter(r=>r.revision_id===doc.current_revision_id||r.recoverable_until&&r.recoverable_until.getTime()>now.getTime()).length > 1000)
          throw new HttpError(503, 'RESOURCE_LIMIT', 'Trop de versions sont encore récupérables. Réessayez après leur expiration.');
        const revisions: DocumentRevisionDto[] = rows.map(r => {
          const current=r.revision_id===doc.current_revision_id;
          const expired=!current&&(!r.recoverable_until||r.recoverable_until.getTime()<=now.getTime());
          const available=!expired&&!r.deleted_at&&!r.purge_pending_at;
          return {id:r.revision_id,current,expired,createdAt:r.created_at.toISOString(),recoverableUntil:r.recoverable_until?.toISOString()??null,
            ...(available?{fileName:r.file_name,mediaType:r.media_type,size:r.size,sha256:r.sha256}:{}),
            summary:available?contentSummary(r.summary_status,r.summary_text):{status:'unavailable'},
            canDownload:available&&rights.capabilities.includes('exporter'),canRestore:available&&!current&&rights.capabilities.includes('modifier')};
        });
        return { versions: revisions, version: doc.version, now: now.toISOString() };
      }, readActivity(request)));
    });
  }
  function handleDocumentRevisionContent(request: Request, id: string, revisionId: string) {
    return guarded(async () => {
      if (!isUuid(id) || !isUuid(revisionId)) throw unavailable();
      const url = new URL(request.url), rawOffset = url.searchParams.get('offset'), rawLength = url.searchParams.get('length');
      if (!/^\d+$/.test(rawOffset ?? '') || !/^\d+$/.test(rawLength ?? '')) throw invalid();
      const offset = Number(rawOffset), length = Number(rawLength);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 1 || length > RANGE_LIMIT) throw invalid();
      const read = (client: PoolClient, actor: Actor) => document(client, actor, id, ['consulter', 'exporter']).then(({ row }) => revision(client, row, revisionId));
      const first = await access.withActor(request, read, readActivity(request));
      if (offset < 0 || offset + length > first.size) throw new HttpError(416, 'INVALID_RANGE', 'Cette portion est hors du fichier.');
      const bytes = await dependencies.store.getRange(first.object_key, offset, offset + length - 1);
      if (bytes.length !== length) throw new Error('Incomplete object range');
      return access.withActor(request, async (client, actor) => {
        const current = await read(client, actor);
        if (current.id !== first.id || current.object_key !== first.object_key) throw unavailable();
        const headers = privateHeaders();
        headers.set('Content-Type', 'application/octet-stream');
        headers.set('Content-Length', String(bytes.length));
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${current.size}`);
        headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(current.file_name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
        headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
        return new Response(new Uint8Array(bytes), { status: 206, headers });
      }, readActivity(request));
    });
  }
  function handleDocumentRevisionRestore(request: Request, id: string, revisionId: string) {
    return guarded(async () => {
      access.origin(request);
      if (!isUuid(id) || !isUuid(revisionId)) throw unavailable();
      const input = await json(request, ['version', 'idempotencyKey']);
      if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || Number(input.version) >= 2147483647 || !isUuid(input.idempotencyKey)) throw invalid();
      return response(await access.withActor(request, async (client, actor) => {
        await budget.lock(client);
        const { row: doc } = await document(client, actor, id, ['consulter', 'modifier'], true);
        const admission=(await client.query('SELECT epoch,departure_epoch FROM hestia_member WHERE user_id=$1',[actor.id])).rows[0];
        const previous = (await client.query('SELECT * FROM hestia_revision_operation WHERE actor_id=$1 AND idempotency_key=$2', [actor.id, input.idempotencyKey])).rows[0];
        if (previous) {
          if (previous.document_id !== id || previous.revision_id !== revisionId || previous.expected_version !== input.version)
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Cette opération correspond à une autre demande.');
          if(Number(previous.actor_epoch)!==Number(admission.epoch)||Number(previous.departure_epoch)!==Number(admission.departure_epoch))throw versionConflict();
          return { success: true, documentId: id, revisionId, version: previous.result_version };
        }
        if (doc.version !== input.version || doc.current_revision_id === revisionId) throw versionConflict();
        const selected = await revision(client, doc, revisionId);
        // Evaluate expiry after all resource locks, immediately before the effect.
        const now = await clock(client);
        if (!selected.recoverable_until || selected.recoverable_until.getTime() <= now.getTime()) throw unavailable();
        await client.query("SELECT set_config('hestia.revision_now',$1,true)", [now.toISOString()]);
        const updated = (await client.query(`UPDATE hestia_document SET object_key=$2,file_name=$3,media_type=$4,size=$5,sha256=$6,
          preview_supported=$7,version=version+1,last_revision_action_key=$8 WHERE id=$1 RETURNING version`,
        [id, selected.object_key, selected.file_name, selected.media_type, selected.size, selected.sha256, selected.preview_supported, input.idempotencyKey])).rows[0];
        await client.query(`INSERT INTO hestia_revision_operation(actor_id,idempotency_key,document_id,revision_id,expected_version,result_version,actor_epoch,departure_epoch)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.id, input.idempotencyKey, id, revisionId, input.version, updated.version,admission.epoch,admission.departure_epoch]);
        const finalRights = await getFolderAccess(client,actor.id,doc.folder_id);
        if (['consulter','modifier'].some(right=>!finalRights.capabilities.includes(right))
          || selected.recoverable_until.getTime() <= (await clock(client)).getTime()) throw unavailable();
        return { success: true, documentId: id, revisionId, version: updated.version };
      }));
    });
  }
  async function cleanupVersions(limit = 20, maxObjects = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 1100) throw new Error('Invalid revision cleanup batch');
    const candidates = await access.transaction(async client => {
      const now = await clock(client);
      return (await client.query<{id: string}>(`SELECT DISTINCT r.content_id AS id FROM hestia_document_revision r
        JOIN hestia_document d ON d.id=r.document_id JOIN hestia_content c ON c.id=r.content_id
        WHERE c.deleted_at IS NULL AND (d.purged_at IS NOT NULL OR (d.current_revision_id<>r.id AND r.recoverable_until<=$1))
        ORDER BY r.content_id LIMIT $2`, [now, Math.min(limit, maxObjects)])).rows;
    });
    let cleaned = 0, failed = 0;
    for (const candidate of candidates) {
      try {
        const key = await access.transaction(async client => {
          await budget.lock(client);
          const now = await clock(client);
          const content = (await client.query<Content>('SELECT * FROM hestia_content WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [candidate.id])).rows[0];
          if (!content) return null;
          const active = await client.query(`SELECT r.id FROM hestia_document_revision r JOIN hestia_document d ON d.id=r.document_id
            WHERE r.content_id=$1 AND d.purged_at IS NULL AND (d.current_revision_id=r.id OR r.recoverable_until>$2)`, [candidate.id, now]);
          if (active.rowCount) return null;
          await client.query('UPDATE hestia_content SET purge_pending_at=COALESCE(purge_pending_at,$2) WHERE id=$1', [candidate.id, now]);
          return content.object_key;
        });
        if (!key) continue;
        // Claim persists across process loss; restore/promotion refuse pending originals.
        await dependencies.store.delete(key);
        await access.transaction(async client => {
          await budget.lock(client);
          await client.query('UPDATE hestia_content SET deleted_at=clock_timestamp(),file_name=NULL WHERE id=$1 AND deleted_at IS NULL', [candidate.id]);
          await client.query('UPDATE hestia_upload_object SET deleted_at=clock_timestamp() WHERE object_key=$1', [key]);
          await client.query(`UPDATE hestia_upload SET title=NULL,file_name=NULL,final_key=NULL,size=NULL,sha256=NULL,media_type=NULL,source=NULL
            WHERE final_key=$1 AND status='completed'`,[key]);
          await client.query('DELETE FROM hestia_content_summary WHERE content_id=$1',[candidate.id]);
        });
        cleaned++;
      } catch { failed++; }
    }
    return { cleaned, failed };
  }
  return { handleDocumentVersions, handleDocumentRevisionContent, handleDocumentRevisionRestore, cleanupVersions };
}
