// Only a native picker may temporarily own draft File objects across a hidden page.
// No browser storage is used. Authentication and the original user are checked on return.
export const CAPTURE_EVENT = "hestia-native-capture";
export type NativeDraft = { id: string; file: File; title: string; source: "import" | "camera"; status: "ready" | "sending" | "done" | "failed" | "duplicate" | "rejected"; progress: number; operation?: string; hash?: string; keepDuplicate: boolean; error?: string };
export type PickerSnapshot = { userId: string; drafts: NativeDraft[]; flow?: { captureId: string | null; kind: "camera" | "import"; replacePageId?: string } };
export type CaptureResult = PickerSnapshot & { folderId: string; file?: File; files?: File[]; id: string };
let pending: { cancel: () => void; release: () => void } | null = null;
export const isNativePickerOpen = () => pending !== null;
export function clearNativePicker() { pending?.cancel(); pending = null; }
export function releaseNativePicker() { pending?.release(); pending = null; }
function requestNativePicker(folderId: string, snapshot: PickerSnapshot, camera: boolean, imagesOnly = false) {
  clearNativePicker();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = camera || imagesOnly ? "image/jpeg,image/png,image/webp,image/heic,image/heif" : ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
  if (camera) input.setAttribute("capture", "environment"); else input.multiple = !snapshot.flow;
  input.hidden = true;
  input.setAttribute("aria-label", camera ? "Prendre une photo native" : "Fichiers à ajouter");
  let finished = false;
  const release = () => { finished = true; snapshot.drafts.length = 0; input.value = ""; input.remove(); clearTimeout(timer); };
  const cancel = () => {
    for (const draft of snapshot.drafts) if (draft.operation && draft.status !== "done") void fetch(`/api/hestia/uploads/${draft.operation}`, {method:"DELETE",credentials:"same-origin",cache:"no-store",keepalive:true}).catch(() => {});
    release();
  };
  const timer = setTimeout(() => { cancel(); pending = null; }, 30 * 60 * 1000);
  pending = { cancel, release };
  const finish = (selected: File[]) => {
    if (finished) return; finished = true;
    input.remove(); // Keep the bounded handoff until the revalidated component consumes it.
    const result: CaptureResult = {...snapshot, folderId, id: crypto.randomUUID(), ...(camera ? {file:selected[0]} : {files:selected})};
    window.dispatchEvent(new CustomEvent<CaptureResult>(CAPTURE_EVENT, { detail: result }));
  };
  input.addEventListener("change", () => finish(Array.from(input.files || [])), { once: true });
  input.addEventListener("cancel", () => finish([]), { once: true });
  document.body.appendChild(input);
  try { input.click(); } catch { finish([]); }
}
export function requestNativeCapture(folderId: string, snapshot: PickerSnapshot) { requestNativePicker(folderId, snapshot, true); }
export function requestNativeImport(folderId: string, snapshot: PickerSnapshot, imagesOnly = false) { requestNativePicker(folderId, snapshot, false, imagesOnly); }

export function hasNativeCamera() {
  // Reuse the established mobile platform gate. A reflected input.capture
  // property is not required for the native picker attribute to work.
  // Touch alone would also enable convertible PCs.
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}
export function requestCaptureFlow(userId: string, folderId: string | null, kind: "camera" | "import", captureId: string | null = null, replacePageId?: string) {
  requestNativePicker(folderId || "", {userId,drafts:[],flow:{captureId,kind,replacePageId}}, kind === "camera");
}
export const OPEN_CAPTURE_EVENT = "hestia-open-capture";
