import { randomUUID } from "node:crypto";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import type { CaptureDto } from "../../../src/shared/capture-contract";

export const origin = { origin: "http://127.0.0.1:3210" };
export const comment = (page: Page) => page.getByLabel("Commentaire pour les suggestions (facultatif)", { exact: true });
export const test = base.extend<{ captures: string[] }>({
  captures: async ({ page }, provide) => {
    const ids: string[] = []; await provide(ids);
    for (const id of ids) {
      const response = await page.request.get(`/api/hestia/capture/${id}`);
      if (!response.ok()) continue;
      const { capture } = await response.json() as { capture: CaptureDto };
      if (capture.state === "open") expect((await page.request.delete(`/api/hestia/capture/${id}`, { headers: origin, data: { version: capture.version } })).ok()).toBe(true);
    }
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
