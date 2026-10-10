import type { PoolClient } from "pg";
import type { Actor } from "../access";
import type { ObjectStore } from "../storage";
import type { StorageBudget } from "../storage/quota";
import type { validateOriginal } from "../formats";
import type { CaptureMediaType, CaptureCrop, CaptureRotation } from "../../shared/capture-contract";
export type ServerClock = (client: PoolClient) => Promise<Date>;
export type CaptureLimits = { fileBytes: number; imagePixels: number; pages: number; totalPixels: number; sourceBytes: number; generationTimeoutMs: number; maxDraftsPerActor: number; maxConcurrentGenerations: number };
export type RenderPage = { id: string; version: number; mediaType: CaptureMediaType; size: number; sha256: string; width: number; height: number; rotation: CaptureRotation; crop: CaptureCrop };
export type RenderRequest = { pages: readonly RenderPage[]; format: "pdf" | "image"; readPage: (id: string) => Promise<Uint8Array>; signal: AbortSignal };
export type RenderResult = { bytes: Uint8Array; mediaType: "application/pdf" | "image/jpeg"; pageCount: number; width: number; height: number; peakRssKiB: number };
export type CaptureRenderer = (input: RenderRequest) => Promise<RenderResult>;
export type AnalysisSelection = Readonly<{ captureId: string; version: number; artifactId: string }>;
export type AnalysisIdentity = AnalysisSelection & Readonly<{ actorId: string; actorEpoch: number; manifestSha256: string; sha256: string; mediaType: CaptureMediaType; size: number; expiresAt: string }>;
export interface CaptureAnalysisBridge {
  inspect(client: PoolClient, actor: Actor, selection: AnalysisSelection): Promise<AnalysisIdentity>;
  assertCurrent(client: PoolClient, actor: Actor, identity: AnalysisIdentity): Promise<void>;
  readBytes(request: Request, identity: AnalysisIdentity): Promise<Uint8Array>;
}
export type CaptureDependencies = {
  store: ObjectStore; budget: StorageBudget; clock?: ServerClock;
  limits?: Partial<CaptureLimits>; renderer?: CaptureRenderer; validateOriginal?: typeof validateOriginal;
};
export interface CaptureService {
  handleCaptures(request: Request): Promise<Response>;
  handleCapture(request: Request, id: string): Promise<Response>;
  handleCapturePages(request: Request, id: string): Promise<Response>;
  handleCapturePageChunk(request: Request, id: string, pageId: string, index: string): Promise<Response>;
  handleCapturePageComplete(request: Request, id: string, pageId: string): Promise<Response>;
  handleCapturePrepare(request: Request, id: string): Promise<Response>;
  handleCaptureContent(request: Request, id: string): Promise<Response>;
  handleCapturePreview(request: Request, id: string): Promise<Response>;
  handleCaptureFinalize(request: Request, id: string): Promise<Response>;
  handleCaptureOperation(request: Request, id: string): Promise<Response>;
  cleanupCaptures(limit: number, maxObjects: number): Promise<{cleaned: number; failed: number}>;
  analysis: CaptureAnalysisBridge;
}
