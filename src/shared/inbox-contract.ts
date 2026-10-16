import type { CaptureDestination, CaptureAccessProjection } from './capture-contract';

export type DocumentSummaryDto = { status: 'pending' | 'running' | 'ready' | 'unavailable' | 'unknown'; text?: string };
export type InboxSettingsDto = { version: number; enabled: boolean; automaticAnalysis: boolean; address: string | null; configured: boolean };
export type InboxSuggestionDto = { destination: CaptureDestination; reason: string; label: string };
export type InboxAnalysisDto = { status: 'pending' | 'running' | 'ready' | 'unavailable' | 'unknown' | 'stale'; summary?: string; suggestions: InboxSuggestionDto[] };
export type InboxAttachmentDto = {
  id: string; messageId: string; version: number; fileName: string; mediaType: string; size: number; sha256: string;
  state: 'pending' | 'discarded' | 'placed' | 'purged'; receivedAt: string; discardedUntil: string | null;
  previewSupported: boolean; comment: string; commentVersion: number; summary: DocumentSummaryDto; analysis: InboxAnalysisDto;
};
export type InboxMessageDto = {
  id: string; receivedAt: string; sender: string; subject: string; context: string; contextPartial: boolean;
  outcome: 'accepted' | 'partial' | 'no_attachments' | 'all_rejected' | 'message_rejected';
  excludedInline: number | null; rejected: { fileName?: string; reason: string }[];
  acknowledgement: 'pending' | 'sent' | 'failed' | 'unknown';
};
export type InboxQueueDto = { pendingCount: number; messages: InboxMessageDto[]; attachments: InboxAttachmentDto[]; receptionAvailable: boolean };
export type InboxDuplicateDto = { kind: 'identical' | 'same_name'; documentId: string; documentVersion: number; title: string; path: string; canReplace: boolean };
export type InboxPlacementInput = { version: number; destination: CaptureDestination; mode: 'add' | 'replace'; title?: string; documentId?: string; documentVersion?: number };
export type InboxPreviewDto = {
  previewToken: string; exactPath: string; accessLabel: string; createsFolders: boolean; duplicates: InboxDuplicateDto[];
  destination: CaptureDestination; mode: 'add' | 'replace'; documentId?: string; documentVersion?: number; access?:CaptureAccessProjection;
};
export type InboxPlacementReceiptDto = { status: 'recorded'; documentId: string; attachmentId: string } | { status: 'not-recorded' | 'in-progress' };
export type DocumentRevisionDto = {
  id: string; current: boolean; createdAt: string; recoverableUntil: string | null;
  fileName?: string; mediaType?: string; size?: number; sha256?: string; summary: DocumentSummaryDto;
  canDownload: boolean; canRestore: boolean; expired?:boolean;
};
