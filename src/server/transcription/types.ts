import type { PoolClient } from "pg";
import type { Actor } from "../access";
import type { ClassificationCredentialCipher, ReadAuthorizedFolders, ServerClock } from "../classification/types";

export type CaptureTranscriptionIdentity = Readonly<{ captureId: string; inboxAttachmentId?: never; actorId: string; actorEpoch: number; expiresAt: string }>;
export type InboxTranscriptionIdentity = Readonly<{ inboxAttachmentId: string; captureId?: never; actorId: string; actorEpoch: number;
  departureEpoch: number; attachmentVersion: number; commentVersion: number }>;
export type TranscriptionIdentity = CaptureTranscriptionIdentity | InboxTranscriptionIdentity;
export type TranscriptionConfiguration = Readonly<{
  version: number; provider: string; model: string; enabled: boolean; monthlyLimitMicros: number; currency: "EUR";
}>;
export type TranscriptionPayload = Readonly<{ bytes: Uint8Array; mediaType: "audio/wav"; durationMs: number; vocabulary: readonly string[] }>;
export interface TranscriptionProvider {
  readonly id: string; readonly mode: "synthetic" | "remote"; readonly label: string;
  readonly models: readonly Readonly<{ id: string; label: string; vocabularySupported: boolean }>[];
  quote(config: TranscriptionConfiguration): Readonly<{ maximumMicros: number; currency: "EUR" }> | null;
  transcribe(config: TranscriptionConfiguration, payload: TranscriptionPayload, credential: string, signal: AbortSignal): Promise<Readonly<{ text: string; actualMicros: number | null }>>;
}
export interface TranscriptionDependencies {
  clock: ServerClock;
  capture: { assertAvailable(client: PoolClient, actor: Actor, captureId: string): Promise<CaptureTranscriptionIdentity> };
  inbox?: { assertAvailable(client: PoolClient, actor: Actor, inboxAttachmentId: string): Promise<InboxTranscriptionIdentity> };
  readAuthorizedFolders: ReadAuthorizedFolders; credentialCipher: ClassificationCredentialCipher;
  providers: readonly TranscriptionProvider[]; allowRemote: boolean; requestTimeoutMs: number;
  deploymentLimitMicros?: number;
}
export const DEFAULT_TRANSCRIPTION_LIMITS = Object.freeze({ requestTimeoutMs: 65_000 });
