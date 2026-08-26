import type { Dimension, Maturity } from './types.ts';

/**
 * The taxonomy is the contract between the classifier, the API filters and the
 * Market Lens UI. Values are stable identifiers; labels are what people read.
 *
 * Terms are matched case-insensitively against a word boundary, so "ai" does
 * not match "said" and "ml" does not match "html". German terms sit alongside
 * English ones because BaFin, finews and Handelsblatt publish in German.
 */

export interface TaxonomyEntry {
  value: string;
  label: string;
  terms: string[];
}

export const REGIONS: TaxonomyEntry[] = [
  {
    value: 'singapore_apac',
    label: 'Singapore & APAC',
    terms: ['singapore', 'mas', 'monetary authority of singapore', 'dbs', 'ocbc', 'uob',
            'apac', 'asia pacific', 'hong kong', 'hkma', 'japan', 'india', 'australia',
            'malaysia', 'indonesia', 'thailand', 'south korea', 'asean'],
  },
  {
    value: 'usa_north_america',
    label: 'USA & North America',
    terms: ['united states', 'u.s.', 'us bank', 'american', 'wall street', 'federal reserve',
            'the fed', 'occ', 'fdic', 'sec', 'jpmorgan', 'jp morgan', 'goldman sachs',
            'bank of america', 'citigroup', 'wells fargo', 'morgan stanley', 'canada',
            'new york', 'usa'],
  },
  {
    value: 'switzerland',
    label: 'Switzerland',
    terms: ['switzerland', 'swiss', 'schweiz', 'finma', 'snb', 'ubs', 'credit suisse',
            'zurich', 'zürich', 'geneva', 'genf', 'julius baer', 'julius bär',
            'pictet', 'lombard odier', 'vontobel', 'raiffeisen schweiz', 'postfinance'],
  },
  {
    value: 'germany_dach',
    label: 'Germany & DACH',
    terms: ['germany', 'german', 'deutschland', 'deutsche bank', 'commerzbank', 'bafin',
            'bundesbank', 'sparkasse', 'volksbank', 'dz bank', 'kfw', 'frankfurt',
            'austria', 'österreich', 'erste bank', 'raiffeisen bank international',
            'dach', 'n26'],
  },
  {
    value: 'uk',
    label: 'United Kingdom',
    terms: ['united kingdom', 'britain', 'british', 'london', 'fca', 'bank of england',
            'prudential regulation authority', 'hsbc', 'barclays', 'lloyds', 'natwest',
            'standard chartered', 'monzo', 'revolut', 'starling'],
  },
  {
    value: 'eu',
    label: 'European Union',
    terms: ['european union', 'europe', 'european commission', 'ecb',
            'european central bank', 'eba', 'european banking authority', 'esma',
            'eu ai act', 'brussels', 'france', 'bnp paribas', 'societe generale',
            'société générale', 'santander', 'bbva', 'unicredit', 'intesa', 'ing group',
            'rabobank', 'nordea', 'netherlands', 'spain', 'italy', 'poland', 'nordic'],
  },
  {
    value: 'middle_east',
    label: 'Middle East',
    terms: ['middle east', 'uae', 'dubai', 'abu dhabi', 'saudi arabia', 'qatar', 'bahrain',
            'kuwait', 'emirates nbd', 'first abu dhabi', 'difc', 'adgm', 'israel'],
  },
  {
    value: 'global',
    label: 'Global',
    terms: ['global', 'worldwide', 'international', 'cross-border', 'bis',
            'bank for international settlements', 'g20', 'basel committee'],
  },
];

export const BANKING_AREAS: TaxonomyEntry[] = [
  {
    value: 'retail_banking',
    label: 'Retail Banking',
    terms: ['retail banking', 'consumer banking', 'privatkunden', 'current account',
            'checking account', 'savings account', 'mortgage', 'hypothek', 'personal loan',
            'branch network', 'mobile banking', 'digital banking'],
  },
  {
    value: 'private_wealth',
    label: 'Private Banking & Wealth',
    terms: ['private banking', 'wealth management', 'vermögensverwaltung', 'privatbank',
            'high net worth', 'hnwi', 'uhnw', 'family office', 'portfolio management',
            'relationship manager', 'client advisor', 'kundenberater', 'asset management',
            'discretionary mandate'],
  },
  {
    value: 'corporate_institutional',
    label: 'Corporate & Institutional',
    terms: ['corporate banking', 'institutional', 'firmenkunden', 'transaction banking',
            'trade finance', 'cash management', 'treasury', 'supply chain finance',
            'commercial lending', 'sme banking', 'mittelstand'],
  },
  {
    value: 'investment_banking',
    label: 'Investment Banking',
    terms: ['investment banking', 'capital markets', 'trading desk', 'equity research',
            'm&a', 'mergers and acquisitions', 'underwriting', 'ipo', 'sell-side',
            'buy-side', 'securities', 'derivatives', 'market making'],
  },
  {
    value: 'payments',
    label: 'Payments',
    terms: ['payments', 'zahlungsverkehr', 'instant payment', 'sepa', 'swift', 'card issuing',
            'acquiring', 'merchant', 'wallet', 'real-time payments', 'cross-border payment',
            'iso 20022', 'open banking', 'psd2', 'cbdc', 'stablecoin'],
  },
  {
    value: 'risk_compliance',
    label: 'Risk & Compliance / AML',
    terms: ['compliance', 'anti-money laundering', 'aml', 'kyc', 'know your customer',
            'sanctions screening', 'financial crime', 'geldwäsche', 'regulatory reporting',
            'risk management', 'credit risk', 'market risk', 'operational risk',
            'model risk', 'audit', 'governance', 'basel iii', 'stress test'],
  },
  {
    value: 'operations',
    label: 'Operations',
    terms: ['back office', 'middle office', 'operations', 'process automation', 'onboarding',
            'servicing', 'reconciliation', 'settlement', 'claims', 'shared services',
            'operational efficiency'],
  },
  {
    value: 'it_infrastructure',
    label: 'IT & Infrastructure',
    terms: ['core banking', 'legacy modernisation', 'legacy modernization', 'cloud migration',
            'data platform', 'infrastructure', 'mainframe', 'api platform', 'devops',
            'cybersecurity', 'it security', 'data governance'],
  },
  {
    value: 'marketing_sales',
    label: 'Marketing & Sales',
    terms: ['marketing', 'customer acquisition', 'cross-sell', 'upsell', 'campaign',
            'personalisation', 'personalization', 'customer experience', 'crm',
            'lead generation', 'churn'],
  },
];

