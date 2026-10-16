import type { ServerConfig } from '../config';
export class AcknowledgementFailure extends Error { constructor(readonly known: boolean) { super('acknowledgement_failed'); } }
export type InboxAcknowledgementMessage = { id: string; email: string; outcome: string; accepted: number; rejected: number; reasons?: readonly string[] };
const reasonLabels: Readonly<Record<string, string>> = {
 quota_exceeded: 'L’espace de stockage disponible est insuffisant.',
 attachment_requires_base64: 'Une pièce utilise un encodage non pris en charge ; joignez-la à nouveau en base64.',
 invalid_base64: 'Le mail contient un encodage base64 invalide.',
 attachment_bytes: 'Le volume admissible des pièces jointes est dépassé.', attachment_count: 'Le nombre admissible de pièces jointes est dépassé.',
 invalid_file: 'Une pièce PDF ou image est invalide.', raw_too_large: 'La taille maximale du mail est dépassée.',
 unsupported_raw_profile: 'Le mail utilise une taille ou un encodage non pris en charge.', unsupported_raw_encoding: 'Le mail utilise un encodage non pris en charge.',
 ambiguous_mime: 'La structure du mail est ambiguë.', duplicate_header: 'Le mail contient des en-têtes ambigus.', duplicate_parameter: 'Le mail contient des paramètres ambigus.', ambiguous_parameter: 'Le mail contient des paramètres ambigus.',
 ambiguous_boundary: 'Les séparateurs du mail sont ambigus.', mime_residue: 'La structure du mail contient des données inattendues.', unclosed_multipart: 'La structure du mail est incomplète.', mime_limit: 'La complexité maximale du mail est dépassée.',
 invalid_filename: 'Le nom encodé d’une pièce est invalide.', raw_integrity: 'L’intégrité du mail n’a pas pu être établie.', message_headers: 'Les en-têtes du mail sont invalides.',
 invalid_html_encoding: 'Le corps HTML du mail utilise un encodage invalide.', unsupported_html_charset: 'Le corps HTML utilise un jeu de caractères non pris en charge.',
 html_reference_limit: 'Les références du corps HTML dépassent la limite de traitement.', html_reference_ambiguity: 'Les références du corps HTML sont ambiguës.', ambiguous_content_id: 'Un identifiant de ressource du mail est ambigu.',
 unsupported_message: 'Le mail ne respecte pas le profil de réception pris en charge.',
};
/** Only fixed public reason codes can enter an outgoing message, never provider/parser text. */
export function minimalRejectionReason(value: string) { return Object.hasOwn(reasonLabels, value) ? value : 'unsupported_message'; }
export function acknowledgementText(message: InboxAcknowledgementMessage, origin: string) {
 const introductions: Record<string, string> = { accepted: 'Votre envoi a été accepté.', partial: 'Votre envoi a été partiellement accepté.', no_attachments: 'Aucune pièce jointe admissible n’a été trouvée dans votre envoi.', all_rejected: 'Toutes les pièces jointes de votre envoi ont été refusées.', message_rejected: 'Votre mail a été refusé dans son ensemble. Aucune pièce n’a été importée ; l’inventaire des pièces jointes n’a pas pu être établi de manière fiable. Corrigez le mail avant de le renvoyer.' };
 if (!Object.hasOwn(introductions, message.outcome) || !Number.isSafeInteger(message.accepted) || !Number.isSafeInteger(message.rejected) || message.accepted < 0 || message.accepted > 20 || message.rejected < 0 || message.rejected > 200) throw new AcknowledgementFailure(true);
 const counts = message.outcome === 'message_rejected' ? '' : ` Pièces acceptées : ${message.accepted}. Pièces refusées : ${message.rejected}.`;
 const reasons: string[] = []; for (const code of (message.reasons ?? []).slice(0, 200)) { if (reasons.length >= 20) break; const label = reasonLabels[minimalRejectionReason(code)]; if (!reasons.includes(label)) reasons.push(label); }
 return `${introductions[message.outcome]}${counts}${reasons.length ? '\nMotifs connus : ' + reasons.join(' ') : ''}\nLes images du corps et les liens ne sont pas importés. Retrouvez le résultat dans votre espace privé À classer : ${origin}\nCet accusé ne confirme pas la fin de l’analyse.`;
}
/** A distinct outgoing capability, with no receiving/full-access credential. No subject or filename enters this transport. */
export function createInboxAcknowledgementTransport(config: ServerConfig, env: Record<string, string | undefined> = process.env, request: typeof fetch = fetch) {
 if (config.environment === 'local' || !env.HESTIA_MAIL_PROVIDER) return undefined;
 const from = env.HESTIA_MAIL_FROM, key = env.RESEND_API_KEY;
 if (env.HESTIA_MAIL_PROVIDER !== 'resend' || !from || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from) || !key || /\s/.test(key)) throw new Error('MAIL_CONFIGURATION_INVALID');
 return async (message: InboxAcknowledgementMessage) => {
  if (!/^[a-f0-9-]{36}$/.test(message.id) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(message.email) || !Number.isSafeInteger(message.accepted) || !Number.isSafeInteger(message.rejected)) throw new AcknowledgementFailure(true);
  const text = acknowledgementText(message, config.origin);
  let result: Response;
  try { result = await request('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'Idempotency-Key': `hestia/inbox/${message.id}` }, body: JSON.stringify({ from, to: [message.email], subject: 'Hestia — votre envoi a été pris en charge', text }) }); }
  catch { throw new AcknowledgementFailure(false); }
  if (!result.ok) { await result.body?.cancel(); throw new AcknowledgementFailure(result.status >= 400 && result.status < 500 && ![408,409,429].includes(result.status)); }
  const reader = result.body?.getReader(); if (!reader) throw new AcknowledgementFailure(false); let size = 0; const chunks = [];
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2048) { await reader.cancel(); throw new AcknowledgementFailure(false); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  let parsed: { id?: unknown }; try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AcknowledgementFailure(false); }
  if (typeof parsed.id !== 'string' || !/^[a-f0-9-]{36}$/.test(parsed.id)) throw new AcknowledgementFailure(false); return { providerId: parsed.id };
 };
}
