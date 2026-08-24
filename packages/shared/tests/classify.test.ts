import { describe, expect, it, test } from 'vitest';
import {
  classify, matchTerms, sentencesOf, summarise,
  DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY,
} from '../src/classify.ts';
import { AI_TERMS, L1_PROCESSES, MARKET_COMMENTARY_TERMS } from '../src/taxonomy.ts';

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
      .toContain('p23_financial_crime_aml_kyc');
    expect(procsOf(at('AI writes credit memos for underwriting at a bank')))
      .toContain('p13_lending_credit_solutions');
    expect(procsOf(at('AI drafts client reporting and portfolio statements at a bank')))
      .toContain('p10_client_reporting_communications');
  });

  it('allocates a shared term to the process that owns the work', () => {
    // These three pairs are the collisions that matter in the P1-P38 landscape,
    // and each is a decision rather than an accident. A term left in two places
    // dilutes both, because an article can carry several process tags.

    // Fraud is P24, not the AML process it used to share a bucket with.
    const fraud = procsOf(at('Bank deploys AI fraud detection for card payments'));
    expect(fraud).toContain('p24_fraud_identity_security');
    expect(fraud).not.toContain('p23_financial_crime_aml_kyc');

    // Model risk is P37's responsible-deployment work, not P28's control testing.
    const governance = procsOf(at('Bank sets up model risk management for its AI models'));
    expect(governance).toContain('p37_ai_governance_responsible');
    expect(governance).not.toContain('p28_operational_risk_control_audit');

    // "kyc" belongs to P23; "account opening" to P4. An article doing both gets
    // both, which is the point of allowing several tags.
    const both = procsOf(at('AI speeds up KYC and account opening at a bank'));
    expect(both).toContain('p23_financial_crime_aml_kyc');
    expect(both).toContain('p04_client_onboarding_activation');
  });

  it('covers the whole supplied landscape, not a subset of it', () => {
    // The list is the business's own P1-P38 and must not quietly lose an entry.
    expect(L1_PROCESSES).toHaveLength(38);
    for (const [i, entry] of L1_PROCESSES.entries()) {
      expect(entry.label.startsWith(`P${i + 1} `)).toBe(true);
      expect(entry.terms.length).toBeGreaterThan(0);
    }
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

describe('a bank using AI, not a bank talking about AI', () => {
  const at = (title: string, summary: string, publisherKind: 'bank' | 'consultancy' | 'regulator' = 'bank') =>
    classify({ title, summary, publisherKind, publishedAt: recent, now: NOW });

  // These clear every other check — AI in the headline, a named institution,
  // high intensity — and none is a banking AI use case. They are macro and
  // equity research that happen to be about the AI industry.
  const COMMENTARY: [string, string][] = [
    ['Goldman Sachs raises US GDP forecast on AI capital expenditure',
     'Economists at the bank said AI spending will add 0.4% to growth.'],
    ['JPMorgan analysts see $500bn of AI spending next year',
     'In a note to clients, strategists forecast data centre buildout.'],
    ['Morgan Stanley: AI stocks rally has further to run',
     'The research report raised price targets across semiconductors.'],
    ['UBS says AI boom will lift the S&P 500',
     'Analysts at the Swiss bank expect the AI trade to broaden.'],
  ];

  it.each(COMMENTARY)('drops %s', (title, summary) => {
    const c = at(title, summary);
    expect(c.relevanceScore).toBe(0);
    expect(c.ruleHits.map((h) => h.rule)).toContain('gate.market_commentary');
  });

  it('separates spending ON AI from a forecast ABOUT AI spending', () => {
    // The distinction is the verb, and nothing else in the sentence.
    const doing = at('JPMorgan to spend $17bn on technology including AI tooling',
                     'The bank is building an internal AI platform for its bankers.');
    const talking = at('JPMorgan estimates AI spending will reach $17bn',
                       'Analysts at the bank forecast capital expenditure across the sector.');
    expect(doing.relevanceScore).toBeGreaterThan(0);
    expect(talking.relevanceScore).toBe(0);
  });

  it('keeps genuine deployments, studies and supervisory guidance', () => {
    expect(at('DBS deploys generative AI assistant to 20,000 employees',
              'The bank rolled out the copilot across its operations teams.')
      .relevanceScore).toBeGreaterThan(0);
    expect(at('McKinsey study: how banks are adopting generative AI',
              'A survey of AI deployment across retail banking operations.', 'consultancy')
      .relevanceScore).toBeGreaterThan(0);
    expect(at('FINMA sets expectations for AI model governance at banks',
              'Supervisory guidance on machine learning model risk.', 'regulator')
      .relevanceScore).toBeGreaterThan(0);
  });
});

describe('the use-case description is quoted, never written', () => {
  it('quotes the sentence that carries the use case, verbatim', () => {
    const summary = 'The lender has deployed a generative AI assistant that drafts credit '
                  + 'memos for its underwriting teams. Shares rose 2%.';
    const c = classify({
      title: 'Bank modernises operations', summary,
      publisherKind: 'bank', publishedAt: recent, now: NOW,
    });
    expect(c.useCaseEvidence).toContain('generative AI assistant that drafts credit memos');
    // Verbatim: the quoted text must appear in the source, character for
    // character, or it is a description someone could not check.
    expect(summary).toContain(c.useCaseEvidence!);
    // And it picks the sentence about the use case, not the one about the shares.
    expect(c.useCaseEvidence).not.toContain('Shares rose');
  });

  it('says nothing when the text describes no use case', () => {
    const c = classify({
      title: 'Bank appoints new chief technology officer',
      summary: 'The appointment takes effect in March.',
      publisherKind: 'bank', publishedAt: recent, now: NOW,
    });
    expect(c.useCaseEvidence).toBeNull();
  });

  it('falls back to the headline only when the headline itself is concrete', () => {
    const c = classify({
      title: 'Barclays deploys AI agents across its back office',
      publisherKind: 'bank', publishedAt: recent, now: NOW,
    });
    expect(c.useCaseEvidence).toBe('Barclays deploys AI agents across its back office');
  });

  it('never returns text that is not in the article', () => {
    const summary = 'The bank uses machine learning for fraud detection in payments.';
    const c = classify({ title: 'Bank news', summary, publisherKind: 'bank',
                         publishedAt: recent, now: NOW });
    if (c.useCaseEvidence) {
      expect(`${summary} Bank news`).toContain(c.useCaseEvidence);
    }
  });
});

describe('the equity register, and hyphens', () => {
  // Found in a live source check, top of the highest-yielding query. It names
  // banks, so the co-occurrence gate passed it; none of the original
  // commentary terms appear in it; and the one that should have —"big tech" —
  // never fired because the headline hyphenates the compound.
  const voxeu = 'If AI disappoints? The transmission of US big-tech earnings news '
              + 'to bank equity prices';

  test('rejects a research note about AI and bank share prices', () => {
    expect(classify({ title: voxeu, publisherKind: 'media' }).relevanceScore).toBe(0);
  });

  test('a hyphenated compound matches the spaced term', () => {
    expect(matchTerms('us big-tech earnings news', MARKET_COMMENTARY_TERMS))
      .toContain('big tech');
    expect(matchTerms('us big tech earnings news', MARKET_COMMENTARY_TERMS))
      .toContain('big tech');
  });

  test('an en dash is a hyphen for this purpose too', () => {
    expect(matchTerms('big–tech valuations', MARKET_COMMENTARY_TERMS)).toContain('big tech');
  });

  test('bare "earnings" counts, not only "earnings season"', () => {
    expect(matchTerms('bank earnings beat forecasts', MARKET_COMMENTARY_TERMS))
      .toContain('earnings');
  });

  // The widened vocabulary must not start eating the articles the tool exists
  // for. These are real headlines from the same check that should survive.
  test.each([
    ['DBS deploys specialist AI agents for 1,500 employees',
     'The bank said the agents are live across the group.'],
    ['UBS rolls out generative AI copilot to advisers',
     'Now generally available to all relationship managers.'],
    ['HSBC expands machine learning fraud detection',
     'The system is in production across retail banking.'],
    ["India's Banking Regulator Urges Lenders to Accelerate AI Spend",
     'The regulator issued guidance to banks.'],
    ['Starling Bank launches Smart Tools built on AI',
     'Customers can build custom banking features.'],
  ])('keeps real adoption: %s', (title, summary) => {
    expect(classify({ title, summary, publisherKind: 'media' }).relevanceScore)
      .toBeGreaterThan(0);
  });

  // The pair that only the verb separates, re-asserted against the wider list.
  test('spending on AI is adoption; forecasting AI spending is not', () => {
    const spend = classify({
      title: 'JPMorgan to spend $17bn on technology including AI',
      summary: 'The bank will roll out tools to employees.', publisherKind: 'media' });
    const forecast = classify({
      title: 'JPMorgan estimates AI spending will reach $500bn, lifting GDP',
      summary: 'Analysts said in a note to clients.', publisherKind: 'media' });
    expect(spend.relevanceScore).toBeGreaterThan(0);
    expect(forecast.relevanceScore).toBe(0);
  });
});

describe('the extractive summary', () => {
  const article = [
    'DBS Bank has deployed specialist generative AI agents to 1,500 employees '
      + 'across its wealth management business.',
    'The rollout followed a six-month pilot with relationship managers in Singapore.',
    'Shares in the lender closed slightly higher on the announcement.',
    'The bank said the agents now handle client research and portfolio summaries '
      + 'that previously took analysts several hours.',
    'A spokesperson declined to comment on the cost of the programme.',
  ].join(' ');

  // The guarantee the whole design rests on: someone checking whether a bank
  // really deployed something must be able to find every word in the source.
  test('every sentence it returns appears verbatim in the article', () => {
    const summary = summarise(article)!;
    for (const sentence of sentencesOf(summary)) {
      expect(article).toContain(sentence);
    }
  });

  test('keeps the sentences that carry the deployment', () => {
    const summary = summarise(article)!;
    expect(summary).toContain('deployed specialist generative AI agents');
  });

  test('reads in the article order, not in score order', () => {
    const summary = summarise(article)!;
    const deployed = summary.indexOf('deployed specialist');
    const followed = summary.indexOf('rollout followed');
    if (deployed >= 0 && followed >= 0) expect(deployed).toBeLessThan(followed);
  });

  test('says nothing rather than something thin', () => {
    expect(summarise(null)).toBeNull();
    expect(summarise('')).toBeNull();
    expect(summarise('Short.')).toBeNull();
    // Long enough to split, but about nothing this tool covers.
    expect(summarise('The weather in Zurich was pleasant throughout the whole of '
      + 'last week and many people sat outside by the lake.')).toBeNull();
  });

  test('never cuts a sentence in half to reach the length limit', () => {
    const summary = summarise(article, { maxChars: 140 })!;
    expect(article).toContain(summary);
    expect(summary.length).toBeLessThanOrEqual(140);
  });

  test('honours the sentence count', () => {
    expect(sentencesOf(summarise(article, { maxSentences: 1 })!).length).toBe(1);
  });
});
