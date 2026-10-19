import type { PoolClient } from "pg";
import type { OutgoingTranscriptionField } from "../../shared/transcription-contract";
import { type Actor, isUuid, unavailable } from "../access";
import type { OutgoingTranscriptionIdentity } from "./types";

/** Metadata-only admission. Never decrypt composition or project attachments. */
export function createOutgoingTranscriptionSource() {
  return { async assertAvailable(client: PoolClient, actor: Actor, draftId: string, field: OutgoingTranscriptionField,
    baseRevision?: number): Promise<OutgoingTranscriptionIdentity> {
    if (!isUuid(draftId)) throw unavailable();
    const row = (await client.query<{ id: string; actor_epoch: string; departure_epoch: string; revision: number; consumed_revision: number | null }>(
      `SELECT d.id,d.actor_epoch,d.departure_epoch,d.revision,d.consumed_revision
       FROM hestia_outgoing_draft d JOIN hestia_member m ON m.user_id=d.actor_id JOIN "user" u ON u.id=m.user_id
       WHERE d.id=$1 AND d.actor_id=$2 AND d.actor_epoch=m.epoch AND d.departure_epoch=m.departure_epoch
         AND m.active AND NOT m.recovering AND u."emailVerified" AND d.lock_operation_id IS NULL
       FOR UPDATE OF d,m`, [draftId, actor.id])).rows[0];
    if (!row || baseRevision !== undefined && row.revision < baseRevision) throw unavailable();
    return { outgoingDraftId: row.id, actorId: actor.id, actorEpoch: Number(row.actor_epoch), departureEpoch: Number(row.departure_epoch),
      field, baseRevision: baseRevision ?? row.revision, revision: row.revision, consumedRevision: row.consumed_revision };
  } };
}
