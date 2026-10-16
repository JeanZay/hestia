import { describe, expect, it } from 'vitest';
import { contentSummary } from '../../src/server/documents/revisions';

describe('document summary projection', () => {
  it('keeps every asynchronous state distinct and suppresses premature or stale text', () => {
    for (const status of ['pending','running','unavailable','unknown'] as const)
      expect(contentSummary(status, 'private result from another state')).toEqual({status});
    expect(contentSummary(undefined, undefined)).toEqual({status:'unavailable'});
    expect(contentSummary('stale', 'old')).toEqual({status:'unavailable'});
  });
  it('counts Unicode code points without silently truncating invalid output', () => {
    const sentence = '😀'.repeat(200);
    expect(contentSummary('ready',sentence)).toEqual({status:'ready',text:sentence});
    expect(contentSummary('ready',sentence+'!')).toEqual({status:'unavailable'});
    for (const value of ['', '  ', null, {}, 4]) expect(contentSummary('ready',value)).toEqual({status:'unavailable'});
  });
});
