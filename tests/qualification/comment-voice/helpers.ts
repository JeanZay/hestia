import { randomUUID } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Page, type Route } from "@playwright/test";
import type { CaptureDto } from "../../../src/shared/capture-contract";

export const origin = { origin: "http://127.0.0.1:3210" };
export const comment = (page: Page) => page.getByLabel("Commentaire pour les suggestions (facultatif)", { exact: true });
/** Only explicit pre-action conflicts permit another DELETE. An unknown outcome
 * fails with bounded metadata; no response text, credential or raw error leaks. */
export async function cleanupCapture(request: Pick<APIRequestContext, "get" | "delete">, id: string) {
  const events: { method: string; status: number; code: string }[] = [];
  const fail = (cause: string): never => { throw new Error(`CAPTURE_TEST_CLEANUP ${JSON.stringify({ cause, events })}`); };
  const knownCodes = new Set(["VERSION_CONFLICT", "CAPTURE_OPERATION_BUSY", "CAPTURE_EXPIRED"]);
  async function perform(method: "get" | "delete", version?: number) {
    let response;
    try { response = await request[method](`/api/hestia/capture/${id}`, { timeout: 2000, ...(method === "delete" ? { headers: origin, data: { version } } : {}) }); }
    catch { events.push({ method: method.toUpperCase(), status: 0, code: "TRANSPORT_UNKNOWN" }); return fail(`${method.toUpperCase()}_OUTCOME_UNKNOWN`); }
    const event = { method: method.toUpperCase(), status: response.status(), code: "BODY_UNREADABLE" }; events.push(event);
    let body;
    try { body = await response.json(); } catch { return fail(`${method.toUpperCase()}_BODY_UNREADABLE`); }
    const code = typeof body?.error?.code === "string" && knownCodes.has(body.error.code) ? body.error.code as string : response.ok() ? "OK" : "OTHER";
    event.code = code;
    return { status: response.status(), code, capture: body?.capture as CaptureDto | undefined };
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await perform("get");
    if (current.status === 410 && current.code === "CAPTURE_EXPIRED") return events;
    if (current.status !== 200 || !current.capture || !Number.isSafeInteger(current.capture.version)) return fail("READ_NOT_CONFIRMED");
    const deleted = await perform("delete", current.capture.version);
    if (deleted.status === 200 && deleted.capture?.state === "abandoned") return events;
    if (deleted.status === 410 && deleted.code === "CAPTURE_EXPIRED") return events;
    if (deleted.status !== 409 || !["VERSION_CONFLICT", "CAPTURE_OPERATION_BUSY"].includes(deleted.code)) return fail("DELETE_NOT_CONFIRMED");
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return fail("EXPLICIT_CONFLICT_LIMIT");
}
export const test = base.extend<{ captures: string[] }>({
  captures: async ({ page }, provide) => {
    const ids: string[] = []; await provide(ids);
    const request = page.context().request;
    if (!page.isClosed()) await page.close(); // Stop browser effects before reading the cleanup version.
    for (const id of ids) await cleanupCapture(request, id);
  },
});
export async function login(page: Page, email = "camille@hestia.invalid") {
  const password = process.env.HESTIA_TEST_PASSWORD;
  if (!password || process.env.HESTIA_ENVIRONMENT !== "local" || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw Error("Owned synthetic local runtime required");
  await page.goto("/");
  let status = 0;
  // Same bounded admission wait as the existing Capture browser harness. Tests
  // share the synthetic origin and must respect its authentication rate limit.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    const signed = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    status = (await signed).status();
    if (status !== 429) break;
    await page.waitForTimeout(10_100);
  }
  expect(status).toBe(200);
  await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
}
export async function folder(page: Page) {
  const response = await page.request.post("/api/hestia/folders", { headers: origin, data: { name: `Commentaire ${randomUUID().slice(0, 8)}`, idempotencyKey: randomUUID() } });
  expect(response.status()).toBe(201); return (await response.json()).folder as { id: string; name: string };
}
export async function destination(page: Page, captures: string[], camera = false) {
  if (camera) await page.getByRole("button", { name: "Photo", exact: true }).click();
  else { await page.getByRole("button", { name: "Moi", exact: true }).click(); await page.getByRole("button", { name: "Brouillons", exact: true }).last().click(); }
  const created = page.waitForResponse(r => new URL(r.url()).pathname === "/api/hestia/capture" && r.request().method() === "POST");
  const chosen = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: camera ? "Prendre la première page" : "Importer un fichier", exact: true }).click();
  await (await chosen).setFiles("tests/fixtures/documents/synthetic.png");
  const capture = (await (await created).json()).capture as CaptureDto; captures.push(capture.id);
  await expect(page.getByText("Page sauvegardée.", { exact: true })).toBeVisible({ timeout: 30_000 });
  if (camera) await page.getByRole("button", { name: "Continuer", exact: true }).click();
  const title = `Préparation commentaire ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Titre du document", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Choisir où ranger", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Où ranger ce document ?", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(comment(page)).toBeVisible();
  return { id: capture.id, title };
}
export async function saved(page: Page, id: string, value: string) {
  await expect.poll(async () => (await (await page.request.get(`/api/hestia/capture/${id}`)).json()).capture.comment).toBe(value);
}
export async function capture(page: Page, id: string): Promise<CaptureDto> {
  const response = await page.request.get(`/api/hestia/capture/${id}`); expect(response.status()).toBe(200); return (await response.json()).capture;
}
export async function choose(page: Page, name: string) {
  await page.getByRole("button", { name: "Parcourir les dossiers", exact: true }).click();
  await page.getByRole("radio", { name, exact: true }).click();
}
/** Synthetic input stream only. The application AudioWorklet, PCM buffering,
 * WAV encoding, fetch and cleanup run normally. This is not a real microphone,
 * recognizer-quality test, Browser Use campaign or provider qualification. */
export async function syntheticMicrophone(page: Page, denied = false) {
  await page.addInitScript(({ denied }) => {
    const state = { requested: 0, stopped: 0 };
    (window as unknown as { __syntheticMic: typeof state }).__syntheticMic = state;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      state.requested++;
      if (denied) throw new DOMException("Synthetic denied microphone", "NotAllowedError");
      const context = new AudioContext(), oscillator = context.createOscillator(), target = context.createMediaStreamDestination();
      oscillator.frequency.value = 220; oscillator.connect(target); oscillator.start(); await context.resume();
      for (const track of target.stream.getTracks()) {
        const stop = track.stop.bind(track); let stopped = false;
        track.stop = () => { if (!stopped) { stopped = true; state.stopped++; oscillator.stop(); void context.close(); } stop(); };
      }
      return target.stream;
    } });
  }, { denied });
}
/** HTTP transport stub only; server budget/provider/rights are covered separately
 * by real createApplication integration tests with injected synthetic providers. */
export async function transcriptionTransport(page: Page, result: (route: Route, call: number) => Promise<void>) {
  let calls = 0;
  await page.route("**/api/hestia/transcriptions?*", async route => {
    if (route.request().method() === "GET") await route.fulfill({ status: 200, json: { enabled: true, available: true, maxDurationMs: 120_000, maxAudioBytes: 4 * 1024 * 1024, mediaTypes: ["audio/wav"], vocabularySupported: true } });
    else { expect(route.request().headers()["content-type"]).toBe("audio/wav"); await result(route, ++calls); }
  });
  return () => calls;
}
export async function dictate(page: Page) {
  await page.getByRole("button", { name: /^Dicter(?: la suite)?$/ }).click();
  await expect(page.getByRole("group", { name: "Dictée en cours", exact: true })).toBeVisible();
  // Allow real AudioWorklet samples to arrive; this wait is stimulus duration,
  // never a latency assertion or a stand-in for observing completion.
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Arrêter et transcrire", exact: true }).click();
}