export const BANK_CATEGORIES: TaxonomyEntry[] = [
  {
    value: 'pwbm',
    label: 'Private & Wealth Management (PWBM)',
    terms: ['private bank', 'privatbank', 'wealth manager', 'wealth management firm',
            'julius baer', 'julius bär', 'pictet', 'lombard odier', 'vontobel',
            'ubs global wealth', 'safra sarasin', 'edmond de rothschild'],
  },
  {
    value: 'retail_bank',
    label: 'Retail Bank',
    terms: ['retail bank', 'high street bank', 'sparkasse', 'volksbank', 'building society',
            'credit union', 'savings bank', 'postfinance', 'lloyds', 'natwest'],
  },
  {
    value: 'commercial_bank',
    label: 'Commercial Bank',
    terms: ['commercial bank', 'universal bank', 'geschäftsbank', 'corporate bank',
            'business bank', 'commerzbank', 'unicredit', 'ing group', 'rabobank'],
  },
  {
    value: 'investment_bank',
    label: 'Investment Bank',
    terms: ['investment bank', 'goldman sachs', 'morgan stanley', 'jefferies', 'lazard',
            'rothschild & co', 'bulge bracket', 'broker-dealer'],
  },
  {
    value: 'neobank_fintech',
    label: 'Neobank & Fintech',
    terms: ['neobank', 'challenger bank', 'fintech', 'digital bank', 'revolut', 'monzo',
            'n26', 'starling', 'nubank', 'chime', 'wise', 'klarna', 'stripe', 'adyen',
            'banking-as-a-service', 'embedded finance'],
  },
  {
    value: 'central_bank_regulator',
    label: 'Central Bank & Regulator',
    terms: ['central bank', 'regulator', 'supervisor', 'aufsicht', 'ecb', 'federal reserve',
            'bafin', 'finma', 'mas', 'fca', 'occ', 'eba', 'esma', 'bis', 'snb',
            'bundesbank', 'supervisory expectations'],
  },
  {
    value: 'infrastructure_provider',
    label: 'Infrastructure & Vendor',
    terms: ['core banking vendor', 'temenos', 'finastra', 'fis', 'fiserv', 'jack henry',
            'avaloq', 'murex', 'swift', 'visa', 'mastercard', 'bloomberg', 'refinitiv',
            'technology provider', 'software vendor'],
  },
];

export const USE_CASES: TaxonomyEntry[] = [
  {
    value: 'customer_service',
    label: 'Customer Service',
    terms: ['chatbot', 'virtual assistant', 'customer service', 'contact centre',
            'contact center', 'call centre', 'call center', 'conversational ai',
            'kundenservice', 'self-service', 'voice assistant', 'agent assist'],
  },
  {
    value: 'advisory_copilot',
    label: 'Advisory & Copilot',
    terms: ['copilot', 'advisor assistant', 'relationship manager assistant',
            'investment advice', 'robo-advisor', 'robo advisor', 'anlageberatung',
            'client advisory', 'next best action', 'meeting preparation'],
  },
  {
    value: 'fraud_aml',
    label: 'Fraud & AML',
    terms: ['fraud detection', 'fraud prevention', 'anti-money laundering', 'aml',
            'transaction monitoring', 'sanctions screening', 'financial crime',
            'betrugserkennung', 'false positive', 'suspicious activity', 'scam detection'],
  },
  {
    value: 'credit_underwriting',
    label: 'Credit & Underwriting',
    terms: ['credit scoring', 'credit decision', 'underwriting', 'loan origination',
            'kreditentscheidung', 'creditworthiness', 'default prediction',
            'collections', 'credit memo'],
  },
  {
    value: 'document_processing',
    label: 'Document Processing',
    terms: ['document processing', 'document intelligence', 'idp', 'ocr',
            'contract analysis', 'intelligent document', 'data extraction',
            'dokumentenverarbeitung', 'kyc document', 'prospectus', 'summarisation',
            'summarization'],
  },
  {
    value: 'engineering',
    label: 'Engineering & Code',
    terms: ['code generation', 'developer productivity', 'github copilot',
            'software engineering', 'legacy code', 'cobol', 'code migration',
            'test generation', 'sdlc'],
  },
  {
    value: 'research_analytics',
    label: 'Research & Analytics',
    terms: ['equity research', 'market research', 'analytics', 'forecasting',
            'data analysis', 'insight generation', 'reporting automation',
            'business intelligence', 'quantitative research'],
  },
  {
    value: 'regtech',
    label: 'RegTech & Reporting',
    terms: ['regtech', 'regulatory reporting', 'regulatory change', 'policy mapping',
            'suptech', 'compliance automation', 'audit automation', 'controls testing',
            'ai act', 'model governance', 'explainability'],
  },
  {
    value: 'personalisation',
    label: 'Personalisation',
    terms: ['personalisation', 'personalization', 'recommendation engine',
            'hyper-personalisation', 'hyper-personalization', 'segmentation',
            'targeted offer', 'customer insight', 'churn prediction'],
  },
  {
    value: 'risk_modelling',
    label: 'Risk Modelling',
    terms: ['risk model', 'scenario analysis', 'stress testing', 'var model',
            'portfolio risk', 'early warning', 'exposure modelling',
            'exposure modeling', 'capital modelling', 'capital modeling'],
  },
];


