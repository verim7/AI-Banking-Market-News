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

/* ------------------------------------------------------------------ L1 processes */

/**
 * Level-1 process landscape for a bank.
 *
 * Structured the way banks actually map their own process house — a client
 * value chain, then the control and support functions that serve it — rather
 * than by org chart, which differs at every institution. Close in spirit to
 * BIAN's service domains and APQC's banking PCF at their top level, so a
 * reader who works with either will recognise the shape.
 *
 * This is deliberately NOT the same axis as BANKING_AREAS. That one answers
 * "whose P&L" (Retail, Private Banking, Investment Bank). This answers "which
 * process" (Onboarding, Credit Decisioning, Financial Crime). An article about
 * AI in KYC at a private bank belongs to private_wealth on one axis and
 * client_onboarding on the other, and losing either would flatten a real
 * distinction Market Lens needs.
 */
export const L1_PROCESSES: TaxonomyEntry[] = [
  // ---- client value chain
  {
    value: 'client_onboarding',
    label: 'Client Acquisition & Onboarding',
    terms: ['onboarding', 'account opening', 'kyc', 'know your customer', 'client due diligence',
            'customer due diligence', 'identity verification', 'id verification', 'e-kyc',
            'digital onboarding', 'kontoeröffnung', 'client acquisition', 'prospecting'],
  },
  {
    value: 'advisory_sales',
    label: 'Advisory & Sales',
    terms: ['advisory', 'investment advice', 'anlageberatung', 'relationship manager',
            'client advisor', 'kundenberater', 'next best action', 'cross-sell', 'up-sell',
            'lead generation', 'financial planning', 'suitability', 'pitch book',
            'meeting preparation', 'client proposal'],
  },
  {
    value: 'lending_credit',
    label: 'Lending & Credit Decisioning',
    terms: ['lending', 'credit decision', 'credit scoring', 'underwriting', 'loan origination',
            'kreditentscheidung', 'creditworthiness', 'mortgage approval', 'credit memo',
            'collections', 'default prediction', 'limit management', 'sme lending',
            'credit assessment'],
  },
  {
    value: 'payments_transactions',
    label: 'Payments & Transaction Banking',
    terms: ['payments', 'zahlungsverkehr', 'clearing', 'settlement', 'instant payment',
            'sepa', 'swift', 'card issuing', 'acquiring', 'merchant services', 'wallet',
            'cross-border payment', 'iso 20022', 'transaction banking', 'cash management',
            'direct debit'],
  },
  {
    value: 'investments_portfolio',
    label: 'Investments & Portfolio Management',
    terms: ['portfolio management', 'portfolio construction', 'asset allocation', 'rebalancing',
            'discretionary mandate', 'fund selection', 'investment research', 'equity research',
            'vermögensverwaltung', 'model portfolio', 'performance attribution'],
  },
  {
    value: 'trading_markets',
    label: 'Trading & Capital Markets',
    terms: ['trading desk', 'execution', 'market making', 'pricing engine', 'quote',
            'algorithmic trading', 'best execution', 'derivatives pricing', 'structuring',
            'capital markets', 'securities lending', 'post-trade'],
  },
  {
    value: 'client_service',
    label: 'Client Service & Support',
    terms: ['customer service', 'client service', 'contact centre', 'contact center',
            'call centre', 'call center', 'kundenservice', 'complaint', 'beschwerde',
            'service request', 'self-service', 'agent assist', 'first contact resolution',
            'chatbot', 'virtual assistant', 'help desk'],
  },

  // ---- control and support
  {
    value: 'financial_crime',
    label: 'Financial Crime & AML',
    terms: ['anti-money laundering', 'aml', 'transaction monitoring', 'sanctions screening',
            'financial crime', 'geldwäsche', 'suspicious activity', 'sar filing',
            'fraud detection', 'fraud prevention', 'betrugserkennung', 'false positive',
            'watchlist', 'pep screening', 'scam detection'],
  },
  {
    value: 'risk_management',
    label: 'Risk Management',
    terms: ['risk management', 'credit risk', 'market risk', 'operational risk', 'model risk',
            'stress test', 'scenario analysis', 'risk model', 'early warning', 'exposure',
            'var model', 'capital adequacy', 'risikomanagement', 'validation'],
  },
  {
    value: 'compliance_regulatory',
    label: 'Compliance & Regulatory Reporting',
    terms: ['compliance', 'regulatory reporting', 'regulatory change', 'supervisory',
            'aufsicht', 'audit', 'controls testing', 'policy management', 'regtech',
            'suptech', 'ai act', 'model governance', 'explainability', 'conduct',
            'mifid', 'basel iii', 'dora', 'meldewesen'],
  },
  {
    value: 'operations_processing',
    label: 'Operations & Back Office',
    terms: ['back office', 'middle office', 'operations', 'reconciliation', 'document processing',
            'dokumentenverarbeitung', 'data entry', 'straight-through processing', 'stp',
            'exception handling', 'servicing', 'claims processing', 'trade processing',
            'corporate actions'],
  },
  {
    value: 'technology_data',
    label: 'Technology & Data',
    terms: ['core banking', 'legacy modernisation', 'legacy modernization', 'cloud migration',
            'data platform', 'data governance', 'mainframe', 'cobol', 'api platform',
            'software engineering', 'code generation', 'developer productivity', 'devops',
            'cybersecurity', 'it security', 'data quality', 'observability'],
  },
  {
    value: 'finance_treasury',
    label: 'Finance & Treasury',
    terms: ['treasury', 'asset liability management', 'alm', 'liquidity management',
            'financial close', 'accounting', 'forecasting', 'budgeting', 'fp&a',
            'balance sheet management', 'funding', 'capital planning'],
  },
  {
    value: 'workforce_corporate',
    label: 'Workforce & Corporate Functions',
    terms: ['human resources', 'hr', 'recruiting', 'talent', 'training', 'upskilling',
            'reskilling', 'employee productivity', 'legal', 'contract review', 'procurement',
            'vendor management', 'internal knowledge', 'intranet search'],
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
    terms: ['in production', 'into production', 'now live', 'went live', 'goes live',
            'generally available', 'rolled out to', 'rollout to', 'deployed across',
            'deployed to', 'in daily use', 'used by employees', 'available to all',
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
    terms: ['launched', 'introduces', 'introduced', 'has deployed', 'now offers',
            'made available', 'released'],
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
