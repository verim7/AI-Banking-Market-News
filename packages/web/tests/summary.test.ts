import { describe, expect, it } from 'vitest';
import {
  COVERAGE_CAVEAT, headlineCounts, summaryLines, tileWindowNote, type Facet,
} from '../src/lib/summary.ts';
import type { Measures } from '../src/lib/measures.ts';

const measures = (over: Partial<Measures> = {}): Measures => ({
  total: 85,
  confirmedUseCases: 40, confirmedReports: 70,
  possibleUseCases: 5,
  reviewedUseCases: 62, reviewedReports: 148,
  deployedUseCases: 41, deployedReports: 90,
  reviewedTotal: 30,
  ...over,
});

const facets: Facet[] = [
  { dimension: 'maturity', value: 'in_production', n: 41 },
  { dimension: 'maturity', value: 'pilot', n: 14 },
  { dimension: 'ai_type', value: 'generative_ai', n: 38 },
  { dimension: 'ai_type', value: 'agentic_ai', n: 17 },
  { dimension: 'l1_process', value: 'p05_relationship', n: 19 },
  { dimension: 'l1_process', value: 'p13_lending', n: 11 },
  { dimension: 'region', value: 'uk', n: 22 },
  { dimension: 'region', value: '__none__', n: 99 },
];

const labels = new Map([
  ['ai_type:generative_ai', 'Generative AI'],
  ['l1_process:p05_relationship', 'P05 – Relationship servicing'],
  ['region:uk', 'United Kingdom'],
]);

describe('the headline counts', () => {
  it('reads maturity from the facets, not from the loaded rows', () => {
    // The page loads at most 200 articles. Counting maturity from those
    // reported "in production among the top 200" under a label that just said
    // "in production" — wrong by exactly the amount nobody could see.
    expect(headlineCounts(measures(), facets).inProduction).toBe(41);
    expect(headlineCounts(measures(), facets).piloting).toBe(14);
  });

  it('prefers reviewed figures once anything has been reviewed', () => {
    const c = headlineCounts(measures(), facets);
    expect(c.useCases).toBe(62);
    expect(c.reports).toBe(148);
  });

  it('falls back to the classifier figures when nothing has been read', () => {
    const c = headlineCounts(measures({ reviewedTotal: 0 }), facets);
    expect(c.useCases).toBe(40);
    expect(c.reports).toBe(70);
  });

  it('survives measures being absent, which is the first paint', () => {
    const c = headlineCounts(null, []);
    expect(c).toEqual({
      total: 0, useCases: 0, reports: 0, deployed: 0,
      inProduction: 0, piloting: 0, reviewed: 0,
    });
  });
});

describe('the executive summary', () => {
  const lines = summaryLines(headlineCounts(measures(), facets), facets, labels);
  const text = lines.join(' ');

  it('leads with the fold, because two different numbers need explaining', () => {
    // "62 use cases" next to "148 articles" reads as a discrepancy unless the
    // sentence says they are the same thing counted two ways.
    expect(lines[0]).toBe('62 distinct AI use cases, reported across 148 articles.');
  });

  it('states adoption in both directions', () => {
    // Says "articles", because the line before it counted use cases and the
    // maturity facet counts articles — "41 are described as…" read as 41 use
    // cases, two sentences apart and both correct.
    expect(text).toContain('41 articles describe something running in production');
    expect(text).toContain('14 a pilot or a trial');
  });

  it('names the leaders using their taxonomy labels, not their keys', () => {
    expect(text).toContain('Generative AI');
    expect(text).toContain('P05 – Relationship servicing');
    expect(text).toContain('United Kingdom');
    expect(text).not.toContain('p05_relationship');
  });

  it('ignores the unclassified bucket when picking a leader', () => {
    // `__none__` is the largest region facet in the fixture above. "Most of the
    // activity is in Not classified" would be true and useless.
    expect(text).toContain('United Kingdom (22)');
    expect(text).not.toContain('__none__');
  });

  it('always ends by saying how much of this a person actually read', () => {
    // The confidence interval on every other line. It is last and it is not
    // conditional: a summary that omits it when the number is inconvenient is
    // worse than one that never had it.
    expect(lines.at(-1)).toContain('30 of 85 articles have been read and graded by hand');
  });

  it('does not talk about a remainder that is empty', () => {
    // "5 of 5 articles have been read by hand; the rest are the classifier's
    // reading" is a sentence about nothing, and it is what the page actually
    // printed the first time it met a fully reviewed view.
    const all = summaryLines(
      headlineCounts(measures({ reviewedTotal: 85 }), facets), facets, labels);
    expect(all.at(-1)).toBe('All 85 articles have been read and graded by hand.');
    expect(all.at(-1)).not.toContain('the rest');
  });

  it('says so plainly when nothing has been reviewed', () => {
    const unread = summaryLines(
      headlineCounts(measures({ reviewedTotal: 0 }), facets), facets, labels);
    expect(unread.at(-1)).toContain('None of these have been reviewed by hand yet');
  });

  it('says one honest thing rather than several about an empty view', () => {
    expect(summaryLines(headlineCounts(null, []), [], labels))
      .toEqual(['Nothing matches these filters yet.']);
  });

  it('never claims to describe the market rather than the coverage', () => {
    // The page is headed "where banks are with AI". Without this caveat it is
    // claiming a survey nobody carried out.
    expect(COVERAGE_CAVEAT).toContain('not what banks have built');
    expect(COVERAGE_CAVEAT).toContain('floor');
  });
});

describe('the date window note', () => {
  it('names the window, or says there is none', () => {
    // A bare count with no window beside it reads as a contradiction rather
    // than a setting: the Lens opens on July and the Archive on everything.
    expect(tileWindowNote('2026-07-01')).toBe('published since 2026-07-01');
    expect(tileWindowNote('')).toBe('all dates');
  });
});
