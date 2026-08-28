import { describe, expect, it } from 'vitest';
import { deadIntegrations } from '../src/run.ts';

/**
 * The line this draws is the whole design: a publisher retiring its RSS feed
 * is weather, and failing the daily run on one would make it permanently red.
 * An entire integration failing is not weather.
 */
describe('telling a dead integration from a dead feed', () => {
  const ok = (kind: string) => ({ kind, ok: true });
  const bad = (kind: string) => ({ kind, ok: false });

  it('says nothing when every source works', () => {
    expect(deadIntegrations([ok('rss'), ok('rss'), ok('gdelt')])).toEqual([]);
  });

  it('says nothing when one feed of many dies', () => {
    // The normal case, and the reason this is not just "any failure".
    expect(deadIntegrations([ok('rss'), ok('rss'), bad('rss'), ok('gdelt')])).toEqual([]);
  });

  it('names the integration when all of its sources fail', () => {
    // 2026-08-28: both GDELT queries returned "fetch failed" while the run
    // printed 29/37 and exited zero.
    expect(deadIntegrations([ok('rss'), ok('rss'), bad('gdelt'), bad('gdelt')]))
      .toEqual(['gdelt']);
  });

  it('names every dead integration, not just the first', () => {
    expect(deadIntegrations([bad('rss'), bad('gdelt')])).toEqual(['gdelt', 'rss']);
  });

  it('ignores an outcome with no kind rather than inventing one', () => {
    // Older snapshots have no kind on their outcomes; a missing field must not
    // become a phantom integration that is always down.
    expect(deadIntegrations([{ ok: false }, ok('rss')])).toEqual([]);
  });

  it('is silent on an empty run', () => {
    expect(deadIntegrations([])).toEqual([]);
  });
});
