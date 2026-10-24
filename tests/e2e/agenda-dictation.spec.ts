import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type { AgendaCard, AgendaMutationInput } from '../../src/shared/agenda-contract';
import { emptyAgendaFields } from '../../src/components/hestia/agenda-client';
import { syntheticMicrophone } from '../qualification/comment-voice/helpers';

const unexpected = new WeakMap<Page, string[]>();
// Hosted-compatible synthetic QA: omitted mocks cannot reach any real API,
// external origin or mutation. No request fixture is a real family identity.
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
  if (info.status === 'passed') await page.screenshot({ path: info.outputPath('agenda-dictation-synthetic.png'), fullPage: true });
});

const cardId = '11111111-1111-4111-8111-111111111111';
const fixture = (): AgendaCard => ({ ...emptyAgendaFields(null), id: cardId, title: 'Sortie synthétique', description: 'Description conservée', revision: 1,
  creator: { id: 'camille', name: 'Camille', departed: false }, canManage: true, archived: false, audience: { mode: 'all', summary: 'household' },
  documents: [], reminders: [], reminderSummary: { count: 0, receives: false }, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' });
const actorHeaders = { 'X-Hestia-Actor': 'camille' };
async function setup(page: Page, options: { existing?: boolean; denied?: boolean; unavailable?: 'disabled' | 'budget'; text?: string;
  transport?: (route: Route, result: unknown, call: number) => Promise<void> } = {}) {
  await syntheticMicrophone(page, options.denied);
  let server: AgendaCard | null = options.existing ? fixture() : null, posts = 0;
  const writes: AgendaMutationInput[] = [], bodies: Buffer[] = [], sessions: string[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: actorHeaders, json: body });
    if (path === '/api/hestia/workspace') return json({ user: { id: 'camille', name: 'Camille', email: 'camille@synthetic.invalid', role: 'owner' }, folders: [], selectedFolder: null, documents: [], now: new Date().toISOString() });
    if (path === '/api/hestia/outgoing') return json({ draft: null, service: { configured: false, reason: 'not-configured', sender: { name: 'Hestia', email: null }, replyTo: 'camille@synthetic.invalid', limits: { documents: 20, bytes: 20000000, recipients: 20 } } });
    if (path === '/api/hestia/inbox') return json({ pendingCount: 0, messages: [], attachments: [], receptionAvailable: true });
    if (path === '/api/hestia/capture') return json({ captures: [] });
    if (path === '/api/hestia/me/recovery-codes') return json({ count: 5 });
    if (path === '/api/hestia/agenda/members') return json({ members: [{ id: 'camille', name: 'Camille' }, { id: 'alex', name: 'Alex' }] });
    if (path === '/api/hestia/agenda/available-documents') return json({ documents: [], nextOffset: null });
    if (path === '/api/hestia/agenda' && method === 'GET') return json({ cards: server ? [server] : [], total: server ? 1 : 0, filteredTotal: server ? 1 : 0, categories: [], nextOffset: null, day: url.searchParams.get('day'), today: '2026-10-24', householdTimeZone: 'Europe/Paris' });
    if (path === '/api/hestia/agenda' && method === 'POST' || path === `/api/hestia/agenda/${cardId}` && method === 'PATCH') {
      const input = req.postDataJSON() as AgendaMutationInput; writes.push(input);
      server = { ...fixture(), ...input, id: cardId, revision: (server?.revision ?? 0) + 1, documents: [], reminders: [] };
      return json({ card: server, operation: { requestId: input.requestId, status: 'committed', cardId, revision: server.revision } });
    }
    if (path === `/api/hestia/agenda/${cardId}` && method === 'GET') return server ? json({ card: server }) : json({ error: { code: 'NOT_FOUND', message: 'Fiche indisponible.' } }, 404);
    if (path === '/api/hestia/transcriptions') {
      expect(req.headers()['x-hestia-expected-actor']).toBe('camille');
      const existing = url.searchParams.has('agendaCardId');
      expect([...url.searchParams.keys()].sort()).toEqual(['agendaFormSessionId', 'field', ...(existing ? ['agendaCardId', 'baseRevision'] : []), ...(method === 'POST' ? ['idempotencyKey'] : [])].sort());
      const session = url.searchParams.get('agendaFormSessionId')!; expect(session).toMatch(/^[0-9a-f-]{36}$/); sessions.push(session);
      if (existing) expect(url.searchParams.get('agendaCardId')).toBe(cardId);
      if (method === 'GET') return json({ enabled: options.unavailable !== 'disabled', available: !options.unavailable, reason: options.unavailable,
        maxDurationMs: 120000, maxAudioBytes: 4194304, mediaTypes: ['audio/wav'], vocabularySupported: false });
      expect(method).toBe('POST'); expect(req.headers()['content-type']).toBe('audio/wav');
      const body = req.postDataBuffer()!; bodies.push(body); expect(body.subarray(0, 4).toString()).toBe('RIFF'); expect(body.length).toBeGreaterThan(44); posts++;
      const field = url.searchParams.get('field'), revision = existing ? Number(url.searchParams.get('baseRevision')) : null;
      const result = { status: 'complete', transcriptionId: randomUUID(), text: options.text ?? (field === 'title' ? 'et rendez-vous\nsynthétique' : 'Premier paragraphe.\n\nDeuxième paragraphe.'),
        agenda: { formSessionId: session, field, cardId: existing ? cardId : null, baseRevision: revision, revision } };
      return options.transport ? options.transport(route, result, posts) : json(result);
    }
    return route.fallback();
  });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Dossiers', exact: true })).toBeVisible();
  return { writes, bodies, sessions, posts: () => posts, card: () => server, change: (patch: Partial<AgendaCard>) => { if (server) server = { ...server, ...patch }; } };
}
async function open(page: Page, isMobile: boolean, existing = false) {
  await page.getByRole('navigation', { name: isMobile ? 'Navigation principale mobile' : 'Navigation principale', exact: true }).getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('tab', { name: 'Liste', exact: true }).click();
  if (existing) { await page.getByRole('button', { name: /Sortie synthétique/ }).click(); await page.getByRole('button', { name: 'Modifier', exact: true }).click(); }
  else await page.getByRole('button', { name: 'Nouvelle fiche', exact: true }).click();
  await expect(page.getByRole('heading', { name: existing ? 'Modifier la fiche' : 'Nouvelle fiche', exact: true })).toBeVisible();
}
const title = (page: Page) => page.getByRole('textbox', { name: 'Titre', exact: true });
const description = (page: Page) => page.getByRole('textbox', { name: 'Description (facultative)', exact: true });
const footer = (page: Page) => page.getByRole('region', { name: 'Actions de la fiche', exact: true });
const pending = (page: Page, field: 'title' | 'description') => page.getByRole('group', { name: `Texte dicté pour ${field === 'title' ? 'le titre' : 'la description'}, pas encore ajouté`, exact: true });
async function listen(page: Page, field: 'title' | 'description') {
  await page.getByRole('button', { name: field === 'title' ? /^Dicter (?:la suite du titre|le titre)$/ : /^Dicter (?:la suite de la description|la description)$/ }).click();
  await expect(page.getByRole('group', { name: /^Dictée en cours pour/ })).toBeVisible();
}
async function stop(page: Page) {
  // Stimulus duration for the real AudioWorklet, never a latency assertion.
  await page.waitForTimeout(350); await page.getByRole('button', { name: 'Arrêter et transcrire', exact: true }).click();
}
async function aligned(a: Locator, b: Locator) {
  const aa = await a.boundingBox(), bb = await b.boundingBox(); expect(aa).not.toBeNull(); expect(bb).not.toBeNull();
  expect(Math.abs(aa!.y - bb!.y)).toBeLessThanOrEqual(1); expect(Math.abs(aa!.height - bb!.height)).toBeLessThanOrEqual(1);
}

