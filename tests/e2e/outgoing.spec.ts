import { expect, test, type Page } from '@playwright/test';
import { OUTGOING_LIMITS, type OutgoingAvailableDocument, type OutgoingDraftDto, type OutgoingSaveInput, type OutgoingSendInput, type OutgoingServiceDto } from '../../src/shared/outgoing-contract';
test.setTimeout(30000);

// Browser contract tests isolate the UI from the provider. SQL/S3 and the
// transmission races are exercised by outgoing.test.ts on the owned local bench.
const first: OutgoingAvailableDocument = { documentId: 'doc-one', documentVersion: 2, revisionId: 'rev-one', title: 'Attestation vélo', fileName: 'original.pdf', size: 1024, path: 'Maison › Assurance', mediaType: 'application/pdf' };
const second: OutgoingAvailableDocument = { documentId: 'doc-two', documentVersion: 1, revisionId: 'rev-two', title: 'Facture entretien', fileName: 'original.pdf', size: 2048, path: 'Mobilité', mediaType: 'application/pdf' };
const service: OutgoingServiceDto = { configured: true, reason: null, sender: { name: 'Hestia au nom de Camille', email: 'hestia@hestia.invalid' }, replyTo: 'camille@hestia.invalid', limits: OUTGOING_LIMITS };
const initialDraft = (): OutgoingDraftDto => ({ id: 'draft-one', revision: 1, state: 'editable', to: ['destinataire@example.com'], subject: 'Pièces synthétiques', message: 'Bonjour,\nVoici les documents.', attachments: [{ ...first, id: 'row-one', state: 'ok' }] });
const folder = { id: 'folder-one', name: 'Maison', version: 1, capabilities: ['consulter', 'exporter', 'modifier', 'déposer'], documentCount: 1, docCount: 1, visibleParentId: null, breadcrumbs: [{ id: 'folder-one', name: 'Maison' }], childCount: 0, canShare: false, canAdminister: false, createdAt: '2026-10-18T12:00:00Z', createdByName: 'Camille' };

