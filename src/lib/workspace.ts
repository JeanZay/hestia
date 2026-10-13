/** Public metadata only. Authorization remains server-side and transaction-scoped. */
export type WorkspaceUser = { id: string; name: string; email: string; role: "owner" | "admin" | "member" };
export type WorkspaceFolder = {
  id: string; name: string; version: number; capabilities: string[];
  documentCount: number; docCount: number; visibleParentId: string | null;
  breadcrumbs: { id: string; name: string }[]; childCount: number;
  canShare: boolean; canAdminister: boolean; createdAt: string; createdByName: string;
};
export type WorkspaceDocument = {
  id: string; folderId: string; title: string; fileName: string; mediaType: string;
  size: number; sha256: string; source: "import" | "camera"; version: number;
  createdAt: string; uploadedByName: string; previewSupported: boolean; capabilities: string[];
};
export type WorkspaceSnapshot = {
  user: WorkspaceUser; folders: WorkspaceFolder[]; selectedFolder: WorkspaceFolder | null;
  documents: WorkspaceDocument[]; now: string;
};