test('Titre et Description : ajout ciblé, paragraphes, focus ailleurs et aucune persistance avant Enregistrer', async ({ page, isMobile }) => {
  const f = await setup(page); await open(page, isMobile);
  await title(page).fill('Idée'); await description(page).fill('Texte conservé');
  await listen(page, 'title'); await description(page).focus(); await stop(page);
  await expect(title(page)).toHaveValue('Idée et rendez-vous synthétique'); await expect(description(page)).toHaveValue('Texte conservé');
  await listen(page, 'description'); await title(page).focus(); await stop(page);
  await expect(description(page)).toHaveValue('Texte conservé\nPremier paragraphe.\n\nDeuxième paragraphe.');
  expect(f.posts()).toBe(2); expect(f.writes).toHaveLength(0); expect(f.card()).toBeNull(); expect(new Set(f.sessions).size).toBe(1);
  await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Idée et rendez-vous synthétique', exact: true })).toBeVisible();
  expect(f.writes).toHaveLength(1); expect(f.writes[0]).toMatchObject({ title: 'Idée et rendez-vous synthétique', description: 'Texte conservé\nPremier paragraphe.\n\nDeuxième paragraphe.' });
  expect(Object.keys(f.writes[0])).not.toContain('audio');
});

test('Saisie pendant écoute et transcription : arbitrage, résumé focus, ajout explicite et retrait prudent', async ({ page, isMobile }) => {
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const f = await setup(page, { transport: async (route, result) => { await held; await route.fulfill({ headers: actorHeaders, json: result }); } });
  try {
    await open(page, isMobile); await title(page).fill('Avant'); await listen(page, 'title'); await title(page).fill('Pendant écoute');
    await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const summary = page.getByText('Dictée à terminer avant d’enregistrer', { exact: true }); await expect(summary).toBeFocused(); expect(f.writes).toHaveLength(0);
    await stop(page); await expect.poll(f.posts).toBe(1); await title(page).fill('Pendant transcription'); release();
    const proposal = pending(page, 'title'); await expect(proposal).toBeVisible(); await expect(title(page)).toHaveValue('Pendant transcription');
    await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(summary).toBeFocused(); expect(f.writes).toHaveLength(0);
    await proposal.getByLabel('Texte dicté pour le titre', { exact: true }).fill('résultat corrigé'); await proposal.getByRole('button', { name: 'Ajouter à la fin du titre', exact: true }).click();
    await expect(title(page)).toHaveValue('Pendant transcription résultat corrigé'); await expect(summary).toHaveCount(0);
    await page.getByRole('button', { name: 'Retirer le texte dicté', exact: true }).click(); await expect(title(page)).toHaveValue('Pendant transcription');
    await listen(page, 'title'); await stop(page); await expect(title(page)).toHaveValue('Pendant transcription et rendez-vous synthétique');
    await title(page).fill('Correction après ajout conservée'); await expect(page.getByRole('button', { name: 'Retirer le texte dicté', exact: true })).toHaveCount(0);
    await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Correction après ajout conservée', exact: true })).toBeVisible();
  } finally { release(); }
});

