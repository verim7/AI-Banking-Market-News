import type { Dimension } from './types.ts';

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

export const TAXONOMY: Record<Dimension, TaxonomyEntry[]> = {
  region: REGIONS,
  banking_area: BANKING_AREAS,
  bank_category: BANK_CATEGORIES,
  use_case: USE_CASES,
};

export const DIMENSIONS: Dimension[] = ['region', 'banking_area', 'bank_category', 'use_case'];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  region: 'Region',
  banking_area: 'Banking area',
  bank_category: 'Bank category',
  use_case: 'AI use case',
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
