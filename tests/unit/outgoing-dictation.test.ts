import { describe, expect, it } from 'vitest';
import { appendOutgoingDictation, normalizeOutgoingDictation, outgoingTextProblem } from '../../src/shared/outgoing-dictation';

describe('outgoing dictation composition contract', () => {
  it('appends without rewriting existing text and preserves message paragraphs', () => {
    expect(appendOutgoingDictation('subject', 'Objet existant', 'suite\r\nencore')).toBe('Objet existant suite encore');
    expect(appendOutgoingDictation('message', 'Bonjour,', 'Premier paragraphe\n\nBonne journée')).toBe('Bonjour,\nPremier paragraphe\n\nBonne journée');
    expect(appendOutgoingDictation('message', 'Bonjour ', 'suite')).toBe('Bonjour suite');
    expect(appendOutgoingDictation('message', '', 'Premier\n\nSecond')).toBe('Premier\n\nSecond');
    expect(normalizeOutgoingDictation('message', 'a\r\nb')).toBe('a\nb');
  });
  it.each([['subject', 200], ['message', 20000]] as const)('counts Unicode code points for %s, without cutting or rejecting ZWJ', (field, max) => {
    expect(outgoingTextProblem(field, '🪁'.repeat(max - 1))).toBeUndefined();
    expect(outgoingTextProblem(field, '🪁'.repeat(max))).toBeUndefined();
    expect(outgoingTextProblem(field, '🪁'.repeat(max + 1))).toContain('Trop long de 1');
    const original = '🪁'.repeat(max), after = appendOutgoingDictation(field, original, 'une suite entière');
    expect(after).toBe(original + ' une suite entière');
    expect(outgoingTextProblem(field, '👨‍👩‍👧‍👦')).toBeUndefined();
  });
  it('uses the strict composition control rules; tabs only allowed in the message', () => {
    expect(outgoingTextProblem('subject', 'a\tb')).toContain('Caractère non accepté');
    expect(outgoingTextProblem('message', 'a\t\nb')).toBeUndefined();
    for (const field of ['subject', 'message'] as const) expect(outgoingTextProblem(field, 'a\u0007b')).toContain('Caractère non accepté');
    expect(outgoingTextProblem('message', 'a\rb')).toContain('Caractère non accepté');
  });
});