export const DIMENSIONS: Dimension[] = [
  'region', 'banking_area', 'bank_category', 'use_case', 'ai_type', 'l1_process',
];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  region: 'Region',
  banking_area: 'Banking area',
  bank_category: 'Bank category',
  use_case: 'AI use case',
  ai_type: 'Type of AI',
  l1_process: 'L1 process',
};

/**
 * The dimensions offered as filters and charted in the statistics.
 *
 * Banking area and bank category are deliberately absent. They are coarse,
 * frequently unset, and rarely the question anyone brings to the Lens — as
 * filters and charts they cost two of eight controls and two of six charts to
 * answer something nobody asked.
 *
 * AI use case joins them. It overlaps the L1 process almost entirely — "fraud
 * and AML" against "P23 financial crime prevention" is the same cut named
 * twice — and the process taxonomy is the one a bank actually works from, so
 * two controls were competing to answer one question with the coarser of them
 * winning by being listed first.
 *
 * All three remain full members of DIMENSIONS: every article still carries
 * them, the reviews still record them, and an RBAC scope on any one of them
 * still restricts what a user can see. Narrowing the filter bar must never
 * widen anyone's visibility.
 */
export const FILTER_DIMENSIONS: Dimension[] = DIMENSIONS.filter(
  (d) => d !== 'banking_area' && d !== 'bank_category' && d !== 'use_case');

/**
 * The option meaning "this article has no value in this dimension".
 *
 * Facet options come from article_tags, so before this existed an article with
 * no region tag appeared under no region option — not merely uncounted but
 * unreachable, since no combination of filter values would ever show it. This
 * sentinel gives every article a home in every filter.
 *
 * A reserved value rather than an empty string: empty is what an absent query
 * parameter already parses to, so the two would be indistinguishable on the
 * wire. A test asserts no real taxonomy value collides with it.
 */
export const UNCLASSIFIED = '__none__';

/** How the unclassified bucket is labelled wherever it is shown. */
export const UNCLASSIFIED_LABEL = 'Not classified';

/** Terms that mark an article as being about AI at all. */
export const AI_TERMS: string[] = [
  'artificial intelligence', 'ai', 'genai', 'gen ai', 'generative ai', 'machine learning',
  'deep learning', 'large language model', 'llm', 'foundation model', 'neural network',
  'chatgpt', 'copilot', 'agentic', 'ai agent', 'ai agents', 'natural language processing',
  'nlp', 'computer vision', 'predictive model', 'künstliche intelligenz', 'ki',
  'maschinelles lernen', 'sprachmodell', 'automation', 'algorithm',
];

/** Terms that mark an article as being about banking / financial services. */
export const BANKING_TERMS: string[] = [
  'bank', 'banks', 'banking', 'financial services', 'financial institution', 'finance',
  'fintech', 'insurer', 'insurance', 'asset manager', 'wealth', 'lender', 'lending',
  'credit', 'payments', 'capital markets', 'trading', 'compliance', 'regulator',
  'supervisory', 'basel', 'bankwesen', 'finanzdienstleistung', 'kreditinstitut',
  'finanzinstitut', 'sparkasse', 'versicherung',
];

/** Terms suggesting the piece is a study or report rather than a news blurb. */
export const STUDY_TERMS: string[] = [
  'study', 'studie', 'report', 'bericht', 'survey', 'umfrage', 'research', 'whitepaper',
  'white paper', 'insights', 'analysis', 'benchmark', 'outlook', 'index', 'point of view',
  'perspective', 'findings', 'annual review',
];

/**
 * Named financial institutions and supervisors.
 *
 * The banking half of the relevance gate originally accepted only the generic
 * vocabulary in BANKING_TERMS, so "UBS rolls out a generative AI copilot"
 * scored zero — it never says the word "bank". That threw away precisely the
 * material worth collecting: a specific use case at a specific institution.
 *
 * Every BANK_CATEGORIES term is institutional by construction. The rest are
 * institutions named in REGIONS, where the surrounding terms are places rather
 * than organisations and so cannot be taken wholesale.
 *
 * Deliberately excluded: "sec". As a bare token it collides with "seconds" and
 * "section" far too often to be evidence of anything.
 */
export const INSTITUTION_TERMS: string[] = [...new Set([
  ...BANK_CATEGORIES.flatMap((e) => e.terms),

  // Singapore & APAC
  'dbs', 'ocbc', 'uob', 'hkma', 'mas', 'monetary authority of singapore',
  // Switzerland
  'ubs', 'credit suisse', 'finma', 'snb', 'julius baer', 'julius bär', 'pictet',
  'lombard odier', 'vontobel', 'postfinance', 'safra sarasin', 'raiffeisen schweiz',
  // Germany & DACH
  'deutsche bank', 'commerzbank', 'bafin', 'bundesbank', 'sparkasse', 'volksbank',
  'dz bank', 'kfw', 'n26', 'erste bank', 'raiffeisen bank international',
  // North America
  'cibc', 'm&t bank', 'huntington', 'charles schwab', 'schwab',
  // Credit bureaux and market infrastructure — not banks, but named operators
  // running their own deployments rather than selling one.
  'experian', 'equifax', 'transunion',
  // Additional APAC and Middle East institutions seen in the corpus
  'bank of singapore', 'nonghyup', 'busan bank', 'ruya', 'adib',
  // UK
  'hsbc', 'barclays', 'lloyds', 'natwest', 'standard chartered', 'monzo', 'revolut',
  'starling', 'fca', 'bank of england', 'prudential regulation authority',
  // USA & North America
  'jpmorgan', 'jp morgan', 'goldman sachs', 'bank of america', 'citigroup',
  'wells fargo', 'morgan stanley', 'federal reserve', 'the fed', 'occ', 'fdic',
  // European Union
  'bnp paribas', 'societe generale', 'société générale', 'santander', 'bbva',
  'unicredit', 'intesa', 'ing group', 'rabobank', 'nordea', 'ecb',
  'european central bank', 'eba', 'european banking authority', 'esma',
  // Middle East
  'emirates nbd', 'first abu dhabi',
  // Global
  'bis', 'bank for international settlements', 'basel committee',
])];

