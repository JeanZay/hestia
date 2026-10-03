import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { type Access, type Actor, HttpError, bodyBytes, guarded, invalid, isUuid, json, privateHeaders, response, textField, unavailable } from "../access";
import type { ObjectStore } from "../storage";
import { validateOriginal } from "../formats";

export const CHUNK_SIZE = 2 * 1024 * 1024;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export type DocumentDependencies = {
  store: ObjectStore;
  validateOriginal?: typeof validateOriginal;
  limits?: { memberBytes?: number; globalBytes?: number; fileBytes?: number };
};
type Upload = {
  id: string; actor_id: string; folder_id: string; owner_id: string; identity_sha: string;
  title: string; file_name: string; media_type: string; size: number; sha256: string; source: string;
  status: string; expires_at: Date; lease_until: Date | null; final_key: string | null;
  keep_duplicate: boolean | null; document_id: string | null;
};
type StoredDocument = {
  id: string; folder_id: string; title: string; file_name: string; media_type: string;
  size: number; sha256: string; source: string; version: number; created_at: Date;
  uploaded_by_name: string; preview_supported: boolean; object_key: string;
  trashed_at: Date | null; purged_at: Date | null;
};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const conflict = (code: string, message: string) => new HttpError(409, code, message);
const closed = () => conflict("OPERATION_CLOSED", "Cet envoi a expiré ou a été annulé. Recommencez l’ajout.");
const busy = () => conflict("OPERATION_BUSY", "Cet envoi est déjà en cours. Réessayez dans un instant.");
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
function dto(row: StoredDocument, capabilities: string[]) {
  return { id: row.id, folderId: row.folder_id, title: row.title, fileName: row.file_name,
    mediaType: row.media_type, size: row.size, sha256: row.sha256, source: row.source,
    version: row.version, createdAt: row.created_at.toISOString(), uploadedByName: row.uploaded_by_name,
    previewSupported: row.preview_supported, capabilities };
}

