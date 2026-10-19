import { OUTGOING_LIMITS } from './outgoing-contract';

export type OutgoingDictationField = 'subject' | 'message';
export const outgoingFieldName = { subject: 'l’objet', message: 'le message' } as const;
export function normalizeOutgoingDictation(field: OutgoingDictationField, text: string) {
  return field === 'subject' ? text.replace(/\r\n|\r|\n/g, ' ') : text.replace(/\r\n/g, '\n');
}
/** Same code-point and control-character rules as the outgoing composition API. */
export function outgoingTextProblem(field: OutgoingDictationField, text: string): string | undefined {
  const normalized = field === 'subject' ? text.trim() : text.replace(/\r\n/g, '\n');
  const invalid = field === 'subject' ? /[\x00-\x1f\x7f]/.test(normalized) : /[\x00-\x08\x0b-\x1f\x7f]/.test(normalized);
  if (invalid) return 'Caractère non accepté : supprimez-le avant d’ajouter.';
  const over = [...normalized].length - OUTGOING_LIMITS[field];
  if (over > 0) return `Trop long de ${over.toLocaleString('fr-FR')} caractères : rien n’est coupé.`;
}
export function appendOutgoingDictation(field: OutgoingDictationField, before: string, dictated: string) {
  const text = normalizeOutgoingDictation(field, dictated);
  if (!before || !text) return before + text;
  const separator = field === 'message' && text.includes('\n') ? (before.endsWith('\n') || text.startsWith('\n') ? '' : '\n') : /\s$/.test(before) || /^\s/.test(text) ? '' : ' ';
  return before + separator + text;
}
