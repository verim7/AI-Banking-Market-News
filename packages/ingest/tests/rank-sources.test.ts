import { describe, expect, test } from 'vitest';
import { candidatesToDrop, corpusProductionRate, qualityScore, renderReport } from '../src/rank-sources.ts';

const source = (over: Partial<Parameters<typeof qualityScore>[0]> = {}) => ({
  articles: 10, mean_ai: 50, in_production: 2, with_use_case: 4, ...over,
});

describe('what the score rewards', () => {
  test('production evidence outweighs everything else', () => {
    const deploys = qualityScore(source({ in_production: 8 }));
    const talks = qualityScore(source({ in_production: 0 }));
    expect(deploys).toBeGreaterThan(talks);
  });

  // The whole point of the logarithm: a firehose must not outrank a specialist
  // just by publishing more.
  test('a small source with real deployments beats a large one without', () => {
    const specialist = qualityScore({
      articles: 12, mean_ai: 70, in_production: 7, with_use_case: 9 });
    const firehose = qualityScore({
      articles: 400, mean_ai: 34, in_production: 3, with_use_case: 20 });
    expect(specialist).toBeGreaterThan(firehose);
  });

  test('volume still breaks a tie between otherwise equal sources', () => {
    const big = qualityScore(source({ articles: 100, in_production: 20, with_use_case: 40 }));
    const small = qualityScore(source({ articles: 10, in_production: 2, with_use_case: 4 }));
    expect(big).toBeGreaterThan(small);
  });

  test('a source that clears the gate without being about AI scores poorly', () => {
    const barely = qualityScore(source({ mean_ai: 31 }));
    const genuinely = qualityScore(source({ mean_ai: 85 }));
    expect(genuinely).toBeGreaterThan(barely);
  });

  test('a source with nothing stored scores zero rather than dividing by zero', () => {
    expect(qualityScore({ articles: 0, mean_ai: 0, in_production: 0, with_use_case: 0 }))
      .toBe(0);
  });
});

describe('the report', () => {
  const rows = [
    { source_id: 'a', source_name: 'Alpha Trade Weekly', publisher_kind: 'media',
      articles: 12, mean_ai: 72, max_ai: 95, in_production: 7, piloting: 2,
      with_use_case: 9, first_seen: '2025-09-01', last_seen: '2026-08-01' },
    { source_id: 'b', source_name: 'Broad Wire', publisher_kind: 'media',
      articles: 300, mean_ai: 33, max_ai: 60, in_production: 0, piloting: 1,
      with_use_case: 12, first_seen: '2025-09-01', last_seen: '2026-08-01' },
  ];
  const processes = [
    { source_id: 'a', value: 'client_onboarding', n: 5 },
    { source_id: 'a', value: 'advisory_sales', n: 4 },
  ];
  const outlets = [
    { source_id: 'Reuters', source_name: 'Reuters', publisher_kind: 'media',
      articles: 9, mean_ai: 66, max_ai: 90, in_production: 5, piloting: 1,
      with_use_case: 7, first_seen: null, last_seen: null },
    { source_id: 'Passing Mention Daily', source_name: 'Passing Mention Daily',
      publisher_kind: 'media', articles: 1, mean_ai: 99, max_ai: 99,
      in_production: 1, piloting: 0, with_use_case: 1,
      first_seen: null, last_seen: null },
  ];
  const names = new Map([['a', 'Alpha Trade Weekly'], ['b', 'Broad Wire']]);
  const md = renderReport(rows, outlets, processes, '2026-08-21', names);

  test('ranks the specialist above the firehose', () => {
    expect(md.indexOf('Alpha Trade Weekly')).toBeLessThan(md.indexOf('Broad Wire'));
  });

  test('names a high-volume source with no deployments as a candidate to drop', () => {
    expect(md).toContain('Candidates to drop');
    const dropSection = md.slice(md.indexOf('Candidates to drop'));
    expect(dropSection).toContain('Broad Wire');
    expect(dropSection).not.toContain('Alpha Trade Weekly');
  });

  test('reports what each source covers, so a narrow source can be found on purpose', () => {
    expect(md).toContain('client_onboarding');
  });

  test('states the corpus it was computed from rather than asserting a ranking', () => {
    expect(md).toContain('312 stored articles');
    expect(md).toContain('2026-08-21');
  });

  test('carries the guidance for finding further sources', () => {
    expect(md).toContain('Trade press beats general press');
    expect(md).toContain('Deployment verbs beat topic words');
  });

  test('an empty database produces a report rather than throwing', () => {
    expect(() => renderReport([], [], [], '2026-08-21')).not.toThrow();
  });

  test('names sources by their configuration, not by whoever published a row', () => {
    // The stored source_name is the outlet — for a Google News query that
    // differs per article, so the source table must be labelled from the file.
    expect(md).toContain('Alpha Trade Weekly');
  });
});

