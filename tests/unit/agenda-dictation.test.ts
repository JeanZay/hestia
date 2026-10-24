import { describe, expect, it } from 'vitest';
import { agendaTextLength, agendaTextProblem, appendAgendaDictation, normalizeAgendaDictation } from '../../src/shared/agenda-dictation';
import { validateAgendaInput } from '../../src/server/agenda/validation';
import { emptyAgendaFields } from '../../src/components/hestia/agenda-client';

describe('Agenda speech proposal and save contract', () => {
  it('appends without rewriting typed text; title is monoline and description keeps paragraphs', () => {
    expect(appendAgendaDictation('title', 'Titre existant', 'suite\r\nencore')).toBe('Titre existant suite encore');
    expect(appendAgendaDictation('description', 'Avant', 'Premier\r\n\r\nSecond')).toBe('Avant\nPremier\n\nSecond');
    expect(appendAgendaDictation('description', 'Avant  ', 'suite')).toBe('Avant  suite');
    expect(appendAgendaDictation('description', '', 'Premier\n\nSecond')).toBe('Premier\n\nSecond');
    expect(appendAgendaDictation('title', 'Intact', ' \n ')).toBe('Intact');
    expect(normalizeAgendaDictation('description', 'a\rb')).toBe('a\nb');
  });
  it.each([['title',200],['description',20000]] as const)('counts codepoints for %s exactly as the server without truncation', (field,max) => {
    for (const length of [max-1,max,max+1]) {
      const text='🪁'.repeat(length), input={...emptyAgendaFields(null),title:'Fiche synthétique',[field]:text,requestId:crypto.randomUUID(),revision:0};
      expect(agendaTextLength(' \r\n'+text+'  ')).toBe(length);
      if (length<=max) { expect(agendaTextProblem(field,text)).toBeUndefined();expect(()=>validateAgendaInput(input,true)).not.toThrow(); }
      else { expect(agendaTextProblem(field,text)).toContain('Trop long de 1');expect(()=>validateAgendaInput(input,true)).toThrow(); }
    }
    const original='🪁'.repeat(max), after=appendAgendaDictation(field,original,'suite complète');
    expect(after).toBe(original+' suite complète');expect(agendaTextProblem(field,after)).toBeDefined();
  });
  it('accepts paragraphs, tabs and ZWJ only where the Agenda contract accepts them', () => {
    expect(agendaTextProblem('title','a\tb')).toContain('Caractère non accepté');
    expect(agendaTextProblem('description','a\t\nb')).toBeUndefined();
    for(const field of ['title','description']as const){expect(agendaTextProblem(field,'a\u0007b')).toContain('Caractère non accepté');expect(agendaTextProblem(field,'👨‍👩‍👧‍👦')).toBeUndefined();}
  });
});
