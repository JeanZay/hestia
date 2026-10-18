"use client";
import type { DocumentSummaryDto } from '../../shared/inbox-contract';
import { Button, Icon } from './design-system';
import { summaryParts, summaryExplanation } from './document-summary-row';
/** Exact technical port of Clé de voûte 1.7 P26/P27 received with inbox v2. */
export function SummaryLine({ summary }: { summary?: DocumentSummaryDto }) {
  if (!summary) return null;
  const part = summaryParts(summary);
  const ready = summary.status === 'ready';
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--cdv-font-text)' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: 'var(--cdv-ink-2)' }}><Icon name={part?.icon || 'info'} size={16}/>{ready ? 'Résumé généré par IA' : part?.text || 'Pas encore de résumé'}</span><span style={{ fontSize: ready ? 16 : 15, lineHeight: 1.45, color: ready ? 'var(--cdv-ink)' : 'var(--cdv-ink-2)', overflowWrap: 'anywhere' }}>{ready ? summary.text : summaryExplanation(summary)}</span></div>;
}
export function InboxCount({ count, onClick }: { count: number; onClick: () => void }) {
  return <Button variant={count ? 'primary' : 'secondary'} icon="inbox" onClick={onClick} aria-label={count ? `À classer, ${count} pièce${count > 1 ? 's' : ''} jointe${count > 1 ? 's' : ''} en attente` : 'À classer, aucune pièce en attente'}>À classer{count ? ` · ${count}` : ''}</Button>;
}
