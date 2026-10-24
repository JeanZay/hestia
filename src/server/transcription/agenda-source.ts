import type { PoolClient } from "pg";
import type { AgendaTranscriptionField } from "../../shared/transcription-contract";
import { type Actor, isUuid, unavailable } from "../access";
import type { AgendaTranscriptionIdentity } from "./types";

/** Admission reads metadata only. An unsaved form never needs a persisted card. */
export function createAgendaTranscriptionSource() {
  return { async assertAvailable(client: PoolClient, actor: Actor, formSessionId: string, field: AgendaTranscriptionField,
    cardId: string | null, baseRevision: number | null): Promise<AgendaTranscriptionIdentity> {
    if (!isUuid(formSessionId) || !["title", "description"].includes(field)
      || (cardId === null ? baseRevision !== null : !isUuid(cardId) || !Number.isInteger(baseRevision) || baseRevision! < 1)) throw unavailable();
    const member = (await client.query<{ epoch: number; departure_epoch: number }>(
      `SELECT m.epoch,m.departure_epoch FROM hestia_member m JOIN "user" u ON u.id=m.user_id
       WHERE m.user_id=$1 AND m.active AND NOT m.recovering AND u."emailVerified" FOR UPDATE OF m`, [actor.id])).rows[0];
    if (!member) throw unavailable();
    let revision: number | null = null;
    if (cardId !== null) {
      const card = (await client.query<{ revision: number }>(
        `SELECT c.revision FROM hestia_agenda_card c JOIN hestia_agenda_access a ON a.card_id=c.id
         WHERE c.id=$1 AND c.creator_id=$2 AND c.creator_departure_epoch=$3 AND c.creator_departed_at IS NULL
           AND c.archived_at IS NULL AND c.revision=$4 AND a.user_id=$2 AND a.active AND a.subject_departure_epoch=$3
         FOR UPDATE OF c,a`, [cardId, actor.id, member.departure_epoch, baseRevision])).rows[0];
      if (!card) throw unavailable();
      revision = card.revision;
    }
    return { agendaFormSessionId: formSessionId, actorId: actor.id, actorEpoch: Number(member.epoch),
      departureEpoch: Number(member.departure_epoch), field, cardId, baseRevision, revision };
  } };
}