export function createDocuments(pool: Pool, access: Access, dependencies?: DocumentDependencies) {
  const { withActor, transaction, origin } = access;
  const db = () => access.currentClient() ?? pool;
  const memberBytes = dependencies?.limits?.memberBytes ?? 1024 ** 3;
  const globalBytes = dependencies?.limits?.globalBytes ?? 4 * 1024 ** 3;
  const fileBytes = dependencies?.limits?.fileBytes ?? MAX_FILE_SIZE;
  for (const n of [memberBytes, globalBytes, fileBytes]) if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid document limits");
  if (fileBytes > MAX_FILE_SIZE) throw new Error("File limit exceeds bounded protocol");
  const store = () => { if (!dependencies?.store) throw new Error("Object storage is not configured"); return dependencies.store; };
  const validate = dependencies?.validateOriginal ?? validateOriginal;
  async function budget(client: PoolClient) { await client.query("SELECT id FROM hestia_storage_budget WHERE id=1 FOR UPDATE"); }
  // Grant rows are locked through the effect. Revocation/expiry is re-evaluated
  // after every remote I/O, never inferred from the initial browser request.
  async function permissions(client: PoolClient, actor: Actor, folderId: string, required: string[]) {
    const folder = (await client.query("SELECT created_by FROM hestia_folder WHERE id=$1 FOR UPDATE", [folderId])).rows[0];
    if (!folder) throw unavailable();
    const grants = await client.query(`SELECT capability FROM hestia_grant WHERE folder_id=$1 AND user_id=$2
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE`, [folderId,actor.id]);
    const capabilities: string[] = [...new Set(grants.rows.map(row => String(row.capability)))];
    if (required.some(right => !capabilities.includes(right))) throw unavailable();
    return { capabilities, ownerId: String(folder.created_by) };
  }
  async function quota(client: PoolClient, owner: string, additional: number) {
    const result = await client.query(`SELECT COALESCE(sum(size),0)::text AS total,
      COALESCE(sum(size) FILTER(WHERE owner_id=$1),0)::text AS member FROM (
        SELECT d.owner_id,d.size FROM hestia_document d JOIN hestia_upload_object o ON o.object_key=d.object_key WHERE o.deleted_at IS NULL
        UNION ALL SELECT owner_id,size FROM hestia_upload WHERE status<>'completed' AND NOT reservation_released
      ) all_bytes`, [owner]);
    if (Number(result.rows[0].member)+additional > memberBytes || Number(result.rows[0].total)+additional > globalBytes)
      throw new HttpError(413, "QUOTA_EXCEEDED", "L’espace disponible est insuffisant pour ce fichier.");
  }
  async function upload(client: PoolClient, actor: Actor, id: string, requireDeposit = true) {
    const row = (await client.query<Upload>("SELECT * FROM hestia_upload WHERE id=$1 AND actor_id=$2 FOR UPDATE", [id,actor.id])).rows[0];
    if (!row) throw unavailable();
    const rights = await permissions(client, actor, row.folder_id, requireDeposit ? ["déposer"] : []);
    return { row, ...rights };
  }
  async function currentDocument(client: PoolClient, actor: Actor, id: string, required = ["consulter"]) {
    const found = (await client.query<StoredDocument>("SELECT * FROM hestia_document WHERE id=$1", [id])).rows[0];
    if (!found || found.trashed_at || found.purged_at) throw unavailable();
    const { capabilities } = await permissions(client, actor, found.folder_id, required);
    // A future trash writer follows the same folder lock. Re-read after waiting.
    const row = (await client.query<StoredDocument>("SELECT * FROM hestia_document WHERE id=$1 AND trashed_at IS NULL AND purged_at IS NULL FOR SHARE", [id])).rows[0];
    if (!row) throw unavailable();
    return { row, capabilities };
  }
  async function receipt(client: PoolClient, row: Upload, capabilities: string[]) {
    if (!row.document_id) throw closed();
    const document = (await client.query<StoredDocument>("SELECT * FROM hestia_document WHERE id=$1 AND trashed_at IS NULL AND purged_at IS NULL", [row.document_id])).rows[0];
    // A persisted receipt is not permission to resurrect a removed document.
    if (!document) throw closed();
    return { success: true, document: capabilities.includes("consulter") ? dto(document, capabilities) : null };
  }
  // Session advisory lock survives the short SQL transactions around I/O. The
  // cleaner uses the same lock, so neither lease expiry nor a slow put can cause
  // it to delete a key while its writer can still publish it. Process exit releases it.
  async function operationLock<T>(id: string, action: () => Promise<T>, skipBusy = false): Promise<T | undefined> {
    const client = await pool.connect(); let locked = false;
    try {
      locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,4818)) AS locked", [id])).rows[0].locked;
      if (!locked) { if (skipBusy) return undefined; throw busy(); }
      return await access.usingClient(client, action);
    } finally {
      try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,4818))", [id]); }
      finally { client.release(); }
    }
  }
  const active = (row: Upload) => {
    if (row.status === "cancelled" || row.expires_at.getTime() <= Date.now()) throw closed();
    if (row.status === "completed") throw closed();
  };
  function handleUploads(request: Request) {
    return guarded(async () => {
      origin(request);
      const input = await json(request, ["folderId","idempotencyKey","fileName","title","size","mediaType","sha256","source"]);
      if (!isUuid(input.folderId) || !isUuid(input.idempotencyKey) || !Number.isSafeInteger(input.size) || Number(input.size)<1) throw invalid();
      if (Number(input.size)>fileBytes) throw new HttpError(413, "FILE_TOO_LARGE", "Ce fichier dépasse la limite de 20 Mio.");
      const fileName = textField(input.fileName,255), title = textField(input.title,200);
      if (/[\\/]/.test(fileName) || typeof input.mediaType !== "string" || !["application/pdf","image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(input.mediaType)
        || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256) || !["import","camera"].includes(String(input.source))) throw invalid();
      const identity = hash(JSON.stringify([input.folderId,fileName,title,input.size,input.mediaType,input.sha256,input.source]));
      // Authenticate before opportunistic maintenance; no public cleanup route.
      await withActor(request, async () => undefined);
      await cleanupUploads(1, 1);
      const result = await withActor(request, async (client,actor) => {
        await budget(client);
        const { ownerId } = await permissions(client,actor,input.folderId as string,["déposer"]);
        const existing = (await client.query<Upload>("SELECT * FROM hestia_upload WHERE actor_id=$1 AND folder_id=$2 AND idempotency_key=$3 FOR UPDATE", [actor.id,input.folderId,input.idempotencyKey])).rows[0];
        if (existing) {
          if (existing.identity_sha !== identity) throw conflict("IDEMPOTENCY_CONFLICT", "Cet identifiant correspond à un autre envoi.");
          if (existing.status === "cancelled" || (existing.status !== "completed" && existing.expires_at.getTime()<=Date.now())) throw closed();
          return { id: existing.id, chunkSize: CHUNK_SIZE, status: existing.status };
        }
        // Expired reservations remain charged until the internal cleaner claims
        // and removes their objects; expiry never silently frees physical space.
        const occupied = await client.query("SELECT id FROM hestia_upload WHERE actor_id=$1 AND status IN ('uploading','finalizing')", [actor.id]);
        if (occupied.rowCount) throw busy();
        await quota(client,ownerId,Number(input.size));
        const id = randomUUID();
        await client.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id,actor.id,input.folderId,ownerId,input.idempotencyKey,identity,title,fileName,input.mediaType,input.size,input.sha256,input.source]);
        return { id, chunkSize: CHUNK_SIZE, status: "uploading" };
      });
      return response({ operation: result },201);
    });
  }
  function handleUploadChunk(request: Request, id: string, indexValue: string) {
    return guarded(async () => {
      origin(request); if (!isUuid(id) || !/^[0-9]$/.test(indexValue)) throw invalid();
      const index = Number(indexValue);
      await withActor(request,async () => undefined);
      return (await operationLock(id, async () => {
        const first = await withActor(request,async (client,actor) => {
          const { row } = await upload(client,actor,id); active(row);
          if (row.status !== "uploading") throw busy();
          if (index>=Math.ceil(row.size/CHUNK_SIZE)) throw invalid(); return row;
        });
        const bytes = await bodyBytes(request,Math.min(CHUNK_SIZE,first.size-index*CHUNK_SIZE));
        const expected = Math.min(CHUNK_SIZE,first.size-index*CHUNK_SIZE);
        if (bytes.length !== expected) throw invalid();
        const digest = hash(bytes);
        const object = await withActor(request,async (client,actor) => {
          const { row } = await upload(client,actor,id); active(row); if (row.status !== "uploading") throw busy();
          const previous = (await client.query("SELECT * FROM hestia_upload_object WHERE upload_id=$1 AND chunk_index=$2 AND deleted_at IS NULL", [id,index])).rows[0];
          if (previous) {
            if (previous.sha256!==digest || previous.size!==bytes.length) throw conflict("CHUNK_CONFLICT", "Cette portion correspond à un autre contenu.");
            return { key: String(previous.object_key), ready: Boolean(previous.ready) };
          }
          const count = (await client.query("SELECT count(*)::int AS n FROM hestia_upload_object WHERE upload_id=$1 AND kind='chunk' AND ready AND deleted_at IS NULL", [id])).rows[0].n;
          if (count!==index) throw conflict("CHUNK_ORDER", "Les portions doivent être envoyées dans l’ordre.");
          const key = `uploads/${id}/${randomUUID()}`;
          await client.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,chunk_index,size,sha256) VALUES($1,$2,'chunk',$3,$4,$5)", [key,id,index,bytes.length,digest]);
          return { key, ready: false };
        });
        if (!object.ready) await store().put(object.key,bytes,"application/octet-stream");
        await withActor(request,async (client,actor) => {
          const { row } = await upload(client,actor,id); active(row); if (row.status!=="uploading") throw busy();
          await client.query("UPDATE hestia_upload_object SET ready=true WHERE object_key=$1", [object.key]);
        });
        return response({ success: true });
      }))!;
    });
  }
  function handleUploadComplete(request: Request, id: string) {
    return guarded(async () => {
      origin(request); if (!isUuid(id)) throw unavailable();
      const input = await json(request,["keepDuplicate"]); if (typeof input.keepDuplicate!=="boolean") throw invalid();
      await withActor(request,async () => undefined);
      return (await operationLock(id,async () => {
        const started = await withActor(request,async (client,actor) => {
          await budget(client);
          const { row, capabilities } = await upload(client,actor,id);
          if (row.status === "completed") {
            if (row.keep_duplicate !== input.keepDuplicate) throw conflict("IDEMPOTENCY_CONFLICT", "Le choix de cet envoi a déjà été confirmé.");
            return { row, result: await receipt(client,row,capabilities) };
          }
          active(row);
          // Owning the advisory lock proves no earlier finalizer is running,
          // including after a process crash; abandon its unreferenced key.
          await client.query("UPDATE hestia_upload SET status='finalizing',lease_until=clock_timestamp()+interval '5 minutes' WHERE id=$1", [id]);
          return { row, result: null };
        });
        if (started.result) return response(started.result);
        try {
          // Remove abandoned final attempts before allocating another original.
          await removeUnreferenced(id, true);
          const row = started.row;
          const parts = (await db().query("SELECT * FROM hestia_upload_object WHERE upload_id=$1 AND kind='chunk' AND ready AND deleted_at IS NULL ORDER BY chunk_index", [id])).rows;
          if (parts.length !== Math.ceil(row.size/CHUNK_SIZE)) throw conflict("UPLOAD_INCOMPLETE", "L’envoi du fichier n’est pas terminé.");
          const original = Buffer.alloc(row.size);
          for (let index=0; index<parts.length; index++) {
            const part = parts[index];
            if (part.chunk_index!==index || part.size!==Math.min(CHUNK_SIZE,row.size-index*CHUNK_SIZE)) throw invalid();
            const bytes = await store().getRange(part.object_key,0,part.size-1);
            if (bytes.length!==part.size || hash(bytes)!==part.sha256) throw new HttpError(422,"INTEGRITY_ERROR","Le fichier reçu est incomplet ou altéré.");
            original.set(bytes,index*CHUNK_SIZE);
            await withActor(request,async (client,actor) => { const checked = await upload(client,actor,id); active(checked.row); });
          }
          if (hash(original)!==row.sha256) throw new HttpError(422,"INTEGRITY_ERROR","Le fichier reçu est incomplet ou altéré.");
          let checked: Awaited<ReturnType<typeof validate>>;
          try { checked = await validate(original,row.media_type); }
          catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "validation_unavailable") throw error;
            throw new HttpError(422,"INVALID_FILE","Ce fichier est invalide ou son format n’est pas pris en charge.");
          }
          const key = `originals/${randomUUID()}`;
          await withActor(request,async (client,actor) => {
            const current = await upload(client,actor,id); active(current.row);
            await client.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256) VALUES($1,$2,'original',$3,$4)", [key,id,row.size,row.sha256]);
            await client.query("UPDATE hestia_upload SET final_key=$2 WHERE id=$1", [id,key]);
          });
          await store().put(key,original,checked.mediaType);
          const result = await withActor(request,async (client,actor) => {
            await budget(client);
            const current = await upload(client,actor,id); active(current.row);
            if (current.row.status!=="finalizing" || current.row.final_key!==key) throw closed();
            await quota(client,current.row.owner_id,0);
            if (!input.keepDuplicate && current.capabilities.includes("consulter")) {
              const duplicate = await client.query("SELECT id FROM hestia_document WHERE folder_id=$1 AND sha256=$2 AND trashed_at IS NULL AND purged_at IS NULL", [row.folder_id,row.sha256]);
              if (duplicate.rowCount) throw conflict("DUPLICATE", "Ce fichier existe déjà dans ce dossier. Vous pouvez l’ajouter quand même.");
            }
            const documentId = randomUUID();
            const document = (await client.query<StoredDocument>(`INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [documentId,row.folder_id,row.owner_id,actor.id,actor.name,row.title,row.file_name,checked.mediaType,row.size,row.sha256,row.source,key,checked.previewSupported])).rows[0];
            await client.query("UPDATE hestia_upload_object SET ready=true WHERE object_key=$1", [key]);
            await client.query("UPDATE hestia_upload SET status='completed',document_id=$2,keep_duplicate=$3,lease_until=NULL WHERE id=$1", [id,documentId,input.keepDuplicate]);
            return { success: true, document: current.capabilities.includes("consulter") ? dto(document,current.capabilities) : null };
          });
          return response(result);
        } catch (error) {
          await db().query("UPDATE hestia_upload SET status='uploading',lease_until=NULL WHERE id=$1 AND status='finalizing'", [id]);
          throw error;
        }
      }))!;
    });
  }
  function handleUpload(request: Request, id: string) {
    return guarded(async () => {
      origin(request); if (!isUuid(id)) throw unavailable();
      return response(await withActor(request,async (client,actor) => {
        await budget(client);
        const { row } = await upload(client,actor,id,false);
        if (row.status === "completed") return { success: true, status: "completed" };
        await client.query("UPDATE hestia_upload SET status='cancelled',lease_until=NULL WHERE id=$1", [id]);
        return { success: true, status: "cancelled" };
      }));
    });
  }
  function handleDocuments(request: Request) {
    return guarded(async () => {
      const url = new URL(request.url), folderId = url.searchParams.get("folderId"), q = url.searchParams.get("q") ?? "";
      if ((folderId && !isUuid(folderId)) || q.length>200) throw invalid();
      const documents = await withActor(request,async (client,actor) => {
        if (folderId) await permissions(client,actor,folderId,["consulter"]);
        const rows = (await client.query<StoredDocument>(`SELECT d.* FROM hestia_document d WHERE d.trashed_at IS NULL AND d.purged_at IS NULL
          AND ($1::uuid IS NULL OR d.folder_id=$1) AND EXISTS(SELECT 1 FROM hestia_grant g WHERE g.folder_id=d.folder_id AND g.user_id=$2
          AND g.capability='consulter' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())) ORDER BY d.folder_id,d.created_at,d.id`, [folderId,actor.id])).rows;
        const result = [];
        for (const row of rows) {
          if (!fold(row.title + " " + row.file_name).includes(fold(q))) continue;
          const current = await currentDocument(client,actor,row.id);
          result.push(dto(current.row,current.capabilities));
        }
        return result;
      });
      return response({ documents });
    });
  }
  function handleDocument(request: Request, id: string) {
    return guarded(async () => {
      if (!isUuid(id)) throw unavailable();
      if (request.method === "GET") return response({ document: await withActor(request,async (client,actor) => {
        const current = await currentDocument(client,actor,id); return dto(current.row,current.capabilities);
      }) });
      origin(request);
      const input = await json(request,["title","version"]), title = textField(input.title,200);
      if (!Number.isSafeInteger(input.version) || Number(input.version)<1 || Number(input.version)>2147483647) throw invalid();
      const document = await withActor(request,async (client,actor) => {
        const current = await currentDocument(client,actor,id,["consulter","modifier"]);
        const result = await client.query<StoredDocument>("UPDATE hestia_document SET title=$2,version=version+1 WHERE id=$1 AND version=$3 RETURNING *", [id,title,input.version]);
        if (!result.rowCount) throw conflict("VERSION_CONFLICT", "Ce document a changé. Actualisez-le avant de réessayer.");
        return dto(result.rows[0],current.capabilities);
      });
      return response({ document });
    });
  }
  function handleDocumentContent(request: Request, id: string) {
    return guarded(async () => {
      if (!isUuid(id)) throw unavailable();
      const url = new URL(request.url), intent = url.searchParams.get("intent"), offsetText = url.searchParams.get("offset"), lengthText = url.searchParams.get("length");
      if (!["preview","download"].includes(intent ?? "") || !/^\d+$/.test(offsetText ?? "") || !/^\d+$/.test(lengthText ?? "")) throw invalid();
      const offset = Number(offsetText), length = Number(lengthText);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length<1 || length>CHUNK_SIZE) throw invalid();
      const required = intent === "download" ? ["consulter","exporter"] : ["consulter"];
      const first = await withActor(request,async (client,actor) => (await currentDocument(client,actor,id,required)).row);
      if (offset>=first.size || offset+length>first.size) throw new HttpError(416,"INVALID_RANGE","Cette portion est hors du fichier.");
      if (intent === "preview" && !first.preview_supported) throw new HttpError(415,"PREVIEW_UNAVAILABLE","L’aperçu de ce format est indisponible.");
      const bytes = await store().getRange(first.object_key,offset,offset+length-1);
      if (bytes.length !== length) throw new Error("Incomplete object range");
      return withActor(request,async (client,actor) => {
        const current = (await currentDocument(client,actor,id,required)).row;
        if (current.object_key!==first.object_key) throw unavailable();
        const headers = privateHeaders();
        headers.set("Content-Type",current.media_type); headers.set("Content-Length",String(bytes.length));
        headers.set("Content-Range",`bytes ${offset}-${offset+length-1}/${current.size}`);
        headers.set("Content-Disposition",`${intent === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(current.file_name).replace(/['()*]/g,c => '%' + c.charCodeAt(0).toString(16))}`);
        headers.set("Content-Security-Policy","sandbox; default-src 'none'");
        return new Response(new Uint8Array(bytes),{ status: 206, headers });
      });
    });
  }
  async function removeUnreferenced(id: string, originalsOnly = false) {
    const keys = (await db().query(`SELECT object_key FROM hestia_upload_object o WHERE upload_id=$1 AND deleted_at IS NULL
      AND (NOT $2::boolean OR kind='original') AND NOT EXISTS(SELECT 1 FROM hestia_document d WHERE d.object_key=o.object_key)`, [id, originalsOnly])).rows;
    for (const row of keys) {
      await store().delete(row.object_key);
      await db().query("UPDATE hestia_upload_object SET deleted_at=clock_timestamp() WHERE object_key=$1", [row.object_key]);
    }
    return keys.length;
  }
  async function cleanupUploads(limit = 20, maxObjects = 1100) {
    if (!Number.isInteger(limit) || limit<1 || limit>100 || !Number.isInteger(maxObjects) || maxObjects<1 || maxObjects>1100) throw new Error("Invalid cleanup batch");
    const candidates = await db().query(`SELECT u.id FROM hestia_upload u WHERE
      (u.status IN ('uploading','finalizing') AND u.expires_at<=clock_timestamp()) OR
      (u.status='cancelled' AND NOT u.reservation_released) OR (u.status IN ('completed','cancelled') AND EXISTS(SELECT 1 FROM hestia_upload_object o WHERE o.upload_id=u.id AND o.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM hestia_document d WHERE d.object_key=o.object_key))) ORDER BY u.created_at LIMIT $1`, [limit]);
    let cleaned = 0;
    for (const candidate of candidates.rows) {
      if (cleaned>=maxObjects) break;
      await operationLock(candidate.id,async () => {
        const keys = await transaction(async client => {
          await budget(client);
          const row = (await client.query<Upload>("SELECT * FROM hestia_upload WHERE id=$1 FOR UPDATE", [candidate.id])).rows[0];
          if (!row) return [];
          if (["uploading","finalizing"].includes(row.status)) {
            if (row.expires_at.getTime()>Date.now()) return [];
            await client.query("UPDATE hestia_upload SET status='cancelled',lease_until=NULL WHERE id=$1", [row.id]);
          }
          return (await client.query(`SELECT object_key FROM hestia_upload_object o WHERE upload_id=$1 AND deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM hestia_document d WHERE d.object_key=o.object_key)`, [row.id])).rows.map(entry => String(entry.object_key));
        });
        for (const key of keys) {
          if (cleaned>=maxObjects) break;
          // No writer remains under the operation lock; only unreferenced keys
          // were claimed. Deletion failures keep the durable ledger for retry.
          await store().delete(key);
          await db().query("UPDATE hestia_upload_object SET deleted_at=clock_timestamp() WHERE object_key=$1", [key]);
          cleaned++;
        }
        await transaction(async client => {
          await budget(client);
          await client.query("UPDATE hestia_upload SET reservation_released=true WHERE id=$1 AND status='cancelled' AND NOT EXISTS(SELECT 1 FROM hestia_upload_object WHERE upload_id=$1 AND deleted_at IS NULL)", [candidate.id]);
        });
      },true);
    }
    return { cleaned };
  }
  return { handleUploads, handleUploadChunk, handleUploadComplete, handleUpload, handleDocuments, handleDocument, handleDocumentContent, cleanupUploads };
}






