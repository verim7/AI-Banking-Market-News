import { classify, type Classification, type PublisherKind } from '@portal/shared';
import { sqlLiteral as L } from './sql.ts';

/**
 * One article's scores and tags, recomputed from its stored text.
 *
 * Split out of rescore.ts so the Worker can use it too: when the editor's
 * browser supplies an article's text, the Worker rescores that one article on
 * the spot. This file imports only the classifier and the SQL quoting, so it
 * bundles into the Worker without the crawler behind it.
 */

export interface StoredArticle {
  id: string;
  title: string;
  summary: string | null;
  excerpt: string | null;
  publisher_kind: string;
  published_at: string | null;
  region_hint: string | null;
  url_original: string;
  /** 'local-browser' marks text from the editor's own browser, which stays private. */
  excerpt_source?: string | null;
}

/** Text from the editor's browser may come from a subscription: graded, not displayed. */
export const PRIVATE_SOURCE = 'local-browser';


/** How a stored row is presented to the classifier, in one place. */
export function classifyStored(row: StoredArticle): Classification {
  return classify({
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    publisherKind: row.publisher_kind as PublisherKind,
    publishedAt: row.published_at,
    regionHint: row.region_hint,
  });
}

/**
 * Statements that replace one article's tags and scores, leaving the article
 * itself alone. Takes the classification rather than computing it, because the
 * caller needs the same result for its report and classifying twice is two
 * chances for the written row and the reported number to disagree.
 */
export function rescoreStatements(row: StoredArticle, c: Classification): string[] {
  const out: string[] = [
    // Wholesale replacement, not merge: re-classification can *remove* a tag,
    // and a stale tag left behind silently widens every filter that uses it.
    // Only the rules' own rows. A review's tags live in this table too now,
    // and a rescore that deleted them would silently undo the reviewer's
    // classification — the same hazard the article_reviews test already guards
    // against, one table over.
    `DELETE FROM article_tags WHERE article_id = ${L(row.id)} AND source = 'rules';`,
  ];

  // A freshly fetched body has to be stored, or it is classified once and then
  // discarded, and the drill-down still has nothing to show.
  if (row.excerpt) {
    out.push(`UPDATE articles SET excerpt = ${L(row.excerpt)} WHERE id = ${L(row.id)};`);
  }

  for (const t of c.tags) {
    out.push(
      // Skipped where a review owns the dimension. The delete above spared the
      // review's row; without this the rules would re-add their own beside it
      // and the article would carry two processes.
      `INSERT OR REPLACE INTO article_tags (article_id, dimension, value, confidence, source) `
      + `SELECT ${L(row.id)}, ${L(t.dimension)}, ${L(t.value)}, ${L(t.confidence)}, 'rules' `
      + `WHERE NOT EXISTS (SELECT 1 FROM article_tags WHERE article_id = ${L(row.id)} `
      + `AND dimension = ${L(t.dimension)} AND source = 'review');`);
  }

  out.push(
    `INSERT INTO article_scores (article_id, relevance_score, rule_hits, ai_intensity, `
    + `maturity, maturity_evidence, use_case_evidence, summary_extract, `
    + `ch_nexus, ch_nexus_evidence) `
    + `VALUES (${L(row.id)}, ${L(c.relevanceScore)}, ${L(JSON.stringify(c.ruleHits))}, `
    + `${L(c.aiIntensity)}, ${L(c.maturity)}, ${L(c.maturityEvidence)}, `
    // The extract is several sentences of the article, shown in the drawer: too
    // much of a subscriber's text. The one-sentence use case stays.
    + `${L(c.useCaseEvidence)}, ${L(row.excerpt_source === PRIVATE_SOURCE ? null : c.summaryExtract)}, `
    + `${L(c.chNexus)}, ${L(c.chNexusEvidence)}) `
    + `ON CONFLICT(article_id) DO UPDATE SET relevance_score=excluded.relevance_score, `
    + `rule_hits=excluded.rule_hits, ai_intensity=excluded.ai_intensity, `
    + `maturity=excluded.maturity, maturity_evidence=excluded.maturity_evidence, `
    + `use_case_evidence=excluded.use_case_evidence, `
    + `summary_extract=excluded.summary_extract, `
    + `ch_nexus=excluded.ch_nexus, `
    + `ch_nexus_evidence=excluded.ch_nexus_evidence;`);

  return out;
}
