import { describe, expect, it } from 'vitest';
import { monthWindows, stamp } from '../src/backfill.ts';
import { backfillSources, loadSources } from '../src/sources.ts';

describe('month windows', () => {
  it('covers roughly twelve months for one year', () => {
    const w = monthWindows(1);
    expect(w.length).toBeGreaterThanOrEqual(12);
    expect(w.length).toBeLessThanOrEqual(13);
  });

  it('covers roughly thirty-six months for three years', () => {
    const w = monthWindows(3);
    expect(w.length).toBeGreaterThanOrEqual(36);
    expect(w.length).toBeLessThanOrEqual(37);
  });

  it('runs oldest first and leaves no gap between windows', () => {
    const w = monthWindows(2);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.start.getTime()).toBe(w[i - 1]!.end.getTime());
    }
  });

  it('never reaches into the future', () => {
    const w = monthWindows(1);
    expect(w[w.length - 1]!.end.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('formats stamps the way GDELT expects', () => {
    expect(stamp(new Date('2024-03-05T07:08:09Z'))).toBe('20240305070809');
    expect(stamp(new Date('2024-03-05T07:08:09Z'))).toMatch(/^\d{14}$/);
  });
});

describe('which sources the backfill uses', () => {
  const all = loadSources();

  it('takes only the broad GDELT queries, not every GDELT source', () => {
    const chosen = backfillSources(all);
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.every((s) => s.kind === 'gdelt')).toBe(true);
    expect(chosen.length).toBeLessThan(all.filter((s) => s.kind === 'gdelt').length);
  });

  it('leaves the narrow region and domain queries to the daily job', () => {
    const ids = backfillSources(all).map((s) => s.id);
    for (const narrow of ['gdelt_swiss_banks', 'gdelt_german_banks', 'gdelt_us_banks',
                          'gdelt_consultancy_big4', 'gdelt_apac']) {
      expect(ids).not.toContain(narrow);
    }
  });

  it('keeps the request count for two years well below what got us blocked', () => {
    // 9 queries x 25 months = 225 requests, of which 82% were refused.
    const requests = backfillSources(all).length * monthWindows(2).length;
    expect(requests).toBeLessThan(100);
  });

  it('never picks an RSS source — only GDELT accepts a date range', () => {
    expect(backfillSources(all).some((s) => s.kind === 'rss')).toBe(false);
  });
});
