import { AGENDA_LIMITS } from './agenda-contract';

export type AgendaDictationField = 'title' | 'description';
export const agendaFieldName = { title: 'le titre', description: 'la description' } as const;
/** Normalize only the proposed speech. The already typed text is never rewritten. */
export function normalizeAgendaDictation(field: AgendaDictationField, text: string) {
  const value = text.replace(/\r\n?/g, '\n');
  return (field === 'title' ? value.replace(/\n+/g, ' ') : value).trim();
}
export function appendAgendaDictation(field: AgendaDictationField, current: string, dictated: string) {
  const text = normalizeAgendaDictation(field, dictated);
  if (!text) return current;
  const separator = !current || /\s$/u.test(current) ? '' : field === 'description' && text.includes('\n') ? '\n' : ' ';
  return current + separator + text;
}
/** Same normalization, code-point count and controls as Agenda's save contract. */
export function agendaTextLength(text: string) { return [...text.replace(/\r\n?/g, '\n').trim()].length; }
export function agendaTextProblem(field: AgendaDictationField, text: string) {
  const value = text.replace(/\r\n?/g, '\n').trim(), over = agendaTextLength(text) - AGENDA_LIMITS[field];
  if (over > 0) return `Trop long de ${over.toLocaleString('fr-FR')} caractère${over > 1 ? 's' : ''}. Corrigez le texte avant de l’ajouter.`;
  if ((field === 'title' ? /[\u0000-\u001f\u007f]/ : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).test(value)) return 'Caractère non accepté. Corrigez le texte avant de l’ajouter.';
}
