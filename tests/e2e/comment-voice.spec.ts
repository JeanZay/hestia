import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { capture, choose, comment, destination, dictate, folder, login, origin, saved, syntheticMicrophone, test, transcriptionTransport } from "../qualification/comment-voice/helpers";

test("Commentaire : clavier, limite Unicode sans troncature et aucune analyse implicite", async ({ page, captures }) => {
  await login(page); const draft = await destination(page, captures);
  let analyses = 0, transcriptions = 0, writes = 0;
  page.on("request", request => { const url = new URL(request.url()); if (request.method() === "POST" && url.pathname.endsWith("/analyze")) analyses++; if (request.method() === "POST" && url.pathname.endsWith("/transcriptions")) transcriptions++; if (request.method() === "PATCH" && url.pathname.endsWith("/comment")) writes++; });
  const field = comment(page); await field.fill("Garantie du véhicule fictif, pas une facture."); await saved(page, draft.id, await field.inputValue());
  expect(writes).toBe(1); expect(analyses).toBe(0); expect(transcriptions).toBe(0);
  const tooLong = "🪁".repeat(2001); await field.fill(tooLong); await expect(field).toHaveValue(tooLong);
  await expect(page.getByText(/Le commentaire dépasse 2 000 caractères/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Demander des suggestions", exact: true })).toBeDisabled();
  expect((await capture(page, draft.id)).comment).toBe("Garantie du véhicule fictif, pas une facture.");
  await field.fill("🪁".repeat(2000)); await saved(page, draft.id, "🪁".repeat(2000));
  await expect(page.getByRole("button", { name: "Demander des suggestions", exact: true })).toBeEnabled();
  expect(analyses).toBe(0); expect(transcriptions).toBe(0);
});

test("Commentaire : réponse autosave retardée ne remplace pas une nouvelle frappe", async ({ page, captures }) => {
  await login(page); const draft = await destination(page, captures);
  let release = () => {}, stored = () => {}; const held = new Promise<void>(resolve => { release = resolve; }), firstStored = new Promise<void>(resolve => { stored = resolve; });
  const sent: string[] = [];
  await page.route(`**/api/hestia/capture/${draft.id}/comment`, async route => {
    sent.push(route.request().postDataJSON().comment as string); const response = await route.fetch();
    if (sent.length === 1) { stored(); await held; } await route.fulfill({ response });
  });
  try {
    await comment(page).fill("Premier texte synthétique"); await firstStored;
    await comment(page).fill("Correction plus récente à préserver"); release();
    await saved(page, draft.id, "Correction plus récente à préserver");
    await expect(comment(page)).toHaveValue("Correction plus récente à préserver");
    expect(sent).toEqual(["Premier texte synthétique", "Correction plus récente à préserver"]);
  } finally { release(); }
});

test("Commentaire : conflit réel entre éditeurs, actualisation explicite et conservation locale", async ({ page, captures }) => {
  await login(page); const draft = await destination(page, captures), initial = await capture(page, draft.id);
  const remote = await page.request.patch(`/api/hestia/capture/${draft.id}/comment`, { headers: origin, data: { commentVersion: initial.commentVersion, comment: "Texte du second éditeur synthétique" } }); expect(remote.status()).toBe(200);
  await comment(page).fill("Mon texte local reste ici");
  await expect(page.getByText("Le brouillon a été modifié sur un autre appareil. Votre commentaire local est conservé.", { exact: true })).toBeVisible();
  await expect(comment(page)).toHaveValue("Mon texte local reste ici");
  expect((await capture(page, draft.id)).comment).toBe("Texte du second éditeur synthétique");
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(comment(page)).toHaveValue("Mon texte local reste ici");
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await saved(page, draft.id, "Mon texte local reste ici");
});

test("Commentaire : destination manuelle conservée, ancienne confirmation refusée, aucune préparation supplémentaire", async ({ page, captures }) => {
  await login(page); const target = await folder(page); await page.reload(); const draft = await destination(page, captures);
  await choose(page, target.name);
  const firstPreview = page.waitForResponse(r => new URL(r.url()).pathname === `/api/hestia/capture/${draft.id}/preview` && r.request().method() === "POST");
  await page.getByRole("button", { name: "Vérifier avant d’enregistrer", exact: true }).click();
  const previous = (await (await firstPreview).json()).preview;
  await expect(page.getByRole("heading", { name: "Qui pourra accéder au document", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retour", exact: true }).click();
  const before = await capture(page, draft.id); let prepareCalls = 0, contentReads = 0, analyses = 0;
  page.on("request", r => { const url = new URL(r.url()); if (url.pathname.endsWith("/prepare")) prepareCalls++; if (url.pathname.endsWith("/content")) contentReads++; if (url.pathname.endsWith("/analyze")) analyses++; });
  await comment(page).fill("Correction destinée seulement à la préparation"); await saved(page, draft.id, "Correction destinée seulement à la préparation");
  await expect(page.getByText("Destination choisie.", { exact: true })).toBeVisible();
  const after = await capture(page, draft.id); expect(after.pages).toEqual(before.pages); expect(after.version).toBe(before.version);
  const stale = await page.request.post(`/api/hestia/capture/${draft.id}/finalize`, { headers: origin, data: { version: before.version, artifactId: previous.artifact.id, destination: { kind: "existing", folderId: target.id }, keepDuplicate: false, previewToken: previous.previewToken, idempotencyKey: randomUUID() } }); expect(stale.status()).toBe(409);
  const nextPreview = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/capture/${draft.id}/preview`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Vérifier avant d’enregistrer", exact: true }).click();
  const next = (await (await nextPreview).json()).preview;
  expect(next.previewToken).not.toBe(previous.previewToken); expect(next.artifact.sha256).toBe(previous.artifact.sha256); expect(next.artifact.size).toBe(previous.artifact.size);
  expect(prepareCalls).toBe(0); expect(contentReads).toBe(0); expect(analyses).toBe(0);
});

test("Commentaire caméra : seule sauvegarde confirmée reprise, échéance inchangée", async ({ page, captures, isMobile }) => {
  test.skip(!isMobile, "Synthetic camera file chooser is exercised on the mobile profile.");
  await login(page); const draft = await destination(page, captures, true), before = await capture(page, draft.id);
  await comment(page).fill("Commentaire caméra synthétique enregistré"); await saved(page, draft.id, "Commentaire caméra synthétique enregistré");
  await expect(page.getByText("Commentaire enregistré dans le brouillon", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Moi", exact: true }).click(); await page.getByRole("button", { name: "Brouillons", exact: true }).last().click();
  await page.locator("li.hc-card").filter({ hasText: draft.title }).getByRole("button", { name: "Reprendre", exact: true }).click();
  await page.getByRole("button", { name: "Continuer", exact: true }).click(); await page.getByRole("button", { name: "Choisir où ranger", exact: true }).click();
  await expect(comment(page)).toHaveValue("Commentaire caméra synthétique enregistré"); expect((await capture(page, draft.id)).expiresAt).toBe(before.expiresAt);
});

test("Dictée : permission refusée conserve le clavier et ne contacte pas le fournisseur", async ({ page, captures }) => {
  await syntheticMicrophone(page, true); const calls = await transcriptionTransport(page, async () => { throw Error("Unexpected STT request"); });
  await login(page); await destination(page, captures); await comment(page).fill("Texte clavier conservé");
  await page.getByRole("button", { name: "Dicter la suite", exact: true }).click();
  await expect(page.getByText("Microphone non autorisé.", { exact: true })).toBeVisible();
  await comment(page).fill("Clavier toujours disponible après refus"); await expect(comment(page)).toHaveValue("Clavier toujours disponible après refus"); expect(calls()).toBe(0);
});

test("Dictée : texte ajouté après arrêt, édition concurrente mise à part et ajout explicite", async ({ page, captures }) => {
  await syntheticMicrophone(page); let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const calls = await transcriptionTransport(page, async (route, call) => { if (call === 2) await held; await route.fulfill({ status: 200, json: { transcriptionId: randomUUID(), status: "complete", text: call === 1 ? "phrase dictée synthétique" : "seconde phrase dictée" } }); });
  await login(page); await destination(page, captures); let analyses = 0; page.on("request", r => { if (r.url().endsWith("/analyze")) analyses++; });
  await comment(page).fill("Préfixe clavier"); await dictate(page); await expect(comment(page)).toHaveValue("Préfixe clavier phrase dictée synthétique");
  try {
    await dictate(page); await expect.poll(calls).toBe(2); await comment(page).fill("Correction faite pendant la transcription"); release();
    const pending = page.getByRole("group", { name: "Texte dicté, pas encore ajouté", exact: true }); await expect(pending).toBeVisible();
    await expect(comment(page)).toHaveValue("Correction faite pendant la transcription"); await expect(page.getByRole("button", { name: "Dicter la suite", exact: true })).toBeDisabled();
    await pending.getByLabel("Texte dicté", { exact: true }).fill("résultat corrigé"); await pending.getByRole("button", { name: "Ajouter à la fin du commentaire", exact: true }).click();
    await expect(comment(page)).toHaveValue("Correction faite pendant la transcription résultat corrigé"); await expect(pending).toHaveCount(0); expect(analyses).toBe(0); expect(calls()).toBe(2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticMic: { stopped: number } }).__syntheticMic.stopped)).toBe(2);
  } finally { release(); }
});

test("Dictée : dépassement non tronqué puis panne sans retry, clavier intact", async ({ page, captures }) => {
  await syntheticMicrophone(page); const over = "x".repeat(2001);
  const calls = await transcriptionTransport(page, async (route, call) => { if (call === 1) await route.fulfill({ status: 200, json: { transcriptionId: randomUUID(), status: "complete", text: over } }); else await route.fulfill({ status: 503, json: { error: { code: "TRANSCRIPTION_FAILED" } } }); });
  await login(page); await destination(page, captures); await comment(page).fill("Texte original"); await dictate(page);
  const pending = page.getByRole("group", { name: "Texte dicté, pas encore ajouté", exact: true }); await expect(pending).toBeVisible(); await expect(pending.getByLabel("Texte dicté", { exact: true })).toHaveValue(over);
  await expect(pending.getByRole("button", { name: "Ajouter à la fin du commentaire", exact: true })).toBeDisabled(); await pending.getByRole("button", { name: "Ne pas utiliser", exact: true }).click();
  await dictate(page); await expect(page.getByText("Transcription impossible.", { exact: true })).toBeVisible(); await expect(comment(page)).toHaveValue("Texte original");
  await comment(page).fill("Texte modifié après la panne"); await saved(page, captures[0], "Texte modifié après la panne"); expect(calls()).toBe(2);
});

test("Dictée : annuler avant émission arrête la piste et écarter ignore une réponse tardive", async ({ page, captures }) => {
  await syntheticMicrophone(page); let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  let delivered = () => {}; const settled = new Promise<void>(resolve => { delivered = resolve; });
  const calls = await transcriptionTransport(page, async route => { await held; try { await route.fulfill({ status: 200, json: { transcriptionId: randomUUID(), status: "complete", text: "Réponse à ne jamais insérer" } }); } catch { /* Aborted client is an expected discard outcome. */ } finally { delivered(); } });
  await login(page); await destination(page, captures); await comment(page).fill("Texte conservé");
  await page.getByRole("button", { name: "Dicter la suite", exact: true }).click(); await expect(page.getByRole("group", { name: "Dictée en cours", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click(); await expect(page.getByText("Dictée annulée.", { exact: true })).toBeVisible(); expect(calls()).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticMic: { stopped: number } }).__syntheticMic.stopped)).toBe(1);
  try { await dictate(page); await expect.poll(calls).toBe(1); await page.getByRole("button", { name: "Ne pas utiliser le résultat", exact: true }).click(); release(); await settled; await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await expect(page.getByText("Résultat écarté.", { exact: true })).toBeVisible(); await expect(comment(page)).toHaveValue("Texte conservé"); await expect(page.getByRole("group", { name: "Texte dicté, pas encore ajouté", exact: true })).toHaveCount(0); } finally { release(); }
});

test("Commentaire : divergence explicitée puis suggestions invalidées sans nouvelle analyse", async ({ page, captures }) => {
  await login(page); const target = await folder(page); await page.reload(); const draft = await destination(page, captures);
  let analyses = 0;
  await page.route(`**/api/hestia/capture/${draft.id}/analyze`, async route => {
    analyses++; expect(route.request().postDataJSON().commentVersion).toBeGreaterThan(0);
    await route.fulfill({ status: 200, json: { analysisId: randomUUID(), status: "complete", result: { existing: [{ folderId: target.id, reason: "Alternative synthétique à confirmer" }], created: [], contradiction: "Le document synthétique parle du véhicule bleu ; le commentaire précise le rouge." } } });
  });
  await comment(page).fill("Véhicule rouge synthétique"); await page.getByRole("button", { name: "Demander des suggestions", exact: true }).click();
  await expect(page.getByText("Divergence signalée.", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: target.name, exact: true })).toBeVisible();
  await comment(page).fill("Correction : véhicule bleu synthétique"); await saved(page, draft.id, "Correction : véhicule bleu synthétique");
  await expect(page.getByText("Divergence signalée.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Le commentaire a changé : les suggestions précédentes/)).toBeVisible(); expect(analyses).toBe(1);
  expect((await (await page.request.get(`/api/hestia/documents?folderId=${target.id}`)).json()).documents).toHaveLength(0);
});

test("Commentaire caméra : autosave ne ferme pas un envoi de page concurrent", async ({ page, captures, isMobile }) => {
  test.skip(!isMobile, "Synthetic camera upload concurrency uses the mobile profile.");
  await login(page); const draft = await destination(page, captures, true), before = await capture(page, draft.id);
  const bytes = await readFile("tests/fixtures/documents/synthetic.png");
  const reservation = await page.request.post(`/api/hestia/capture/${draft.id}/pages`, { headers: origin, data: { version: before.version, idempotencyKey: randomUUID(), fileName: "page-concurrente-synthetique.png", mediaType: "image/png", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
  expect(reservation.status()).toBe(200); const { upload, captureVersion } = await reservation.json();
  await comment(page).fill("Commentaire pendant l’envoi synthétique"); await saved(page, draft.id, "Commentaire pendant l’envoi synthétique");
  const sent = await page.request.put(`/api/hestia/capture/${draft.id}/pages/${upload.id}/chunks/0`, { headers: { ...origin, "content-type": "application/octet-stream" }, data: bytes }); expect(sent.status()).toBe(200);
  const completed = await page.request.post(`/api/hestia/capture/${draft.id}/pages/${upload.id}/complete`, { headers: origin, data: { version: captureVersion } }); expect(completed.status()).toBe(200);
  const after = await capture(page, draft.id); expect(after.pages).toHaveLength(2); expect(after.pages[0]).toEqual(before.pages[0]); expect(after.comment).toBe("Commentaire pendant l’envoi synthétique");
});

test("Dictée native simulée : permission HTTP, véritable getUserMedia et pistes libérées", async () => {
  const { chromium, devices } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3210" });
  const page = await context.newPage(), ids: string[] = [];
  try {
    const health = await context.request.get("/api/health");
    expect(health.headers()["permissions-policy"]).toContain("microphone=(self)");
    // getUserMedia remains untouched. Only Chromium's launch-time media source
    // is synthetic. Observe tracks when passed to the native AudioContext.
    await page.addInitScript(() => {
      const original = AudioContext.prototype.createMediaStreamSource;
      const tracks: MediaStreamTrack[] = [];
      (window as unknown as { __nativeMicTracks: MediaStreamTrack[] }).__nativeMicTracks = tracks;
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        tracks.push(...stream.getTracks()); return original.call(this, stream);
      };
    });
    const calls = await transcriptionTransport(page, async route => { await route.fulfill({ status: 200, json: { transcriptionId: randomUUID(), status: "complete", text: "Résultat synthétique du transport" } }); });
    await login(page); await destination(page, ids); await dictate(page);
    await expect(comment(page)).toHaveValue("Résultat synthétique du transport"); expect(calls()).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __nativeMicTracks: MediaStreamTrack[] }).__nativeMicTracks.map(track => track.readyState))).toEqual(["ended"]);
  } finally {
    for (const id of ids) {
      const response = await page.request.get(`/api/hestia/capture/${id}`);
      if (response.ok()) { const current = (await response.json()).capture; if (current.state === "open") expect((await page.request.delete(`/api/hestia/capture/${id}`, { headers: origin, data: { version: current.version } })).ok()).toBe(true); }
    }
    await context.close(); await browser.close();
  }
});

test("Dictée réglages : désactiver un profil indisponible et baisser le plafond sans appel au service", async ({ page }) => {
  const settings = { version: 4, provider: "openrouter", model: "microsoft/mai-transcribe-2", enabled: true, monthlyLimitMicros: 10_000_000, currency: "EUR", keyPresent: true, keySetAt: "2026-10-01T00:00:00.000Z", period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", timeZone: "UTC" }, spentMicros: 0, reservedMicros: 0, availableProviders: [] };
  const writes: Record<string, unknown>[] = []; let serviceCalls = 0, classificationWrites = 0;
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.endsWith("/transcriptions") && request.method() === "POST") serviceCalls++; if (url.pathname.endsWith("/classification-settings") && request.method() !== "GET") classificationWrites++; });
  await page.route("**/api/hestia/transcription-settings", async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { settings } });
    expect(route.request().method()).toBe("PUT"); const body = route.request().postDataJSON(); writes.push(body);
    await route.fulfill({ status: 200, json: { settings: { ...settings, ...body, version: 5 } } });
  });
  await login(page, "alex@hestia.invalid"); await page.getByRole("button", { name: "Moi", exact: true }).click(); await page.getByRole("button", { name: "Dictée", exact: true }).click();
  await expect(page.getByText("Non utilisable · modèle indisponible", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Dictée disponible pour le foyer" }).uncheck();
  await page.getByLabel("Plafond mensuel de la dictée (en euros)", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Désactivée", { exact: true })).toBeVisible();
  expect(writes).toEqual([{ version: 4, provider: settings.provider, model: settings.model, monthlyLimitMicros: 5_000_000, enabled: false }]);
  expect(serviceCalls).toBe(0); expect(classificationWrites).toBe(0);
  await expect(page.getByLabel("Remplacer la clé du service (facultatif)", { exact: true })).toHaveValue("");
});
