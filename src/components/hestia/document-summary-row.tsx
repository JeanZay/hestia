"use client";
import { useId, type ReactNode } from 'react';
import type { DocumentSummaryDto } from '../../shared/inbox-contract';
import { Icon } from './design-system';

const causes: Record<string, string> = {
  format: 'Pas de résumé : format non analysable',
  unreadable: 'Pas de résumé : contenu illisible',
  'ai-off': 'Pas de résumé : résumés IA désactivés pour le foyer',
  budget: 'Pas de résumé pour l’instant : plafond IA du foyer atteint',
};
/** Clé de voûte 1.8 P28: the server alone supplies state and known cause. */
export function summaryParts(summary?: DocumentSummaryDto) {
  if (!summary || summary.status === 'none') return null;
  if (summary.status === 'ready') return { ready: true, text: summary.text || '', icon: 'file-text', dashed: false, spin: false };
  if (summary.status === 'pending') return { ready: false, text: 'Résumé prévu', icon: 'clock', dashed: false, spin: false };
  if (summary.status === 'running') return { ready: false, text: 'Résumé en préparation', icon: 'loader', dashed: false, spin: true };
  return { ready: false, text: summary.status === 'unavailable' && summary.cause ? causes[summary.cause] || 'Résumé indisponible pour le moment' : 'Résumé indisponible pour le moment', icon: 'info', dashed: true, spin: false };
}
export function summaryExplanation(summary?: DocumentSummaryDto) {
  if (!summary || summary.status === 'none') return 'Pas encore de résumé. Les documents ajoutés avant les résumés en recevront un, dans la limite du plafond IA du foyer ; ce n’est pas encore programmé pour celui-ci.';
  if (summary.status === 'pending') return 'Le résumé de ce document est programmé. Le document est utilisable en attendant.';
  if (summary.status === 'running') return 'Le résumé est en préparation. Le document est utilisable en attendant.';
  if (summary.status === 'unavailable') {
    if (summary.cause === 'format') return 'Ce format ne peut pas être analysé. Le document reste consultable et téléchargeable selon vos accès.';
    if (summary.cause === 'unreadable') return 'Le contenu du fichier n’a pas pu être lu. Le document reste consultable et téléchargeable selon vos accès.';
    if (summary.cause === 'ai-off') return 'Les résumés IA sont désactivés pour le foyer. Le document reste utilisable.';
    if (summary.cause === 'budget') return 'Le plafond IA du foyer est atteint. Le document reste utilisable.';
  }
  return 'Le résumé n’est pas disponible pour le moment. Le document reste utilisable.';
}
/** Faithful P28 port; existing screens have no document-row menu handlers. */
export function DocumentSummaryRow({ title, meta, path, mediaType, summary, onOpen, disabled = false }: { title: string; meta?: string; path?: string; mediaType: string; summary?: DocumentSummaryDto; onOpen: () => void; disabled?: boolean }) {
  const id = useId(), part = summaryParts(summary);
  const summaryId = `${id}-summary`, metaId = `${id}-meta`;
  return <div className="h-summary-row" onClick={event => { if (!disabled && !event.defaultPrevented && !(event.target as Element).closest('button,[role=menu],a,input')) onOpen(); }}>
    <span className={`h-file-thumb ${mediaType === 'application/pdf' ? 'h-file-pdf' : 'h-file-image'}`} aria-hidden="true">{mediaType === 'application/pdf' ? 'PDF' : 'IMG'}</span>
    <div className="h-summary-row-content">
      <button type="button" className="cdv-focus h-summary-title" disabled={disabled} onClick={onOpen} aria-describedby={[part && summaryId, (meta || path) && metaId].filter(Boolean).join(' ') || undefined}>{title}</button>
      {part && (part.ready ? <p id={summaryId} className="h-summary-text"><span className="h-summary-sr">Résumé IA : </span>{part.text}</p> : <span id={summaryId} className={`h-summary-state${part.dashed ? ' h-summary-unavailable' : ''}`}><Icon name={part.icon} size={14} style={part.spin ? { animation: 'cdv-spin 1.4s linear infinite' } : undefined}/>{part.text}</span>)}
      {(meta || path) && <span id={metaId} className="h-summary-meta">{[path, meta].filter(Boolean).join(' · ')}</span>}
    </div>
  </div>;
}
/** Clé de voûte 1.8 P29, once per displayed list. */
export function SummaryNote({ children }: { children?: ReactNode }) {
  return <p className="h-summary-note"><Icon name="file-text" size={16}/><span>{children || 'Les résumés sous chaque document sont générés par IA à partir du fichier. Ils aident à repérer un document ; ils peuvent être incomplets ou inexacts.'}</span></p>;
}
