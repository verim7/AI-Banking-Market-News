import { describe, expect, it } from 'vitest';
import { classify } from '@portal/shared';
import {
  formatRejections, gateReasonOf, summariseRejections, type RejectedItem,
} from '../src/rejections.ts';

const hits = (...rules: string[]) => ({
  ruleHits: rules.map((rule) => ({ rule, term: '-', weight: 0 })),
});

const item = (title: string, sourceName: string, ...rules: string[]): RejectedItem =>
  ({ title, sourceName, classification: hits(...rules) });

describe('which gate refused an article', () => {
  it('names the first gate, not every gate that fired', () => {
    // classify() records both when neither list matched. Reporting the pair
    // tells a reader nothing: a piece about crop yields fails both, and is
    // meant to. The first failure names the list that would have to change.
    expect(gateReasonOf(hits('gate.no_ai_term', 'gate.no_banking_evidence')))
      .toBe('no_ai_term');
    expect(gateReasonOf(hits('gate.no_banking_evidence'))).toBe('no_banking_evidence');
    expect(gateReasonOf(hits('gate.ai_not_central'))).toBe('ai_not_central');
    expect(gateReasonOf(hits('gate.market_commentary'))).toBe('market_commentary');
  });

  it('does not invent a gate for an article that simply scored nothing', () => {
    expect(gateReasonOf(hits())).toBe('unscored');
    expect(gateReasonOf(hits('ai_term', 'recency'))).toBe('unscored');
  });

  it('reads the reason off a real classification, not a hand-built one', () => {
    // The coupling this protects: gateReasonOf() matches on `gate.<reason>`,
    // so renaming a rule in classify.ts without renaming it here would leave
    // every rejection reported as "unscored" and nobody would notice.
    const crops = classify({
      title: 'Wheat futures ease on a better harvest outlook',
      summary: null, publisherKind: 'media', publishedAt: '2026-08-18T00:00:00Z',
    });
    expect(crops.relevanceScore).toBe(0);
    expect(gateReasonOf(crops)).toBe('no_ai_term');

    const aiOnly = classify({
      title: 'OpenAI releases a new large language model',
      summary: 'The model improves reasoning benchmarks.',
      publisherKind: 'media', publishedAt: '2026-08-18T00:00:00Z',
    });
    expect(aiOnly.relevanceScore).toBe(0);
    expect(gateReasonOf(aiOnly)).toBe('no_banking_evidence');
  });
});

describe('the rejection report', () => {
  const corpus = [
    item('Wheat futures ease', 'Reuters', 'gate.no_ai_term', 'gate.no_banking_evidence'),
    item('Sanctions list updated', 'Reuters', 'gate.no_ai_term', 'gate.no_banking_evidence'),
    item('OpenAI ships a model', 'TechCrunch', 'gate.no_banking_evidence'),
    item('Bank results beat', 'FT', 'gate.no_ai_term'),
    item('Analyst sees AI lifting bank margins', 'FT', 'gate.market_commentary'),
    item('Capital rules bulletin mentions AI once', 'FT', 'gate.ai_not_central'),
  ];

  it('tallies by reason, in the order the gates are applied', () => {
    const report = summariseRejections(corpus);
    expect(report.total).toBe(6);
    expect(report.byReason).toEqual([
      { reason: 'no_ai_term', count: 3 },
      { reason: 'no_banking_evidence', count: 1 },
      { reason: 'ai_not_central', count: 1 },
      { reason: 'market_commentary', count: 1 },
    ]);
  });

  it('attributes rejections to the feed that carried them', () => {
    const report = summariseRejections(corpus);
    expect(report.bySource[0]).toEqual(
      { reason: 'no_ai_term', sourceName: 'Reuters', count: 2 });
  });

  it('spends its example budget per reason, not over the report', () => {
    // no_ai_term is always the biggest bucket and always the least
    // interesting. A flat cap would fill the sample with it and hide the
    // commentary rejections, which are the ones worth arguing about.
    const noisy = Array.from({ length: 50 },
      (_, i) => item(`Ordinary news ${i}`, 'Reuters', 'gate.no_ai_term'));
    const report = summariseRejections(
      [...noisy, item('Analyst note', 'FT', 'gate.market_commentary')], 5);

    expect(report.total).toBe(51);
    expect(report.examples.filter((e) => e.reason === 'no_ai_term')).toHaveLength(5);
    expect(report.examples.map((e) => e.title)).toContain('Analyst note');
  });

  it('carries the evidence the gate recorded, where there is any', () => {
    const report = summariseRejections([{
      title: 'Capital rules bulletin', sourceName: 'FT',
      classification: { ruleHits: [
        { rule: 'gate.ai_not_central', term: 'intensity 12 < 30', weight: 0 },
      ] },
    }]);
    expect(report.examples[0]?.detail).toBe('intensity 12 < 30');
  });

  it('prints real headlines and a reason for each', () => {
    const text = formatRejections(summariseRejections(corpus)).join('\n');
    expect(text).toContain('6 rejected at the gate');
    expect(text).toContain('no AI term matched');
    expect(text).toContain('"Wheat futures ease" — Reuters');
    expect(text).toContain('"Analyst sees AI lifting bank margins" — FT');
  });

  it('says so when nothing was rejected, because that is the suspicious case', () => {
    const report = summariseRejections([]);
    expect(report.total).toBe(0);
    expect(report.byReason).toEqual([]);
    expect(formatRejections(report).join('\n')).toContain('itself worth checking');
  });
});
