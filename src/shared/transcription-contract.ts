/** Public dictation contract. Credentials, audio and vocabulary never appear in reads. */
export const TRANSCRIPTION_MAX_DURATION_MS = 120_000;
export const TRANSCRIPTION_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export type OutgoingTranscriptionField = "subject" | "message";
export type OutgoingTranscriptionResult = {
  draftId: string; field: OutgoingTranscriptionField; baseRevision: number; revision: number;
};
export type TranscriptionSettingsDto = {
  version: number; provider: string; model: string; enabled: boolean;
  monthlyLimitMicros: number; currency: "EUR"; keyPresent: boolean; keySetAt: string | null;
  period: { start: string; end: string; timeZone: "UTC" }; spentMicros: number; reservedMicros: number;
  availableProviders: { id: string; label: string; models: { id: string; label: string; vocabularySupported: boolean }[] }[];
};
export type TranscriptionSettingsInput = {
  version: number; provider: string; model: string; enabled: boolean; monthlyLimitMicros: number; apiKey?: string;
};
export type TranscriptionAvailabilityDto = {
  enabled: boolean; available: boolean; reason?: "disabled" | "model-unavailable" | "budget";
  maxDurationMs: number; maxAudioBytes: number; mediaTypes: "audio/wav"[]; vocabularySupported: boolean;
};
export type TranscriptionResultDto = {
  transcriptionId: string; status: "pending" | "complete" | "failed" | "stale"; text?: string;
  outgoing?: OutgoingTranscriptionResult;
};
