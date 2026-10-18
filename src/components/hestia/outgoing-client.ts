import type { OutgoingAttachmentDto, OutgoingAvailableDocument, OutgoingCheckDto, OutgoingDraftDto, OutgoingOperationDto, OutgoingRecapDto, OutgoingSelection, OutgoingSendDto, OutgoingStateDto } from '../../shared/outgoing-contract';
import { OUTGOING_LIMITS } from '../../shared/outgoing-contract';

export const OUTGOING_EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
export type OutgoingComposition = { to: string[]; subject: string; message: string; attachmentIds: string[] };
export type OutgoingSnapshot = { loading: boolean; failedLoad: boolean; server: OutgoingStateDto | null; local: OutgoingComposition;
  save: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'conflict'; busy: boolean; dirty: boolean;
  conflict: OutgoingDraftDto | null; conflictAgain: boolean; conflictRevision: number | null;
  step: 'edit' | 'recap' | 'accepted'; recap: OutgoingRecapDto | null; operation: OutgoingOperationDto | null;
  ambiguous: boolean; result: string | null; announcement: string; accepted: { subject: string; count: number } | null };
const emptyComposition = (): OutgoingComposition => ({ to: [], subject: '', message: '', attachmentIds: [] });
const initial = (): OutgoingSnapshot => ({ loading: true, failedLoad: false, server: null, local: emptyComposition(), save: 'idle', busy: false,
  dirty: false, conflict: null, conflictAgain: false, conflictRevision: null, step: 'edit', recap: null, operation: null,
  ambiguous: false, result: null, announcement: '', accepted: null });
const composition = (draft: OutgoingDraftDto | null): OutgoingComposition => draft ? { to: [...draft.to], subject: draft.subject, message: draft.message, attachmentIds: draft.attachments.map(row => row.id) } : emptyComposition();
export const outgoingLocked = (state: OutgoingSnapshot) => state.busy || state.ambiguous || state.operation?.state === 'preparing' || state.operation?.state === 'sending' || !!(state.server?.draft && state.server.draft.state !== 'editable');
export const outgoingAttachments = (state: OutgoingSnapshot) => (state.server?.draft?.attachments ?? []).filter(row => state.local.attachmentIds.includes(row.id));
export const outgoingTotal = (rows: OutgoingAttachmentDto[]) => rows.reduce((sum, row) => sum + (row.state === 'unavailable' ? 0 : row.size), 0);
export const outgoingSelection = (row: OutgoingAvailableDocument): OutgoingSelection => ({ documentId: row.documentId, documentVersion: row.documentVersion, revisionId: row.revisionId });
export const outgoingFailure = (code: string | null) => ({ 'not-configured': 'Le service d’envoi n’est pas configuré pour le foyer. Rien n’a été envoyé.', quota: 'La limite d’envoi du service est atteinte. Rien n’a été envoyé.', address: 'Une adresse a été refusée par le fournisseur. Corrigez-la avant de réessayer.', 'rights-or-version': 'Une pièce jointe n’est plus disponible ou sa version a changé. Vérifiez la préparation.', size: 'Les pièces jointes dépassent la limite du service. Retirez des documents.', integrity: 'L’intégrité d’une pièce jointe n’a pas pu être confirmée. Rien n’a été envoyé.', unavailable: 'Le service d’envoi est indisponible. Rien n’a été envoyé.', busy: 'Une demande est déjà en cours. Vérifiez son résultat.' }[code ?? ''] ?? 'L’envoi a été refusé avant acceptation. La préparation est conservée.');
export class OutgoingError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

