import { describe, expect, it, test } from 'vitest';
import {
  actorKey, classify, echoesTitle, sentencesOf, summarise, useCaseKey,
  DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY,
} from '../src/classify.ts';
import { matchTerms } from '../src/terms.ts';
import {
  AI_TERMS, ANALYST_RATING_TERMS, BANKING_TERMS, L1_PROCESSES, MARKET_COMMENTARY_TERMS,
} from '../src/taxonomy.ts';

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

describe('the vocabulary gap that dropped a real article', () => {
  /**
   * "Anthropic launches Claude for Financial Advisors" came down the Finextra AI
   * feed — a source this project already polls — and was dropped at ingest with
   * a relevance score of zero, failing BOTH gates at once: no AI term matched,
   * and no banking evidence. The list knew `chatgpt` and `copilot` and none of
   * the other model names; and an adviser was not banking evidence, in a tool
   * half of whose audience is wealth management.
   */
  const score = (title: string) => classify({
    title, summary: null, excerpt: null, publisherKind: 'media',
    publishedAt: recent, now: NOW,
  }).relevanceScore;

  it('keeps the article that started this', () => {
    expect(score('Anthropic launches Claude for Financial Advisors')).toBeGreaterThan(0);
  });

  it('reads a model name as an AI term, because headlines use the brand', () => {
    for (const t of ['anthropic', 'claude', 'openai', 'gemini', 'gpt']) {
      expect(matchTerms(`Deutsche Bank adopts ${t} across the group`, AI_TERMS))
        .toContain(t);
    }
  });

  it('reads an adviser as banking evidence', () => {
    // The plural comes free: matchTerms pluralises terms of four characters or
    // more, which is why "Financial Advisors" matches "financial advisor".
    expect(score('Claude arrives for financial advisers')).toBeGreaterThan(0);
    expect(score('Anthropic ships a tool for wealth advisors')).toBeGreaterThan(0);
  });

  it('still refuses the words that only look like AI', () => {
    // Deliberately absent from AI_TERMS: each is an ordinary English word or a
    // common metaphor, and each appears in the graded corpus only in headlines
    // that already say AI — so admitting them buys nothing and costs precision.
    expect(matchTerms('the bedrock of banking compliance', AI_TERMS)).toEqual([]);
    expect(matchTerms('a mistral blew through the markets', AI_TERMS)).toEqual([]);
    expect(matchTerms('perplexity among lenders about the rules', AI_TERMS)).toEqual([]);
  });

  it('does not let a bare advisory mean banking', () => {
    // "DBS rolls out career advisory service to help employees navigate
    // AI-driven change" is HR, and it is in the corpus.
    expect(matchTerms('career advisory service for employees', BANKING_TERMS))
      .toEqual([]);
  });
});

/*
 * The second round, asked for after the first: not "what did we miss this
 * time" but "what else is the vocabulary blind to, and how would we know?"
 *
 * Every term below was measured against the 1,024-article graded corpus before
 * it was admitted or refused, and the refusals matter as much as the additions
 * — which is why both are asserted here. A term someone removes because it
 * "looks harmless" should fail a test, not a production run.
 */
