import { describe, expect, it } from 'vitest';
import {
  classify, matchTerms, DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY,
} from '../src/classify.ts';
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
    expect(c.ruleHits.map((h) => h.rule)).toContain('gate.no_banking_evidence');
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

describe('named institutions count as financial evidence', () => {
  // Regression fixtures. Every one of these scored zero before, because the
  // gate demanded the literal word "bank" — discarding exactly the specific,
  // named use cases this portal exists to collect.
  const NAMED = [
    'Lloyds deploys agentic AI for customer service',
    'UBS rolls out generative AI copilot for client advisors',
    'DBS expands machine learning fraud detection',
    'JPMorgan launches LLM research assistant',
    'Revolut uses AI to cut onboarding times',
    'FINMA publishes guidance on AI model governance',
  ];

  it.each(NAMED)('scores %s above the default floor', (title) => {
    const c = classify({ title, publisherKind: 'media', publishedAt: recent, now: NOW });
    expect(c.relevanceScore).toBeGreaterThanOrEqual(DEFAULT_RELEVANCE_THRESHOLD);
  });

  it('records the institution that fired, so the HIL tab can explain itself', () => {
    const c = classify({
      title: 'DBS expands machine learning fraud detection',
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    const hit = c.ruleHits.find((h) => h.rule === 'institution');
    expect(hit?.term).toBe('dbs');
  });

  it('does not let an institution alone open the gate without an AI term', () => {
    const c = classify({
      title: 'UBS reports higher quarterly profit',
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    expect(c.relevanceScore).toBe(0);
    expect(c.ruleHits.map((h) => h.rule)).toContain('gate.no_ai_term');
  });

  it('still rejects AI news with no financial angle at all', () => {
    for (const title of [
      'OpenAI releases a new large language model',
      'Nvidia earnings beat on AI chip demand',
    ]) {
      const c = classify({ title, publisherKind: 'media', publishedAt: recent, now: NOW });
      expect(c.relevanceScore).toBe(0);
      expect(c.ruleHits.map((h) => h.rule)).toContain('gate.no_banking_evidence');
    }
  });

  it('excludes "sec", which collides with seconds and section', () => {
    const c = classify({
      title: 'The model runs in 30 sec per AI inference',
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    expect(c.relevanceScore).toBe(0);
  });
});

describe('AI must be the subject, not a passing mention', () => {
  const at = (title: string, summary: string, publisherKind: 'bank' | 'regulator' | 'media' | 'consultancy') =>
    classify({ title, summary, publisherKind, publishedAt: recent, now: NOW });

  // The portal is for AI in banking. Regulatory, sanctions and results
  // coverage is what was filling the Lens, and none of it belongs here.
  const DROP: [string, string][] = [
    ['ECB extends sanctions reporting requirements for Russian entities',
     'Banks must file additional returns on frozen assets.'],
    ['Basel Committee finalises capital rules for market risk',
     'New standards take effect in 2027.'],
    ['Bank updates its branch opening hours',
     'A note on service changes; the AI chatbot page is unaffected.'],
  ];

  it.each(DROP)('drops %s', (title, summary) => {
    expect(at(title, summary, 'regulator').relevanceScore).toBe(0);
  });

  it('drops AI news with no financial angle', () => {
    const c = at('Nvidia earnings beat on AI chip demand', 'Data centre revenue surged.', 'media');
    expect(c.relevanceScore).toBe(0);
  });

  it('keeps AI in banking supervision, which is squarely in scope', () => {
    const c = at('FINMA consults on governance expectations for AI models in banks',
                 'Supervisory guidance on model risk and explainability for machine learning.',
                 'regulator');
    expect(c.relevanceScore).toBeGreaterThan(0);
    expect(c.aiIntensity).toBeGreaterThanOrEqual(MIN_AI_INTENSITY);
  });

  it('records why an article was judged not about AI', () => {
    const c = at('Basel Committee finalises capital rules', 'Standards for market risk.', 'regulator');
    expect(c.ruleHits.map((h) => h.rule)).toContain('gate.no_ai_term');
  });
});

describe('AI type, L1 process and maturity', () => {
  const at = (title: string, summary = '') =>
    classify({ title, summary, publisherKind: 'bank', publishedAt: recent, now: NOW });

  const typesOf = (c: ReturnType<typeof classify>) =>
    c.tags.filter((t) => t.dimension === 'ai_type').map((t) => t.value);
  const procsOf = (c: ReturnType<typeof classify>) =>
    c.tags.filter((t) => t.dimension === 'l1_process').map((t) => t.value);

  it('separates generative, agentic, machine learning and rules', () => {
    expect(typesOf(at('Bank deploys a generative AI copilot for advisors'))).toContain('generative_ai');
    expect(typesOf(at('Bank deploys agentic AI agents in operations'))).toContain('agentic_ai');
    expect(typesOf(at('Bank uses machine learning for credit scoring'))).toContain('machine_learning');
    expect(typesOf(at('Bank replaces its rules engine and RPA bots with AI')))
      .toContain('traditional_automation');
  });

  it('allows more than one type, because real systems combine them', () => {
    const types = typesOf(at('Agentic AI built on large language models at a bank'));
    expect(types).toContain('agentic_ai');
    expect(types).toContain('generative_ai');
  });

  it('places articles in the L1 process they describe', () => {
    expect(procsOf(at('AI cuts AML false positives in transaction monitoring at a bank')))
      .toContain('financial_crime');
    expect(procsOf(at('AI speeds up KYC and account opening at a bank')))
      .toContain('client_onboarding');
    expect(procsOf(at('AI writes credit memos for underwriting at a bank')))
      .toContain('lending_credit');
  });

  it('reads a live rollout as production and cites the phrase', () => {
    const c = at('Bank rolls out AI assistant',
                 'The generative AI tool is now live and deployed across the group.');
    expect(c.maturity).toBe('in_production');
    expect(c.maturityEvidence).toBeTruthy();
  });

  it('does not read a pilot as production, even when it was "launched"', () => {
    const c = at('Bank launches AI pilot',
                 'The bank launched a pilot of its machine learning fraud model.');
    expect(c.maturity).toBe('pilot');
  });

  it('reads a rollout that followed a pilot as production', () => {
    const c = at('Bank scales its AI assistant',
                 'Generative AI rolled out to all 60,000 staff after a successful pilot.');
    expect(c.maturity).toBe('in_production');
  });

  it('separates an intention from a deployment', () => {
    expect(at('Bank plans to deploy AI', 'The lender plans to build a machine learning platform.').maturity)
      .toBe('announced');
    expect(at('AI adoption in banking', 'A study of machine learning across lenders.').maturity)
      .toBe('research');
  });

  it('says nothing rather than guessing when there is no signal', () => {
    const c = at('Machine learning and banking', 'Some thoughts on models at a bank.');
    expect(c.maturity).toBe('unknown');
    expect(c.maturityEvidence).toBeNull();
  });
});
