import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTGOING_LIMITS, type OutgoingDraftDto } from '../../src/shared/outgoing-contract';
import { OutgoingClient } from '../../src/components/hestia/outgoing-client';
import { OutgoingDictationClient } from '../../src/components/hestia/outgoing-dictation-client';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const availability = { enabled: true, available: true, maxDurationMs: 120000, maxAudioBytes: 4194304, mediaTypes: ['audio/wav'], vocabularySupported: false };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fixture(options: { empty?: boolean; text?: string; held?: ReturnType<typeof deferred<Response>>; denied?: boolean; status?: number; code?: string } = {}) {
  let draft: OutgoingDraftDto | null = options.empty ? null : { id: '10000000-0000-4000-8000-000000000001', revision: 1, state: 'editable', to: ['synthetic@example.com'], subject: 'Objet clavier', message: 'Message clavier', attachments: [] };
  const service = { configured: false, reason: 'not-configured', sender: { name: 'Hestia', email: null }, replyTo: 'synthetic@example.com', limits: OUTGOING_LIMITS };
  const calls: { url: string; init?: RequestInit }[] = [];
  let posts = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes('/transcriptions')) {
      if (init?.method !== 'POST') return response(availability);
      posts++;
      if (options.held) return options.held.promise;
      const params = new URL(url, 'http://synthetic.invalid').searchParams;
      return response(options.status ? { error: { code: options.code } } : { status: 'complete', transcriptionId: 'synthetic', text: options.text ?? 'texte dicté', outgoing: { draftId: params.get('outgoingDraftId'), field: params.get('field'), baseRevision: Number(params.get('baseRevision')), revision: draft?.revision ?? 1 } }, options.status ?? 200);
    }
    if (init?.method === 'POST') { draft = { id: '10000000-0000-4000-8000-000000000001', revision: 1, state: 'editable', to: [], subject: '', message: '', attachments: [] }; }
    if (init?.method === 'PATCH' && draft) { const body = JSON.parse(String(init.body)); draft = { ...draft, ...body, revision: draft.revision + 1 }; return response({ draft }); }
    if (init?.method === 'DELETE') { draft = null; return response({ draft }); }
    return response({ draft, service });
  });
  vi.stubGlobal('fetch', fetcher);
  const outgoing = new OutgoingClient(); outgoing.start('actor-a', vi.fn());
  await vi.waitFor(() => expect(outgoing.getSnapshot().loading).toBe(false));
  const recorder = { start: vi.fn(async () => { if (options.denied) throw new DOMException('refus synthétique', 'NotAllowedError'); }), stop: vi.fn(async () => new Blob(['audio-synthétique'], { type: 'audio/wav' })), cancel: vi.fn() };
  const voice = new OutgoingDictationClient(outgoing, { recorder: async () => recorder, compatible: async () => true, fetch: fetcher });
  const disconnect = voice.connect(); cleanups.push(() => { disconnect(); outgoing.clear(); });
  const complete = (text = 'réponse tardive', field = 'subject') => response({ status: 'complete', text, outgoing: { draftId: '10000000-0000-4000-8000-000000000001', field, baseRevision: 1, revision: draft?.revision ?? 1 } });
  return { outgoing, voice, recorder, calls, posts: () => posts, complete, draft: () => draft, replace: (value: OutgoingDraftDto | null) => { draft = value; } };
}

