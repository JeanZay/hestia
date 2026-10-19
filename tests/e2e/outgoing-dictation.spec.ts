import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { OUTGOING_LIMITS, type OutgoingDraftDto } from '../../src/shared/outgoing-contract';
import { syntheticMicrophone } from '../qualification/comment-voice/helpers';

const unexpected = new WeakMap<Page, string[]>();
// This suite may run against an authorized hosted bundle: no real API or
// external origin is reachable, even when a mock is accidentally omitted.
test.beforeEach(async ({ context, page, baseURL }) => {
  const blocked: string[] = []; unexpected.set(page, blocked);
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.pathname}`); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }, info) => {
  expect(unexpected.get(page) ?? []).toEqual([]);
  if (info.status === 'passed') await page.screenshot({ path: info.outputPath('dictation-synthetic.png'), fullPage: true });
});

const id = '10000000-0000-4000-8000-000000000001';
const service = { configured: true, reason: null, sender: { name: 'Hestia synthétique', email: 'hestia@synthetic.invalid' }, replyTo: 'camille@synthetic.invalid', limits: OUTGOING_LIMITS };
const firstDraft = (): OutgoingDraftDto => ({ id, revision: 1, state: 'editable', to: ['destinataire@example.com'], subject: 'Attestation', message: 'Bonjour,', attachments: [{ id: 'synthetic-row', state: 'ok', documentId: 'synthetic-doc', documentVersion: 1, revisionId: 'synthetic-revision', title: 'Attestation synthétique', fileName: 'synthetic.pdf', size: 100, path: 'Maison', mediaType: 'application/pdf' }] });
async function setup(page: Page, options: { empty?: boolean; denied?: boolean; disabled?: boolean; text?: string; transport?: (route: Route, result: unknown, call: number) => Promise<void> } = {}) {
  await syntheticMicrophone(page, options.denied);
  let draft: OutgoingDraftDto | null = options.empty ? null : firstDraft(), posts = 0, creations = 0, checks = 0;
  const bodies: Buffer[] = [], queries: string[][] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/hestia/workspace') return json({ user: { id: 'camille', name: 'Camille', email: 'camille@synthetic.invalid', role: 'owner' }, folders: [], selectedFolder: null, documents: [], now: new Date().toISOString() });
    if (path === '/api/hestia/outgoing') {
      if (method === 'POST' && !draft) { creations++; draft = { ...firstDraft(), to: [], subject: '', message: '', attachments: [] }; }
      return json({ draft, service });
    }
    if (path === `/api/hestia/outgoing/${id}` && method === 'PATCH') {
      const body = request.postDataJSON(); if (!draft || body.revision !== draft.revision) return json({ error: { code: 'VERSION_CONFLICT' } }, 409);
      draft = { ...draft, ...body, revision: draft.revision + 1 }; return json({ draft });
    }
    if (path === `/api/hestia/outgoing/${id}` && method === 'DELETE') { draft = null; return json({ draft }); }
    if (path === `/api/hestia/outgoing/${id}/check`) {
      checks++; return json({ draft, recap: { token: 'synthetic-token', expiresAt: new Date(Date.now() + 60000).toISOString(), sender: service.sender, replyTo: service.replyTo, to: draft!.to, subject: draft!.subject, message: draft!.message, attachments: draft!.attachments, totalBytes: 100 } });
    }
    if (path === '/api/hestia/transcriptions') {
      expect([...url.searchParams.keys()].sort()).toEqual(method === 'POST' ? ['baseRevision', 'field', 'idempotencyKey', 'outgoingDraftId'] : ['field', 'outgoingDraftId']);
      expect(url.searchParams.get('outgoingDraftId')).toBe(id);
      if (method === 'GET') return json({ enabled: !options.disabled, available: !options.disabled, reason: options.disabled ? 'disabled' : undefined, maxDurationMs: 120000, maxAudioBytes: 4194304, mediaTypes: ['audio/wav'], vocabularySupported: false });
      posts++; queries.push([...url.searchParams.keys()]); expect(request.headers()['content-type']).toBe('audio/wav');
      const body = request.postDataBuffer()!; bodies.push(body); expect(body.subarray(0, 4).toString()).toBe('RIFF'); expect(body.byteLength).toBeGreaterThan(44);
      const result = { status: 'complete', transcriptionId: randomUUID(), text: options.text ?? (url.searchParams.get('field') === 'subject' ? 'et facture\nsynthétique' : 'Voici les documents.\n\nBonne journée.'), outgoing: { draftId: id, field: url.searchParams.get('field'), baseRevision: Number(url.searchParams.get('baseRevision')), revision: draft?.revision ?? 1 } };
      if (options.transport) return options.transport(route, result, posts);
      return json(result);
    }
    if (path === '/api/hestia/inbox') return json({ pendingCount: 0, messages: [], attachments: [], receptionAvailable: true });
    if (path === '/api/hestia/capture') return json({ captures: [] });
    if (path === '/api/hestia/me/recovery-codes') return json({ count: 5 });
    return route.fallback();
  });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Dossiers', exact: true })).toBeVisible();
  return { posts: () => posts, creations: () => creations, checks: () => checks, draft: () => draft, bodies, queries };
}
async function open(page: Page, isMobile: boolean) {
  const nav = page.getByRole('navigation', { name: isMobile ? 'Navigation principale mobile' : 'Navigation principale', exact: true });
  await nav.getByRole('button', { name: isMobile ? /^Échanges/ : 'Envois', exact: !isMobile }).click();
  if (isMobile) await page.getByRole('main').getByRole('button', { name: /Envois/ }).click();
  await expect(page.getByRole('heading', { name: 'Envois', exact: true })).toBeVisible();
}
async function listen(page: Page, field: 'subject' | 'message') {
  await page.getByRole('button', { name: field === 'subject' ? /Dicter (?:la suite de )?l’objet/ : /Dicter (?:la suite du message|le message)/ }).click();
  await expect(page.getByRole('group', { name: /^Dictée en cours pour/ })).toBeVisible();
}
async function stop(page: Page) {
  // Stimulus for the real AudioWorklet, never a latency assertion.
  await page.waitForTimeout(350); await page.getByRole('button', { name: 'Arrêter et transcrire', exact: true }).click();
}

test('Objet et Message : ajout fidèle, paragraphes, sauvegarde et récapitulatif sans audio joint', async ({ page, isMobile }) => {
  const f = await setup(page); await open(page, isMobile);
  await listen(page, 'subject'); await page.getByLabel('Message', { exact: true }).focus(); await stop(page);
  await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('Attestation et facture synthétique');
  await listen(page, 'message'); await stop(page);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Bonjour,\nVoici les documents.\n\nBonne journée.');
  await expect.poll(() => f.draft()?.message).toBe('Bonjour,\nVoici les documents.\n\nBonne journée.');
  await expect(page.getByText('Enregistrée dans Hestia', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vérifier avant d’envoyer', exact: true })).toBeVisible();
  expect(f.posts()).toBe(2); expect(f.checks()).toBe(1); expect(f.draft()?.attachments).toHaveLength(1);
  expect(f.bodies.every(body => body.subarray(0, 4).toString() === 'RIFF')).toBe(true);
});

test('Édition pendant écoute puis transcription : résultat séparé, vérification refusée, correction et retrait prudent', async ({ page, isMobile }) => {
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const f = await setup(page, { transport: async (route, result) => { await held; await route.fulfill({ status: 200, json: result }); } });
  await open(page, isMobile); await listen(page, 'subject');
  await page.getByLabel('Objet', { exact: true }).fill('Correction pendant écoute');
  await expect(page.getByText('Une dictée est déjà en cours pour l’objet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(page.getByText('Dictée à terminer avant l’envoi', { exact: true })).toBeFocused(); expect(f.checks()).toBe(0);
  await stop(page); await expect.poll(f.posts).toBe(1);
  await page.getByLabel('Objet', { exact: true }).fill('Correction pendant transcription'); release();
  const pending = page.getByRole('group', { name: 'Texte dicté pour l’objet, pas encore ajouté', exact: true });
  await expect(pending).toBeVisible(); await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('Correction pendant transcription');
  await pending.getByLabel('Texte dicté pour l’objet', { exact: true }).fill('résultat corrigé'); await pending.getByRole('button', { name: 'Ajouter à la fin de l’objet', exact: true }).click();
  await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('Correction pendant transcription résultat corrigé');
  await page.getByRole('button', { name: 'Retirer le texte dicté', exact: true }).click();
  await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('Correction pendant transcription');
});

test('Limites Unicode sans troncature et contrôle invisible corrigeable ; compteur et confidentialité adaptatifs', async ({ page, isMobile }) => {
  const f = await setup(page, { text: '🪁'.repeat(201) + '\u0007' }); await open(page, isMobile);
  const info = page.getByText(/Seul l’audio est envoyé au service de transcription du foyer/);
  if (isMobile) await expect(info).toBeHidden(); else await expect(info).toBeVisible();
  await page.getByLabel('Objet', { exact: true }).fill('🪁'.repeat(200)); await expect(page.getByText('200 / 200 caractères', { exact: true })).toBeVisible();
  await listen(page, 'subject'); await stop(page);
  const pending = page.getByRole('group', { name: 'Texte dicté pour l’objet, pas encore ajouté', exact: true });
  await expect(pending.getByLabel('Texte dicté pour l’objet', { exact: true })).toHaveValue('🪁'.repeat(201) + '\u0007');
  await expect(pending.getByRole('button', { name: 'Ajouter à la fin de l’objet', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('🪁'.repeat(200)); expect(f.posts()).toBe(1);
  await pending.getByRole('button', { name: 'Ne pas utiliser', exact: true }).click();
  await page.getByLabel('Message', { exact: true }).fill('🪁'.repeat(20001));
  await expect(page.getByText('20 001 / 20 000 caractères · 1 en trop', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click(); expect(f.checks()).toBe(0);
});

test('Préparation vide amorcée au clic ; annuler et quitter empêchent toute réponse tardive', async ({ page, isMobile }) => {
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const f = await setup(page, { empty: true, transport: async (route, result) => { await held; await route.fulfill({ status: 200, json: result }).catch(() => {}); } });
  try {
    await open(page, isMobile); expect(f.creations()).toBe(0);
    await listen(page, 'subject'); await page.getByRole('button', { name: 'Annuler', exact: true }).click(); expect(f.posts()).toBe(0); expect(f.creations()).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticMic: { stopped: number } }).__syntheticMic.stopped)).toBe(1);
    await listen(page, 'subject'); await stop(page); await expect.poll(f.posts).toBe(1);
    const nav = page.getByRole('navigation', { name: isMobile ? 'Navigation principale mobile' : 'Navigation principale', exact: true });
    await nav.getByRole('button', { name: isMobile ? 'Dossiers' : 'Tous les dossiers', exact: true }).click(); release();
    await open(page, isMobile); await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('');
    await expect(page.getByRole('group', { name: /Texte dicté pour/ })).toHaveCount(0);
  } finally { release(); }
});

test('Microphone refusé préserve le clavier sans appel de transcription', async ({ page, isMobile }) => {
  const f = await setup(page, { denied: true }); await open(page, isMobile); await page.getByRole('button', { name: 'Dicter la suite de l’objet', exact: true }).click();
  await expect(page.getByRole('alert').getByText('Microphone non autorisé.', { exact: true })).toBeVisible();
  await page.getByLabel('Objet', { exact: true }).fill('Clavier conservé après refus'); expect(f.posts()).toBe(0);
  await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('Clavier conservé après refus');
});