/** Actor-scoped volatile state. Mutations are serialized and are never automatically replayed. */
export class OutgoingClient {
  private state = initial();
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private epoch = 0;
  private readGeneration = 0;
  private operationRead = 0;
  private edits = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private mutation = false;
  private saveTask: Promise<boolean> | null = null;
  private actor: string | null = null;
  private accessLost: () => void = () => {};
  private intention: { draftId: string; revision: number; token: string; requestId: string } | null = null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<OutgoingSnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  clear = () => {
    this.epoch++; this.readGeneration++; this.operationRead++; this.controller.abort(); this.controller = new AbortController();
    clearTimeout(this.timer); clearInterval(this.poll); this.actor = null; this.mutation = false; this.saveTask = null; this.intention = null; this.edits = 0;
    this.state = initial(); this.listeners.forEach(listener => listener());
  };
  start(actor: string, accessLost: () => void) {
    this.clear(); this.actor = actor; this.accessLost = accessLost; void this.load();
    this.poll = setInterval(() => { if (!this.mutation && !this.state.loading && !globalThis.document?.hidden) void this.load(true); }, 15000);
  }
  private async request<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
    const signal = this.controller.signal, epoch = this.epoch;
    const response = await fetch(`/api/hestia/outgoing${path}`, { method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Hestia-Activity': method === 'GET' ? 'passive' : 'interactive', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    signal.throwIfAborted(); if (epoch !== this.epoch) throw new DOMException('Obsolete request', 'AbortError');
    if (!response.ok) {
      if ([401, 403].includes(response.status)) { this.clear(); this.accessLost(); throw new DOMException('Access lost', 'AbortError'); }
      throw new OutgoingError(response.status, data?.error?.code || 'UNAVAILABLE', data?.error?.message || 'Impossible de joindre Hestia. Réessayez.');
    }
    return data as T;
  }
  private aborted(error: unknown, epoch: number) { return epoch !== this.epoch || error instanceof DOMException && error.name === 'AbortError'; }
  private adopt(draft: OutgoingDraftDto | null, keepLocal = false) {
    const server = this.state.server;
    if (!server) return;
    this.update({ server: { ...server, draft }, operation: draft?.operation ?? null,
      ...(keepLocal ? {} : { local: composition(draft), dirty: false, save: draft ? 'saved' as const : 'idle' as const }) });
  }
  async load(quiet = false) {
    if (!this.actor || this.mutation) return;
    const read = ++this.readGeneration, epoch = this.epoch;
    if (!quiet) this.update({ loading: true, failedLoad: false, result: null });
    try {
      const next = await this.request<OutgoingStateDto>();
      if (read !== this.readGeneration) return;
      const before = this.state.server?.draft;
      const changed = !!before && (before.id !== next.draft?.id || before.revision !== next.draft?.revision);
      const projectionChanged = !!before && JSON.stringify(before.attachments) !== JSON.stringify(next.draft?.attachments);
      const keep = this.state.dirty || this.state.save === 'conflict';
      this.update({ server: next, loading: false, failedLoad: false, operation: next.draft?.operation ?? this.state.operation,
        ...(keep ? {} : { local: composition(next.draft), save: next.draft ? 'saved' as const : 'idle' as const }),
        ...(projectionChanged || changed ? { recap: null, step: 'edit' as const } : {}) });
      if (changed && keep) this.update({ save: 'conflict', conflict: next.draft, conflictRevision: next.draft?.revision ?? null, recap: null, step: 'edit' });
      if (next.draft?.operation) {
        // A previously observed refusal must not discard a new local edit/conflict.
        if (keep && next.draft.operation.state === 'failed') this.update({ operation: next.draft.operation });
        else this.applyOperation({ operation: next.draft.operation, draft: next.draft });
        if (['preparing', 'sending', 'uncertain'].includes(next.draft.operation.state)) await this.readOperation(next.draft.operation.id);
      }
      else if (this.state.ambiguous && this.state.operation) await this.readOperation(this.state.operation.id);
    } catch (error) { if (!this.aborted(error, epoch) && !quiet) this.update({ loading: false, failedLoad: true, server: null, result: null }); }
  }
  edit(patch: Partial<OutgoingComposition>) {
    if (outgoingLocked(this.state)) return;
    this.edits++; this.operationRead++; this.intention = null;
    this.update({ local: { ...this.state.local, ...patch }, dirty: true, save: this.state.save === 'conflict' ? 'conflict' : 'pending', recap: null, step: 'edit', result: null });
    clearTimeout(this.timer);
    if (this.state.save !== 'conflict') this.timer = setTimeout(() => { void this.save(); }, 900);
  }
  private async ensureDraft() {
    if (this.state.server?.draft) return this.state.server.draft;
    const result = await this.request<OutgoingStateDto>('', 'POST', {});
    this.update({ server: result });
    if (!result.draft) throw new Error('Préparation indisponible.');
    return result.draft;
  }
  private async conflict(again: boolean) {
    const server = await this.request<OutgoingStateDto>();
    this.update({ server, save: 'conflict', dirty: true, conflict: server.draft, conflictRevision: server.draft?.revision ?? null,
      conflictAgain: again, step: 'edit', recap: null, announcement: again ? 'La version enregistrée a encore changé. Relisez-la, puis choisissez à nouveau.' : 'Préparation modifiée sur un autre appareil.' });
  }
  save(againstRevision?: number): Promise<boolean> {
    if (this.saveTask) return this.saveTask.then(() => this.state.save === 'conflict' ? false : this.save(againstRevision));
    const task = this.performSave(againstRevision); this.saveTask = task;
    return task.finally(() => { if (this.saveTask === task) this.saveTask = null; });
  }
  private async performSave(againstRevision?: number): Promise<boolean> {
    if (this.mutation || this.state.ambiguous || this.state.server?.draft?.state && this.state.server.draft.state !== 'editable') return false;
    if (this.state.save === 'conflict' && againstRevision === undefined) return false;
    if (!this.state.dirty && againstRevision === undefined && this.state.server?.draft?.operation?.state !== 'failed') return true;
    if (this.state.save === 'conflict' && !this.state.server?.draft) return false;
    clearTimeout(this.timer); this.mutation = true; ++this.readGeneration;
    const epoch = this.epoch, version = this.edits, local = this.state.local;
    this.update({ save: 'saving' });
    try {
      const draft = await this.ensureDraft();
      const result = await this.request<{ draft: OutgoingDraftDto }>(`/${encodeURIComponent(draft.id)}`, 'PATCH', { revision: againstRevision ?? draft.revision, ...local });
      const newer = version !== this.edits;
      this.adopt(result.draft, newer);
      this.update({ save: newer ? 'pending' : 'saved', dirty: newer, conflict: null, conflictRevision: null, conflictAgain: false, announcement: 'Préparation enregistrée dans Hestia.' });
      return !newer;
    } catch (error) {
      if (!this.aborted(error, epoch)) {
        if (error instanceof OutgoingError && error.status === 409 && error.code === 'VERSION_CONFLICT') await this.conflict(againstRevision !== undefined).catch(() => { this.update({ save: 'failed' }); });
        else this.update({ save: 'failed', result: error instanceof Error ? error.message : null, announcement: 'Préparation non enregistrée. Vos modifications restent ici.' });
      }
      return false;
    } finally { if (epoch === this.epoch) { this.mutation = false; if (this.state.dirty && this.state.save === 'pending') this.timer = setTimeout(() => { void this.save(); }, 900); } }
  }
  async useServer() {
    if (this.mutation) return;
    clearTimeout(this.timer); this.edits++; ++this.readGeneration; this.mutation = true;
    const epoch = this.epoch; this.update({ busy: true });
    try {
      const server = await this.request<OutgoingStateDto>();
      this.intention = null;
      this.update({ server, local: composition(server.draft), operation: server.draft?.operation ?? null, ambiguous: false,
        dirty: false, save: server.draft ? 'saved' : 'idle', conflictRevision: null, conflict: null, conflictAgain: false,
        result: null, recap: null, step: 'edit', announcement: 'Version enregistrée chargée.' });
    } catch (error) { if (!this.aborted(error, epoch)) this.update({ result: 'La version enregistrée n’a pas pu être chargée. Vos modifications restent ici.' }); }
    finally { if (epoch === this.epoch) { this.mutation = false; this.update({ busy: false }); } }
  }
  async keepMine() { if (this.state.conflictRevision !== null) await this.save(this.state.conflictRevision); }
  async available(query: string, signal: AbortSignal) {
    const result = await this.request<{ documents: OutgoingAvailableDocument[] }>(`/available?q=${encodeURIComponent(query)}`);
    signal.throwIfAborted(); return result.documents;
  }
  private async mutateDraft(path: (id: string) => string, method: string, body: (draft: OutgoingDraftDto) => unknown) {
    if (outgoingLocked(this.state) || this.state.save === 'conflict') return false;
    if (!await this.save()) return false;
    if (this.mutation) return false;
    this.mutation = true; ++this.readGeneration; this.update({ busy: true, result: null });
    const epoch = this.epoch; let reconcile = false;
    try {
      const draft = await this.ensureDraft();
      const result = await this.request<{ draft: OutgoingDraftDto | null }>(path(draft.id), method, body(draft));
      this.adopt(result.draft); this.intention = null; this.update({ announcement: method === 'DELETE' ? 'Préparation abandonnée.' : 'Préparation mise à jour.' }); return true;
    } catch (error) {
      if (!this.aborted(error, epoch)) {
        if (error instanceof OutgoingError && error.status === 409 && error.code === 'VERSION_CONFLICT') await this.conflict(false).catch(() => {});
        else { this.update({ result: error instanceof Error ? error.message : 'Action non confirmée.' }); reconcile = true; }
      }
      return false;
    } finally { if (epoch === this.epoch) { this.mutation = false; this.update({ busy: false }); if (reconcile) void this.load(true); } }
  }
  add(selections: OutgoingSelection[]) {
    const unique = [...new Map(selections.map(row => [row.documentId, row])).values()];
    return this.mutateDraft(id => `/${encodeURIComponent(id)}/attachments`, 'POST', draft => ({ revision: draft.revision, selections: unique }));
  }
  accept(row: OutgoingAttachmentDto) {
    if (row.state === 'unavailable' || !row.current) return Promise.resolve(false);
    const current = row.current;
    return this.mutateDraft(id => `/${encodeURIComponent(id)}/attachments/${encodeURIComponent(row.id)}/accept`, 'POST', draft => ({ revision: draft.revision, documentVersion: current.documentVersion, revisionId: current.revisionId }));
  }
  abandon() { return this.mutateDraft(id => `/${encodeURIComponent(id)}`, 'DELETE', draft => ({ revision: draft.revision })); }
  async check() {
    if (outgoingLocked(this.state) || this.state.save === 'conflict') return;
    if (!await this.save()) return;
    const draft = this.state.server?.draft; if (!draft || this.mutation) return;
    this.mutation = true; ++this.readGeneration; this.update({ busy: true, result: null }); const epoch = this.epoch; let reconcile = false;
    try {
      const result = await this.request<OutgoingCheckDto>(`/${encodeURIComponent(draft.id)}/check`, 'POST', { revision: draft.revision });
      this.adopt(result.draft); this.intention = null; this.update({ step: 'recap', recap: result.recap, announcement: 'Vérifiez avant d’envoyer.' });
    } catch (error) {
      if (!this.aborted(error, epoch)) {
        if (error instanceof OutgoingError && error.status === 409 && error.code === 'VERSION_CONFLICT') await this.conflict(false).catch(() => {});
        else { this.update({ result: error instanceof Error ? error.message : 'Vérification impossible.' }); reconcile = true; }
      }
    } finally { if (epoch === this.epoch) { this.mutation = false; this.update({ busy: false }); if (reconcile) void this.load(true); } }
  }
  back() { if (!outgoingLocked(this.state)) this.update({ step: 'edit', recap: null }); }
  fresh() { this.intention = null; this.update({ step: 'edit', accepted: null, operation: null, result: null, local: emptyComposition() }); void this.load(); }
  private applyOperation(result: OutgoingSendDto) {
    const { operation, draft } = result;
    if (operation.state === 'accepted') {
      const accepted = this.state.recap ? { subject: this.state.recap.subject, count: this.state.recap.to.length } : this.state.accepted;
      this.adopt(draft); this.update({ step: 'accepted', recap: null, operation, ambiguous: false, accepted, result: null, announcement: 'Accepté pour envoi.' }); this.intention = null;
    } else if (operation.state === 'failed') {
      this.adopt(draft); this.update({ step: 'edit', recap: null, operation, ambiguous: false, result: outgoingFailure(operation.code), announcement: 'Envoi refusé. La préparation est conservée.' }); this.intention = null;
    } else { this.adopt(draft); this.update({ operation, ambiguous: operation.state === 'uncertain', step: operation.state === 'uncertain' ? 'edit' : this.state.step, announcement: operation.state === 'uncertain' ? 'Résultat de l’envoi à vérifier.' : 'Transmission en cours.' }); }
  }
  async readOperation(id: string) {
    const operationRead = ++this.operationRead, generation = this.readGeneration;
    const result = await this.request<OutgoingSendDto>(`/operations/${encodeURIComponent(id)}`);
    if (operationRead !== this.operationRead || generation !== this.readGeneration) return;
    this.applyOperation(result);
  }
  async send() {
    const draft = this.state.server?.draft, recap = this.state.recap;
    if (!draft || !recap || outgoingLocked(this.state) || this.mutation) return;
    if (!this.intention) this.intention = { draftId: draft.id, revision: draft.revision, token: recap.token, requestId: crypto.randomUUID() };
    const intention = this.intention, epoch = this.epoch;
    this.mutation = true; ++this.readGeneration; this.update({ busy: true, result: null });
    try { this.applyOperation(await this.request<OutgoingSendDto>(`/${encodeURIComponent(intention.draftId)}/send`, 'POST', { revision: intention.revision, requestId: intention.requestId, confirmationToken: intention.token })); }
    catch (error) {
      if (!this.aborted(error, epoch)) {
        if (error instanceof OutgoingError && error.status < 500) { this.intention = null; this.update({ step: 'edit', recap: null, result: error.message }); }
        else this.update({ ambiguous: true, announcement: 'Résultat de l’envoi à vérifier. La préparation reste bloquée.' });
      }
    } finally { if (epoch === this.epoch) { this.mutation = false; this.update({ busy: false }); if (this.state.ambiguous || this.state.operation?.state === 'sending' || this.state.operation?.state === 'preparing') void this.load(true); } }
  }
}

export function outgoingValidation(state: OutgoingSnapshot) {
  const errors: string[] = [], rows = outgoingAttachments(state), local = state.local;
  if (!local.to.length) errors.push('Ajoutez au moins une adresse, par exemple nom@example.com.');
  const bad = local.to.filter(address => !OUTGOING_EMAIL.test(address));
  if (bad.length) errors.push(`Corrigez les adresses : ${bad.join(', ')}.`);
  if (local.to.length > OUTGOING_LIMITS.recipients) errors.push(`La limite est de ${OUTGOING_LIMITS.recipients} destinataires.`);
  if (!local.subject.trim()) errors.push('Indiquez un objet.');
  if (!rows.length) errors.push('Ajoutez au moins un document.');
  const invalid = rows.filter(row => row.state !== 'ok').length;
  if (invalid) errors.push(`${invalid} pièce${invalid > 1 ? 's jointes sont' : ' jointe est'} à corriger.`);
  if (outgoingTotal(rows) > OUTGOING_LIMITS.rawBytes) errors.push('Le total dépasse 20 Mio : retirez des documents. Hestia ne compresse ni ne fractionne les fichiers.');
  return errors;
}
