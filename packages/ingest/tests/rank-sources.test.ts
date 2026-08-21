import { describe, expect, test } from 'vitest';
import { qualityScore, renderReport } from '../src/rank-sources.ts';

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
  const md = renderReport(rows, processes, '2026-08-21');

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
    expect(() => renderReport([], [], '2026-08-21')).not.toThrow();
  });
});
