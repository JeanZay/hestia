"use client";
import type { DocumentSummaryDto } from '../../shared/inbox-contract';
import { SummaryLine } from './inbox-design';
/** The authoritative workspace read owns revision and access checks. Display
 * cannot create an AI job or publish a separate, stale summary response. */
export function DocumentSummary({ initial }: { documentId:string; initial?:DocumentSummaryDto; revisionId?:string }) {
  return <div className="hc-card"><SummaryLine summary={initial || { status: 'none' }}/>{initial?.status === 'ready' && <span className="h-summary-detail-note">Résumé de la version actuelle, fondé sur le seul contenu du fichier. Ce n’est pas une vérification du document.</span>}</div>;
}