/**
 * The generic vocabulary for an institution, as opposed to the name of one.
 *
 * An explicit list rather than "everything in BANK_CATEGORIES": the category
 * term lists name real firms as examples, so filtering by membership removed
 * Starling along with "neobank" and cost two real deployments their maturity.
 */
const GENERIC_INSTITUTION_WORDS = new Set([
  'bank', 'banks', 'banking', 'the bank', 'fintech', 'fintechs', 'neobank',
  'digital bank', 'challenger bank', 'retail bank', 'private bank', 'central bank',
  'universal bank', 'regional bank', 'community bank', 'investment bank',
  'insurer', 'insurance', 'asset manager', 'wealth manager', 'lender', 'lenders',
  'credit union', 'building society', 'regulator', 'supervisor', 'custodian',
  'financial institution', 'financial institutions', 'bankwesen', 'kreditinstitut',
  'finanzinstitut', 'versicherung', 'sparkasse', 'volksbank',
]);

/**
 * Institutions by name, without the category words.
 *
 * INSTITUTION_TERMS deliberately includes the generic vocabulary — bank,
 * fintech, insurer — because for judging relevance "a fintech deployed X" is a
 * real signal. For identifying *who* did something it is useless: an article
 * mentioning fintech has not named anybody, and treating it as though it had
 * lets a vendor launch past the actor test and would let two unrelated fintech
 * stories collapse into one.
 */
export const NAMED_INSTITUTIONS: string[] = INSTITUTION_TERMS.filter(
  (t) => !GENERIC_INSTITUTION_WORDS.has(t));


/* ------------------------------------------------------------------ L1 processes */

/**
 * The bank's level-1 process landscape: P1 to P38, as supplied by the business.
 *
 * This is the fixed classification axis for every article and every AI use case,
 * now and for anything ingested later. It is not a shape this tool invented and
 * must not drift: the numbering is how the processes are referred to in the
 * business, so the labels carry it.
 *
 * Deliberately NOT the same axis as BANKING_AREAS. That one answers "whose P&L"
 * (Retail, Private Banking, Investment Bank). This answers "which process". An
 * article about AI in KYC at a private bank belongs to private_wealth on one
 * axis and P23 on the other, and losing either would flatten a distinction the
 * Market Lens needs.
 *
 * Terms are allocated to the most specific process that owns them, because an
 * article can carry several process tags and a term in two places dilutes both.
 * "fraud detection" is P24 rather than P23, "kyc" is P23 rather than P4, and
 * "model risk" is P37 rather than P28 — each is the process that would actually
 * own the work.
 *
 * Changing an entry's `value` orphans every tag already written against it.
 * Re-tag stored articles with `npm run rescore` after any edit here.
 */
