import type { TranscriptionAvailabilityDto, TranscriptionResultDto } from '../../shared/transcription-contract';
import { appendOutgoingDictation, normalizeOutgoingDictation, outgoingFieldName, outgoingTextProblem, type OutgoingDictationField as Field } from '../../shared/outgoing-dictation';
import { OutgoingClient, outgoingLocked } from './outgoing-client';
import type { DictationRecorder } from './dictation-recorder';

type Notice = { title: string; text: string; tone?: 'info' | 'warning'; retry?: boolean };
type Pending = { text: string; reason: string };
type Active = { field: Field; phase: 'permission' | 'listening' | 'transcribing'; elapsed: number };
type Identity = { epoch: number; draftId: string | null };
type Session = Identity & { field: Field; revision: number; text: string; version: number; controller: AbortController; recorder: Pick<DictationRecorder, 'start' | 'stop' | 'cancel'> | null };
export type OutgoingDictationSnapshot = { active: Active | null; pending: Partial<Record<Field, Pending>>; notices: Partial<Record<Field, Notice>>;
  appended: { field: Field; before: string; after: string } | null; availability: TranscriptionAvailabilityDto | null; compatible: boolean; announcement: string };
type Dependencies = { recorder: () => Promise<Pick<DictationRecorder, 'start' | 'stop' | 'cancel'>>; compatible: () => Promise<boolean>; fetch: typeof fetch };
const defaults: Dependencies = { recorder: async () => { const { DictationRecorder } = await import('./dictation-recorder'); return new DictationRecorder(); },
  compatible: async () => (await import('./dictation-recorder')).supportsDictation(), fetch: (...args) => fetch(...args) };
const empty = (): OutgoingDictationSnapshot => ({ active: null, pending: {}, notices: {}, appended: null, availability: null, compatible: true, announcement: '' });

/** Owns a view lifetime, never an audio queue. A result belongs to one actor,
 * preparation and field; ordinary saves can advance the draft revision. */
