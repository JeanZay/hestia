"use client";
import { useId, type Ref } from 'react';
import type { OutgoingAttachmentDto } from '../../shared/outgoing-contract';
import { Button, Icon } from './design-system';
import { OUTGOING_EMAIL } from './outgoing-client';

// Controlled ports of Clé de voûte 1.9 P31–P33, exact Envois V2 hand-off.
export const fmtMio = (bytes: number) => `${(bytes / 1048576).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mio`;
export function mergeRecipients(values: string[], raw: string) {
  const next = [...values];
  for (const address of raw.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean)) if (!next.some(value => value.toLowerCase() === address.toLowerCase())) next.push(address);
  return next;
}
export function RecipientList({ values, text, onText, onChange, disabled, locked = disabled, error, inputRef }: { values: string[]; text: string; onText: (value: string) => void; onChange: (value: string[]) => void; disabled: boolean; locked?: boolean; error?: string; inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  const add = (raw: string) => { if (!raw.trim()) return; onChange(mergeRecipients(values, raw)); onText(''); };
  const invalid = values.filter(value => !OUTGOING_EMAIL.test(value));
  return <div className="ho-recipients"><label htmlFor={id}>À</label><span id={`${id}-hint`} className="ho-recipient-hint">Une ou plusieurs adresses. Chaque destinataire verra les autres adresses.</span>
    {!!values.length && <ul aria-label="Destinataires">{values.map(value => { const bad = !OUTGOING_EMAIL.test(value); return <li key={value} className={bad ? 'ho-address-invalid' : ''}>{bad && <Icon name="alert" size={16} style={{ color: 'var(--cdv-danger)' }}/>}<span>{value}{bad && <strong> · adresse invalide</strong>}</span>{!disabled && <button type="button" className="cdv-focus ho-icon-button" aria-label={`Retirer ${value}`} title={`Retirer ${value}`} onClick={() => onChange(values.filter(row => row !== value))}><Icon name="x"/></button>}</li>; })}</ul>}
    {!locked && <input id={id} ref={inputRef} className="cdv-focus" type="email" inputMode="email" autoComplete="off" disabled={disabled} value={text} placeholder={values.length ? 'Ajouter une adresse' : 'nom@example.com'} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={!!error || undefined} onChange={event => { const value = event.target.value; if (/[,;]\s*$/.test(value)) add(value); else onText(value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(text); } else if (event.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)); }} onBlur={() => add(text)}/>}
    {error ? <span id={`${id}-error`} className="ho-field-error"><Icon name="alert" size={16} style={{ color: 'var(--cdv-danger)' }}/>{error}</span> : !!invalid.length && <span className="ho-recipient-hint">{invalid.length} adresse{invalid.length > 1 ? 's' : ''} à corriger.</span>}
  </div>;
}
export function SizeMeter({ total, max = 20971520 }: { total: number; max?: number }) {
  const over = total > max;
  return <div className={`ho-size ${over ? 'ho-size-over' : ''}`}><span>{over && <Icon name="alert" size={16} style={{ color: 'var(--cdv-danger)' }}/>}Total des pièces jointes : {fmtMio(total)} sur 20,0 Mio{over ? ` · ${fmtMio(total - max)} de trop` : ''}</span><div role="presentation"><div style={{ width: `${Math.min(100, Math.round(total / max * 100))}%`, background: over ? 'var(--cdv-danger)' : 'var(--cdv-action)' }}/></div></div>;
}
function FileThumb({ mediaType }: { mediaType: string }) { const image = mediaType.startsWith('image/'); return <span aria-hidden="true" className={`ho-thumb ${image ? 'ho-thumb-image' : ''}`}>{image ? 'IMG' : 'PDF'}</span>; }
export function AttachmentRow({ row, last, disabled, onRemove, onAccept }: { row: OutgoingAttachmentDto; last: boolean; disabled: boolean; onRemove: () => void; onAccept: () => void }) {
  const unavailable = row.state === 'unavailable', warn = row.state === 'renamed' || row.state === 'replaced';
  const word = unavailable ? 'Document indisponible' : row.state === 'renamed' ? 'Titre modifié' : row.state === 'replaced' ? 'Fichier remplacé' : null;
  const note = unavailable ? 'Ce document n’est plus disponible pour vous, ou ne peut plus être exporté. Retirez-le pour continuer.' : row.state === 'renamed' && row.current ? `Le titre du document est devenu « ${row.current.title} ». Le fichier joint ne change pas de nom : les destinataires recevront « ${row.fileName} ».` : row.state === 'replaced' && row.current ? `Ce document a une nouvelle version dans Hestia, avec son propre fichier « ${row.current.fileName} » (${fmtMio(row.current.size)}). Rien n’a changé dans la préparation : joignez la nouvelle version ou retirez le document.` : null;
  return <li className={`ho-attachment ${unavailable ? 'ho-attachment-unavailable' : warn ? 'ho-attachment-warning' : ''}`} style={{ borderBottom: last ? 0 : undefined }}>
    <div>{unavailable ? <span aria-hidden="true" className="ho-unavailable-thumb"><Icon name="lock" size={16}/></span> : <FileThumb mediaType={row.mediaType}/>}</div>
    <div className="ho-attachment-text"><strong>{unavailable ? 'Document indisponible' : row.state === 'renamed' && row.current ? row.current.title : row.title}</strong>{!unavailable && <><span className="ho-filename">Fichier joint : <strong>{row.fileName}{row.state === 'replaced' ? ' (version choisie)' : ''}</strong></span><span className="ho-attachment-meta">{row.path} · {fmtMio(row.size)}</span></>}{word && !unavailable && <span className="ho-attachment-state"><Icon name="alert" size={14}/>{word}</span>}{note && <span className="ho-attachment-note">{note}</span>}</div>
    {!disabled && <div className="h-actions">{warn && <Button variant="secondary" compact onClick={onAccept}>{row.state === 'replaced' ? 'Joindre la nouvelle version' : 'Garder ce document'}</Button>}<Button variant="tertiary" compact icon="x" aria-label={unavailable ? 'Retirer le document indisponible' : `Retirer ${row.title}`} onClick={onRemove}>Retirer</Button></div>}
  </li>;
}
// Exact indeterminate DS1.0 Progress geometry, without the DC runtime.
export function OutgoingProgress() { return <div role="status" aria-live="polite"><span>Transmission au fournisseur… Ne fermez pas cette page.</span><div className="ho-progress" role="progressbar" aria-label="Transmission au fournisseur… Ne fermez pas cette page." aria-valuemin={0} aria-valuemax={100}><span/></div></div>; }