export const L1_PROCESSES: TaxonomyEntry[] = [
  {
    value: 'p01_market_franchise_planning',
    label: 'P1 – Market & franchise planning',
    terms: ['market sizing', 'competitor analysis', 'competitive intelligence',
            'market intelligence', 'franchise strategy', 'market entry', 'addressable market',
            'peer benchmarking', 'share of wallet', 'market opportunity'],
  },
  {
    value: 'p02_client_acquisition_prospecting',
    label: 'P2 – Client acquisition & prospecting',
    terms: ['prospecting', 'lead generation', 'lead scoring', 'client acquisition',
            'prospect identification', 'referral network', 'pipeline generation',
            'new client acquisition', 'wealth screening', 'neukundengewinnung'],
  },
  {
    value: 'p03_marketing_campaigns_personalisation',
    label: 'P3 – Marketing, campaigns & personalisation',
    terms: ['marketing campaign', 'personalisation', 'personalization', 'next best action',
            'next best offer', 'client segmentation', 'marketing automation', 'targeted offer',
            'cross-sell', 'up-sell', 'content generation', 'marketing content'],
  },
  {
    value: 'p04_client_onboarding_activation',
    label: 'P4 – Client onboarding & activation',
    terms: ['onboarding', 'account opening', 'client activation', 'digital onboarding',
            'kontoeröffnung', 'identity verification', 'id verification', 'document capture',
            'application form', 'welcome journey', 'time to onboard'],
  },
  {
    value: 'p05_relationship_servicing_engagement',
    label: 'P5 – Relationship servicing & digital engagement',
    terms: ['client service', 'customer service', 'contact centre', 'contact center',
            'call centre', 'call center', 'kundenservice', 'service request', 'self-service',
            'chatbot', 'virtual assistant', 'agent assist', 'help desk', 'digital banking',
            'mobile banking', 'client portal', 'first contact resolution',
            // Headlines describe the product, not the process. Every term
            // below was carried by an article a reviewer put in P05 that the
            // list could not reach — 32 of them, the biggest single gap.
            'customer-facing', 'client-facing', 'customer facing', 'client facing',
            'assistant for business', 'business banking', 'small business banking',
            'retail customers', 'smart tools', 'personalised banking',
            'personalized banking', 'financial management', 'client work',
            'client experience', 'customer experience', 'serve customers',
            'answering customers', 'client servicing', 'relationship servicing'],
  },
  {
    value: 'p06_client_discovery_financial_planning',
    label: 'P6 – Client discovery & financial planning',
    terms: ['financial planning', 'financial plan', 'goal-based', 'risk profiling',
            'client discovery', 'needs analysis', 'retirement planning', 'cash flow planning',
            'life goals', 'finanzplanung'],
  },
  {
    value: 'p07_investment_advisory_proposal',
    label: 'P7 – Investment advisory & proposal management',
    terms: ['investment advice', 'investment advisory', 'anlageberatung', 'investment proposal',
            'pitch book', 'meeting preparation', 'client proposal', 'relationship manager',
            'client advisor', 'kundenberater', 'advisory copilot', 'investment recommendation',
            'meeting notes',
            'financial advisor', 'financial adviser', 'advisors', 'advisers',
            'wealth manager', 'wealth managers', 'adviser workflows',
            'advisor workflows', 'field teams', 'portfolio analysis',
            'client meeting', 'client meetings', 'wealth platform',
            'adviser tool', 'advisor tool', 'wealth management platform'],
  },
  {
    value: 'p08_portfolio_construction_mandates',
    label: 'P8 – Portfolio construction & mandate management',
    terms: ['portfolio construction', 'asset allocation', 'rebalancing',
            'discretionary mandate', 'model portfolio', 'fund selection',
            'portfolio optimisation', 'portfolio optimization', 'mandate management',
            'vermögensverwaltung'],
  },
  {
    value: 'p09_portfolio_monitoring_performance',
    label: 'P9 – Portfolio monitoring, performance & attribution',
    terms: ['performance attribution', 'portfolio monitoring', 'performance measurement',
            'return attribution', 'benchmark comparison', 'portfolio analytics',
            'drift monitoring', 'performance calculation'],
  },
  {
    value: 'p10_client_reporting_communications',
    label: 'P10 – Client reporting & communications',
    terms: ['client reporting', 'client communication', 'portfolio statement',
            'statement generation', 'quarterly report', 'client letter', 'report generation',
            'kundenreporting', 'client update'],
  },
  {
    value: 'p11_product_solution_shelf',
    label: 'P11 – Product & solution shelf development',
    terms: ['product development', 'product shelf', 'solution design', 'product approval',
            'new product', 'product governance', 'structured product design', 'product launch'],
  },
  {
    value: 'p12_pricing_fees_billing',
    label: 'P12 – Pricing, fees & billing',
    terms: ['fee calculation', 'fee schedule', 'billing', 'pricing model', 'pricing strategy',
            'price optimisation', 'price optimization', 'fee transparency', 'invoicing',
            'rebate', 'gebühren'],
  },
  {
    value: 'p13_lending_credit_solutions',
    label: 'P13 – Lending & credit solutions',
    terms: ['lending', 'loan origination', 'credit decision', 'credit scoring', 'underwriting',
            'mortgage', 'lombard loan', 'kreditentscheidung', 'sme lending', 'credit memo',
            'credit memos', 'loan application', 'collateral', 'creditworthiness',
            // "corporate credit assessments" is how three of the eight outlets
            // covering the DBS rollout described it, and the list had no form
            // of the phrase at all.
            'credit assessment', 'credit assessments', 'credit analysis',
            'credit tool', 'credit risk', 'loans', 'borrower', 'sba lending',
            'merchant lending', 'credit union', 'credit unions'],
  },
  {
    value: 'p14_wealth_structuring_fiduciary',
    label: 'P14 – Wealth structuring & fiduciary solutions',
    terms: ['wealth structuring', 'fiduciary', 'trust services', 'estate planning',
            'succession planning', 'inheritance', 'wealth planning', 'nachlassplanung',
            'family office structuring'],
  },
  {
    value: 'p15_client_account_lifecycle_admin',
    label: 'P15 – Client & account lifecycle administration',
    terms: ['account maintenance', 'client data management', 'account closure',
            'lifecycle administration', 'kyc refresh', 'periodic review', 'client offboarding',
            'data remediation', 'static data'],
  },
  {
    value: 'p16_order_management_execution',
    label: 'P16 – Order management & trade execution',
    terms: ['order management', 'trade execution', 'best execution', 'algorithmic trading',
            'execution management', 'order routing', 'trading desk', 'market making',
            'execution quality'],
  },
  {
    value: 'p17_treasury_fx_money_markets',
    label: 'P17 – Treasury, FX & money-market operations',
    terms: ['foreign exchange', 'fx trading', 'money market', 'treasury operations',
            'repo market', 'currency hedging', 'devisen', 'liquidity trading'],
  },
  {
    value: 'p18_settlement_custody',
    label: 'P18 – Securities settlement & custody',
    terms: ['securities settlement', 'custody', 'custodian', 'safekeeping', 'depotbank',
            'post-trade', 'clearing house', 't+1 settlement'],
  },
  {
    value: 'p19_corporate_actions_income',
    label: 'P19 – Corporate actions & income processing',
    terms: ['corporate action', 'dividend processing', 'coupon payment', 'income processing',
            'proxy voting', 'stock split', 'entitlement processing'],
  },
  {
    value: 'p20_payments_cash_operations',
    label: 'P20 – Payments & cash operations',
    terms: ['payments', 'zahlungsverkehr', 'instant payment', 'sepa', 'swift', 'iso 20022',
            'cash management', 'direct debit', 'card issuing', 'acquiring',
            'cross-border payment', 'payment processing',
            'agentic commerce', 'moving money', 'money movement', 'merchant',
            'merchants', 'remittance', 'card issuance'],
  },
  {
    value: 'p21_reconciliation_exceptions',
    label: 'P21 – Reconciliation & exception management',
    terms: ['reconciliation', 'exception management', 'break resolution', 'nostro',
            'exception handling', 'abstimmung', 'straight-through processing',
            'exception triage'],
  },
  {
    value: 'p22_market_reference_data',
    label: 'P22 – Market & reference data management',
    terms: ['reference data', 'market data', 'data feed', 'security master', 'instrument data',
            'pricing data', 'data vendor'],
  },
  {
    value: 'p23_financial_crime_aml_kyc',
    label: 'P23 – Financial crime prevention (AML / KYC / sanctions)',
    terms: ['anti-money laundering', 'aml', 'kyc', 'know your customer',
            'transaction monitoring', 'sanctions screening', 'financial crime', 'geldwäsche',
            'suspicious activity', 'sar filing', 'watchlist', 'pep screening', 'adverse media',
            'customer due diligence', 'client due diligence', 'false positive'],
  },
  {
    value: 'p24_fraud_identity_security',
    label: 'P24 – Fraud & identity security',
    terms: ['fraud detection', 'fraud prevention', 'betrugserkennung', 'scam detection',
            'account takeover', 'identity fraud', 'payment fraud', 'card fraud', 'deepfake',
            'biometric', 'authentication', 'fraud scoring'],
  },
  {
    value: 'p25_suitability_conduct_complaints',
    label: 'P25 – Suitability, conduct & complaints assurance',
    terms: ['suitability', 'appropriateness', 'conduct risk', 'mis-selling',
            'complaint handling', 'beschwerde', 'advice quality', 'client outcome',
            'call monitoring', 'mifid'],
  },
  {
    value: 'p26_credit_counterparty_risk',
    label: 'P26 – Credit & counterparty risk management',
    terms: ['credit risk', 'counterparty risk', 'probability of default', 'exposure modelling',
            'exposure modeling', 'credit rating', 'early warning', 'credit portfolio',
            'kreditrisiko', 'pd model', 'loss given default'],
  },
  {
    value: 'p27_market_liquidity_risk',
    label: 'P27 – Market & liquidity risk management',
    terms: ['market risk', 'liquidity risk', 'value at risk', 'var model', 'stress test',
            'scenario analysis', 'interest rate risk', 'marktrisiko', 'risk factor model'],
  },
  {
    value: 'p28_operational_risk_control_audit',
    label: 'P28 – Operational risk, internal control & audit',
    terms: ['operational risk', 'internal control', 'internal audit', 'control testing',
            'incident management', 'risk and control self-assessment', 'rcsa',
            'operationelles risiko', 'audit trail'],
  },
  {
    value: 'p29_regulatory_compliance_change',
    label: 'P29 – Regulatory compliance & change monitoring',
    terms: ['regulatory compliance', 'regulatory change', 'horizon scanning',
            'compliance monitoring', 'policy management', 'regulatory obligation', 'regtech',
            'supervisory expectation', 'regulatory requirement', 'aufsichtsrecht',
            'compliance', 'fca', 'hkma', 'bafin', 'finma', 'sandbox',
            'live testing', 'consumer protection', 'ai law', 'supervisory',
            'supervision', 'regulator', 'regulators'],
  },
  {
    value: 'p30_financial_accounting_close',
    label: 'P30 – Financial accounting & close',
    terms: ['financial accounting', 'month-end close', 'general ledger', 'journal entry',
            'accounting close', 'bookkeeping', 'buchhaltung', 'period close'],
  },
  {
    value: 'p31_regulatory_tax_financial_reporting',
    label: 'P31 – Regulatory, tax & financial reporting',
    terms: ['regulatory reporting', 'tax reporting', 'financial reporting', 'finrep', 'corep',
            'fatca', 'crs', 'meldewesen', 'statutory reporting', 'disclosure requirement',
            'esg reporting'],
  },
  {
    value: 'p32_profitability_cost_steering',
    label: 'P32 – Profitability & cost steering',
    terms: ['profitability', 'cost income ratio', 'cost management', 'margin analysis',
            'client profitability', 'cost allocation', 'expense management', 'cost steering'],
  },
  {
    value: 'p33_capital_liquidity_alm',
    label: 'P33 – Capital, liquidity & balance-sheet management (ALM)',
    terms: ['asset liability management', 'alm', 'capital management', 'balance sheet',
            'liquidity coverage ratio', 'capital adequacy', 'basel', 'funding cost',
            'risk weighted assets', 'bilanzsteuerung'],
  },
  {
    value: 'p34_strategy_operating_model_change',
    label: 'P34 – Strategy, operating model & change portfolio',
    terms: ['operating model', 'transformation programme', 'transformation program',
            'change portfolio', 'target operating model', 'digital transformation',
            'project portfolio', 'restructuring', 'corporate strategy'],
  },
  {
    value: 'p35_technology_platform_engineering',
    label: 'P35 – Technology platform & engineering',
    terms: ['core banking', 'cloud migration', 'software engineering', 'developer productivity',
            'code generation', 'legacy modernisation', 'legacy modernization', 'devops',
            'it infrastructure', 'platform engineering', 'technology stack',
            'enterprise-wide', 'enterprise wide', 'copilot', 'chatgpt enterprise',
            'ai framework', 'ai infrastructure', 'ai platform', 'ai hub',
            'ai workspace', 'foundation model', 'ai readiness', 'ai lab',
            'ai research', 'research division', 'licence deal', 'license deal'],
  },
  {
    value: 'p36_data_governance_analytics',
    label: 'P36 – Data governance & analytics products',
    terms: ['data governance', 'data quality', 'data lineage', 'data platform', 'data lake',
            'master data', 'data catalogue', 'data catalog', 'data mesh',
            'business intelligence', 'advanced analytics',
            'financial research', 'data tools', 'ai tracker',
            'model intelligence', 'data foundations', 'data strategy'],
  },
  {
    value: 'p37_ai_governance_responsible',
    label: 'P37 – AI governance & responsible deployment',
    terms: ['ai governance', 'responsible ai', 'model risk management', 'model validation',
            'ai ethics', 'explainability', 'ai act', 'model governance', 'guardrails',
            'bias testing', 'ai policy', 'human oversight', 'model risk',
            'code of conduct', 'shadow ai', 'schatten-ki', 'going rogue',
            'ai risks', 'kill switch', 'kill switches', 'accountability',
            'ai security'],
  },
  {
    value: 'p38_workforce_skills_talent',
    label: 'P38 – Workforce, skills & talent',
    terms: ['workforce', 'upskilling', 'reskilling', 'talent', 'recruitment',
            'employee training', 'job displacement', 'headcount', 'hiring', 'skills gap',
            'mitarbeiterschulung'],
  },
];

