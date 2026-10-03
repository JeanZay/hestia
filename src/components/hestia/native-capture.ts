// Native pickers can background the page. Keep only this transient input alive;
// the application revalidates the session before accepting its eventual result.
export const CAPTURE_EVENT = "hestia-native-capture";
export type CaptureResult = { folderId: string; file?: File; files?: File[]; id: string };
function requestNativePicker(folderId: string, camera: boolean, imagesOnly = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = camera || imagesOnly ? "image/jpeg,image/png,image/webp,image/heic,image/heif" : ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
  if (camera) input.capture = "environment"; else input.multiple = true;
  input.hidden = true;
  input.setAttribute("aria-label", camera ? "Prendre une photo native" : "Fichiers à ajouter");
  let finished = false;
  const finish = (selected: File[]) => {
    if (finished) return; finished = true;
    input.remove();
    const result: CaptureResult = {folderId, id: crypto.randomUUID(), ...(camera ? {file:selected[0]} : {files:selected})};
    window.dispatchEvent(new CustomEvent<CaptureResult>(CAPTURE_EVENT, { detail: result }));
  };
  input.addEventListener("change", () => finish(Array.from(input.files || [])), { once: true });
  input.addEventListener("cancel", () => finish([]), { once: true });
  document.body.appendChild(input);
  try { input.click(); } catch { finish([]); }
}
export function requestNativeCapture(folderId: string) { requestNativePicker(folderId, true); }
export function requestNativeImport(folderId: string, imagesOnly = false) { requestNativePicker(folderId, false, imagesOnly); }
