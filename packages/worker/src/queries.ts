import type { Dimension } from '@portal/shared';
import { scopePredicate, type UserContext } from './rbac.ts';

export interface ArticleFilters {
  regions?: string[];
  bankingAreas?: string[];
  bankCategories?: string[];
  useCases?: string[];
  aiTypes?: string[];
  l1Processes?: string[];
  minAiIntensity?: number | null;
  maturities?: string[];
  search?: string | null;
  from?: string | null;
  to?: string | null;
  minRelevance?: number | null;
  publisherKinds?: string[];
  favoritesOnly?: boolean;
  hilDecision?: 'relevant' | 'not_relevant' | 'undecided' | null;
  /** Restrict to specific ids. Scopes still apply on top of this. */
  articleIds?: string[];
  limit?: number;
  offset?: number;
}

const DIMENSION_OF_FILTER: [keyof ArticleFilters, Dimension][] = [
  ['regions', 'region'],
  ['bankingAreas', 'banking_area'],
  ['bankCategories', 'bank_category'],
  ['useCases', 'use_case'],
  ['aiTypes', 'ai_type'],
  ['l1Processes', 'l1_process'],
];

export interface BuiltQuery {
  sql: string;
  params: (string | number)[];
}

/** Default page cap for interactive lists. The export path raises it. */
const MAX_LIMIT = 200;
const MAX_EXPORT_LIMIT = 500;

/**
 * One builder for every article list in the app — News, Market Lens, Archive,
 * Favorites, the HIL queue and the CSV export all differ only by filters. The
 * scope predicate is appended here rather than by each caller, so a new
 * endpoint cannot forget it.
 */