/* ------------------------------------------------------------------ AI types */

/**
 * What kind of AI the article is actually describing.
 *
 * Multiple values are expected and correct: an agentic system is almost always
 * built on generative models, and a fraud stack routinely combines classical
 * machine learning with rules. Forcing a single label would misrepresent most
 * real deployments.
 */
export const AI_TYPES: TaxonomyEntry[] = [
  {
    value: 'generative_ai',
    label: 'Generative AI',
    terms: ['generative ai', 'genai', 'gen ai', 'large language model', 'llm', 'llms',
            'foundation model', 'frontier model', 'chatgpt', 'gpt-4', 'gpt-5', 'openai',
            'anthropic', 'claude', 'gemini', 'llama', 'mistral', 'copilot',
            'prompt engineering', 'retrieval augmented generation', 'rag',
            'generative model', 'sprachmodell', 'generative künstliche intelligenz'],
  },
  {
    value: 'agentic_ai',
    label: 'Agentic AI',
    terms: ['ai agent', 'ai agents', 'agentic', 'agentic ai', 'autonomous agent',
            'multi-agent', 'agent workflow', 'agent orchestration', 'tool use',
            'autonomous workflow', 'digital worker', 'agentische ki'],
  },
  {
    value: 'machine_learning',
    label: 'Machine Learning',
    terms: ['machine learning', 'maschinelles lernen', 'ml model', 'deep learning',
            'neural network', 'predictive model', 'predictive analytics', 'supervised learning',
            'unsupervised learning', 'reinforcement learning', 'gradient boosting',
            'random forest', 'xgboost', 'anomaly detection', 'classification model',
            'clustering', 'feature engineering', 'computer vision',
            'natural language processing', 'nlp'],
  },
  {
    value: 'traditional_automation',
    label: 'Rules & Traditional Automation',
    terms: ['robotic process automation', 'rpa', 'rules engine', 'rule-based', 'expert system',
            'optical character recognition', 'ocr', 'workflow automation', 'decision table',
            'statistical model', 'regression model', 'scorecard', 'heuristic',
            'regelbasiert', 'prozessautomatisierung'],
  },
];

