import type { TranscriptionAvailabilityDto, TranscriptionResultDto } from '../../shared/transcription-contract';
import { agendaFieldName, agendaTextProblem, appendAgendaDictation, normalizeAgendaDictation, type AgendaDictationField as Field } from '../../shared/agenda-dictation';
import type { DictationRecorder } from './dictation-recorder';

export type AgendaVoiceContext = { actorId: string; formSessionId: string; cardId: string | null; revision: number | null;
  values: Record<Field, string>; versions: Record<Field, number>; editable: boolean; locked: boolean };
type Host = { read: () => AgendaVoiceContext; edit: (field: Field, text: string) => void; accessLost: () => void };
type Notice = { title: string; text: string; tone?: 'info' | 'warning'; retry?: boolean };
type Pending = { text: string; reason: string };
type Active = { field: Field; phase: 'permission' | 'listening' | 'transcribing'; elapsed: number };
type Session = { context: AgendaVoiceContext; field: Field; controller: AbortController; recorder: Pick<DictationRecorder, 'start' | 'stop' | 'cancel'> | null };
export type AgendaVoiceSnapshot = { active: Active | null; pending: Partial<Record<Field, Pending>>; notices: Partial<Record<Field, Notice>>;
  appended: { field: Field; before: string; after: string } | null; availability: TranscriptionAvailabilityDto | null; compatible: boolean; announcement: string };
type Dependencies = { recorder: () => Promise<Pick<DictationRecorder, 'start' | 'stop' | 'cancel'>>; compatible: () => Promise<boolean>; fetch: typeof fetch };
const defaults: Dependencies = { recorder: async () => { const { DictationRecorder } = await import('./dictation-recorder'); return new DictationRecorder(); },
  compatible: async () => (await import('./dictation-recorder')).supportsDictation(), fetch: (...args) => fetch(...args) };
const empty = (): AgendaVoiceSnapshot => ({ active: null, pending: {}, notices: {}, appended: null, availability: null, compatible: true, announcement: '' });
const same = (a: AgendaVoiceContext, b: AgendaVoiceContext) => a.actorId === b.actorId && a.formSessionId === b.formSessionId && a.cardId === b.cardId && a.revision === b.revision;

