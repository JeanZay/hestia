import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentSummaryRow, SummaryNote, summaryParts, summaryExplanation } from '../../src/components/hestia/document-summary-row';
import { DocumentSummary } from '../../src/components/hestia/document-summary';

describe('summary display contract', () => {
  it('only names a cause asserted by the server, and leaves historical rows quiet', () => {
    expect(summaryParts({status:'none'})).toBeNull();
    expect(summaryParts({status:'pending'})?.text).toBe('Résumé prévu');
    expect(summaryParts({status:'running'})?.text).toBe('Résumé en préparation');
    for (const status of ['unknown','unavailable'] as const) expect(summaryParts({status})?.text).toBe('Résumé indisponible pour le moment');
    expect(summaryParts({status:'unknown',cause:'budget'})?.text).toBe('Résumé indisponible pour le moment');
    for (const cause of ['format','unreadable','ai-off','budget'] as const) {
      expect(summaryParts({status:'unavailable',cause})?.dashed).toBe(true);
      expect(summaryExplanation({status:'unavailable',cause})).not.toContain('pour le moment');
    }
    expect(summaryExplanation({status:'none'})).toContain('ce n’est pas encore programmé');
  });
  it('retains all 200 Unicode characters, title-only button and referenced descriptions', () => {
    const text='🧾'.repeat(200);
    const html=renderToStaticMarkup(createElement(DocumentSummaryRow,{title:'Facture',meta:'2 Ko',path:'Maison',mediaType:'application/pdf',summary:{status:'ready',text},onOpen:()=>{}}));
    expect(html).toContain(text);
    expect(html).toContain('Résumé IA : ');
    expect(html).toMatch(/aria-describedby="([^"]+)-summary ([^"]+)-meta"/);
    expect(html).toMatch(/<button[^>]*>Facture<\/button>/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain('title=');
    expect(html).not.toContain('aria-live');
  });
  it('puts the AI disclaimer at list level and explains detail states without a retry', () => {
    expect(renderToStaticMarkup(createElement(SummaryNote))).toContain('générés par IA à partir du fichier');
    const none=renderToStaticMarkup(createElement(DocumentSummary,{documentId:'synthetic',initial:{status:'none'}}));
    expect(none).toContain('Pas encore de résumé');
    const ready=renderToStaticMarkup(createElement(DocumentSummary,{documentId:'synthetic',initial:{status:'ready',text:'Facture synthétique.'}}));
    expect(ready).toContain('Résumé généré par IA');
    expect(ready).toContain('Ce n’est pas une vérification du document.');
    expect(ready).not.toContain('<button');
  });
});
