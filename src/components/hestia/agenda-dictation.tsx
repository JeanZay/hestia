"use client";
import { useEffect, useRef } from 'react';
import { AGENDA_LIMITS } from '../../shared/agenda-contract';
import { agendaTextLength, appendAgendaDictation, agendaFieldName, agendaTextProblem, type AgendaDictationField as Field } from '../../shared/agenda-dictation';
import { Banner, Button, Icon, TextArea } from './design-system';
import { AgendaDictationClient, type AgendaVoiceSnapshot } from './agenda-dictation-client';

/** P22 uses precisely the same character accounting as Agenda's server. */
function LengthMeter({ text, field }: { text: string; field: Field }) {
  const length = agendaTextLength(text), max = AGENDA_LIMITS[field], over = length - max;
  return <span className={`hc-length ${over > 0 ? 'hc-length-over' : ''}`}>{over > 0 && <Icon name="alert" size={16}/ >}{length.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')} caractères{over > 0 ? ` · ${over.toLocaleString('fr-FR')} en trop` : ''}</span>;
}
/** Claude Design Agenda fiche dictée V1: existing P21/P22, no new visual system. */
export function AgendaDictation({ field, controller, voice, text, locked }: { field: Field; controller: AgendaDictationClient; voice: AgendaVoiceSnapshot; text: string; locked: boolean }) {
  const stopBox = useRef<HTMLDivElement>(null), statusBox = useRef<HTMLDivElement>(null);
  const active = voice.active?.field === field ? voice.active : null, other = voice.active && !active, pending = voice.pending[field], notice = voice.notices[field];
  const reason = controller.reason() || (other ? `Une dictée est déjà en cours pour ${agendaFieldName[voice.active!.field]}.` : null);
  const label = field === 'title' ? text.trim() ? 'Dicter la suite du titre' : 'Dicter le titre' : text.trim() ? 'Dicter la suite de la description' : 'Dicter la description';
  const after = pending ? appendAgendaDictation(field, text, pending.text) : '', error = pending ? agendaTextProblem(field, after) : undefined;
  const appended = voice.appended?.field === field && voice.appended.after === text ? voice.appended : null;
  useEffect(() => {
    if (active?.phase === 'listening') stopBox.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (active?.phase) statusBox.current?.focus();
  }, [active?.phase]);
  return <div className="ha-dictation"><LengthMeter field={field} text={text}/>
    {!active ? reason ? <div className="hc-row"><span className="hc-voice-unavailable"><Icon name="mic-off" size={18}/>Dictée indisponible</span><span className="ha-voice-muted">{reason}</span></div> : <div><Button variant="secondary" compact icon="mic" disabled={locked || !!pending} onClick={() => void controller.start(field)}>{label}</Button></div> : active.phase === 'listening' ? <div ref={stopBox} className="hc-voice-listening" role="group" aria-label={`Dictée en cours pour ${agendaFieldName[field]}`}><span className="hc-voice-word"><span className="hc-voice-pulse" aria-hidden="true"/><Icon name="mic" size={18}/>Écoute <span className="hc-voice-time">{active.elapsed >= 105 ? <><Icon name="alert" size={16}/>encore {120 - active.elapsed} s</> : `${Math.floor(active.elapsed / 60)}:${String(active.elapsed % 60).padStart(2, '0')} / 2:00`}</span></span><Button compact icon="square" onClick={() => void controller.stop()}>Arrêter et transcrire</Button><Button variant="tertiary" compact onClick={() => controller.cancel()}>Annuler</Button></div> : <div ref={statusBox} tabIndex={-1} className="hc-row hc-voice-status"><strong className="hc-row"><Icon name={active.phase === 'permission' ? 'mic' : 'loader'} size={18}/>{active.phase === 'permission' ? 'Autorisation du microphone demandée…' : 'Transcription en cours…'}</strong>{active.phase === 'transcribing' && <span className="ha-voice-muted">Vous pouvez continuer à écrire.</span>}<Button compact variant="tertiary" onClick={() => controller.cancel()}>{active.phase === 'permission' ? 'Annuler' : 'Ne pas utiliser le résultat'}</Button></div>}
    {field === 'title' && !voice.active && !controller.reason() && <span className="ha-dictation-info">Seul l’audio est envoyé au service de transcription du foyer ; ni le texte déjà écrit, ni les documents associés, ni les membres ou leurs adresses. Hestia ne conserve pas l’audio. Rien n’est enregistré avant « Enregistrer ».</span>}
    {notice && <Banner title={notice.title} tone={notice.tone} action={notice.retry && !reason && !voice.active && !pending && !locked ? 'Dicter à nouveau' : undefined} onAction={() => void controller.start(field)}>{notice.text}</Banner>}
    {appended && <div className="ha-dictation-added"><Icon name="check" size={18}/><span>Texte dicté ajouté à la fin {field === 'title' ? 'du titre' : 'de la description'}. Relisez-le et corrigez-le si besoin ; rien n’est enregistré.</span><Button variant="tertiary" compact disabled={locked} onClick={() => controller.undo(field)}>Retirer le texte dicté</Button></div>}
    {pending && <div className="ha-dictation-pending" role="group" aria-label={`Texte dicté pour ${agendaFieldName[field]}, pas encore ajouté`}><span><strong>Pas encore ajouté.</strong> {pending.reason}</span><TextArea label={`Texte dicté pour ${agendaFieldName[field]}`} rows={field === 'title' ? 2 : 4} value={pending.text} onChange={event => controller.editPending(field, event.target.value)} error={error}/><span className="hc-row ha-voice-muted">Après ajout : <LengthMeter text={after} field={field}/></span><div className="hc-row"><Button variant="secondary" compact icon="plus" disabled={!!error || !pending.text.trim() || locked} onClick={() => controller.addPending(field)}>Ajouter à la fin {field === 'title' ? 'du titre' : 'de la description'}</Button><Button variant="tertiary" compact onClick={() => controller.dropPending(field)}>Ne pas utiliser</Button></div></div>}
  </div>;
}