/** An ephemeral form session, never an Agenda save or a durable audio queue. */
export class AgendaDictationClient {
  private state = empty(); private listeners = new Set<() => void>(); private session: Session | null = null;
  private lifetime: AgendaVoiceContext | null = null; private timer?: ReturnType<typeof setInterval>;
  private availabilityWork?: AbortController; private connected = false;
  constructor(private host: Host = { read: () => { throw new Error('Formulaire indisponible'); }, edit: () => {}, accessLost: () => {} }, private deps: Dependencies = defaults) {}
  bindHost(host: Host) { this.host = host; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<AgendaVoiceSnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private notice(field: Field, value: Notice) { this.update({ notices: { ...this.state.notices, [field]: value }, announcement: value.title }); }
  connect() {
    this.connected = true;
    void this.deps.compatible().then(compatible => { if (this.connected) this.update({ compatible }); }).catch(() => { if (this.connected) this.update({ compatible: false }); });
    this.synchronize();
    return () => { this.connected = false; this.reset(); };
  }
  synchronize() {
    const current = this.host.read(), changed = !this.lifetime || !same(current, this.lifetime);
    if (changed || current.editable !== this.lifetime?.editable) {
      const interrupted = this.session, transmitted = this.state.active?.phase === 'transcribing';
      this.availabilityWork?.abort(); this.cancel(false, true); this.update({ availability: null, notices: {} });
      this.lifetime = current;
      if (interrupted && !changed) this.notice(interrupted.field, { title: 'Dictée arrêtée.', text: transmitted ? 'La fiche a changé ou n’est plus disponible. Le résultat est écarté ; l’audio déjà transmis peut compter dans le plafond du foyer.' : 'La fiche a changé ou n’est plus disponible. Rien n’a été transmis ; l’enregistrement est abandonné.' });
      if (current.editable) { const work = new AbortController(); this.availabilityWork = work; void this.availability(current, 'title', work.signal).catch(() => {}); }
    }
  }
  reset() { this.availabilityWork?.abort(); this.availabilityWork = undefined; this.lifetime = null; this.cancel(false, true); this.update(empty()); }
  private valid(session: Session) { const now = this.host.read(); return this.connected && this.session === session && !session.controller.signal.aborted && now.editable && same(now, session.context); }
  private retain(session: Session) { if (this.valid(session)) return true; session.recorder?.cancel(); if (this.session === session) this.cancel(true, true); return false; }
  private source(context: AgendaVoiceContext, field: Field) {
    const params = new URLSearchParams({ agendaFormSessionId: context.formSessionId, field });
    if (context.cardId) { params.set('agendaCardId', context.cardId); params.set('baseRevision', String(context.revision)); }
    return params;
  }
  private headers(context: AgendaVoiceContext, interactive: boolean) { return { 'X-Hestia-Expected-Actor': encodeURIComponent(context.actorId), 'X-Hestia-Activity': interactive ? 'interactive' : 'passive' }; }
  private actor(response: Response, context: AgendaVoiceContext) {
    let actor: string | null = null; try { const value = response.headers.get('X-Hestia-Actor'); actor = value === null ? null : decodeURIComponent(value); } catch {}
    if (response.status === 401 || actor !== null && actor !== context.actorId || response.ok && actor === null) { this.reset(); this.host.accessLost(); throw new DOMException('Accès perdu', 'AbortError'); }
  }
  private async availability(context: AgendaVoiceContext, field: Field, signal: AbortSignal) {
    const response = await this.deps.fetch(`/api/hestia/transcriptions?${this.source(context, field)}`, { signal, credentials: 'same-origin', cache: 'no-store', headers: this.headers(context, false) });
    const value = await response.json(); signal.throwIfAborted();
    if (!same(this.host.read(), context) || !this.host.read().editable) throw new DOMException('Formulaire remplacé', 'AbortError');
    this.actor(response, context);
    if (!response.ok) throw new Error('Dictée momentanément indisponible. Vous pouvez écrire.');
    this.update({ availability: value as TranscriptionAvailabilityDto }); return value as TranscriptionAvailabilityDto;
  }
  reason() {
    if (!this.state.compatible) return 'La dictée n’est pas possible avec ce navigateur. Vous pouvez écrire.';
    const value = this.state.availability; if (!value || value.available) return null;
    return value.reason === 'disabled' ? 'La dictée n’est pas activée pour le foyer. Vous pouvez écrire.' : value.reason === 'model-unavailable' ? 'Le modèle de dictée est indisponible pour le moment. Vous pouvez écrire.' : value.reason === 'budget' ? 'Plafond mensuel de la dictée atteint. Vous pouvez écrire.' : 'Dictée momentanément indisponible. Vous pouvez écrire.';
  }
  blockingErrors() {
    const errors = this.state.active ? [`Une dictée est en cours pour ${agendaFieldName[this.state.active.field]} : terminez-la ou annulez-la.`] : [];
    for (const field of ['title', 'description'] as Field[]) if (this.state.pending[field]) errors.push(`Un texte dicté attend votre choix pour ${agendaFieldName[field]} : ajoutez-le ou ne l’utilisez pas.`);
    return errors;
  }
  async start(field: Field) {
    const context = this.host.read();
    if (!this.connected || this.session || this.state.pending[field] || this.reason() || !context.editable || context.locked) return;
    const session: Session = { context: structuredClone(context), field, controller: new AbortController(), recorder: null };
    this.session = session; this.update({ active: { field, phase: 'permission', elapsed: 0 }, notices: { ...this.state.notices, [field]: undefined }, announcement: 'Autorisation du microphone demandée.' });
    try {
      const available = await this.availability(context, field, session.controller.signal);
      if (!this.retain(session)) return;
      if (!available.available) { this.cancel(false); return; }
      session.recorder = await this.deps.recorder(); session.controller.signal.throwIfAborted();
      if (!this.retain(session)) return;
      await session.recorder.start(session.controller.signal, () => { void this.stop(true); }); session.controller.signal.throwIfAborted();
      if (!this.retain(session)) return;
      this.update({ active: { field, phase: 'listening', elapsed: 0 }, announcement: `Écoute pour ${agendaFieldName[field]}. Utilisez « Arrêter et transcrire » pour terminer.` });
      const began = Date.now();
      this.timer = setInterval(() => {
        if (!this.retain(session) || this.state.active?.phase !== 'listening') return;
        const elapsed = Math.min(120, Math.floor((Date.now() - began) / 1000));
        this.update({ active: { field, phase: 'listening', elapsed }, ...(elapsed === 105 ? { announcement: 'Encore 15 secondes d’enregistrement.' } : {}) });
        if (elapsed >= 120) void this.stop(true);
      }, 1000);
    } catch (error) {
      session.recorder?.cancel(); if (session.controller.signal.aborted || this.session !== session) return;
      this.cancel(false); const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.notice(field, { tone: 'warning', title: denied ? 'Microphone non autorisé.' : 'Dictée impossible.', text: denied ? 'Autorisez le microphone pour Hestia dans les réglages du navigateur, puis réessayez. Vous pouvez aussi écrire.' : 'La dictée n’a pas pu démarrer. Votre texte est intact ; vous pouvez écrire au clavier.', retry: true });
    }
  }
  cancel(show = true, interrupted = false) {
    const session = this.session, phase = this.state.active?.phase; this.session = null;
    clearInterval(this.timer); this.timer = undefined; session?.controller.abort(); session?.recorder?.cancel();
    this.update({ active: null, ...(interrupted ? { pending: {}, appended: null } : {}) });
    if (session && show) this.notice(session.field, { title: interrupted ? 'Dictée arrêtée.' : phase === 'transcribing' ? 'Résultat écarté.' : 'Dictée annulée.', text: phase === 'transcribing' ? 'Il ne sera pas ajouté. L’enregistrement avait déjà été transmis : il peut compter dans le plafond du foyer.' : 'Rien n’a été transmis ; l’enregistrement est abandonné.' });
  }
  async stop(limit = false) {
    const session = this.session; if (!session?.recorder || this.state.active?.phase !== 'listening') return;
    if (!this.valid(session) || this.host.read().locked) { this.cancel(true, true); return; }
    clearInterval(this.timer); this.update({ active: { ...this.state.active, phase: 'transcribing' }, announcement: limit ? 'Limite de 2 minutes atteinte. Transcription demandée.' : 'Transcription demandée.' });
    const signal = session.controller.signal;
    try {
      let audio: Blob | null = await session.recorder.stop(); signal.throwIfAborted();
      if (!this.valid(session)) return;
      const params = this.source(session.context, session.field); params.set('idempotencyKey', crypto.randomUUID());
      const response = await this.deps.fetch(`/api/hestia/transcriptions?${params}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { ...this.headers(session.context, true), 'Content-Type': 'audio/wav' }, signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), body: audio }); audio = null;
      const result = await response.json() as TranscriptionResultDto & { error?: { code?: string } }; signal.throwIfAborted();
      if (!this.valid(session)) return;
      this.actor(response, session.context);
      if (!response.ok || result.status !== 'complete') {
        const budget = /BUDGET|LIMIT/.test(result.error?.code ?? '');
        if (budget && this.state.availability) this.update({ availability: { ...this.state.availability, available: false, reason: 'budget' } });
        this.notice(session.field, { tone: 'warning', title: budget ? 'Plafond de la dictée atteint.' : 'Transcription impossible.', text: 'La transcription n’a pas abouti et l’enregistrement n’est pas conservé. Votre texte est intact. Vous pouvez écrire au clavier.', retry: !budget }); return;
      }
      const binding = result.agenda, context = session.context;
      if (!binding || binding.formSessionId !== context.formSessionId || binding.field !== session.field || binding.cardId !== context.cardId || binding.baseRevision !== context.revision || binding.revision !== context.revision) { this.notice(session.field, { title: 'Résultat écarté.', text: 'La fiche a changé ou n’est plus disponible. Le résultat ne sera pas ajouté.' }); return; }
      if (!result.text?.trim()) { this.notice(session.field, { title: 'Aucun texte reconnu.', text: 'Rien n’a été ajouté. Dictez à nouveau plus près du microphone, ou écrivez.', retry: true }); return; }
      const field = session.field, text = normalizeAgendaDictation(field, result.text), current = this.host.read(), after = appendAgendaDictation(field, current.values[field], text), problem = agendaTextProblem(field, after);
      const edited = current.values[field] !== context.values[field] || current.versions[field] !== context.versions[field];
      if (!edited && !problem && !current.locked) this.append(field, after);
      else this.update({ pending: { ...this.state.pending, [field]: { text, reason: edited ? `Vous avez modifié ${agendaFieldName[field]} pendant la dictée : rien n’a été remplacé.` : problem ? 'Ajouté tel quel, le texte ne respecte pas les limites ou caractères acceptés. Corrigez-le ci-dessous, ou ne l’utilisez pas.' : 'La fiche a changé. Relisez-la avant d’ajouter le texte dicté.' } }, announcement: `Texte dicté prêt pour ${agendaFieldName[field]}, pas encore ajouté.` });
    } catch { if (!signal.aborted && this.valid(session)) this.notice(session.field, { tone: 'warning', title: 'Transcription impossible.', text: 'Votre texte est intact et l’enregistrement n’est pas conservé. Dictez à nouveau ou écrivez.', retry: true }); }
    finally { session.recorder.cancel(); if (this.session === session) { this.session = null; this.update({ active: null }); } }
  }
  private append(field: Field, after: string) { const before = this.host.read().values[field]; this.host.edit(field, after); this.update({ pending: { ...this.state.pending, [field]: undefined }, appended: { field, before, after }, announcement: `Texte dicté ajouté à la fin ${field === 'title' ? 'du titre' : 'de la description'}. Relisez-le ; rien n’est enregistré.` }); }
  editPending(field: Field, text: string) { const pending = this.state.pending[field]; if (pending) this.update({ pending: { ...this.state.pending, [field]: { ...pending, text } } }); }
  addPending(field: Field) { const pending = this.state.pending[field], current = this.host.read(); if (!pending || !current.editable || current.locked || !this.lifetime || !same(current, this.lifetime)) return; const after = appendAgendaDictation(field, current.values[field], pending.text); if (pending.text.trim() && !agendaTextProblem(field, after)) this.append(field, after); }
  dropPending(field: Field) { this.update({ pending: { ...this.state.pending, [field]: undefined }, announcement: 'Texte dicté écarté.' }); }
  undo(field: Field) { const appended = this.state.appended, current = this.host.read(); if (appended?.field !== field || current.values[field] !== appended.after || current.locked || !current.editable || !this.lifetime || !same(current, this.lifetime)) return; this.host.edit(field, appended.before); this.update({ appended: null, announcement: 'Texte dicté retiré.' }); }
}
