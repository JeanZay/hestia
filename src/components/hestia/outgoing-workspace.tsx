"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OutgoingAvailableDocument, OutgoingDraftDto } from '../../shared/outgoing-contract';
import { OUTGOING_LIMITS } from '../../shared/outgoing-contract';
import { Banner, Button, Checkbox, Dialog, EmptyState, Icon, TextArea, TextField } from './design-system';
import { AttachmentRow, fmtMio, mergeRecipients, OutgoingProgress, RecipientList, SizeMeter } from './outgoing-design';
import { OutgoingClient, OUTGOING_EMAIL, outgoingAttachments, outgoingLocked, outgoingSelection, outgoingTotal, outgoingValidation, type OutgoingSnapshot } from './outgoing-client';
import { OutgoingDictationClient } from './outgoing-dictation-client';
import { OutgoingDictation } from './outgoing-dictation';
import './outgoing.css';

function DocumentPicker({ client, state, onClose }: { client: OutgoingClient; state: OutgoingSnapshot; onClose: () => void }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState<OutgoingAvailableDocument[]>([]), [selected, setSelected] = useState<Map<string, OutgoingAvailableDocument>>(new Map());
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const title = useRef<HTMLElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setRows([]); setError('');
      void client.available(query, ac.signal).then(value => { if (!ac.signal.aborted) setRows(value); }).catch(reason => { if (!ac.signal.aborted) setError(reason instanceof Error ? reason.message : 'Chargement impossible.'); }).finally(() => { if (!ac.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [client, query]);
  const have = new Set(outgoingAttachments(state).flatMap(row => row.state === 'unavailable' ? [] : [row.documentId]));
  const groups = Map.groupBy(rows, row => row.path);
  const add = async () => { if (await client.add([...selected.values()].map(outgoingSelection))) onClose(); };
  return <div className="ho-picker" role="group" aria-labelledby="outgoing-picker-title"><strong id="outgoing-picker-title" ref={title} tabIndex={-1}>Choisir des documents</strong><span className="ho-muted">Seuls les documents que vous pouvez consulter et exporter sont proposés, dans leur version actuelle.</span><TextField label="Filtrer par titre ou dossier" type="search" value={query} onChange={event => setQuery(event.target.value)}/>
    {error && <Banner title="Chargement impossible." tone="danger">{error}</Banner>}{loading ? <span role="status">Chargement en cours…</span> : !rows.length ? query.trim() ? <span className="ho-muted">Aucun document ne correspond à « {query} ».</span> : <EmptyState icon="lock" title="Aucun document à envoyer">L’envoi par email demande de pouvoir consulter et exporter un document. Aucun de vos documents ne le permet pour l’instant.</EmptyState> : [...groups].map(([path, documents]) => <fieldset key={path}><legend>{path}</legend>{documents.map(row => <Checkbox key={row.documentId} label={row.title} description={`${have.has(row.documentId) ? 'Déjà dans la préparation · ' : ''}fichier « ${row.fileName} » · ${fmtMio(row.size)}`} checked={have.has(row.documentId) || selected.has(row.documentId)} disabled={outgoingLocked(state) || have.has(row.documentId)} onChange={checked => setSelected(before => { const next = new Map(before); if (checked) next.set(row.documentId, row); else next.delete(row.documentId); return next; })}/>)}</fieldset>)}
    <div className="h-actions"><Button compact disabled={!selected.size || outgoingLocked(state)} onClick={() => void add()}>{selected.size ? `Ajouter ${selected.size} document${selected.size > 1 ? 's' : ''}` : 'Ajouter'}</Button><Button variant="tertiary" compact disabled={state.busy} onClick={onClose}>Fermer</Button></div>
  </div>;
}
function SavedVersion({ draft }: { draft: OutgoingDraftDto | null }) {
  const rows = [{ key: 'Version', value: draft ? `Enregistrée (révision ${draft.revision})` : 'Aucune préparation enregistrée' }, { key: 'À', value: draft?.to.join(', ') || '—' }, { key: 'Objet', value: draft?.subject || '—' }, { key: 'Message', value: draft?.message || '—' }, { key: 'Documents', value: draft?.attachments.map(row => row.state === 'unavailable' ? 'Document indisponible' : `${row.title} (fichier « ${row.fileName} »)`).join(', ') || '—' }];
  return <dl className="ho-version">{rows.map(row => <div key={row.key}><dt>{row.key}</dt><dd>{row.value}</dd></div>)}</dl>;
}
export function OutgoingWorkspace({ client, state }: { client: OutgoingClient; state: OutgoingSnapshot }) {
  const [picker, setPicker] = useState(false), [discard, setDiscard] = useState(false), [showServer, setShowServer] = useState(false), [toText, setToText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [dictation] = useState(() => new OutgoingDictationClient(client));
  const voice = useSyncExternalStore(dictation.subscribe, dictation.getSnapshot, dictation.getSnapshot);
  const [dictationErrors, setDictationErrors] = useState(false);
  useEffect(() => {
    const disconnect = dictation.connect();
    const hidden = () => { if (document.hidden) dictation.cancel(true, true); };
    const pagehide = () => dictation.cancel(false, true);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); disconnect(); };
  }, [dictation]);
  const title = useRef<HTMLHeadingElement>(null), errorTitle = useRef<HTMLElement>(null), resultTitle = useRef<HTMLElement>(null), conflictTitle = useRef<HTMLElement>(null), recapTitle = useRef<HTMLHeadingElement>(null);
  const locked = outgoingLocked(state), draft = state.server?.draft, rows = outgoingAttachments(state), total = outgoingTotal(rows), uncertain = state.ambiguous || draft?.state === 'uncertain';
  const hardLocked = state.ambiguous || !!(draft && draft.state !== 'editable') || state.operation?.state === 'preparing' || state.operation?.state === 'sending';
  const transmitting = state.busy && state.step === 'recap' || draft?.state === 'sending';
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { if (state.step === 'recap') recapTitle.current?.focus(); else if (state.step === 'accepted' || state.result || uncertain) resultTitle.current?.focus(); else if (state.save === 'conflict') conflictTitle.current?.focus(); }, [state.step, state.result, state.save, uncertain, state.conflictAgain]);
  const check = () => {
    const voiceErrors = dictation.blockingErrors();
    setDictationErrors(voiceErrors.length > 0);
    if (voiceErrors.length) { setErrors(voiceErrors); setTimeout(() => errorTitle.current?.focus(), 0); return; }
    if (toText.trim()) { client.edit({ to: mergeRecipients(client.getSnapshot().local.to, toText) }); setToText(''); }
    const current = client.getSnapshot();
    if (current.save === 'conflict') { conflictTitle.current?.focus(); return; }
    const found = outgoingValidation(current); setErrors(found);
    if (found.length) { setTimeout(() => errorTitle.current?.focus(), 0); return; }
    void client.check();
  };
  const saveText = state.save === 'conflict' ? 'Conflit avec un autre appareil' : ({ idle: 'Pas encore enregistrée', pending: 'Modifications non enregistrées', saving: 'Enregistrement…', saved: 'Enregistrée dans Hestia', failed: 'Non enregistrée · vos modifications restent ici' })[state.save];
  const saveIcon = state.save === 'saved' ? 'check' : state.save === 'saving' ? 'loader' : state.save === 'pending' ? 'pencil' : state.save === 'idle' ? 'info' : 'alert';
  const local = state.local, empty = !local.to.length && !local.subject.trim() && !local.message.trim() && !rows.length;
  return <section className="ho-workspace" aria-label="Envois"><header className="ho-heading"><h1 ref={title} tabIndex={-1}>Envois</h1>{!state.loading && !state.failedLoad && state.step !== 'accepted' && <span className={`ho-save ${state.save === 'failed' ? 'ho-save-failed' : ''}`} role="status"><Icon name={locked && !state.busy ? 'lock' : saveIcon} size={14} style={state.save === 'saved' ? {color:'var(--cdv-success)'} : state.save === 'failed' ? {color:'var(--cdv-danger)'} : state.save === 'conflict' ? {color:'var(--cdv-warning)'} : undefined}/><span>{locked && !state.busy ? 'Bloquée pendant la vérification' : saveText}</span></span>}</header>
    {state.loading ? <span role="status">Chargement en cours…</span> : state.failedLoad ? <Banner tone="danger" title="Chargement impossible." action="Réessayer" onAction={() => void client.load()}>La préparation n’a pas pu être chargée. Rien n’est affiché tant qu’elle n’est pas chargée depuis Hestia.</Banner> : <>
      {uncertain && <div className="ho-uncertain" role="status"><strong ref={resultTitle} tabIndex={-1}><Icon name="alert"/>Résultat de l’envoi à vérifier</strong><span>La réponse du fournisseur n’est pas parvenue à Hestia. L’email a peut-être été accepté, ou non : Hestia le vérifie. Pour éviter un double envoi, cette préparation reste bloquée jusqu’au résultat. Vous n’avez rien à refaire.</span></div>}
      {state.step === 'accepted' ? <div className="ho-accepted"><strong ref={resultTitle} tabIndex={-1}><Icon name="check"/>Accepté pour envoi.</strong>{state.accepted && <span>« {state.accepted.subject} » a été accepté par le fournisseur pour {state.accepted.count} destinataire{state.accepted.count > 1 ? 's' : ''}. La préparation a été vidée.</span>}<span className="ho-receipt-note">L’acceptation par le fournisseur ne garantit pas la remise à chaque destinataire. Hestia ne garde pas d’historique de vos envois.</span><div><Button icon="plus" onClick={() => { setErrors([]); setToText(''); client.fresh(); }}>Préparer un nouvel email</Button></div></div> : <>
        {state.save === 'conflict' && <div className="ho-conflict" role="alert"><strong ref={conflictTitle} tabIndex={-1}>Préparation modifiée sur un autre appareil.</strong><span>Vos dernières modifications ici ne sont pas enregistrées et rien n’a été écrasé. Relisez la version enregistrée, puis choisissez laquelle garder.</span>{state.conflictAgain && <strong><Icon name="alert" size={18}/>La version enregistrée a encore changé depuis votre lecture : rien n’a été écrasé. Relisez la version ci-dessous, puis choisissez à nouveau.</strong>}<Button variant="secondary" compact aria-expanded={showServer || state.conflictAgain} onClick={() => setShowServer(!showServer)}>{showServer || state.conflictAgain ? 'Masquer la version enregistrée' : 'Voir la version enregistrée'}</Button>{(showServer || state.conflictAgain) && <><SavedVersion draft={state.conflict}/><div className="h-actions"><Button compact onClick={() => { void client.useServer(); setToText(''); setErrors([]); }}>Utiliser la version enregistrée</Button><Button variant="secondary" compact disabled={state.conflictRevision === null} onClick={() => void client.keepMine()}>Enregistrer ma version à la place</Button></div></>}</div>}
        {state.result && <div className="ho-error" role="alert"><strong ref={resultTitle} tabIndex={-1}><Icon name="alert" size={18}/>Envoi impossible.</strong><span>{state.result}</span></div>}
        {!!errors.length && <div className="ho-error" role="alert"><strong ref={errorTitle} tabIndex={-1}>{dictationErrors ? 'Dictée à terminer avant l’envoi' : errors.length > 1 ? `${errors.length} points à corriger avant l’envoi` : 'Un point à corriger avant l’envoi'}</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        {state.step === 'edit' ? <div className="ho-compose"><span className="ho-private"><Icon name="lock" size={18}/>Préparation visible par vous seul, enregistrée dans Hestia. Vous pouvez la reprendre sur un autre appareil.</span>{transmitting && <OutgoingProgress/>}
          <RecipientList values={local.to} text={toText} onText={setToText} onChange={to => { client.edit({ to }); setErrors([]); }} disabled={locked} locked={hardLocked} error={errors.length && (!local.to.length || local.to.some(value => !OUTGOING_EMAIL.test(value))) ? 'Ajoutez une adresse valide, par exemple nom@example.com.' : undefined}/>
          <TextField label="Objet" required value={local.subject} onChange={event => { client.edit({ subject: event.target.value }); setErrors([]); }} error={errors.length && !local.subject.trim() ? 'Indiquez un objet.' : undefined} disabled={locked}/><OutgoingDictation field="subject" controller={dictation} voice={voice} state={state}/><TextArea label="Message" hint="Texte simple, envoyé tel que vous l’écrivez. Facultatif." rows={4} value={local.message} onChange={event => client.edit({ message: event.target.value })} disabled={locked}/><OutgoingDictation field="message" controller={dictation} voice={voice} state={state}/>
          <section className="ho-attachments" aria-labelledby="outgoing-attachments"><h2 id="outgoing-attachments">Pièces jointes</h2>{rows.length ? <><ul aria-label="Pièces jointes" className={total > OUTGOING_LIMITS.rawBytes ? 'ho-over-limit' : ''}>{rows.map((row, index) => <AttachmentRow key={row.id} row={row} last={index === rows.length - 1} disabled={locked} onRemove={() => { client.edit({ attachmentIds: local.attachmentIds.filter(id => id !== row.id) }); setErrors([]); }} onAccept={() => void client.accept(row)}/>)}</ul><SizeMeter total={total}/></> : <span className="ho-muted">Aucun document. Ajoutez-en ici ou depuis la fiche d’un document.</span>}
            {!hardLocked && <div><Button variant="secondary" icon="plus" disabled={locked} aria-expanded={picker} onClick={() => setPicker(!picker)}>Ajouter des documents</Button></div>}{picker && !hardLocked && <DocumentPicker client={client} state={state} onClose={() => setPicker(false)}/>}
          </section>{!hardLocked && <footer className="ho-actions"><Button variant="tertiary" icon="trash" disabled={empty||locked} onClick={() => setDiscard(true)}>Abandonner la préparation</Button><Button iconRight="chevron-right" loading={state.busy||state.save === 'saving'} onClick={check}>Vérifier l’envoi</Button></footer>}
        </div> : state.recap && <section className="ho-recap" aria-labelledby="outgoing-recap-title"><h2 id="outgoing-recap-title" ref={recapTitle} tabIndex={-1}>Vérifier avant d’envoyer</h2><dl className="ho-recap-data">{[{ key: 'Expéditeur', value: state.recap.sender.email ? `${state.recap.sender.name} <${state.recap.sender.email}>` : state.recap.sender.name }, { key: 'Réponses à', value: `${state.recap.replyTo} (votre adresse de compte vérifiée)` }, { key: 'À', value: state.recap.to.join(', ') }, { key: 'Objet', value: state.recap.subject }, { key: 'Message', value: state.recap.message.trim() || '(aucun message)' }, { key: 'Pièces jointes', value: state.recap.attachments.map(row => `${row.fileName} · ${fmtMio(row.size)}\n   document « ${row.title} »`).join('\n') + `\nTotal : ${fmtMio(state.recap.totalBytes)} sur 20,0 Mio` }].map(row => <div key={row.key}><dt>{row.key}</dt><dd>{row.value}</dd></div>)}</dl>
          <ul className="ho-reminders"><li><Icon name="users" size={18}/><span>Chaque destinataire verra toutes les adresses de « À » et le nom de chaque fichier.</span></li><li><Icon name="share" size={18}/><span>Une fois envoyée, la copie sort de Hestia : ses accès ne s’y appliquent plus, et elle ne peut être ni rappelée ni retirée.</span></li><li><Icon name="info" size={18}/><span>Les fichiers, adresses, objet et message passent par le service Resend, qui les conserve 30 jours. Hestia ne garde pas d’historique de vos envois ; cela ne supprime pas cette conservation.</span></li></ul><footer className="ho-actions"><Button variant="tertiary" icon="chevron-left" disabled={locked} onClick={() => client.back()}>Modifier</Button><Button icon="send" loading={transmitting} disabled={locked} onClick={() => void client.send()}>Envoyer</Button></footer>{transmitting && <OutgoingProgress/>}</section>}
      </>}
    </>}
    {discard && <Dialog title="Abandonner la préparation ?" confirmLabel="Abandonner" confirmVariant="danger" busy={state.busy} onCancel={() => setDiscard(false)} onConfirm={() => { void client.abandon().then(ok => { if (ok) { setDiscard(false); setErrors([]); setToText(''); } }); }}>Destinataires, objet, message et la liste des documents seront effacés de la préparation. Les documents restent dans leurs dossiers.</Dialog>}
    <div className="ho-live" role="status" aria-live="polite">{state.announcement}</div>
    <div className="ho-live" role="status" aria-live="polite">{voice.announcement}</div>
  </section>;
}
export function ExchangesWorkspace({ count, state, onInbox, onOutgoing }: { count: number; state: OutgoingSnapshot; onInbox: () => void; onOutgoing: () => void }) {
  const uncertain = state.ambiguous || state.server?.draft?.state === 'uncertain';
  const size = state.server?.draft?.attachments.length ?? 0;
  const meta = uncertain ? 'Résultat de l’envoi à vérifier' : state.server?.draft ? `Préparation en cours · ${size} document${size > 1 ? 's' : ''}` : 'Aucune préparation';
  return <section className="ho-workspace ho-exchanges"><h1 tabIndex={-1}>Échanges</h1><div role="list"><button type="button" className="cdv-focus ho-exchange-row" onClick={onInbox}><span className="ho-pick-mark"/><Icon name="folder"/><span><strong>À classer</strong><small>{count} pièce{count > 1 ? 's reçues' : ' reçue'} par mail, à ranger</small></span></button><button type="button" className="cdv-focus ho-exchange-row" onClick={onOutgoing}><span className="ho-pick-mark"/><Icon name="folder"/><span><strong>Envois</strong><small>{meta}</small></span></button></div></section>;
}
