/** Private projections; no storage key, provider payload or durable composition receipt. */
export const OUTGOING_LIMITS = Object.freeze({ recipients: 20, attachments: 20, subject: 200, message: 20000,
  addressBytes: 254, rawBytes: 20971520, rangeBytes: 2097152, requestBytes: 131072, encodedBytes: 33554432 });
export type OutgoingSender = { name: string; email: string | null };
export type OutgoingServiceDto = { configured: boolean; reason: 'not-configured' | null; sender: OutgoingSender;
  replyTo: string; limits: typeof OUTGOING_LIMITS };
export type OutgoingSelection = { documentId: string; documentVersion: number; revisionId: string };
export type OutgoingAvailableDocument = OutgoingSelection & { title: string; fileName: string; size: number; path: string; mediaType: string };
export type OutgoingAttachmentDto = { id: string; state: 'unavailable' } | (OutgoingAvailableDocument & {
  id: string; state: 'ok' | 'renamed' | 'replaced';
  current?: { documentVersion: number; revisionId: string; title: string; fileName: string; size: number };
});
export type OutgoingOperationState = 'preparing' | 'sending' | 'accepted' | 'failed' | 'uncertain';
export type OutgoingFailureCode = 'not-configured' | 'quota' | 'busy' | 'rights-or-version' | 'size' | 'integrity' | 'unavailable' | 'address' | null;
export type OutgoingOperationDto = { id: string; state: OutgoingOperationState; code: OutgoingFailureCode };
export type OutgoingDraftDto = { id: string; revision: number; state: 'editable' | 'sending' | 'uncertain';
  to: string[]; subject: string; message: string; attachments: OutgoingAttachmentDto[]; operation?: OutgoingOperationDto };
export type OutgoingStateDto = { draft: OutgoingDraftDto | null; service: OutgoingServiceDto };
export type OutgoingSaveInput = { revision: number; to: string[]; subject: string; message: string; attachmentIds: string[] };
export type OutgoingRecapDto = { token: string; expiresAt: string; sender: OutgoingSender; replyTo: string;
  to: string[]; subject: string; message: string; attachments: OutgoingAvailableDocument[]; totalBytes: number };
export type OutgoingCheckDto = { draft: OutgoingDraftDto; recap: OutgoingRecapDto };
export type OutgoingSendInput = { revision: number; requestId: string; confirmationToken: string };
export type OutgoingSendDto = { operation: OutgoingOperationDto; draft: OutgoingDraftDto | null };