export function buildArticleQuery(
  user: UserContext,
  filters: ArticleFilters,
  opts: { countOnly?: boolean; maxLimit?: number } = {},
): BuiltQuery {
  const where: string[] = [];
  const params: (string | number)[] = [];

  // The user's own favourite and decision state, joined per-user.
  const joins = [
    `LEFT JOIN article_scores sc ON sc.article_id = a.id`,
    `LEFT JOIN favorites f ON f.article_id = a.id AND f.user_id = ?`,
    `LEFT JOIN hil_decisions h ON h.article_id = a.id AND h.user_id = ?`,
  ];
  const joinParams: (string | number)[] = [user.userId, user.userId];

  for (const [key, dimension] of DIMENSION_OF_FILTER) {
    const values = filters[key] as string[] | undefined;
    if (!values || values.length === 0) continue;
    const placeholders = values.map(() => '?').join(', ');
    where.push(
      `EXISTS (SELECT 1 FROM article_tags ft WHERE ft.article_id = a.id `
      + `AND ft.dimension = ? AND ft.value IN (${placeholders}))`);
    params.push(dimension, ...values);
  }

  if (filters.articleIds?.length) {
    where.push(`a.id IN (${filters.articleIds.map(() => '?').join(', ')})`);
    params.push(...filters.articleIds);
  }

  if (filters.publisherKinds?.length) {
    where.push(`a.publisher_kind IN (${filters.publisherKinds.map(() => '?').join(', ')})`);
    params.push(...filters.publisherKinds);
  }

  if (filters.search) {
    // search_text is stored lowercased at ingest, so the column is not wrapped
    // in lower() here and the index stays usable.
    where.push(`a.search_text LIKE ?`);
    params.push(`%${filters.search.toLowerCase()}%`);
  }

  if (filters.from) {
    where.push(`COALESCE(a.published_at, a.fetched_at) >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`COALESCE(a.published_at, a.fetched_at) <= ?`);
    params.push(filters.to);
  }

  if (typeof filters.minRelevance === 'number') {
    where.push(`COALESCE(sc.relevance_score, 0) >= ?`);
    params.push(filters.minRelevance);
  }

  if (typeof filters.minAiIntensity === 'number') {
    where.push(`COALESCE(sc.ai_intensity, 0) >= ?`);
    params.push(filters.minAiIntensity);
  }

  if (filters.maturities?.length) {
    where.push(`COALESCE(sc.maturity, 'unknown') IN (${filters.maturities.map(() => '?').join(', ')})`);
    params.push(...filters.maturities);
  }

  if (filters.favoritesOnly) where.push(`f.article_id IS NOT NULL`);

  if (filters.hilDecision) {
    if (filters.hilDecision === 'undecided') {
      // "Undecided" must include articles with no decision row at all, which is
      // where every new article starts.
      where.push(`(h.decision IS NULL OR h.decision = 'undecided')`);
    } else {
      where.push(`h.decision = ?`);
      params.push(filters.hilDecision);
    }
  }

  const scope = scopePredicate(user, 'a');
  if (scope.where) {
    where.push(scope.where);
    params.push(...scope.params);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join('\n  AND ')}` : '';

  if (opts.countOnly) {
    return {
      sql: `SELECT COUNT(*) AS total FROM articles a\n${joins.join('\n')}\n${whereSql}`,
      params: [...joinParams, ...params],
    };
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), opts.maxLimit ?? MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  const sql = `
SELECT
  a.id, a.url_canonical AS url, a.title, a.summary, a.source_name, a.publisher_kind,
  a.published_at, a.fetched_at, a.enriched_by,
  COALESCE(sc.relevance_score, 0) AS relevance_score,
  COALESCE(sc.ai_intensity, 0) AS ai_intensity,
  COALESCE(sc.maturity, 'unknown') AS maturity,
  sc.maturity_evidence,
  sc.rule_hits,
  CASE WHEN f.article_id IS NULL THEN 0 ELSE 1 END AS is_favorite,
  COALESCE(h.decision, 'undecided') AS hil_decision,
  COALESCE(h.note, '') AS hil_note,
  (SELECT GROUP_CONCAT(t.dimension || ':' || t.value, '|')
     FROM article_tags t WHERE t.article_id = a.id) AS tags
FROM articles a
${joins.join('\n')}
${whereSql}
ORDER BY COALESCE(sc.relevance_score, 0) DESC,
         COALESCE(a.published_at, a.fetched_at) DESC
LIMIT ? OFFSET ?`.trim();

  return { sql, params: [...joinParams, ...params, limit, offset] };
}

/** Counts per taxonomy value for the Market Lens facets, scope-aware. */
export { MAX_EXPORT_LIMIT };

export function buildFacetQuery(user: UserContext, filters: ArticleFilters): BuiltQuery {
  const base = buildArticleQuery(user, { ...filters, limit: MAX_LIMIT }, { countOnly: true });
  // Reuse the predicate by wrapping it: the facet counts must respect exactly
  // the same visibility rules as the list they annotate.
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    'SELECT ft.dimension, ft.value, COUNT(DISTINCT a.id) AS n '
    + 'FROM articles a JOIN article_tags ft ON ft.article_id = a.id',
  ) + '\nGROUP BY ft.dimension, ft.value ORDER BY n DESC';

  return { sql, params: base.params };
}

/** Daily volume for the Market Lens trend chart, scope-aware. */
/**
 * Volume over time, bucketed by day or by month.
 *
 * A year of daily points is 365 marks in a chart a few hundred pixels wide —
 * unreadable, and it hides the trend the Lens exists to show. Anything longer
 * than roughly two months is bucketed monthly instead.
 */
export function buildTrendQuery(
  user: UserContext, filters: ArticleFilters, bucket: 'day' | 'month' = 'day',
): BuiltQuery {
  const base = buildArticleQuery(user, filters, { countOnly: true });
  const width = bucket === 'month' ? 7 : 10;
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    `SELECT substr(COALESCE(a.published_at, a.fetched_at), 1, ${width}) AS day, `
    + 'COUNT(*) AS n FROM articles a',
  ) + '\nGROUP BY day ORDER BY day ASC';

  return { sql, params: base.params };
}