test('Limite titre Unicode et caractère interdit : résultat entier corrigible, aucun écrasement ni troncature', async ({ page, isMobile }) => {
  const f = await setup(page, { text: '🪁'.repeat(201) + '\u0007' }); await open(page, isMobile);
  await title(page).fill('🪁'.repeat(199)); await listen(page, 'title'); await stop(page);
  const proposal = pending(page, 'title'); await expect(proposal.getByLabel('Texte dicté pour le titre', { exact: true })).toHaveValue('🪁'.repeat(201) + '\u0007');
  await expect(proposal.getByRole('button', { name: 'Ajouter à la fin du titre', exact: true })).toBeDisabled(); await expect(title(page)).toHaveValue('🪁'.repeat(199));
  await title(page).fill('Titre court'); await proposal.getByLabel('Texte dicté pour le titre', { exact: true }).fill('\u0007');
  await expect(proposal.getByText('Caractère non accepté. Corrigez le texte avant de l’ajouter.', { exact: true })).toBeVisible();
  await proposal.getByRole('button', { name: 'Ne pas utiliser', exact: true }).click(); await expect(proposal).toHaveCount(0);
  await title(page).fill('🪁'.repeat(201)); await expect(page.getByText(/201 \/ 200 caractères/)).toBeVisible();
  await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click(); expect(f.writes).toHaveLength(0); await expect(title(page)).toHaveValue('🪁'.repeat(201));
});

