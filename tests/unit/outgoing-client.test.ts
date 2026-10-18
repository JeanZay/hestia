import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTGOING_LIMITS, type OutgoingAttachmentDto, type OutgoingAvailableDocument, type OutgoingDraftDto, type OutgoingStateDto } from '../../src/shared/outgoing-contract';
import { OutgoingClient, outgoingTotal, outgoingValidation } from '../../src/components/hestia/outgoing-client';

const clients: OutgoingClient[] = [];
const service = { configured: true, reason: null, sender: { name: 'Hestia', email: 'envois@example.com' }, replyTo: 'camille@example.com', limits: OUTGOING_LIMITS } as const;
const attachment = (documentId = 'doc-a'): OutgoingAttachmentDto => ({ id: `row-${documentId}`, documentId, documentVersion: 1, revisionId: 'revision-a', title: 'Attestation', fileName: 'same.pdf', path: 'Maison', mediaType: 'application/pdf', size: 400000, state: 'ok' });
const draft = (revision = 1): OutgoingDraftDto => ({ id: 'draft-a', revision, state: 'editable', to: ['jeanne@example.com'], subject: 'Documents du vélo', message: '', attachments: [attachment()] });
const state = (value: OutgoingDraftDto | null = draft()): OutgoingStateDto => ({ draft: value, service });
const response = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function create() { const client = new OutgoingClient(); clients.push(client); client.start('actor-a', vi.fn()); await vi.waitFor(() => expect(client.getSnapshot().loading).toBe(false)); return client; }
afterEach(() => { for (const client of clients.splice(0)) client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('outgoing actor state and durable intent', () => {
  it('creates an absent draft with the empty JSON envelope required by the real HTTP handler', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST' && url === '/api/hestia/outgoing') {
        expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
        expect(init.body).toBe('{}');
        return response(state({ ...draft(), to: [], subject: '', attachments: [] }));
      }
      if (url.endsWith('/attachments')) return response({ draft: draft(2) });
      return response(state(null));
    }));
    const client = await create();
    expect(await client.add([{ documentId: 'doc-a', documentVersion: 1, revisionId: 'revision-a' }])).toBe(true);
    expect(calls.filter(call => call.init?.method === 'POST').map(call => call.url)).toEqual(['/api/hestia/outgoing', '/api/hestia/outgoing/draft-a/attachments']);
    expect(client.getSnapshot().local.attachmentIds).toEqual(['row-doc-a']);
  });
  it('clears private composition and ignores a late response whose transport ignored cancellation', async () => {
    const old = deferred<Response>(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++calls === 1 ? old.promise : response(state(null))));
    const client = new OutgoingClient(); clients.push(client); client.start('old-actor', vi.fn());
    client.clear(); client.start('new-actor', vi.fn());
    await vi.waitFor(() => expect(client.getSnapshot().loading).toBe(false));
    old.resolve(await response(state(draft()))); await old.promise; await new Promise(resolve => setTimeout(resolve, 0));
    expect(client.getSnapshot().server?.draft).toBeNull(); expect(client.getSnapshot().local.subject).toBe('');
  });
  it('keeps both local edits and the updated conflict when a third writer changes the presented revision', async () => {
    let serverRevision = 1; const patchBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)); patchBodies.push(body);
        if (patchBodies.length < 3) { serverRevision++; return response({ error: { code: 'VERSION_CONFLICT', message: 'Préparation modifiée.' } }, 409); }
        return response({ draft: { ...draft(++serverRevision), subject: body.subject } });
      }
      return response(state(draft(serverRevision)));
    }));
    const client = await create(); client.edit({ subject: 'Ma version locale' });
    expect(await client.save()).toBe(false); expect(client.getSnapshot().conflictRevision).toBe(2);
    await client.keepMine(); expect(client.getSnapshot().save).toBe('conflict'); expect(client.getSnapshot().conflictAgain).toBe(true);
    expect(client.getSnapshot().local.subject).toBe('Ma version locale'); expect(client.getSnapshot().conflictRevision).toBe(3);
    await client.keepMine(); expect(client.getSnapshot().save).toBe('saved');
    expect(patchBodies.map(body => body.revision)).toEqual([1, 2, 3]); expect(patchBodies.every(body => !('force' in body))).toBe(true);
  });
  it('does not replay an ambiguous send or accept a double click as another intention', async () => {
    const send = deferred<Response>(); const sendBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/check')) return response({ draft: draft(), recap: { token: 'confirmation', expiresAt: new Date(Date.now() + 60000).toISOString(), sender: service.sender, replyTo: service.replyTo, to: draft().to, subject: draft().subject, message: '', attachments: [attachment()], totalBytes: 400000 } });
      if (url.endsWith('/send')) { sendBodies.push(JSON.parse(String(init?.body))); return send.promise; }
      return response(state());
    }));
    const client = await create(); await client.check(); const first = client.send(); await client.send();
    expect(sendBodies).toHaveLength(1); expect(sendBodies[0].requestId).toBeTruthy();
    send.reject(new Error('Connection interrupted after request')); await first;
    expect(client.getSnapshot().ambiguous).toBe(true); await client.send(); expect(sendBodies).toHaveLength(1);
  });
  it('invalidates a recap immediately when a fresh rights projection removes private attachment metadata', async () => {
    let hidden = false;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/check')) return response({ draft: draft(), recap: { token: 'confirmation', expiresAt: new Date(Date.now() + 60000).toISOString(), sender: service.sender, replyTo: service.replyTo, to: draft().to, subject: draft().subject, message: '', attachments: [attachment()], totalBytes: 400000 } });
      return response(state(hidden ? { ...draft(), attachments: [{ id: 'row-doc-a', state: 'unavailable' }] } : draft()));
    }));
    const client = await create(); await client.check(); expect(client.getSnapshot().recap).not.toBeNull(); hidden = true; await client.load(true);
    expect(client.getSnapshot().recap).toBeNull(); expect(client.getSnapshot().step).toBe('edit'); expect(client.getSnapshot().server?.draft?.attachments).toEqual([{ id: 'row-doc-a', state: 'unavailable' }]);
  });
  it('keeps distinct document IDs when attachments have the same original filename', async () => {
    let selected: unknown;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/attachments')) { selected = JSON.parse(String(init?.body)).selections; return response({ draft: { ...draft(2), attachments: [attachment('doc-a'), attachment('doc-b')] } }); }
      return response(state());
    }));
    const client = await create();
    await client.add([{ documentId: 'doc-a', documentVersion: 1, revisionId: 'revision-a' }, { documentId: 'doc-b', documentVersion: 1, revisionId: 'revision-b' }]);
    expect(selected).toEqual([{ documentId: 'doc-a', documentVersion: 1, revisionId: 'revision-a' }, { documentId: 'doc-b', documentVersion: 1, revisionId: 'revision-b' }]);
    expect(client.getSnapshot().server?.draft?.attachments).toHaveLength(2);
  });
  it('uses the selected immutable size and enforces the exact raw boundary without leaking unavailable metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response(state()))); const client = await create();
    const selected: OutgoingAttachmentDto = { ...attachment() as OutgoingAvailableDocument & { id: string }, state: 'replaced', current: { documentVersion: 2, revisionId: 'revision-b', title: 'Nouvelle version', fileName: 'larger.pdf', size: 9000000 } };
    expect(outgoingTotal([selected, { id: 'hidden', state: 'unavailable' }])).toBe(400000);
    const value = client.getSnapshot(); value.server!.draft!.attachments = [{ ...selected, state: 'ok', size: OUTGOING_LIMITS.rawBytes }];
    expect(outgoingValidation(value)).toEqual([]); value.server!.draft!.attachments[0] = { ...selected, state: 'ok', size: OUTGOING_LIMITS.rawBytes + 1 };
    expect(outgoingValidation(value).some(error => error.includes('20 Mio'))).toBe(true);
  });
  it('does not overwrite a new local composition when a passive read repeats a known refusal', async () => {
    const failed = { ...draft(), operation: { id: 'failed-operation', state: 'failed' as const, code: 'quota' as const } };
    vi.stubGlobal('fetch', vi.fn(() => response(state(failed))));
    const client = await create(); client.edit({ subject: 'Nouvelle intention locale' }); await client.load(true);
    expect(client.getSnapshot().local.subject).toBe('Nouvelle intention locale'); expect(client.getSnapshot().dirty).toBe(true);
  });
  it('reloads the current server version and ignores an operation response predating new local edits', async () => {
    const stale = deferred<Response>(); let serverRevision = 1;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/operations/') ? stale.promise : response(state({ ...draft(serverRevision), subject: `Serveur ${serverRevision}` }))));
    const client = await create(); const previous = client.readOperation('old-operation');
    client.edit({ subject: 'Version locale ultérieure' });
    stale.resolve(await response({ operation: { id: 'old-operation', state: 'accepted', code: null }, draft: null })); await previous;
    expect(client.getSnapshot().local.subject).toBe('Version locale ultérieure'); expect(client.getSnapshot().step).toBe('edit');
    serverRevision = 4; await client.useServer();
    expect(client.getSnapshot().local.subject).toBe('Serveur 4'); expect(client.getSnapshot().server?.draft?.revision).toBe(4);
  });
});
