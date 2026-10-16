"use client";
import { useEffect, useState } from 'react';
import type { DocumentSummaryDto } from '../../shared/inbox-contract';
import { inboxRequest } from './inbox-client';
import { SummaryLine } from './inbox-design';
/** Display never creates or starts an AI job. Polling is read-only. */
export function DocumentSummary({ documentId, initial, revisionId }: { documentId:string; initial?:DocumentSummaryDto; revisionId?:string }) {
  const [summary,setSummary]=useState(initial);
  useEffect(()=>{if(!initial||!['pending','running'].includes(initial.status))return;const ac=new AbortController();const read=()=>void inboxRequest<{summary:DocumentSummaryDto;revisionId?:string}>(`/documents/${documentId}/summary`,ac.signal).then(result=>{if(!ac.signal.aborted&&(!revisionId||revisionId===result.revisionId))setSummary(result.summary);}).catch(()=>{});const timer=setInterval(read,2500);return()=>{ac.abort();clearInterval(timer);};},[documentId,initial,revisionId]);
  return summary?<div className="hc-card"><SummaryLine summary={summary}/></div>:null;
}
