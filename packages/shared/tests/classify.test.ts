import { describe, expect, it } from 'vitest';
import { classify, matchTerms, DEFAULT_RELEVANCE_THRESHOLD } from '../src/classify.ts';
import { AI_TERMS } from '../src/taxonomy.ts';

const NOW = new Date('2026-08-20T00:00:00Z');
const recent = '2026-08-18T00:00:00Z';

const tagValues = (c: ReturnType<typeof classify>, dim: string) =>
  c.tags.filter((t) => t.dimension === dim).map((t) => t.value);

describe('matchTerms', () => {
  it('respects word boundaries so "ai" does not match inside words', () => {
    expect(matchTerms('he said it was a paid aid', AI_TERMS)).not.toContain('ai');
    expect(matchTerms('the bank deployed AI last year', AI_TERMS)).toContain('ai');
  });

  it('matches terms whose edges are not word characters', () => {
    expect(matchTerms('U.S. banks are hiring', ['u.s.'])).toEqual(['u.s.']);
    expect(matchTerms('advising on M&A deals', ['m&a'])).toEqual(['m&a']);
  });

  it('matches the plural form, because headlines are written in the plural', () => {
    expect(matchTerms('Swiss private banks deploy AI', ['private bank']))
      .toEqual(['private bank']);
    expect(matchTerms('wealth managers adopt copilots', ['wealth manager', 'copilot']))
      .toEqual(['wealth manager', 'copilot']);
  });

  it('does not pluralise short abbreviations', () => {
    expect(matchTerms('the ais were noisy', ['ai'])).toEqual([]);
  });

  it('matches German terms with umlauts', () => {
    expect(matchTerms('Künstliche Intelligenz im Bankwesen', ['künstliche intelligenz']))
      .toEqual(['künstliche intelligenz']);
  });
});

describe('the co-occurrence gate', () => {
  it('scores zero for AI news with no banking angle', () => {
    const c = classify({
      title: 'OpenAI releases a new large language model',
      summary: 'The model improves reasoning benchmarks.',
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    expect(c.relevanceScore).toBe(0);
    expect(c.ruleHits.map((h) => h.rule)).toContain('gate.no_banking_term');
  });

  it('scores zero for banking news with no AI angle', () => {
    const c = classify({
      title: 'Deutsche Bank reports higher quarterly profit',
      summary: 'Net income rose on strong lending revenue.',
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    expect(c.relevanceScore).toBe(0);
    expect(c.ruleHits.map((h) => h.rule)).toContain('gate.no_ai_term');
  });

  it('still tags a gated article so it stays browsable in the archive', () => {
    const c = classify({
      title: 'Deutsche Bank reports higher quarterly profit',
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    expect(tagValues(c, 'region')).toContain('germany_dach');
  });
});

describe('scoring', () => {
  it('scores a consultancy study on AI in private banking above the threshold', () => {
    const c = classify({
      title: 'McKinsey study: generative AI in private banking and wealth management',
      summary: 'A survey of Swiss private banks finds relationship manager copilots '
             + 'cutting meeting preparation time.',
      publisherKind: 'consultancy', publishedAt: recent, now: NOW,
    });
    expect(c.relevanceScore).toBeGreaterThan(DEFAULT_RELEVANCE_THRESHOLD);
    expect(tagValues(c, 'region')).toContain('switzerland');
    expect(tagValues(c, 'banking_area')).toContain('private_wealth');
    expect(tagValues(c, 'use_case')).toContain('advisory_copilot');
  });

  it('ranks a consultancy study above the identical piece from media', () => {
    const base = {
      title: 'AI adoption in retail banking',
      summary: 'A report on machine learning in consumer banking fraud detection.',
      publishedAt: recent, now: NOW,
    } as const;
    const consultancy = classify({ ...base, publisherKind: 'consultancy' });
    const media = classify({ ...base, publisherKind: 'media' });
    expect(consultancy.relevanceScore).toBeGreaterThan(media.relevanceScore);
  });

  it('ranks a recent article above an otherwise identical old one', () => {
    const base = {
      title: 'AI agents in transaction monitoring at banks',
      summary: 'Machine learning cuts AML false positives.',
      publisherKind: 'media', now: NOW,
    } as const;
    const fresh = classify({ ...base, publishedAt: '2026-08-19T00:00:00Z' });
    const old = classify({ ...base, publishedAt: '2024-01-01T00:00:00Z' });
    expect(fresh.relevanceScore).toBeGreaterThan(old.relevanceScore);
  });

  it('records an explanation for every point it awards', () => {
    const c = classify({
      title: 'Generative AI at DBS: a Singapore bank scales customer service chatbots',
      publisherKind: 'bank', publishedAt: recent, now: NOW,
    });
    expect(c.ruleHits.length).toBeGreaterThan(0);
    expect(c.ruleHits.map((h) => h.rule)).toContain('title.ai_and_banking');
    expect(c.ruleHits.map((h) => h.rule)).toContain('publisher_weight');
    expect(tagValues(c, 'region')).toContain('singapore_apac');
    expect(tagValues(c, 'use_case')).toContain('customer_service');
  });

  it('never exceeds 100', () => {
    const c = classify({
      title: 'AI machine learning LLM generative ai in banking finance fintech study',
      summary: 'chatbot fraud detection credit scoring document processing regtech '
             + 'personalisation risk model copilot equity research code generation',
      publisherKind: 'consultancy', publishedAt: recent, now: NOW,
    });
    expect(c.relevanceScore).toBeLessThanOrEqual(100);
  });
});

describe('region hints', () => {
  it('applies the source region when the text names no region', () => {
    const c = classify({
      title: 'Supervisory expectations for AI in lending',
      summary: 'The regulator sets out machine learning model governance for banks.',
      publisherKind: 'regulator', regionHint: 'switzerland',
      publishedAt: recent, now: NOW,
    });
    expect(tagValues(c, 'region')).toContain('switzerland');
  });

  it('does not duplicate a region already found in the text', () => {
    const c = classify({
      title: 'FINMA on AI model risk in Swiss banks',
      publisherKind: 'regulator', regionHint: 'switzerland',
      publishedAt: recent, now: NOW,
    });
    expect(tagValues(c, 'region').filter((v) => v === 'switzerland')).toHaveLength(1);
  });
});
