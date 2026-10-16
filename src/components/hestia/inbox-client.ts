export class InboxError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
/** Reads may be repeated; mutations are never automatically replayed. */
export async function inboxRequest<T>(path: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/hestia${path}`, { method, signal, credentials: 'same-origin', cache: 'no-store', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Hestia-Activity': 'interactive' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({})); signal.throwIfAborted();
  if (!response.ok) throw new InboxError(response.status, data?.error?.code || 'UNAVAILABLE', data?.error?.message || 'Impossible de joindre Hestia. Réessayez.');
  return data as T;
}
export const inboxError = (error: unknown) => error instanceof Error ? error.message : 'Connexion interrompue. Réessayez.';
export const unknownInboxResult = (error: unknown) => !(error instanceof InboxError) || error.status >= 500;
export const recoverable = (until: string | null, now = Date.now()) => !!until && Number.isFinite(Date.parse(until)) && Date.parse(until) > now;

/** The document and revision APIs expose bounded ranges, never a whole-file endpoint. */
export async function readRevisionBytes(documentId: string, revision: { id: string; size: number; sha256: string }, signal: AbortSignal): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(revision.size);
  for (let offset = 0; offset < revision.size; offset += 2 * 1024 * 1024) {
    const length = Math.min(2 * 1024 * 1024, revision.size - offset);
    const response = await fetch(`/api/hestia/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(revision.id)}/content?offset=${offset}&length=${length}`, { credentials: 'same-origin', cache: 'no-store', signal });
    if (response.status !== 206) throw new InboxError(response.status, 'CONTENT_UNAVAILABLE', 'Téléchargement indisponible. Les accès ou le délai ont pu changer.');
    const part = new Uint8Array(await response.arrayBuffer()); signal.throwIfAborted();
    if (part.length !== length || response.headers.get('Content-Range') !== `bytes ${offset}-${offset + length - 1}/${revision.size}`) throw new Error('Téléchargement incomplet. Aucun fichier n’a été enregistré.');
    bytes.set(part, offset);
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  if (digest !== revision.sha256) throw new Error('L’intégrité du fichier n’a pas pu être confirmée. Aucun fichier n’a été enregistré.');
  return bytes.buffer;
}