async function setup(page: Page, options: { draft?: OutgoingDraftDto | null; outcome?: 'accepted' | 'uncertain' | 'lost'; configured?: boolean } = {}) {
  let draft = options.draft === undefined ? initialDraft() : options.draft;
  const sent: OutgoingSendInput[] = [], saved: OutgoingSaveInput[] = [];
  let checks = 0, adds = 0, deletes = 0, conflictCount = 0;
  const state = () => ({ draft, service: options.configured === false ? { ...service, configured: false, reason: 'not-configured' as const, sender: { ...service.sender, email: null } } : service });
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const conflict = () => json({ error: { code: 'VERSION_CONFLICT', message: 'La préparation a changé.' } }, 409);
    if (path === '/api/hestia/workspace') return json({ user: { id: 'camille', name: 'Camille', email: 'camille@hestia.invalid', role: 'owner' }, folders: [folder], selectedFolder: url.searchParams.has('folderId') ? folder : null, documents: url.searchParams.has('folderId') ? [{ id: first.documentId, folderId: folder.id, title: first.title, fileName: first.fileName, mediaType: first.mediaType, size: first.size, sha256: 'a'.repeat(64), createdAt: '2026-10-18T12:00:00Z', uploadedByName: 'Camille', source: 'capture', version: first.documentVersion, revisionId: first.revisionId, capabilities: folder.capabilities, previewSupported: false, summary: { status: 'ready', text: 'Attestation synthétique.' } }] : [], now: new Date().toISOString() });
    if (path === '/api/hestia/outgoing') {
      if (method === 'POST' && !draft) draft = { ...initialDraft(), to: [], subject: '', message: '', attachments: [] };
      return json(state());
    }
    if (path === '/api/hestia/outgoing/available') {
      const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase('fr');
      return json({ documents: [first, second].filter(row => `${row.title} ${row.path}`.toLocaleLowerCase('fr').includes(query)) });
    }
    if (path === '/api/hestia/outgoing/draft-one' && method === 'PATCH') {
      const input = req.postDataJSON() as OutgoingSaveInput; saved.push(input);
      if (conflictCount > 0 && draft) { conflictCount--; draft = { ...draft, revision: draft.revision + 1, subject: 'Version autre appareil' }; return conflict(); }
      if (!draft || input.revision !== draft.revision) return conflict();
      draft = { ...draft, ...input, attachments: draft.attachments.filter(row => input.attachmentIds.includes(row.id)), revision: draft.revision + 1 };
      return json({ draft });
    }
    if (path === '/api/hestia/outgoing/draft-one' && method === 'DELETE') {
      deletes++; if (!draft || req.postDataJSON().revision !== draft.revision || draft.state !== 'editable') return conflict();
      draft = null; return json({ draft });
    }
    if (path === '/api/hestia/outgoing/draft-one/attachments') {
      adds++; const input = req.postDataJSON(); if (!draft || input.revision !== draft.revision) return conflict();
      const rows = [...draft.attachments];
      for (const selection of input.selections) {
        const doc = [first, second].find(row => row.documentId === selection.documentId);
        if (doc && !rows.some(row => row.state !== 'unavailable' && row.documentId === doc.documentId)) rows.push({ ...doc, id: `row-${doc.documentId}`, state: 'ok' });
      }
      draft = { ...draft, attachments: rows, revision: draft.revision + 1 }; return json({ draft });
    }
    if (path.endsWith('/check')) {
      checks++; if (!draft || req.postDataJSON().revision !== draft.revision) return conflict();
      return json({ draft, recap: { token: 'opaque-server-confirmation', expiresAt: new Date(Date.now() + 300000).toISOString(), sender: service.sender, replyTo: service.replyTo, to: draft.to, subject: draft.subject, message: draft.message, attachments: draft.attachments.filter(row => row.state !== 'unavailable'), totalBytes: draft.attachments.reduce((sum, row) => sum + (row.state === 'unavailable' ? 0 : row.size), 0) } });
    }
    if (path.endsWith('/send')) {
      sent.push(req.postDataJSON() as OutgoingSendInput);
      const operation = { id: 'operation-one', state: options.outcome === 'accepted' || !options.outcome ? 'accepted' as const : 'uncertain' as const, code: null };
      if (operation.state === 'accepted') draft = null;
      else if (draft) draft = { ...draft, state: 'uncertain', operation };
      if (options.outcome === 'lost') return route.abort('failed');
      return json({ operation, draft });
    }
    if (path === '/api/hestia/outgoing/operations/operation-one') return json({ operation: { id: 'operation-one', state: 'uncertain', code: null }, draft });
    if (path === '/api/hestia/inbox') return json({ pendingCount: 1, messages: [], attachments: [], receptionAvailable: true });
    if (path === '/api/hestia/capture') return json({ captures: [] });
    if (path === '/api/hestia/transcriptions') return json({ enabled: false, available: false, reason: 'disabled' });
    if (path === '/api/hestia/me/recovery-codes') return json({ count: 5 });
    return json({});
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dossiers', exact: true })).toBeVisible();
  return { sent, saved, counts: () => ({ checks, adds, deletes }), draft: () => draft, conflictNext: (count = 1) => { conflictCount = count; } };
}

async function openOutgoing(page: Page, isMobile: boolean) {
  const nav = page.getByRole('navigation', { name: isMobile ? 'Navigation principale mobile' : 'Navigation principale', exact: true });
  await nav.getByRole('button', { name: isMobile ? /^Échanges/ : 'Envois', exact: !isMobile }).click();
  if (isMobile) { await expect(page.getByRole('heading', { name: 'Échanges', exact: true })).toBeVisible(); await page.getByRole('main').getByRole('button', { name: /Envois/ }).click(); }
  await expect(page.getByRole('heading', { name: 'Envois', exact: true })).toBeVisible();
}

