// Native pickers can background the page. Keep only this transient input alive;
// the application revalidates the session before accepting its eventual result.
export const CAPTURE_EVENT = "hestia-native-capture";
export type CaptureResult = { folderId: string; file?: File; id: string };
export function requestNativeCapture(folderId: string) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif";
  input.capture = "environment"; input.hidden = true;
  input.setAttribute("aria-label", "Prendre une photo native");
  let finished = false;
  const finish = (file?: File) => {
    if (finished) return; finished = true;
    input.remove();
    window.dispatchEvent(new CustomEvent<CaptureResult>(CAPTURE_EVENT, { detail: { folderId, file, id: crypto.randomUUID() } }));
  };
  input.addEventListener("change", () => finish(input.files?.[0]), { once: true });
  input.addEventListener("cancel", () => finish(), { once: true });
  document.body.appendChild(input);
  try { input.click(); } catch { finish(); }
}
