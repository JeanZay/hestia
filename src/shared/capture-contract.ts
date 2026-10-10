/** Public wire types only: no credentials, object keys or private access graph. */
export type CaptureMediaType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";
export type CaptureRotation = 0 | 90 | 180 | 270;
export type CaptureCrop = { t: number; r: number; b: number; l: number };
export type CaptureKind = "camera" | "import";
export type CaptureFormat = "pdf" | "image" | "original";
export type CapturePageDto = {
  id: string; version: number; order: number; rotation: CaptureRotation; crop: CaptureCrop;
  size: number; mediaType: CaptureMediaType; width: number; height: number; savedAt: string;
};
export type CaptureDto = {
  id: string; kind: CaptureKind; version: number;
  state: "open" | "preparing" | "finalized" | "abandoned" | "expired";
  createdAt: string; expiresAt: string; currentFolderId: string | null;
  title: string; format: CaptureFormat; pages: CapturePageDto[];
};
export type CaptureArtifactDto = {
  id: string; version: number; mediaType: CaptureMediaType; fileName: string;
  size: number; sha256: string; pageCount: number;
};
export type CaptureDestination =
  | { kind: "existing"; folderId: string }
  | { kind: "create"; parentId: string; levels: string[] };
export type CaptureAccessProjection = {
  capabilities: string[]; message: string;
  /** Only the existing sharing/administration envelope may disclose people. */
  people?: { id: string; name: string; capabilities: string[] }[];
};
export type CapturePreviewInput = {
  version: number; artifactId: string; destination: CaptureDestination; keepDuplicate: boolean;
};
export type CapturePreviewDto = {
  previewToken: string; artifact: CaptureArtifactDto; title: string;
  path: { id?: string; name: string; isNew: boolean }[];
  access: CaptureAccessProjection; duplicate: boolean;
};
export type CaptureFinalizeInput = CapturePreviewInput & { previewToken: string; idempotencyKey: string };
export type CaptureReconcileInput = CaptureFinalizeInput & { captureId: string };
export type CaptureDocumentDto = {
  id: string; folderId: string; title: string; fileName: string; mediaType: string;
  size: number; sha256: string; source: string; version: number; createdAt: string;
  uploadedByName: string; previewSupported: boolean; capabilities: string[];
};
export type CaptureOperationDto =
  | { status: "recorded"; document: CaptureDocumentDto }
  | { status: "not-recorded" | "in-progress" };
export type ClassificationResultDto = {
  existing: { folderId: string; reason: string }[];
  created: { parentId: string; levels: string[]; reason: string }[];
  summary?: string;
};
export type ClassificationAnalysisDto = {
  analysisId: string; status: "pending" | "complete" | "failed" | "stale";
  result?: ClassificationResultDto;
};
export type ClassificationSettingsDto = {
  version: number; provider: string; model: string; enabled: boolean;
  monthlyLimitMicros: number; currency: "EUR"; keyPresent: boolean; keySetAt: string | null;
  period: { start: string; end: string; timeZone: "UTC" };
  spentMicros: number; reservedMicros: number;
  availableProviders: { id: string; label: string; models: { id: string; label: string }[] }[];
};
export type ClassificationSettingsInput = {
  version: number; provider: string; model: string; monthlyLimitMicros: number;
  enabled: boolean; apiKey?: string;
};
export type CaptureCreateInput = { kind: CaptureKind; idempotencyKey: string; currentFolderId: string | null };
export type CapturePatchInput = {
  version: number; title: string; format: CaptureFormat;
  pages: { id: string; rotation: CaptureRotation; crop: CaptureCrop }[];
};
export type CapturePageInput = {
  version: number; idempotencyKey: string; fileName: string; mediaType: CaptureMediaType;
  size: number; sha256: string; replacePageId?: string;
};
export type CapturePageReservationDto = { upload: { id: string; chunkSize: number }; captureVersion: number };