/* ------------------------------------------------------------------ maturity */

export const MATURITY_LABELS: Record<Maturity, string> = {
  in_production: 'In production',
  pilot: 'Pilot / testing',
  announced: 'Announced',
  research: 'Research / study',
  unknown: 'Not stated',
};

/**
 * Evidence phrases for how far a deployment has actually got.
 *
 * Tiered rather than flat, because the strongest claim in a sentence is not
 * always the right one. "Rolled out to all 60,000 staff after a successful
 * pilot" is production; "launched a pilot" is not, even though both contain
 * "launch". So unambiguous production language outranks pilot language, and
 * pilot language outranks the softer launch verbs — which stops a press
 * release about a trial being read as a live system.
 *
 * The phrase that decided the classification is stored on the article, so the
 * table can show the reader what the claim rests on.
 */
export const MATURITY_SIGNALS: { maturity: Maturity; terms: string[] }[] = [
  {
    maturity: 'in_production',
    // Present tense matters as much as past. Every term here was originally a
    // past or prepositional form — "rolled out to", "deployed across" — while
    // headlines are written in the present: "DBS rolls out", "Starling
    // deploys". Measured against 80 hand-graded articles, thirteen of fifteen
    // real deployments read as `unknown` for want of these forms alone.
    terms: ['in production', 'into production', 'now live', 'went live', 'goes live',
            'generally available', 'rolled out to', 'rollout to',
            'deployed across', 'deployed to',
            'in daily use', 'used by employees', 'available to all',
            'bank-wide', 'firm-wide', 'group-wide', 'at scale', 'scaled to',
            'productive', 'im produktiveinsatz', 'flächendeckend'],
  },
  {
    maturity: 'pilot',
    terms: ['pilot', 'piloting', 'pilot phase', 'proof of concept', 'poc', 'trial',
            'trialling', 'trialing', 'testing', 'under test', 'beta', 'sandbox',
            'limited rollout', 'early access', 'experiment', 'prototype',
            'pilotprojekt', 'testphase', 'erprobung'],
  },
  {
    maturity: 'in_production',
    // Weaker launch language: real, but outranked by pilot above.
    // Launch language, weaker than the tier above and outranked by pilot. It is
    // safe to include the vendor-flavoured verbs here only because the actor
    // test in classify.ts caps anything without a named institution: "Zeplyn
    // launches" is capped to announced, "Starling launches" is not.
    // Present-tense headline verbs live here rather than in the strong tier
    // above, because a vendor and a bank write them identically: "Broadridge
    // deploys" and "DBS rolls out" are the same words about different things.
    // The actor test tells them apart — with a named institution these stay
    // production, without one they cap at announced. The strong tier keeps the
    // forms that state scope on their own ("deployed across the group"), which
    // no press release uses about a product it is merely shipping.
    terms: ['launched', 'launches', 'introduces', 'introduced', 'debuts', 'unveils',
            'rolls out', 'rolling out', 'deploys', 'deploying',
            'has deployed', 'now offers', 'made available', 'released',
            'uses', 'is using', 'now uses'],
  },
  {
    maturity: 'announced',
    terms: ['plans to', 'will launch', 'intends to', 'is developing', 'to roll out',
            'announced plans', 'signed an agreement', 'partnership with', 'teams up',
            'to build', 'upcoming', 'plant', 'will deploy'],
  },
  {
    maturity: 'research',
    terms: ['study', 'studie', 'survey', 'umfrage', 'research finds', 'report finds',
            'according to a report', 'whitepaper', 'white paper', 'findings', 'analysis',
            'benchmark', 'outlook'],
  },
];