test('Description limite 20 000 : proposition complète, correction explicite et abandon du résultat', async ({ page, isMobile }) => {
  const f = await setup(page, { text: 'é'.repeat(20001) }); await open(page, isMobile); await title(page).fill('Idée conservée');
  await description(page).fill('é'.repeat(19999)); await listen(page, 'description'); await stop(page);
  const proposal = pending(page, 'description'); await expect(proposal.getByLabel('Texte dicté pour la description', { exact: true })).toHaveValue('é'.repeat(20001));
  await expect(proposal.getByRole('button', { name: 'Ajouter à la fin de la description', exact: true })).toBeDisabled(); await expect(description(page)).toHaveValue('é'.repeat(19999));
  await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click(); expect(f.writes).toHaveLength(0);
  await proposal.getByRole('button', { name: 'Ne pas utiliser', exact: true }).click(); await expect(page.getByText('Dictée à terminer avant d’enregistrer', { exact: true })).toHaveCount(0);
  await description(page).fill('é'.repeat(20000)); await footer(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Idée conservée', exact: true })).toBeVisible(); expect([...f.writes[0].description]).toHaveLength(20000);
});

test('Annuler une fiche clavier modifiée confirme ; Continuer conserve ; fiche propre quitte directement', async ({ page, isMobile }) => {
  const f = await setup(page); await open(page, isMobile); await title(page).fill('Clavier à conserver');
  await footer(page).getByRole('button', { name: 'Annuler', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Abandonner la nouvelle fiche ?', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Continuer la saisie', exact: true }).click(); await expect(title(page)).toHaveValue('Clavier à conserver');
  await footer(page).getByRole('button', { name: 'Annuler', exact: true }).click(); await dialog.getByRole('button', { name: 'Abandonner', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Nouvelle fiche', exact: true }).click();
  await footer(page).getByRole('button', { name: 'Annuler', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible(); expect(f.writes).toHaveLength(0);
});

test('Abandon pendant transcription interdit le résultat tardif dans une nouvelle session de fiche', async ({ page, isMobile }) => {
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const f = await setup(page, { transport: async (route, result) => { await held; await route.fulfill({ headers: actorHeaders, json: result }).catch(() => {}); } });
  try {
    await open(page, isMobile); await title(page).fill('À abandonner'); await listen(page, 'title'); await stop(page); await expect.poll(f.posts).toBe(1);
    await footer(page).getByRole('button', { name: 'Annuler', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Abandonner la nouvelle fiche ?', exact: true });
    await dialog.getByRole('button', { name: 'Continuer la saisie', exact: true }).click(); await expect(title(page)).toHaveValue('À abandonner'); await expect(page.getByText('Transcription en cours…', { exact: true })).toBeVisible();
    await footer(page).getByRole('button', { name: 'Annuler', exact: true }).click(); await dialog.getByRole('button', { name: 'Abandonner', exact: true }).click(); release();
    await page.getByRole('button', { name: 'Nouvelle fiche', exact: true }).click(); await expect(title(page)).toHaveValue(''); await expect(page.getByRole('group', { name: /Texte dicté pour/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticMic: { stopped: number } }).__syntheticMic.stopped)).toBe(1);
    expect(f.writes).toHaveLength(0); expect(new Set(f.sessions).size).toBe(2);
  } finally { release(); }
});

for (const unavailable of ['denied', 'disabled', 'budget'] as const) test(`Micro/service ${unavailable} : clavier conservé, aucun POST ni sauvegarde`, async ({ page, isMobile }) => {
  const f = await setup(page, { denied: unavailable === 'denied', unavailable: unavailable === 'denied' ? undefined : unavailable });
  await open(page, isMobile); await title(page).fill('Texte clavier conservé');
  if (unavailable === 'denied') { await page.getByRole('button', { name: 'Dicter la suite du titre', exact: true }).click(); await expect(page.getByRole('alert').getByText('Microphone non autorisé.', { exact: true })).toBeVisible(); }
  else await expect(page.getByText(unavailable === 'disabled' ? 'La dictée n’est pas activée pour le foyer. Vous pouvez écrire.' : 'Plafond mensuel de la dictée atteint. Vous pouvez écrire.').first()).toBeVisible();
  await expect(title(page)).toHaveValue('Texte clavier conservé'); expect(f.posts()).toBe(0); expect(f.writes).toHaveLength(0);
});

for (const change of ['archive', 'revision', 'manage'] as const) test(`Fiche modifiée : ${change} arrête la dictée et écarte le résultat tardif`, async ({ page, isMobile }) => {
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const f = await setup(page, { existing: true, transport: async (route, result) => { await held; await route.fulfill({ headers: actorHeaders, json: result }).catch(() => {}); } });
  try {
    await open(page, isMobile, true); await listen(page, 'title'); await stop(page); await expect.poll(f.posts).toBe(1);
    f.change(change === 'archive' ? { archived: true, revision: 2 } : change === 'revision' ? { revision: 2, title: 'Autre appareil' } : { canManage: false });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    if (change === 'revision') { await expect(page.getByText('Fiche modifiée sur un autre appareil.', { exact: true })).toBeVisible(); await expect(title(page)).toHaveValue('Sortie synthétique'); }
    else await expect(page.getByRole('heading', { name: 'Fiche indisponible', exact: true })).toBeVisible();
    release(); await expect(page.getByText('Transcription en cours…', { exact: true })).toHaveCount(0); await expect(page.getByRole('group', { name: /Texte dicté pour/ })).toHaveCount(0); expect(f.writes).toHaveLength(0);
  } finally { release(); }
});

test('Dates et actions : alignement, aide commune, 320/390/768/1280, défilement du dernier rappel', async ({ page, isMobile }) => {
  await setup(page); await open(page, isMobile); await title(page).fill('Géométrie synthétique'); await page.getByLabel('Début', { exact: true }).fill('2027-04-05');
  await page.getByLabel('Date de fin', { exact: true }).fill('2027-04-06'); await page.getByRole('button', { name: 'Ajouter un rappel', exact: true }).click();
  for (const width of isMobile ? [320, 390] : [768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const end = page.getByLabel('Date de fin', { exact: true }), endTime = page.getByLabel('Heure de fin', { exact: true });
    await end.scrollIntoViewIfNeeded(); await expect(page.getByText('Pour plusieurs jours ; incluse.', { exact: true })).toBeVisible();
    const endBox = await end.boundingBox(), timeBox = await endTime.boundingBox(); expect(endBox).not.toBeNull(); expect(timeBox).not.toBeNull();
    if (Math.abs(endBox!.x - timeBox!.x) > 2) await aligned(end, endTime); else expect(timeBox!.y).toBeGreaterThanOrEqual(endBox!.y + endBox!.height);
    const cancel = footer(page).getByRole('button', { name: 'Annuler', exact: true }), save = footer(page).getByRole('button', { name: 'Enregistrer', exact: true });
    await save.scrollIntoViewIfNeeded(); await aligned(cancel, save); const c = await cancel.boundingBox(), s = await save.boundingBox(); expect(Math.abs(c!.width - s!.width)).toBeLessThanOrEqual(1);
    const last = page.getByRole('button', { name: 'Retirer ce rappel', exact: true }); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
    const lastBox = await last.boundingBox(), stickyBox = await footer(page).boundingBox(); expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(stickyBox!.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`agenda-form-${width}.png`), fullPage: true });
  }
});

test('Réduction visualViewport synthétique : actions accessibles au-dessus du clavier simulé', async ({ page, isMobile }) => {
  await setup(page); await open(page, isMobile); await page.setViewportSize({ width: 390, height: 844 });
  await title(page).fill('Clavier synthétique'); await description(page).focus();
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 420 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await expect(page.locator('.h-root')).toHaveAttribute('data-agenda-keyboard', '');
  const save = footer(page).getByRole('button', { name: 'Enregistrer', exact: true }); await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport();
  const actions = await footer(page).boundingBox(); expect(actions!.y + actions!.height).toBeLessThanOrEqual(421);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