describe('outgoing dictation view lifetime and arbitration', () => {
  it('creates a real absent draft only on the explicit microphone gesture and posts only audio', async () => {
    const f = await fixture({ empty: true }); expect(f.calls.some(call => call.init?.method === 'POST')).toBe(false);
    await f.voice.start('message'); await f.voice.stop();
    expect(f.outgoing.getSnapshot().local.message).toBe('texte dicté');
    const post = f.calls.find(call => call.url.includes('/transcriptions') && call.init?.method === 'POST')!;
    const params = new URL(post.url, 'http://synthetic.invalid').searchParams;
    expect([...params.keys()].sort()).toEqual(['baseRevision', 'field', 'idempotencyKey', 'outgoingDraftId']);
    expect(params.get('field')).toBe('message'); expect(params.get('baseRevision')).toBe('1');
    expect(post.init?.body).toBeInstanceOf(Blob); expect(post.init?.headers).toMatchObject({ 'Content-Type': 'audio/wav' });
    expect(f.posts()).toBe(1); expect(f.recorder.cancel).toHaveBeenCalled();
  });
  it.each(['listening', 'transcribing'] as const)('keeps edits made during %s in a separate editable result and appends explicitly', async phase => {
    const held = deferred<Response>(), f = await fixture({ held });
    await f.voice.start('subject');
    if (phase === 'listening') f.outgoing.edit({ subject: 'Correction pendant écoute' });
    const task = f.voice.stop(); await vi.waitFor(() => expect(f.posts()).toBe(1));
    if (phase === 'transcribing') f.outgoing.edit({ subject: 'Correction pendant transcription' });
    const before = f.outgoing.getSnapshot().local.subject; held.resolve(f.complete()); await task;
    expect(f.outgoing.getSnapshot().local.subject).toBe(before); expect(f.voice.getSnapshot().pending.subject?.text).toBe('réponse tardive');
    f.voice.editPending('subject', 'résultat corrigé'); f.voice.addPending('subject');
    expect(f.outgoing.getSnapshot().local.subject).toBe(before + ' résultat corrigé'); expect(f.voice.blockingErrors()).toEqual([]);
    f.voice.undo('subject'); expect(f.outgoing.getSnapshot().local.subject).toBe(before);
  });
  it('does not discard a result solely because autosave advanced the revision, and keeps its original field', async () => {
    const held = deferred<Response>(), f = await fixture({ held });
    await f.voice.start('subject'); const task = f.voice.stop(); await vi.waitFor(() => expect(f.posts()).toBe(1));
    f.outgoing.edit({ message: 'Modification de l’autre champ' }); await f.outgoing.save();
    held.resolve(f.complete()); await task;
    expect(f.outgoing.getSnapshot().local.subject).toBe('Objet clavier réponse tardive');
    expect(f.outgoing.getSnapshot().local.message).toBe('Modification de l’autre champ');
    f.outgoing.edit({ subject: 'Correction après ajout' }); f.voice.undo('subject'); expect(f.outgoing.getSnapshot().local.subject).toBe('Correction après ajout');
  });
  it.each(['clear', 'fresh', 'abandon', 'server', 'replace', 'lock', 'background'] as const)('ignores a transport that resolves after %s, including a fresh preparation without unmount', async action => {
    const held = deferred<Response>(), f = await fixture({ held });
    await f.voice.start('subject'); const task = f.voice.stop(); await vi.waitFor(() => expect(f.posts()).toBe(1));
    if (action === 'clear') { f.outgoing.clear(); f.outgoing.start('new-actor', vi.fn()); }
    if (action === 'fresh') f.outgoing.fresh();
    if (action === 'abandon') await f.outgoing.abandon();
    if (action === 'server') await f.outgoing.useServer();
    if (action === 'replace') { f.replace({ ...f.draft()!, id: '20000000-0000-4000-8000-000000000002' }); await f.outgoing.load(true); }
    if (action === 'lock') { f.replace({ ...f.draft()!, state: 'uncertain' }); await f.outgoing.load(true); }
    if (action === 'background') f.voice.cancel(true, true);
    await vi.waitFor(() => expect(f.outgoing.getSnapshot().loading).toBe(false));
    const before = f.outgoing.getSnapshot().local.subject;
    held.resolve(f.complete()); await task;
    expect(f.outgoing.getSnapshot().local.subject).toBe(before); expect(f.voice.getSnapshot().pending).toEqual({}); expect(f.voice.getSnapshot().active).toBeNull();
  });
  it('holds over-limit and forbidden-control text without cutting and never starts another recording while active', async () => {
    const f = await fixture({ text: 'x'.repeat(201) + '\u0007' });
    await f.voice.start('subject'); await f.voice.start('message'); expect(f.recorder.start).toHaveBeenCalledTimes(1);
    expect(f.voice.blockingErrors()).toHaveLength(1); await f.outgoing.check(); expect(f.calls.some(call => call.url.endsWith('/check'))).toBe(false);
    await f.voice.stop(); expect(f.voice.getSnapshot().pending.subject?.text).toBe('x'.repeat(201) + '\u0007');
    f.voice.addPending('subject'); expect(f.outgoing.getSnapshot().local.subject).toBe('Objet clavier');
    f.voice.dropPending('subject'); expect(f.voice.blockingErrors()).toEqual([]);
  });
  it('requires exact response metadata and rejects a stale result instead of inserting it elsewhere', async () => {
    const held = deferred<Response>(), f = await fixture({ held });
    await f.voice.start('subject'); const task = f.voice.stop(); await vi.waitFor(() => expect(f.posts()).toBe(1));
    held.resolve(f.complete('mauvais champ', 'message')); await task;
    expect(f.outgoing.getSnapshot().local.subject).toBe('Objet clavier'); expect(f.outgoing.getSnapshot().local.message).toBe('Message clavier');
    expect(f.voice.getSnapshot().notices.subject?.title).toBe('Résultat écarté.');
  });
  it('detects a field edited and then restored during listening; editing another field does not retarget the result', async () => {
    const f = await fixture(); await f.voice.start('message');
    f.outgoing.edit({ message: 'Correction temporaire' }); f.outgoing.edit({ message: 'Message clavier' });
    await f.voice.stop(); expect(f.voice.getSnapshot().pending.message?.text).toBe('texte dicté');
    expect(f.outgoing.getSnapshot().local.message).toBe('Message clavier');
  });
  it('keeps the keyboard after denied microphone, and budget failure has no retry or automatic replay', async () => {
    const denied = await fixture({ denied: true }); await denied.voice.start('subject');
    expect(denied.voice.getSnapshot().notices.subject?.title).toBe('Microphone non autorisé.'); expect(denied.posts()).toBe(0);
    denied.outgoing.edit({ subject: 'Toujours au clavier' }); expect(denied.outgoing.getSnapshot().local.subject).toBe('Toujours au clavier');
    const budget = await fixture({ status: 429, code: 'TRANSCRIPTION_BUDGET' }); await budget.voice.start('message'); await budget.voice.stop();
    expect(budget.posts()).toBe(1); expect(budget.voice.getSnapshot().notices.message?.retry).toBe(false); expect(budget.voice.reason()).toContain('Plafond');
  });
});
