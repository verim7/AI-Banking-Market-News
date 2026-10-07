import { describe, expect, it } from 'vitest';
import { linkFilters, readLink } from '../src/lib/link.ts';

describe('a link into the tracker', () => {
  it('opens the Lens on the month the weekly email names', () => {
    const link = readLink('?tab=lens&from=2026-09-01&to=2026-09-30&grade=A');
    expect(link).toEqual({ tab: 'lens', from: '2026-09-01', to: '2026-09-30', grades: ['A'] });
    expect(linkFilters(link)).toEqual({ from: '2026-09-01', to: '2026-09-30', grades: ['A'] });
  });

  it('ignores what it cannot trust, and changes nothing without parameters', () => {
    expect(readLink('?tab=admin&from=yesterday&to=2026-9-1&grade=Z')).toEqual({});
    expect(readLink('')).toEqual({});
    expect(linkFilters({})).toEqual({});
  });

  it('opens the Review Queue for the browser routine', () => {
    expect(readLink('?tab=hil').tab).toBe('hil');
  });
});
