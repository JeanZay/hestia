import type { PoolClient } from "pg";
import type { Actor } from "../access";
import type { CaptureMediaType } from "../../shared/capture-contract";

export type ServerClock = (client: PoolClient) => Promise<Date>;
export type AnalysisSelection = Readonly<{ captureId: string; version: number; artifactId: string }>;
export type AnalysisIdentity = AnalysisSelection & Readonly<{
  actorId: string; actorEpoch: number; manifestSha256: string; sha256: string;
  mediaType: CaptureMediaType; size: number; expiresAt: string;
}>;
export interface CaptureAnalysisBridge {
  inspect(client: PoolClient, actor: Actor, selection: AnalysisSelection): Promise<AnalysisIdentity>;
  assertCurrent(client: PoolClient, actor: Actor, identity: AnalysisIdentity): Promise<void>;
  readBytes(request: Request, identity: AnalysisIdentity): Promise<Uint8Array>;
}
export type AuthorizedFolder = Readonly<{
  id: string; name: string; path: readonly Readonly<{ id: string; name: string }>[]; canCreate: boolean;
}>;
export type ReadAuthorizedFolders = (client: PoolClient, actor: Actor) => Promise<readonly AuthorizedFolder[]>;
export type ClassificationConfiguration = Readonly<{
  version: number; provider: string; model: string; enabled: boolean; monthlyLimitMicros: number; currency: string;
}>;
export type ProviderPayload = Readonly<{ bytes: Uint8Array; mediaType: CaptureMediaType; folders: readonly AuthorizedFolder[] }>;
export type ProviderCost = Readonly<{ maximumMicros: number; currency: string }>;
export type ProviderOutcome = Readonly<{ value: unknown; actualMicros: number | null }>;
export interface ClassificationProvider {
  readonly id: string; readonly mode: "synthetic" | "remote";
  readonly label?: string; readonly models?: readonly Readonly<{ id: string; label: string }>[];
  quote(config: ClassificationConfiguration, payload: ProviderPayload): ProviderCost | null;
  analyze(config: ClassificationConfiguration, payload: ProviderPayload, credential: string, signal: AbortSignal): Promise<ProviderOutcome>;
  quoteCheck(config: ClassificationConfiguration): ProviderCost | null;
  check(config: ClassificationConfiguration, credential: string, signal: AbortSignal): Promise<Readonly<{
    status: "accepted" | "invalid" | "unreachable"; actualMicros: number | null;
  }>>;
}
export interface ClassificationCredentialCipher {
  seal(credential: string, associatedData: string): string;
  open(sealed: string, associatedData: string): string;
}
export interface ClassificationDependencies {
  clock: ServerClock; capture: CaptureAnalysisBridge; readAuthorizedFolders: ReadAuthorizedFolders;
  credentialCipher: ClassificationCredentialCipher; providers: readonly ClassificationProvider[]; allowRemote: boolean;
  requestTimeoutMs: number; maxResultBytes: number; maxSuggestions: number;
}
export const DEFAULT_CLASSIFICATION_LIMITS = Object.freeze({ requestTimeoutMs: 15_000, maxResultBytes: 16_384, maxSuggestions: 8 });
