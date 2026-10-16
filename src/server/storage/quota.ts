import type { PoolClient } from "pg";
import { HttpError } from "../access";

export type ByteCharge = Readonly<{ ownerId: string; bytes: number }>;
export interface StorageBudget {
  lock(client: PoolClient): Promise<void>;
  usage(client: PoolClient, ownerId: string): Promise<{ totalBytes: number; memberBytes: number }>;
  assertAdditional(client: PoolClient, charges: readonly ByteCharge[]): Promise<void>;
  transfer(client: PoolClient, fromOwnerId: string, toOwnerId: string, bytes: number): Promise<void>;
}

/** One serialized accounting boundary for uploads, documents and Capture objects. */
export function createStorageBudget(memberBytes = 1024 ** 3, globalBytes = 4 * 1024 ** 3): StorageBudget {
  for (const value of [memberBytes, globalBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid storage budget");
  const lock = async (client: PoolClient) => { await client.query("SELECT id FROM hestia_storage_budget WHERE id=1 FOR UPDATE"); };
  async function usage(client: PoolClient, ownerId: string) {
    const result = await client.query<{ total: string; member: string }>(`SELECT COALESCE(sum(size),0)::text AS total,
      COALESCE(sum(size) FILTER(WHERE owner_id=$1),0)::text AS member FROM (
        SELECT owner_id,size FROM hestia_content WHERE deleted_at IS NULL
        UNION ALL SELECT d.owner_id,d.size FROM hestia_document d JOIN hestia_upload_object o ON o.object_key=d.object_key
          WHERE o.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM hestia_content c WHERE c.object_key=d.object_key)
        UNION ALL SELECT owner_id,size FROM hestia_upload WHERE status<>'completed' AND NOT reservation_released
        UNION ALL SELECT u.owner_id,o.size FROM hestia_upload_object o JOIN hestia_upload u ON u.id=o.upload_id
          WHERE o.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM hestia_content c WHERE c.object_key=o.object_key)
          AND NOT EXISTS(SELECT 1 FROM hestia_document d WHERE d.object_key=o.object_key)
          AND (o.kind='original' OR u.status='completed' OR u.reservation_released)
        UNION ALL SELECT o.owner_id,o.charged_bytes AS size FROM hestia_capture_object o WHERE o.deleted_at IS NULL AND NOT o.promoted
          AND NOT EXISTS(SELECT 1 FROM hestia_content c WHERE c.object_key=o.object_key)
        UNION ALL SELECT e.owner_id,c.size FROM hestia_inbox_chunk c JOIN hestia_inbox_event e ON e.id=c.event_id WHERE c.deleted_at IS NULL
      ) all_bytes`, [ownerId]);
    return { totalBytes: Number(result.rows[0].total), memberBytes: Number(result.rows[0].member) };
  }
  async function assertAdditional(client: PoolClient, charges: readonly ByteCharge[]) {
    await lock(client);
    const grouped = new Map<string, number>(); let additional = 0;
    for (const { ownerId, bytes } of charges) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid storage charge");
      grouped.set(ownerId, (grouped.get(ownerId) ?? 0) + bytes); additional += bytes;
    }
    for (const [ownerId, bytes] of grouped) {
      const current = await usage(client, ownerId);
      if (current.totalBytes + additional > globalBytes || current.memberBytes + bytes > memberBytes)
        throw new HttpError(413, "QUOTA_EXCEEDED", "L’espace disponible est insuffisant pour ce fichier.");
    }
  }
  async function transfer(client: PoolClient, fromOwnerId: string, toOwnerId: string, bytes: number) {
    await lock(client);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid storage transfer");
    if (fromOwnerId === toOwnerId) return;
    const current = await usage(client, toOwnerId);
    // The same physical original stays charged to the household throughout.
    if (current.memberBytes + bytes > memberBytes || current.totalBytes > globalBytes)
      throw new HttpError(413, "QUOTA_EXCEEDED", "L’espace disponible est insuffisant pour ce fichier.");
  }
  return { lock, usage, assertAdditional, transfer };
}
