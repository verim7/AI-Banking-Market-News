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
  /** Column to order by. Whitelisted, never interpolated from user input. */
  sort?: SortKey;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Sortable columns, as a fixed map rather than a string the caller supplies.
 * ORDER BY cannot take a bound parameter, so the value would have to be
 * interpolated — and interpolating anything a client sends is how injection
 * happens. A whitelist means the client picks a key, never SQL.
 */
/**
 * How promising an article is, as one orderable number.
 *
 * Three parts, and the multipliers are what make the ordering mean something:
 *
 *   tier * 1000000   completeness, and it dominates absolutely
 *   ai_intensity * 1000   orders within a tier
 *   maturity * 100        lifts a near-tie
 *
 * An article scoring 100 on AI focus with no AI category and no described use
 * case is not the most promising thing in the list — it is an article nobody
 * can act on. Completeness therefore decides the tier and no score can cross a
 * tier boundary, which is why the multiplier is larger than the widest possible
 * spread of everything below it.
 *
 * Inside a tier, AI focus leads, as asked. Maturity is deliberately small: it
 * should lift a deployment over a pilot of the same strength, not carry a weak
 * article over a strong one.
 */
const PROMISE = `(
  (CASE
     WHEN EXISTS (SELECT 1 FROM article_tags pt
                   WHERE pt.article_id = a.id AND pt.dimension = 'ai_type')
      AND sc.use_case_evidence IS NOT NULL AND sc.use_case_evidence <> ''
       THEN 2
     WHEN EXISTS (SELECT 1 FROM article_tags pt
                   WHERE pt.article_id = a.id AND pt.dimension = 'ai_type')
       OR (sc.use_case_evidence IS NOT NULL AND sc.use_case_evidence <> '')
       THEN 1
     ELSE 0
   END) * 1000000
  + COALESCE(sc.ai_intensity, 0) * 1000
  + (CASE COALESCE(sc.maturity, 'unknown')
       WHEN 'in_production' THEN 3
       WHEN 'pilot'         THEN 2
       WHEN 'announced'     THEN 1
       ELSE 0
     END) * 100
)`;

export const SORT_COLUMNS = {
  promise: PROMISE,
  published: 'COALESCE(a.published_at, a.fetched_at)',
  relevance: 'COALESCE(sc.relevance_score, 0)',
  aiIntensity: 'COALESCE(sc.ai_intensity, 0)',
  title: 'a.title',
  source: 'a.source_name',
  maturity: "COALESCE(sc.maturity, 'unknown')",
} as const;

export type SortKey = keyof typeof SORT_COLUMNS;

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
  opts: {
    countOnly?: boolean;
    maxLimit?: number;
    /**
     * Include the article's full body text.
     *
     * Off for lists. The extract runs to 4000 characters, so a 200-row Lens
     * page would carry most of a megabyte of text nobody has opened.
     */
    includeBody?: boolean;
  } = {},
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

  // Promise by default: the first question anyone asks of this table is which
  // use cases are worth reading, and relevance also weighs publisher and
  // recency, which answers a different one.
  const sortKey: SortKey = filters.sort && filters.sort in SORT_COLUMNS
    ? filters.sort
    : 'promise';
  const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  const sql = `
SELECT
  a.id, a.url_canonical AS url, a.title, a.summary,${opts.includeBody ? '\n  a.excerpt,' : ''}
  a.source_name, a.publisher_kind,
  a.published_at, a.fetched_at, a.enriched_by,
  sc.summary_extract,
  COALESCE(sc.relevance_score, 0) AS relevance_score,
  COALESCE(sc.ai_intensity, 0) AS ai_intensity,
  COALESCE(sc.maturity, 'unknown') AS maturity,
  sc.maturity_evidence,
  sc.use_case_evidence,
  sc.rule_hits,
  CASE WHEN f.article_id IS NULL THEN 0 ELSE 1 END AS is_favorite,
  COALESCE(h.decision, 'undecided') AS hil_decision,
  COALESCE(h.note, '') AS hil_note,
  (SELECT GROUP_CONCAT(t.dimension || ':' || t.value, '|')
     FROM article_tags t WHERE t.article_id = a.id) AS tags
FROM articles a
${joins.join('\n')}
${whereSql}
ORDER BY ${SORT_COLUMNS[sortKey]} ${dir},
         COALESCE(a.published_at, a.fetched_at) DESC,
         a.id ASC
LIMIT ? OFFSET ?`.trim();

  return { sql, params: [...joinParams, ...params, limit, offset] };
}

/** Counts per taxonomy value for the Market Lens facets, scope-aware. */
export { MAX_EXPORT_LIMIT };

/**
 * Counts for one dimension's options, with every OTHER filter applied but not
 * its own.
 *
 * Applying a dimension's filter to its own counts is the classic faceted-search
 * bug and the reason options went empty: pick Switzerland and the region facet
 * returns only Switzerland, so Germany can never be added. Excluding the
 * dimension from its own query keeps its options selectable while still
 * narrowing them by everything else — pick "Agentic AI" and the region list
 * shows only regions that actually have agentic articles, with counts.
 *
 * Options that would return nothing simply do not come back, which is what
 * makes it impossible to choose a filter with no results.
 */
export function buildFacetQueryFor(
  user: UserContext, filters: ArticleFilters, dimension: Dimension,
): BuiltQuery {
  const key = DIMENSION_OF_FILTER.find(([, d]) => d === dimension)?.[0];
  const without: ArticleFilters = key ? { ...filters, [key]: [] } : { ...filters };

  const base = buildArticleQuery(user, { ...without, limit: MAX_LIMIT }, { countOnly: true });
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    'SELECT ft.dimension, ft.value, COUNT(DISTINCT a.id) AS n '
    + 'FROM articles a JOIN article_tags ft ON ft.article_id = a.id AND ft.dimension = ?',
  ) + '\nGROUP BY ft.dimension, ft.value ORDER BY n DESC';

  // The replacement puts this JOIN first in the statement, so its placeholder
  // binds ahead of every other parameter — including the two user ids in the
  // joins that follow.
  return { sql, params: [dimension, ...base.params] };
}

/** Counts for a column-backed filter (publisher kind, maturity). */
export function buildColumnFacetQuery(
  user: UserContext, filters: ArticleFilters, column: 'publisher_kind' | 'maturity',
): BuiltQuery {
  const without: ArticleFilters = column === 'publisher_kind'
    ? { ...filters, publisherKinds: [] }
    : { ...filters, maturities: [] };

  const expr = column === 'publisher_kind' ? 'a.publisher_kind' : "COALESCE(sc.maturity, 'unknown')";
  const base = buildArticleQuery(user, { ...without, limit: MAX_LIMIT }, { countOnly: true });
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    `SELECT ${expr} AS value, COUNT(DISTINCT a.id) AS n FROM articles a`,
  ) + `\nGROUP BY ${expr} ORDER BY n DESC`;

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
