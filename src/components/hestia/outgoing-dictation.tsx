"use client";
import { useEffect, useRef } from 'react';
import { OUTGOING_LIMITS } from '../../shared/outgoing-contract';
import { appendOutgoingDictation, outgoingFieldName, outgoingTextProblem, type OutgoingDictationField as Field } from '../../shared/outgoing-dictation';
import { Banner, Button, Icon, TextArea } from './design-system';
import { outgoingLocked, type OutgoingSnapshot } from './outgoing-client';
import { OutgoingDictationClient, type OutgoingDictationSnapshot } from './outgoing-dictation-client';

/** P22 from the validated 1.6 hand-off, parameterized for the outgoing limits. */
function LengthMeter({ text, field }: { text: string; field: Field }) {
  const length = [...(field === 'subject' ? text.trim() : text.replace(/\r\n/g, '\n'))].length, max = OUTGOING_LIMITS[field], over = length - max;
  return <span className={`hc-length ${over > 0 ? 'hc-length-over' : ''}`}>{over > 0 && <Icon name="alert" size={16}/ >}{length.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')} caractères{over > 0 ? ` · ${over.toLocaleString('fr-FR')} en trop` : ''}</span>;
}
/** Technical port of Envois dictée V1, P21 and P22. */
export function OutgoingDictation({ field, controller, voice, state }: { field: Field; controller: OutgoingDictationClient; voice: OutgoingDictationSnapshot; state: OutgoingSnapshot }) {
  const stopBox = useRef<HTMLDivElement>(null), statusBox = useRef<HTMLDivElement>(null);
  const active = voice.active?.field === field ? voice.active : null, other = voice.active && !active, pending = voice.pending[field], notice = voice.notices[field];
  const reason = controller.reason() || (other ? `Une dictée est déjà en cours pour ${outgoingFieldName[voice.active!.field]}.` : null);
  const text = state.local[field], label = field === 'subject' ? text.trim() ? 'Dicter la suite de l’objet' : 'Dicter l’objet' : text.trim() ? 'Dicter la suite du message' : 'Dicter le message';
  const after = pending ? appendOutgoingDictation(field, text, pending.text) : '', error = pending ? outgoingTextProblem(field, after) : undefined;
  const locked = outgoingLocked(state), appended = voice.appended?.field === field && voice.appended.after === text ? voice.appended : null;
  useEffect(() => {
    if (active?.phase === 'listening') stopBox.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (active?.phase) statusBox.current?.focus();
  }, [active?.phase]);
  return <div className="ho-dictation"><LengthMeter field={field} text={text}/>
    {!active ? reason ? <div className="hc-row"><span className="hc-voice-unavailable"><Icon name="mic-off" size={18}/>Dictée indisponible</span><span className="ho-muted">{reason}</span></div> : <div><Button variant="secondary" compact icon="mic" disabled={locked || !!pending} onClick={() => void controller.start(field)}>{label}</Button></div> : active.phase === 'listening' ? <div ref={stopBox} className="hc-voice-listening" role="group" aria-label={`Dictée en cours pour ${outgoingFieldName[field]}`}><span className="hc-voice-word"><span className="hc-voice-pulse" aria-hidden="true"/><Icon name="mic" size={18}/>Écoute <span className="hc-voice-time">{active.elapsed >= 105 ? <><Icon name="alert" size={16}/>encore {120 - active.elapsed} s</> : `${Math.floor(active.elapsed / 60)}:${String(active.elapsed % 60).padStart(2, '0')} / 2:00`}</span></span><Button compact icon="square" onClick={() => void controller.stop()}>Arrêter et transcrire</Button><Button variant="tertiary" compact onClick={() => controller.cancel()}>Annuler</Button></div> : <div ref={statusBox} tabIndex={-1} className="hc-row hc-voice-status"><strong className="hc-row"><Icon name={active.phase === 'permission' ? 'mic' : 'loader'} size={18}/>{active.phase === 'permission' ? 'Autorisation du microphone demandée…' : 'Transcription en cours…'}</strong>{active.phase === 'transcribing' && <span className="ho-muted">Vous pouvez continuer à écrire.</span>}<Button compact variant="tertiary" onClick={() => controller.cancel()}>{active.phase === 'permission' ? 'Annuler' : 'Ne pas utiliser le résultat'}</Button></div>}
    {field === 'subject' && !voice.active && !controller.reason() && <span className="ho-dictation-info">Seul l’audio est envoyé au service de transcription du foyer ; ni les destinataires, ni le texte déjà écrit, ni les pièces jointes. Hestia ne conserve pas l’audio. Rien n’est envoyé par mail en dictant.</span>}
    {notice && <Banner title={notice.title} tone={notice.tone} action={notice.retry && !reason && !voice.active && !pending && !locked ? 'Dicter à nouveau' : undefined} onAction={() => void controller.start(field)}>{notice.text}</Banner>}
    {appended && <div className="ho-dictation-added"><Icon name="check" size={18}/><span>Texte dicté ajouté à la fin {field === 'subject' ? 'de l’objet' : 'du message'}. Relisez-le et corrigez-le si besoin.</span><Button variant="tertiary" compact disabled={locked} onClick={() => controller.undo(field)}>Retirer le texte dicté</Button></div>}
    {pending && <div className="ho-dictation-pending" role="group" aria-label={`Texte dicté pour ${outgoingFieldName[field]}, pas encore ajouté`}><span><strong>Pas encore ajouté.</strong> {pending.reason}</span><TextArea label={`Texte dicté pour ${outgoingFieldName[field]}`} rows={field === 'subject' ? 2 : 4} value={pending.text} onChange={event => controller.editPending(field, event.target.value)} error={error}/><span className="hc-row ho-muted">Après ajout : <LengthMeter text={after} field={field}/></span><div className="hc-row"><Button variant="secondary" compact icon="plus" disabled={!!error || !pending.text.trim() || locked || state.save === 'conflict'} onClick={() => controller.addPending(field)}>Ajouter à la fin {field === 'subject' ? 'de l’objet' : 'du message'}</Button><Button variant="tertiary" compact onClick={() => controller.dropPending(field)}>Ne pas utiliser</Button></div></div>}
  </div>;
}