/* --------------------------------------------------- dimension registry */

export const TAXONOMY: Record<Dimension, TaxonomyEntry[]> = {
  region: REGIONS,
  banking_area: BANKING_AREAS,
  bank_category: BANK_CATEGORIES,
  use_case: USE_CASES,
  ai_type: AI_TYPES,
  l1_process: L1_PROCESSES,
};


/* ------------------------------------------- adoption vs commentary */

/**
 * The hardest false positive: a bank talking ABOUT AI rather than USING it.
 *
 * "Goldman raises its US GDP forecast on AI capex" and "JPMorgan analysts see
 * $500bn of AI spending" both clear the AI-and-banking gate easily — AI in the
 * headline, a named institution, high intensity — and neither is a banking AI
 * use case. They are macroeconomic and equity research that happen to be about
 * the AI industry.
 *
 * Two signals separate them, and both are needed. MARKET_COMMENTARY_TERMS say
 * the subject is the economy or the market. ANALYST_VOICE_TERMS say the bank is
 * the speaker rather than the actor — which is the sharper of the two, because
 * "JPMorgan will spend $17bn on technology including AI" is genuine adoption
 * while "JPMorgan estimates AI spending will reach $17bn" is not, and only the
 * verb tells them apart.
 */
export const MARKET_COMMENTARY_TERMS: string[] = [
  'gdp', 'gross domestic product', 'economic growth', 'the economy', 'recession',
  'inflation', 'interest rate', 'rate cut', 'monetary policy', 'macroeconomic',
  'capex', 'capital expenditure', 'ai spending', 'ai investment boom', 'ai boom',
  'ai bubble', 'ai trade', 'ai rally', 'ai stocks', 'share price', 'stock market',
  'equity market', 'valuation', 'market cap', 's&p 500', 'nasdaq', 'dow jones',
  'stoxx', 'index fund', 'etf', 'bull market', 'bear market', 'investors',
  'shareholder', 'earnings season', 'quarterly earnings', 'price target',
  'chipmaker', 'semiconductor', 'nvidia', 'data centre buildout',
  'data center buildout', 'hyperscaler', 'magnificent seven', 'wall street rally',
  // The equity register. Added after a research note titled "If AI disappoints?
  // The transmission of US big-tech earnings news to bank equity prices" scored
  // 24 and was admitted: it names banks, so the co-occurrence gate passed it,
  // and none of the terms above appear in it. "earnings season" and "quarterly
  // earnings" were present while bare "earnings" was not, and "big tech" never
  // fired because the headline hyphenates it.
  'big tech', 'earnings', 'equity price', 'stock price', 'bond yield',
  'spillover', 'market reaction', 'sell-off', 'stock', 'equities',
];

/** The bank is quoted, not acting. */
export const ANALYST_VOICE_TERMS: string[] = [
  'analysts say', 'analysts said', 'analysts expect', 'analysts at', 'strategists',
  'economists', 'research note', 'research report', 'in a note', 'note to clients',
  'forecast', 'forecasts', 'forecasting', 'estimates that', 'projects that',
  'predicts', 'expects the', 'according to a report by', 'said in a report',
  'survey of investors', 'outlook for', 'sees ai', 'warned that', 'said on',
];

/**
 * The institution is doing something with AI. These are what a genuine use case
 * reads like, and their absence is what makes commentary recognisable.
 */
/**
 * Corporate news about AI, which is not AI doing anything.
 *
 * Reading 80 articles found nine of this genre scored as deployments — an
 * appointment of a Chief AI Officer reached AI intensity 100 and maturity
 * in_production. The article is real and about AI, but nothing is running:
 * hiring someone, retraining staff or signing a training MOU is a company
 * responding to AI, not a use case.
 */
export const CORPORATE_NEWS_TERMS: string[] = [
  'appoints', 'appointment', 'names as', 'joins as', 'steps down', 'hires as',
  'chief ai officer', 'head of ai', 'reskill', 'reskills', 'reskilling',
  'upskill', 'upskills', 'upskilling', 'memorandum of understanding', 'mou',
  'job cuts', 'cut jobs', 'headcount', 'redundancies', 'layoffs',
  'career advisory', 'apprenticeship', 'training programme', 'training program',
  // Skills-and-jobs partnerships read as deployments because the body says
  // "launched": DBS and IBF signing a training MOU scored in_production.
  'ai skills', 'skills and jobs', 'skills & jobs', 'workforce development',
  'talent pipeline',
];

export const ADOPTION_TERMS: string[] = [
  'deploy', 'deployed', 'deploying', 'deployment', 'roll out', 'rolled out',
  'rollout', 'implement', 'implemented', 'implementation', 'launch', 'launched',
  'pilot', 'piloting', 'trial', 'trialling', 'testing', 'adopt', 'adopted',
  'adoption of', 'using ai', 'uses ai', 'use ai', 'built', 'building', 'developed',
  'developing', 'introduce', 'introduced', 'integrate', 'integrated', 'automate',
  'automated', 'automating', 'in production', 'went live', 'now live',
  'employees', 'staff', 'workforce', 'bankers', 'advisors', 'advisers',
  'relationship managers', 'customers', 'clients use', 'internal', 'workflow',
  'operations', 'back office', 'front office', 'platform', 'tool', 'assistant',
  'copilot', 'partnership with', 'partnered with', 'signed', 'contract with',
  'invest in ai', 'investing in ai', 'spend on technology', 'technology budget',
];
