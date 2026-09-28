import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleProposals, sameStory, storyTokens, type Bundleable } from '../src/bundle.ts';

const row = (articleId: string, grade: string, title: string,
  actor: string | null = null, l1Process: string | null = null): Bundleable =>
  ({ articleId, grade, title, actor, l1Process });

const titlesOf = (bundles: Bundleable[][]) => bundles.map((b) => b.map((r) => r.articleId));

describe('storyTokens', () => {
  it('drops the words every headline here shares, and splits hyphens', () => {
    expect([...storyTokens('AI-powered tools reshape the bank')]).toEqual(['resha']);
  });

  it('keeps a figure whole, with or without its thousands separator', () => {
    expect(storyTokens('80,000 staff').has('80000')).toBe(true);
    expect(storyTokens('Train 80000 workers').has('80000')).toBe(true);
  });
});

describe('sameStory', () => {
  it('needs at least two distinctive words in common', () => {
    expect(sameStory(storyTokens('Narmi opens marketplace'), storyTokens('Narmi hires a chief'))).toBe(false);
  });

  it('two rare words are enough, however the rest is worded', () => {
    const a = storyTokens('Feedzai tackles the integration gap with Farol');
    const b = storyTokens('As banks pivot, Feedzai unveils Farol to cut investigation times');
    expect(sameStory(a, b)).toBe(false);
    expect(sameStory(a, b, (t) => t === 'feedz' || t === 'farol')).toBe(true);
  });
});

describe('bundleProposals', () => {
  it('bundles one institution\'s use case by what it is, not by its headline', () => {
    const bundles = bundleProposals([
      row('1', 'A', 'Deutsche Bank Deploys Agentic AI for KYC Onboarding',
        'Deutsche Bank', 'p23_financial_crime_aml_kyc'),
      row('2', 'A', 'TheWealthNet - Deutsche Bank PB launches AI solution for source of wealth processes',
        'Deutsche Bank', 'p23_financial_crime_aml_kyc'),
      row('3', 'A', 'Deutsche Bank deploys AI in trade finance', 'Deutsche Bank', 'p21_trade_finance'),
    ]);
    expect(titlesOf(bundles)).toEqual([['1', '2'], ['3']]);
  });

  it('never bundles across grades: an A and a B are two different claims', () => {
    const bundles = bundleProposals([
      row('1', 'A', 'BNP Paribas forges agentic AI partnership with Google Cloud',
        'BNP Paribas', 'p05_relationship_servicing_engagement'),
      row('2', 'B', 'BNP Paribas forges agentic AI partnership with Google Cloud'),
      row('3', 'D', 'BNP Paribas forges agentic AI partnership with Google Cloud'),
    ]);
    expect(bundles).toHaveLength(3);
  });

  it('keeps the list order, with each bundle where its first member was', () => {
    const bundles = bundleProposals([
      row('1', 'B', 'Japan regulator is boosting scrutiny of AI data center financing'),
      row('2', 'B', 'Paywhere launches banking services through AI assistants'),
      row('3', 'B', 'Japan regulator is boosting scrutiny of AI data centre financing'),
    ]);
    expect(titlesOf(bundles)).toEqual([['1', '3'], ['2']]);
  });

  it('a proposal that matches nothing is a bundle of one', () => {
    expect(bundleProposals([row('1', 'B', 'Something entirely different')])).toEqual(
      [[row('1', 'B', 'Something entirely different')]]);
    expect(bundleProposals([])).toEqual([]);
  });

  it('two short headlines sharing only a theme stay apart', () => {
    const bundles = bundleProposals([
      row('1', 'D', 'Wealth Managers Positive On Emerging Markets, AI, Gold, Defence'),
      row('2', 'D', 'Wealth Management Launches AI Agent'),
    ]);
    expect(bundles).toHaveLength(2);
  });

  // The first week the gate ran, as the Routine proposed it. What the editor
  // named as slow to review — the same Deutsche Bank KYC story again and again
  // — and what a wrong merge would look like, both measured on real headlines.
  describe('the week of 28 September 2026', () => {
    const file = resolve(__dirname, '../../../data/review/proposals/2026-09-28-1.jsonl');
    const order: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    const rows = readFileSync(file, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l) as Bundleable & { headline: string })
      // The proposal file holds the Routine's headline; for these it is the
      // article's title, which is what the worker bundles on.
      .map((r) => ({ ...r, title: r.headline }))
      .sort((a, b) => order[a.grade]! - order[b.grade]!);
    const bundles = bundleProposals(rows);
    const bundleWith = (text: string) => bundles.find((b) => b.some((r) => r.title.includes(text)));

    it('turns 80 proposals into fewer cards, losing none', () => {
      expect(rows).toHaveLength(80);
      expect(bundles.flat()).toHaveLength(80);
      expect(bundles.length).toBeLessThanOrEqual(65);
    });

    it('puts the three Deutsche Bank KYC reports on one card', () => {
      expect(bundleWith('Deutsche Bank Deploys Agentic AI for KYC')).toHaveLength(3);
    });

    it('puts the same story from several outlets on one card, across languages', () => {
      expect(bundleWith('Feedzai tackles')).toHaveLength(3);
      expect(bundleWith('KI-Belastung in Banken')).toHaveLength(4);
      expect(bundleWith('BNP Paribas, Google Cloud')).toHaveLength(2);
    });

    it('does not bundle a vendor launch with a round-up that shares "AI-powered"', () => {
      expect(bundleWith('OneSeven Launches')).toHaveLength(1);
      expect(bundleWith('AI-powered tools reshape')).toHaveLength(1);
    });

    it('every bundle is one grade', () => {
      for (const b of bundles) expect(new Set(b.map((r) => r.grade)).size).toBe(1);
    });
  });
});