test('Plusieurs dossiers et deux noms originaux identiques restent deux pièces dans le récapitulatif', async ({ page, isMobile }) => {
  const state = await setup(page); await openOutgoing(page, isMobile);
  await page.getByRole('textbox', { name: 'À', exact: true }).fill('autre@example.com');
  await page.getByRole('textbox', { name: 'À', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Ajouter des documents', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Filtrer par titre ou dossier' }).fill('Mobilité');
  await page.getByRole('checkbox', { name: /Facture entretien/ }).check();
  await page.getByRole('button', { name: /^Ajouter( 1 document)?$/ }).click();
  await expect(page.getByText('Facture entretien', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vérifier avant d’envoyer', exact: true })).toBeVisible();
  await expect(page.locator('.ho-recap-data')).toContainText('Facture entretien');
  expect((await page.locator('.ho-recap-data').innerText()).match(/original\.pdf/g)).toHaveLength(2);
  await expect(page.locator('.ho-recap-data')).toContainText('camille@hestia.invalid');
  expect(state.draft()?.attachments).toHaveLength(2); expect(state.draft()?.to).toEqual(['destinataire@example.com', 'autre@example.com']); expect(state.sent).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('outgoing-recap.png'), fullPage: true });
});

test('Une préparation enregistrée reprend après rechargement puis acceptation la vide sans historique', async ({ page, isMobile }) => {
  const state = await setup(page); await openOutgoing(page, isMobile);
  await page.getByRole('textbox', { name: 'Objet', exact: true }).fill('Nouvel objet synthétique');
  await expect.poll(() => state.saved.length).toBe(1);
  await page.reload(); await openOutgoing(page, isMobile);
  await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue('Nouvel objet synthétique');
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByText('Accepté pour envoi.', { exact: true }).first()).toBeVisible();
  expect(state.sent).toHaveLength(1); expect(state.sent[0]).toMatchObject({ confirmationToken: 'opaque-server-confirmation' });
  expect(state.sent[0].requestId).toMatch(/^[a-f0-9-]{36}$/); expect(state.draft()).toBeNull();
  await page.getByRole('button', { name: 'Préparer un nouvel email', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue('');
});

for (const outcome of ['uncertain', 'lost'] as const) test(`Issue ${outcome} : aucun second envoi ni abandon, même après rechargement`, async ({ page, isMobile }) => {
  const state = await setup(page, { outcome }); await openOutgoing(page, isMobile);
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByText('Résultat de l’envoi à vérifier', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Envoyer', exact: true })).toHaveCount(0);
  await page.reload(); await openOutgoing(page, isMobile);
  await expect(page.getByText('Résultat de l’envoi à vérifier', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toBeDisabled();
  expect(state.sent).toHaveLength(1); expect(state.counts().deletes).toBe(0);
});

test('Une pièce devenue interdite ne révèle aucune ancienne métadonnée et bloque le récapitulatif', async ({ page, isMobile }) => {
  const state = await setup(page, { draft: { ...initialDraft(), attachments: [{ id: 'opaque-row', state: 'unavailable' }] } }); await openOutgoing(page, isMobile);
  await expect(page.getByText('Attestation vélo', { exact: true })).toHaveCount(0);
  await expect(page.getByText('original.pdf', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(page.getByText('1 pièce jointe est à corriger.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vérifier avant d’envoyer', exact: true })).toHaveCount(0);
  expect(state.counts().checks).toBe(0);
});

test('Total supérieur à 20 Mio préserve la préparation et interdit la transmission', async ({ page, isMobile }) => {
  const state = await setup(page, { draft: { ...initialDraft(), attachments: [{ ...first, id: 'row-one', state: 'ok', size: OUTGOING_LIMITS.rawBytes + 1 }] } }); await openOutgoing(page, isMobile);
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(page.getByText(/Le total dépasse 20 Mio/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vérifier avant d’envoyer', exact: true })).toHaveCount(0);
  expect(state.counts().checks).toBe(0); expect(state.sent).toHaveLength(0); expect(state.draft()?.attachments).toHaveLength(1);
});

test('Un conflit de sauvegarde ne confirme pas une ancienne enveloppe', async ({ page, isMobile }) => {
  const state = await setup(page); await openOutgoing(page, isMobile); state.conflictNext();
  await page.getByRole('textbox', { name: 'Objet', exact: true }).fill('Modification locale conservée');
  await page.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(page.getByText('Préparation modifiée sur un autre appareil.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue('Modification locale conservée');
  await expect(page.getByRole('heading', { name: 'Vérifier avant d’envoyer', exact: true })).toHaveCount(0);
  expect(state.counts().checks).toBe(0); expect(state.sent).toHaveLength(0);
});

test('API réelle SQL/S3 : ajout depuis la fiche, reprise privée et refus certain du fournisseur local désactivé', async ({ page, browser, isMobile }) => {
  test.setTimeout(90000);
  test.skip(!process.env.HESTIA_TEST_RUN_ID, 'Requires the owned synthetic SQL/S3 browser bench');
  const { login } = await import('../qualification/comment-voice/helpers');
  const { readFile } = await import('node:fs/promises');
  const { createHash, randomUUID } = await import('node:crypto');
  await login(page);
  const headers = { origin: new URL(page.url()).origin }, suffix = randomUUID().slice(0, 8);
  const folderName = `Envois synthétiques ${suffix}`, title = `Attestation synthétique ${suffix}`;
  const created = await page.request.post('/api/hestia/folders', { headers, data: { name: folderName, idempotencyKey: randomUUID() } });
  expect(created.status()).toBe(201); const folderId = (await created.json()).folder.id;
  const bytes = await readFile('tests/fixtures/documents/synthetic.pdf');
  const upload = await page.request.post('/api/hestia/uploads', { headers, data: { folderId, idempotencyKey: randomUUID(), fileName: 'piece-originale.pdf', title, size: bytes.length, mediaType: 'application/pdf', sha256: createHash('sha256').update(bytes).digest('hex'), source: 'import' } });
  expect(upload.status()).toBe(201); const uploadId = (await upload.json()).operation.id;
  expect((await page.request.put(`/api/hestia/uploads/${uploadId}/chunks/0`, { headers: { ...headers, 'content-type': 'application/octet-stream' }, data: bytes })).status()).toBe(200);
  const completed = await page.request.post(`/api/hestia/uploads/${uploadId}/complete`, { headers, data: { keepDuplicate: true } });
  expect(completed.status()).toBe(200);
  // Business actions now use the real packaged browser and its HTTP handlers.
  await page.reload();
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${folderName}`) }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter à l’envoi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Déjà dans la préparation', exact: true })).toBeDisabled();
  await page.getByRole('complementary', { name: 'Document', exact: true }).getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir Envois', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Envois', exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'À', exact: true }).fill('destinataire@example.com');
  await page.getByRole('textbox', { name: 'À', exact: true }).press('Enter');
  await page.getByRole('textbox', { name: 'Objet', exact: true }).fill(`Objet durable ${suffix}`);
  await expect(page.getByText('Enregistrée dans Hestia', { exact: true })).toBeVisible();
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: await page.context().storageState() });
  try {
    const resumed = await other.newPage(); await resumed.goto('/'); await openOutgoing(resumed, false);
    await expect(resumed.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue(`Objet durable ${suffix}`);
    await expect(resumed.getByText(title, { exact: true })).toBeVisible();
    const persisted = await resumed.request.get('/api/hestia/outgoing'); expect(persisted.status()).toBe(200);
    expect((await persisted.json()).service.configured).toBe(false);
    await resumed.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
    await expect(resumed.getByRole('heading', { name: 'Vérifier avant d’envoyer', exact: true })).toBeVisible();
    await resumed.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(resumed.getByText('Le service d’envoi n’est pas configuré pour le foyer. Rien n’a été envoyé.', { exact: true })).toBeVisible();
    await expect(resumed.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue(`Objet durable ${suffix}`);
    await resumed.getByRole('button', { name: 'Abandonner la préparation', exact: true }).click();
    await resumed.getByRole('dialog').getByRole('button', { name: 'Abandonner', exact: true }).click();
    await expect(resumed.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue('');
  } finally { await other.close(); }
  await page.reload(); await openOutgoing(page, isMobile);
  await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue('');
});