describe('the outlet table, which answers where to look next', () => {
  const rows = [
    { source_id: 'gnews', source_name: 'gnews', publisher_kind: 'media',
      articles: 50, mean_ai: 55, max_ai: 90, in_production: 5, piloting: 3,
      with_use_case: 20, first_seen: null, last_seen: null },
  ];
  const outlets = [
    { source_id: 'Reuters', source_name: 'Reuters', publisher_kind: 'media',
      articles: 9, mean_ai: 66, max_ai: 90, in_production: 5, piloting: 1,
      with_use_case: 7, first_seen: null, last_seen: null },
    { source_id: 'Passing Mention Daily', source_name: 'Passing Mention Daily',
      publisher_kind: 'media', articles: 1, mean_ai: 99, max_ai: 99,
      in_production: 1, piloting: 0, with_use_case: 1,
      first_seen: null, last_seen: null },
  ];
  const md = renderReport(rows, outlets, [], '2026-08-21',
                          new Map([['gnews', 'Google News — banking']]));

  test('lists an outlet that recurs with real deployments', () => {
    expect(md).toContain('Outlets worth adding as their own source');
    expect(md).toContain('Reuters');
  });

  // A single article at 100% production is not a 100% production rate, and
  // listing it would send someone chasing a source on one data point.
  test('omits an outlet with too few articles for its rates to mean anything', () => {
    expect(md).not.toContain('Passing Mention Daily');
  });

  test('keeps the outlet table separate from the configured-source table', () => {
    expect(md.indexOf('Google News — banking'))
      .toBeLessThan(md.indexOf('Outlets worth adding'));
  });
});


describe('judging a source against how this corpus actually behaves', () => {
  const at = (articles: number, in_production: number, mean_ai = 55) =>
    ({ articles, in_production, mean_ai });

  test('the corpus rate is the share of all articles with production evidence', () => {
    expect(corpusProductionRate([at(50, 2), at(50, 2)])).toBeCloseTo(0.04);
    expect(corpusProductionRate([])).toBe(0);
  });

  // The failure the first version had: at a ~4% base rate a 13-article source
  // expects half a deployment, so zero is the most likely outcome and means
  // nothing. Flagging it named eight of seventeen sources, including the best.
  test('a small source with no deployments is not flagged at a low base rate', () => {
    const rows = [at(500, 20), at(13, 0)];
    expect(candidatesToDrop(rows)).not.toContainEqual(at(13, 0));
  });

  test('a source large enough to expect three deployments and having none is flagged', () => {
    const rows = [at(500, 20), at(200, 0)];
    expect(candidatesToDrop(rows)).toContainEqual(at(200, 0));
  });

  test('a source scraping the gate floor is flagged whatever its volume', () => {
    const rows = [at(500, 20), at(10, 1, 31)];
    expect(candidatesToDrop(rows)).toContainEqual(at(10, 1, 31));
  });

  test('a genuinely good source is never flagged', () => {
    const rows = [at(500, 20), at(40, 9, 78)];
    expect(candidatesToDrop(rows)).not.toContainEqual(at(40, 9, 78));
  });

  test('with no production anywhere, nothing is flagged for lacking it', () => {
    // Zero corpus rate means the measure carries no information yet; inventing
    // a threshold there would condemn every source on the first week of data.
    const rows = [at(100, 0), at(100, 0)];
    expect(candidatesToDrop(rows)).toEqual([]);
  });

  test('the report says nothing qualifies rather than omitting the section', () => {
    const good = [{ source_id: 'a', source_name: 'a', publisher_kind: 'media',
      articles: 40, mean_ai: 78, max_ai: 90, in_production: 9, piloting: 2,
      with_use_case: 30, first_seen: null, last_seen: null }];
    const md = renderReport(good, [], [], '2026-08-21');
    expect(md).toContain('Nothing qualifies');
  });
});