describe('the vocabulary, widened on measured evidence', () => {
  const score = (title: string) => classify({
    title, summary: null, excerpt: null, publisherKind: 'media',
    publishedAt: recent, now: NOW,
  }).relevanceScore;

  it('knows the labs whose names contain no AI word', () => {
    // The selection rule for this group, stated once: matchTerms treats a
    // hyphen and a space as word boundaries, so bare `ai` already covers
    // "AI-powered", "Meta AI" and "Mistral AI". Only names that contain
    // neither "AI" nor another listed term are gaps.
    for (const t of ['deepmind', 'cohere', 'databricks', 'palantir', 'hugging face']) {
      expect(matchTerms(`Deutsche Bank signs with ${t} for the group`, AI_TERMS))
        .toContain(t);
    }
  });

  it('knows the techniques the category words miss', () => {
    for (const t of ['chatbot', 'voicebot', 'model context protocol',
                     'multi-agent', 'autonomous agent', 'digital worker']) {
      expect(matchTerms(`the bank put a ${t} into production`, AI_TERMS)).toContain(t);
    }
  });

  it('will not read Claude\u2019s model names as AI terms', () => {
    // A sonnet is a poem, an opus is a musical work, a haiku is a poem. Zero
    // hits in the corpus is the argument for leaving them out, not against:
    // any hit at all would be a false one.
    for (const t of ['sonnet', 'opus', 'haiku']) {
      expect(matchTerms(`a ${t} about the market`, AI_TERMS)).toEqual([]);
    }
  });

  it('will not read a bare agent or advisor as evidence of anything', () => {
    // `agent`: 58 corpus hits, insurance agents and estate agents among them.
    // `advisor`: 37 hits, ten of them D-graded — the worst ratio measured.
    expect(matchTerms('the insurance agent called', AI_TERMS)).toEqual([]);
    expect(matchTerms('an advisor joined the board', BANKING_TERMS)).toEqual([]);
  });

  it('reads the advisory vocabulary the process taxonomy already uses', () => {
    // P07 is named for investment advisory. The gate did not know the phrase
    // the taxonomy is built on.
    for (const t of ['investment advisory', 'investment advice', 'investment proposal']) {
      expect(matchTerms(`Claude drafts the ${t}`, BANKING_TERMS)).toContain(t);
    }
    expect(score('OpenAI tool writes the investment proposal')).toBeGreaterThan(0);
  });

  it('reads core banking work as banking, including the acronyms', () => {
    for (const t of ['kyc', 'aml', 'anti-money laundering', 'know your customer',
                     'mortgage', 'loan', 'underwriting', 'collateral', 'treasury',
                     'custodian', 'brokerage', 'securities', 'reconciliation']) {
      expect(matchTerms(`an AI agent handles ${t} work`, BANKING_TERMS)).toContain(t);
    }
  });

  it('closes the two gaps a word boundary created', () => {
    // `bank` needs a non-letter before it, so it never matched inside
    // "neobank"; and `asset manager` does not pluralise into "management".
    expect(matchTerms('the neobank deployed agents', BANKING_TERMS)).toContain('neobank');
    expect(matchTerms('an asset management arm', BANKING_TERMS)).toContain('asset management');
  });

  it('counts a named supervisor as banking, because headlines name the regulator', () => {
    for (const t of ['finma', 'bafin', 'fca', 'ecb', 'federal reserve']) {
      expect(matchTerms(`${t} publishes AI guidance`, BANKING_TERMS)).toContain(t);
    }
    expect(score('FINMA sets out expectations for agentic AI')).toBeGreaterThan(0);
  });

  it('reads German, because the Swiss and DACH sources publish in it', () => {
    for (const t of ['privatbank', 'verm\u00f6gensverwaltung', 'hypothek',
                     'zahlungsverkehr', 'anlageberatung', 'kredit']) {
      expect(matchTerms(`KI-Agenten im ${t}`, BANKING_TERMS)).toContain(t);
    }
  });

  it('still refuses the banking words that are commoner in their ordinary sense', () => {
    expect(matchTerms('an AI assurance layer for models', BANKING_TERMS)).toEqual([]);
    expect(matchTerms('employee onboarding with a chatbot', BANKING_TERMS)).toEqual([]);
    expect(matchTerms('a portfolio of AI experiments', BANKING_TERMS)).toEqual([]);
  });

  it('does not turn the wider gate into an open one', () => {
    // The gate is still a conjunction: banking evidence without an AI term is
    // as rejected as it ever was, and the reverse likewise.
    expect(score('FINMA raises the countercyclical capital buffer')).toBe(0);
    expect(score('DeepMind folds another protein')).toBe(0);
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

  it('no longer quotes the headline back, however concrete the headline is', () => {
    // This used to return the title. The column sits directly beneath the
    // title in the table, so the reader saw the same words twice with the
    // second copy dressed as corroboration.
    const c = classify({
      title: 'Barclays deploys AI agents across its back office',
      publisherKind: 'bank', publishedAt: recent, now: NOW,
    });
    expect(c.useCaseEvidence).toBeNull();
  });

  it('ignores a summary that is the headline with the outlet name stuck on', () => {
    // The shape three graded batches are full of, measured at 154 rows of 189.
    const title = 'How Banks Are Rethinking Credit Risk in an AI-Driven Economy';
    const c = classify({
      title,
      summary: `${title} Global Banking & Finance Review`,
      publisherKind: 'media', publishedAt: recent, now: NOW,
    });
    expect(c.useCaseEvidence).toBeNull();
  });

  it('keeps a summary that opens with the headline and then says something', () => {
    // The guard must not eat a real summary just because it restates the
    // headline first. What separates them is how much comes after it.
    const title = 'Starling launches an AI assistant';
    const summary = `${title} for its 5,000 business customers, cutting the time `
      + 'a query takes to answer from two days to under an hour.';
    const c = classify({
      title, summary, publisherKind: 'bank', publishedAt: recent, now: NOW,
    });
    expect(c.useCaseEvidence).not.toBeNull();
    expect(summary).toContain(c.useCaseEvidence!);
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

describe('telling a summary from the headline wearing a summary hat', () => {
  it('catches the headline with an outlet name appended', () => {
    expect(echoesTitle(
      'Citi, HSBC, StanChart adopt Ant International’s forex AI tool',
      'Citi, HSBC, StanChart adopt Ant International’s forex AI tool Reuters')).toBe(true);
  });

  it('catches it through GDELT re-spacing and curly quotes', () => {
    // GDELT pads punctuation ("ex - PayPal") and outlets vary their quote marks,
    // so the comparison works on words, not characters.
    expect(echoesTitle(
      "JPMorgan hired another ex-PayPal exec working on agentic AI",
      "JPMorgan hired another ex - PayPal exec working on agentic AI")).toBe(true);
  });

  it('catches a truncated headline', () => {
    expect(echoesTitle(
      'Starling Bank launches AI tools for customised services',
      'Starling Bank launches AI tools for')).toBe(true);
  });

  it('lets a real summary through, even one that opens with the headline', () => {
    const title = 'DBS rolls out agentic AI for 1,500 bankers';
    expect(echoesTitle(title, `${title} to draft credit memos, cutting a task that `
      + 'took two days to about forty minutes across the corporate bank.')).toBe(false);
  });

  it('lets an unrelated sentence through', () => {
    expect(echoesTitle(
      'Bank launches AI assistant',
      'The lender is piloting a large language model that drafts credit memos.')).toBe(false);
  });

  it('says no when either side is empty', () => {
    expect(echoesTitle('Some headline', null)).toBe(false);
    expect(echoesTitle('Some headline', '')).toBe(false);
    expect(echoesTitle('', 'Some text')).toBe(false);
  });
});

describe('identifying one use case across many outlets', () => {
  const key = (title: string, actor?: string | null, l1Process = 'p13_lending_credit_solutions') =>
    useCaseKey({ title, actor, l1Process });

  it('gives eight bylines of one rollout the same key', () => {
    const titles = [
      'DBS rolls out agentic AI for 1,500 bankers to draft credit memos',
      "Singapore's DBS deploys specialist AI agents for 1,500 employees",
      'DBS rolls out agentic AI credit tool to 1,500 staff globally',
      "DBS Rolls Out Agentic AI to 1'500 Bankers",
    ];
    const keys = new Set(titles.map((t) => key(t)));
    expect(keys.size).toBe(1);
  });

  it('reaches across the week boundary that split Starling', () => {
    // Five rows landed in W34 and two in W35, so the ingest story key — which
    // is bucketed by week — could not join them. This one has no date in it.
    expect(key('Starling launches AI assistant for business banking',
               null, 'p05_relationship_servicing_engagement'))
      .toBe(key('Starling Bank Launches Smart Tools to Empower Customers',
                null, 'p05_relationship_servicing_engagement'));
  });

  it('keeps one bank’s separate programmes apart', () => {
    // Pass 1 found the rules conflating these two. Reskilling staff and
    // drafting credit memos are different work by the same bank.
    expect(key('DBS rolls out agentic AI to draft credit memos'))
      .not.toBe(key('DBS Reskills 11,000 Staff as AI Reshapes Banking Jobs',
                    null, 'p38_workforce_skills_talent'));
  });

  it('normalises the actor a reviewer wrote against the institution list', () => {
    expect(key('AI meeting tool launched', 'Bank of America Merrill'))
      .toBe(key('Bank of America launches an AI meeting tool'));
  });

  it('refuses to group without an institution', () => {
    expect(key('How AI is quickly overhauling one segment of SBA lending')).toBeNull();
  });

  it('refuses to group without a process', () => {
    expect(useCaseKey({ title: 'DBS deploys AI', l1Process: null })).toBeNull();
    expect(useCaseKey({ title: 'DBS deploys AI' })).toBeNull();
  });

  it('folds a bank the institution list has never heard of', () => {
    // Four reports of one Incore KYC trial counted as four use cases, because
    // "Incore" is not on the term list and nobody would think to add it. The
    // reviewer named the actor on all four; that is what the key now uses.
    const incore = [
      key('Incore Bank\u2019s AI Hits 99% Accuracy on KYC Checks', 'Incore Bank',
          'p23_financial_crime_aml_kyc'),
      key('Onboarding statt Monate nur noch Tage: Incore Bank testet KI-Agenten',
          'Incore Bank', 'p23_financial_crime_aml_kyc'),
      key('Kyndryl, Incore Bank and Google Cloud Automate Bank KYC with Gemini',
          'Incore Bank', 'p23_financial_crime_aml_kyc'),
      key('Incore trials AI for onboarding', 'Incore', 'p23_financial_crime_aml_kyc'),
    ];
    expect(new Set(incore).size).toBe(1);
    expect(incore[0]).toBe('incore|p23_financial_crime_aml_kyc');
  });

  it('meets on the first party, because the partner differs by report', () => {
    // "Revolut and Visa" and "Revolut, with Mastercard" are one programme told
    // twice. The bank leads the partnership in both.
    expect(key('Live agentic payment completed', 'Revolut and Visa'))
      .toBe(key('AI agent settles a card payment', 'Revolut, with Mastercard'));
  });

  it('drops a trailing suffix but never a leading one', () => {
    expect(actorKey('Incore Bank')).toBe('incore');
    expect(actorKey('C6 Bank Holdings')).toBe('c6');
    // "Bank of England" is not "of England".
    expect(actorKey('Bank of England')).toBe('bank of england');
  });

  it('will not group on a word that names nobody', () => {
    expect(actorKey('the bank')).toBeNull();
    expect(actorKey('a fintech lender')).toBeNull();
    expect(actorKey('bank')).toBeNull();
    expect(actorKey('Financial')).toBeNull();
    expect(actorKey('   ')).toBeNull();
    expect(actorKey(null)).toBeNull();
  });
});

describe('the bank as analyst, not operator', () => {
  // Both of these were graded D by hand, in two consecutive review passes, and
  // both had been admitted. `ubs` matches the house issuing the rating, and
  // neither headline says anything about a bank doing anything.
  //
  // They also arrived with NO body — headline only — which is why this asserts
  // on the title alone. Every weight that depends on body text was zero, so a
  // gate that needs a paragraph to decide would still let them in.
  test.each([
    ['Palantir upgraded to Buy by UBS on strong AI and data demand'],
    ['Die Jabil-Inc.-Aktie profitiert von AI-Fantasie und neuem UBS-Buy-Rating'],
  ])('rejects equity research on a headline alone: %s', (title) => {
    expect(classify({ title, publisherKind: 'media' }).relevanceScore).toBe(0);
  });

  test('the German article is caught by German terms, not by luck', () => {
    // If this ever passes only because of the English half of the list, the
    // trilingual gap is still open and the next German headline gets through.
    const german = 'die jabil-inc.-aktie profitiert von ai-fantasie und neuem ubs-buy-rating';
    expect(matchTerms(german, ANALYST_RATING_TERMS)).toContain('aktie');
  });

  // The narrowness is the point, and these are the two words that make it
  // risky. A bank upgrading a platform is the story this app exists for, and
  // "outperform" belongs to AI research writing as much as to equity research.
  test.each([
    ['DBS upgrades its core banking platform with an AI decision engine',
     'The engine is live for credit decisions.'],
    ['New AI models outperform human analysts in fraud detection at ING',
     'The models run in production across retail banking.'],
    ['UBS rolls out generative AI copilot to advisers',
     'Now generally available to all relationship managers.'],
  ])('keeps a use case that merely sounds like a rating: %s', (title, summary) => {
    expect(classify({ title, summary, publisherKind: 'media' }).relevanceScore)
      .toBeGreaterThan(0);
  });

  test('bare "upgrade" and "outperform" are deliberately absent', () => {
    // Guards the decision rather than the outcome: adding either word would
    // make the list catch more equity research and start eating real adoption.
    expect(ANALYST_RATING_TERMS).not.toContain('upgrade');
    expect(ANALYST_RATING_TERMS).not.toContain('upgraded');
    expect(ANALYST_RATING_TERMS).not.toContain('outperform');
    expect(ANALYST_RATING_TERMS).not.toContain('underperform');
  });
});

describe('a maturity word inside a hypothetical is not a claim', () => {
  const maturityOf = (title: string, summary: string) =>
    classify({ title, summary, publisherKind: 'media' }).maturity;

  // The two articles that loosened the dAsDeployment ratchet at pass 19, in
  // their own words. Both are graded D and both read as deployments.
  test('advice about what would scale is not something in production', () => {
    expect(maturityOf(
      'Big, deep, narrow: Choosing the agentic opportunities that can scale',
      'Pick problems big enough to matter, deep enough to create differentiated '
      + 'value, and narrow enough to scale safely in production.',
    )).not.toBe('in_production');
  });

  test('moving beyond experiments is not running one', () => {
    expect(maturityOf(
      'Kastle raises $24 million Series A for banking AI',
      'Banks and lenders explore ways to move AI beyond customer-facing '
      + 'assistants and isolated experiments into operational processes.',
    )).not.toBe('pilot');
  });

  test('a poll about firms stuck before a pilot is not a pilot', () => {
    // Graded B. "Struggle to move beyond pilot stage" says the opposite of
    // what the term alone claims.
    expect(maturityOf(
      'UOB Poll Finds SMEs Keen on AI but Struggle to Move Beyond Pilot Stage',
      'Most respondents said they struggle to move beyond the pilot stage.',
    )).not.toBe('pilot');
  });

  // Only the text IN FRONT of the term is examined, and these are why. A cue
  // after the term governs a different clause entirely.
  test('a plan that follows a deployment does not erase the deployment', () => {
    expect(maturityOf(
      'DBS deploys AI agents across the group',
      'The agents went live last month and the bank plans to expand them.',
    )).toBe('in_production');
  });

  test('a cue far enough away does not reach the term', () => {
    // The window is 60 characters. A modal at the start of a long sentence
    // says nothing about a claim at the end of it.
    expect(maturityOf(
      'HSBC expands machine learning fraud detection',
      'Banks could face rising fraud losses, according to the report published '
      + 'this week by the industry body. The system is now live across retail '
      + 'banking.',
    )).toBe('in_production');
  });

  test('"if" does not match inside another word', () => {
    // The cue list is matched on word boundaries. Without them "if" fires on
    // "life", "specific" and "verify", which appear constantly in this corpus.
    expect(maturityOf(
      'Nationwide puts AI identity verification into production',
      'The bank said the specific verification flow is now live for customers.',
    )).toBe('in_production');
  });
});
