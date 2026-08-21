export type Dimension =
  | 'region' | 'banking_area' | 'bank_category' | 'use_case'
  | 'ai_type'      // generative / agentic / machine learning / rules
  | 'l1_process';  // where in the bank's process landscape it lands

export type PublisherKind = 'consultancy' | 'regulator' | 'bank' | 'media';

export interface Tag {
  dimension: Dimension;
  value: string;
  confidence: number;
}

/** A hit is one reason the classifier gave an article points. */
export interface RuleHit {
  rule: string;
  term: string;
  weight: number;
}

export type Maturity = 'in_production' | 'pilot' | 'announced' | 'research' | 'unknown';

export interface Classification {
  tags: Tag[];
  relevanceScore: number;
  /**
   * How central AI is to the article, 0-100 — distinct from relevanceScore,
   * which also weighs the publisher and how recent it is. A regulator's speech
   * that mentions AI once is relevant but not intense; this is the axis that
   * keeps sanctions and capital-rules coverage out.
   */
  aiIntensity: number;
  maturity: Maturity;
  /** The phrase that decided the maturity, so the claim can be checked. */
  maturityEvidence: string | null;
  /**
   * The sentence from the article describing the use case, quoted verbatim.
   * Null when the text does not describe one — an invented description in a
   * market-intelligence tool reads exactly like a real one, so there is none.
   */
  useCaseEvidence: string | null;
  /**
   * A short abstract built from the article's own sentences.
   *
   * Null until the body has been fetched — a headline cannot be summarised,
   * and a summary of a headline is just the headline.
   */
  summaryExtract: string | null;
  ruleHits: RuleHit[];
}

/** An article after normalisation, before it reaches the database. */
export interface NormalizedArticle {
  id: string;
  urlCanonical: string;
  urlOriginal: string;
  title: string;
  summary: string | null;
  excerpt: string | null;
  sourceId: string;
  sourceName: string;
  publisherKind: PublisherKind;
  language: string | null;
  publishedAt: string | null;
}

export interface ClassifiedArticle extends NormalizedArticle {
  classification: Classification;
}