export class OutgoingDictationClient {
  private state = empty();
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  private identity: Identity;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private availabilityWork?: AbortController;
  private availabilitySource: string | null = null;
  constructor(private outgoing: OutgoingClient, private deps: Dependencies = defaults) { this.identity = outgoing.dictationIdentity(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<OutgoingDictationSnapshot>) {
    this.state = { ...this.state, ...patch }; this.outgoing.setDictationPending(this.blockingErrors().length > 0); this.listeners.forEach(listener => listener());
  }
  private notice(field: Field, value: Notice) { this.update({ notices: { ...this.state.notices, [field]: value }, announcement: value.title }); }
  connect() {
    this.identity = this.outgoing.dictationIdentity(); this.unsubscribe = this.outgoing.subscribe(() => this.synchronize());
    void this.deps.compatible().then(compatible => { if (this.unsubscribe) this.update({ compatible }); });
    this.synchronize();
    return () => { this.unsubscribe?.(); this.unsubscribe = undefined; this.availabilityWork?.abort(); this.availabilitySource = null; this.cancel(false); this.update(empty()); };
  }
  private synchronize() {
    const next = this.outgoing.dictationIdentity(), composition = this.outgoing.getSnapshot();
    const replaced = this.identity.draftId !== null && next.draftId !== this.identity.draftId;
    const unavailable = composition.step !== 'edit' || composition.ambiguous || !!composition.server?.draft && composition.server.draft.state !== 'editable' || ['preparing', 'sending'].includes(composition.operation?.state ?? '');
    if (next.epoch !== this.identity.epoch || replaced || unavailable) {
      const field = this.session?.field; this.cancel(false); this.update({ pending: {}, appended: null, notices: {}, ...(next.epoch !== this.identity.epoch ? { availability: null } : {}) });
      if (field) this.notice(field, { title: 'Dictée arrêtée.', text: 'La préparation a changé ou n’est plus disponible. Le résultat est écarté.' });
    }
    this.identity = next;
    if (next.draftId !== this.availabilitySource) {
      this.availabilityWork?.abort(); this.availabilitySource = next.draftId;
      if (next.draftId && !unavailable) { const controller = new AbortController(); this.availabilityWork = controller; void this.availability(next.draftId, 'subject', controller.signal).catch(() => {}); }
    }
  }
  private source(draftId: string, field: Field) { return `outgoingDraftId=${encodeURIComponent(draftId)}&field=${field}`; }
  private async availability(draftId: string, field: Field, signal: AbortSignal) {
    const response = await this.deps.fetch(`/api/hestia/transcriptions?${this.source(draftId, field)}`, { signal, credentials: 'same-origin', cache: 'no-store', headers: { 'X-Hestia-Activity': 'passive' } });
    const result = await response.json(); signal.throwIfAborted();
    if ([401, 403].includes(response.status)) { this.outgoing.loseDictationAccess(); throw new DOMException('Accès perdu', 'AbortError'); }
    if (!response.ok) throw new Error('Dictée momentanément indisponible. Vous pouvez écrire.');
    this.update({ availability: result as TranscriptionAvailabilityDto }); return result as TranscriptionAvailabilityDto;
  }
  reason() {
    if (!this.state.compatible) return 'La dictée n’est pas possible avec ce navigateur. Vous pouvez écrire.';
    const value = this.state.availability;
    if (!value || value.available) return null;
    return value.reason === 'disabled' ? 'La dictée n’est pas activée pour le foyer. Vous pouvez écrire.' : value.reason === 'model-unavailable' ? 'Le modèle de dictée est indisponible pour le moment. Vous pouvez écrire.' : value.reason === 'budget' ? 'Plafond mensuel de la dictée atteint. Vous pouvez écrire.' : 'Dictée momentanément indisponible. Vous pouvez écrire.';
  }
  blockingErrors() {
    const errors = this.state.active ? [`Une dictée est en cours pour ${outgoingFieldName[this.state.active.field]} : terminez-la ou annulez-la.`] : [];
    for (const field of ['subject', 'message'] as Field[]) if (this.state.pending[field]) errors.push(`Un texte dicté attend votre choix pour ${outgoingFieldName[field]} : ajoutez-le ou ne l’utilisez pas.`);
    return errors;
  }
  async start(field: Field) {
    if (this.session || this.state.pending[field] || this.reason() || outgoingLocked(this.outgoing.getSnapshot()) || this.outgoing.getSnapshot().step !== 'edit') return;
    const identity = this.outgoing.dictationIdentity(), local = this.outgoing.getSnapshot().local;
    const session: Session = { ...identity, field, revision: 0, text: local[field], version: identity.versions[field], controller: new AbortController(), recorder: null };
    this.session = session; this.update({ active: { field, phase: 'permission', elapsed: 0 }, notices: { ...this.state.notices, [field]: undefined }, announcement: 'Autorisation du microphone demandée.' });
    try {
      const prepared = await this.outgoing.prepareDictation(); session.controller.signal.throwIfAborted();
      session.draftId = prepared.draftId; session.revision = prepared.revision;
      const availability = await this.availability(prepared.draftId, field, session.controller.signal);
      if (!availability.available) { this.cancel(false); return; }
      session.recorder = await this.deps.recorder(); session.controller.signal.throwIfAborted();
      await session.recorder.start(session.controller.signal, () => { void this.stop(true); }); session.controller.signal.throwIfAborted();
      this.update({ active: { field, phase: 'listening', elapsed: 0 }, announcement: `Écoute pour ${outgoingFieldName[field]}. Utilisez « Arrêter et transcrire » pour terminer.` });
      const began = Date.now();
      this.timer = setInterval(() => {
        if (this.session !== session || this.state.active?.phase !== 'listening') return;
        const elapsed = Math.min(120, Math.floor((Date.now() - began) / 1000));
        this.update({ active: { field, phase: 'listening', elapsed }, ...(elapsed === 105 ? { announcement: 'Encore 15 secondes d’enregistrement.' } : {}) });
        if (elapsed >= 120) void this.stop(true);
      }, 1000);
    } catch (error) {
      session.recorder?.cancel();
      if (session.controller.signal.aborted || this.session !== session) return;
      this.cancel(false);
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.notice(field, { tone: 'warning', title: denied ? 'Microphone non autorisé.' : session.revision ? 'Dictée impossible.' : 'Préparation indisponible.',
        text: denied ? 'Autorisez le microphone pour Hestia dans les réglages du navigateur, puis réessayez. Vous pouvez aussi écrire.' : 'La dictée n’a pas pu démarrer. Votre texte est intact ; vous pouvez écrire au clavier.', retry: true });
    }
  }
  cancel(show = true, interrupted = false) {
    const session = this.session, phase = this.state.active?.phase;
    this.session = null; clearInterval(this.timer); this.timer = undefined; session?.controller.abort(); session?.recorder?.cancel(); this.update({ active: null });
    if (interrupted) this.update({ pending: {}, appended: null });
    if (session && show) this.notice(session.field, { title: interrupted ? 'Dictée arrêtée.' : phase === 'transcribing' ? 'Résultat écarté.' : 'Dictée annulée.', text: phase === 'transcribing' ? 'Il ne sera pas ajouté. L’enregistrement avait déjà été transmis : il peut compter dans le plafond du foyer.' : 'Rien n’a été transmis ; l’enregistrement est abandonné.' });
  }
  async stop(limit = false) {
    const session = this.session;
    if (!session?.recorder || this.state.active?.phase !== 'listening' || !session.draftId) return;
    clearInterval(this.timer); this.update({ active: { ...this.state.active, phase: 'transcribing' }, announcement: limit ? 'Limite de 2 minutes atteinte. Transcription demandée.' : 'Enregistrement arrêté. Transcription demandée.' });
    if (limit) this.notice(session.field, { title: 'Limite atteinte.', text: 'L’enregistrement s’est arrêté à 2 minutes ; la transcription est demandée.' });
    const signal = session.controller.signal;
    try {
      let audio: Blob | null = await session.recorder.stop(); signal.throwIfAborted();
      const response = await this.deps.fetch(`/api/hestia/transcriptions?${this.source(session.draftId, session.field)}&baseRevision=${session.revision}&idempotencyKey=${crypto.randomUUID()}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'audio/wav', 'X-Hestia-Activity': 'interactive' }, signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), body: audio }); audio = null;
      const result = await response.json() as TranscriptionResultDto & { outgoing?: { draftId: string; field: Field; baseRevision: number; revision: number }; error?: { code?: string } }; signal.throwIfAborted();
      if (this.session !== session) return;
      if ([401, 403].includes(response.status)) { this.outgoing.loseDictationAccess(); return; }
      if (!response.ok || result.status !== 'complete') {
        const budget = /BUDGET|LIMIT/.test(result.error?.code ?? '');
        if (budget) this.update({ availability: { ...this.state.availability!, available: false, reason: 'budget' } });
        this.notice(session.field, { tone: 'warning', title: budget ? 'Plafond de la dictée atteint.' : 'Transcription impossible.', text: 'La transcription n’a pas abouti et l’enregistrement n’est pas conservé. Votre texte est intact. Vous pouvez écrire au clavier.', retry: !budget }); return;
      }
      const binding = result.outgoing, identity = this.outgoing.dictationIdentity();
      if (!binding || binding.draftId !== session.draftId || binding.field !== session.field || binding.baseRevision !== session.revision || !Number.isSafeInteger(binding.revision) || binding.revision < session.revision || identity.epoch !== session.epoch || identity.draftId !== session.draftId) { this.notice(session.field, { title: 'Résultat écarté.', text: 'La préparation a changé ou n’est plus disponible. Le résultat ne sera pas ajouté.' }); return; }
      if (!result.text?.trim()) { this.notice(session.field, { title: 'Aucun texte reconnu.', text: 'Rien n’a été ajouté. Dictez à nouveau plus près du microphone, ou écrivez.', retry: true }); return; }
      const field = session.field, text = normalizeOutgoingDictation(field, result.text), current = this.outgoing.getSnapshot();
      const after = appendOutgoingDictation(field, current.local[field], text), problem = outgoingTextProblem(field, after);
      const edited = current.local[field] !== session.text || identity.versions[field] !== session.version;
      if (!edited && !problem && !outgoingLocked(current) && current.save !== 'conflict') this.append(field, after);
      else {
        const reason = edited ? `Vous avez modifié ${outgoingFieldName[field]} pendant la dictée : rien n’a été remplacé.` : problem ? `Ajouté tel quel, le texte ne respecte pas les limites ou caractères acceptés. Corrigez-le ci-dessous, ou ne l’utilisez pas.` : 'La préparation a changé. Relisez-la avant d’ajouter le texte dicté.';
        this.update({ pending: { ...this.state.pending, [field]: { text, reason } }, announcement: `Texte dicté prêt pour ${outgoingFieldName[field]}, pas encore ajouté.` });
      }
    } catch {
      if (!signal.aborted && this.session === session) this.notice(session.field, { tone: 'warning', title: 'Transcription impossible.', text: 'La transcription n’a pas abouti et l’enregistrement n’est pas conservé. Votre texte est intact. Dictez à nouveau ou écrivez.', retry: true });
    } finally { session.recorder.cancel(); if (this.session === session) { this.session = null; this.update({ active: null }); } }
  }
  private append(field: Field, after: string) {
    const before = this.outgoing.getSnapshot().local[field]; this.outgoing.edit({ [field]: after });
    this.update({ pending: { ...this.state.pending, [field]: undefined }, appended: { field, before, after }, announcement: `Texte dicté ajouté à la fin ${field === 'subject' ? 'de l’objet' : 'du message'}. Relisez-le avant de vérifier l’envoi.` });
  }
  editPending(field: Field, text: string) { const pending = this.state.pending[field]; if (pending) this.update({ pending: { ...this.state.pending, [field]: { ...pending, text } } }); }
  addPending(field: Field) {
    const pending = this.state.pending[field], current = this.outgoing.getSnapshot();
    if (!pending || outgoingLocked(current) || current.save === 'conflict') return;
    const after = appendOutgoingDictation(field, current.local[field], pending.text);
    if (!pending.text.trim() || outgoingTextProblem(field, after)) return;
    this.append(field, after);
  }
  dropPending(field: Field) { this.update({ pending: { ...this.state.pending, [field]: undefined }, announcement: 'Texte dicté écarté.' }); }
  undo(field: Field) {
    const appended = this.state.appended, current = this.outgoing.getSnapshot();
    if (appended?.field !== field || current.local[field] !== appended.after || outgoingLocked(current)) return;
    this.outgoing.edit({ [field]: appended.before }); this.update({ appended: null, announcement: 'Texte dicté retiré.' });
  }
}
