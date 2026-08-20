export type Dimension = 'region' | 'banking_area' | 'bank_category' | 'use_case';

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

export interface Classification {
  tags: Tag[];
  relevanceScore: number;
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
