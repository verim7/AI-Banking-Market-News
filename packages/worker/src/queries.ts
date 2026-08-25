import { UNCLASSIFIED, type Dimension } from '@portal/shared';
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
  /** Reviewed use-case grades. 'unreviewed' selects articles with no review. */
  grades?: string[];
  search?: string | null;
  from?: string | null;
  to?: string | null;
  minRelevance?: number | null;
  publisherKinds?: string[];
  favoritesOnly?: boolean;
  hilDecision?: 'relevant' | 'not_relevant' | 'undecided' | null;
  /** Restrict to specific ids. Scopes still apply on top of this. */
  articleIds?: string[];
  /**
   * Show rows marked as re-reports of another story. Off by default.
   *
   * One DBS rollout is eight rows in the archive. Counting it eight times
   * distorts every figure the Lens reports, so the Lens hides them — but the
   * Archive turns this on, because "find that story again" has to reach the
   * copy that was actually filed.
   */
  includeDuplicates?: boolean;
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
const HAS_AI_TYPE = `EXISTS (SELECT 1 FROM article_tags pt
                            WHERE pt.article_id = a.id AND pt.dimension = 'ai_type')`;

const HAS_USE_CASE_TEXT = `(sc.use_case_evidence IS NOT NULL AND sc.use_case_evidence <> '')`;

/**
 * How complete the picture of an article's use case is.
 *
 *   2  the article describes the use case in its own words AND an AI type was
 *      identified — a confirmed AI use case
 *   1  one of the two, not both — possible, unconfirmed
 *   0  neither
 *
 * Named rather than inlined because two things depend on it and they must not
 * drift: the promise ordering below, which decides what tops the table, and the
 * use-case measure, which reports how many were found. A tile that counted a
 * different set from the one the ranking promotes would be reporting on a
 * different app.
 */
export const COMPLETENESS_TIER = `(CASE
      WHEN ${HAS_AI_TYPE} AND ${HAS_USE_CASE_TEXT} THEN 2
      WHEN ${HAS_AI_TYPE} OR ${HAS_USE_CASE_TEXT} THEN 1
      ELSE 0
    END)`;

const PROMISE = `(
  (${COMPLETENESS_TIER} * 2
   -- Readability is a half step inside the tier, never a tier of its own.
   -- A readable article outranks an unreadable one of equal completeness,
   -- and still never outranks a more complete one. An article nobody can
   -- open is an article nobody can act on — the same argument that puts an
   -- empty AI category below a filled one — but completeness was asked for
   -- first and stays first.
   + (CASE WHEN a.excerpt IS NOT NULL AND a.excerpt <> '' THEN 1 ELSE 0 END)
  ) * 1000000
  + COALESCE(sc.ai_intensity, 0) * 1000
  + (CASE COALESCE(sc.maturity, 'unknown')
       WHEN 'in_production' THEN 3
       WHEN 'pilot'         THEN 2
       WHEN 'announced'     THEN 1
       ELSE 0
     END) * 100
)`;

/**
 * Review grade as an order, best first under DESC.
 *
 * Unreviewed sits above D and below C on purpose. The grades are not a single
 * quality scale: A, B and C say a person read the article and found a use case
 * of some strength, D says a person read it and found none. An unreviewed row
 * is unknown, and unknown belongs above known-worthless — burying every article
 * nobody has read yet beneath the ones already ruled out would empty the Lens
 * of everything ingested since the last review pass.
 */
const GRADE_RANK = `(CASE COALESCE(rv.grade, '')
    WHEN 'A' THEN 4
    WHEN 'B' THEN 3
    WHEN 'C' THEN 2
    WHEN ''  THEN 1
    ELSE 0
  END)`;

export const SORT_COLUMNS = {
  grade: GRADE_RANK,
  promise: PROMISE,
  published: 'COALESCE(a.published_at, a.fetched_at)',
  relevance: 'COALESCE(sc.relevance_score, 0)',
  aiIntensity: 'COALESCE(sc.ai_intensity, 0)',
  title: 'a.title',
  source: 'a.source_name',
  maturity: "COALESCE(rv.maturity, sc.maturity, 'unknown')",
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
    // Reviewed judgements live in their own table so rescore cannot reach them;
    // they are joined here so every list, count and export sees them at once.
    `LEFT JOIN article_reviews rv ON rv.article_id = a.id`,
    `LEFT JOIN favorites f ON f.article_id = a.id AND f.user_id = ?`,
    `LEFT JOIN hil_decisions h ON h.article_id = a.id AND h.user_id = ?`,
  ];
  const joinParams: (string | number)[] = [user.userId, user.userId];

  for (const [key, dimension] of DIMENSION_OF_FILTER) {
    const values = filters[key] as string[] | undefined;
    if (!values || values.length === 0) continue;

    // "Not classified" is a value like any other in the UI, and here is the one
    // place that has to know it isn't. Handling it inside the shared builder
    // means the list, the count, the trend, the facets and the CSV export all
    // understand it without a line of their own — the alternative was five
    // places that could each get the rule slightly wrong.
    const real = values.filter((v) => v !== UNCLASSIFIED);
    const wantsUnclassified = real.length !== values.length;

    const clauses: string[] = [];
    if (real.length > 0) {
      const placeholders = real.map(() => '?').join(', ');
      clauses.push(
        `EXISTS (SELECT 1 FROM article_tags dt WHERE dt.article_id = a.id `
        + `AND dt.dimension = ? AND dt.value IN (${placeholders}))`);
      params.push(dimension, ...real);
    }
    if (wantsUnclassified) {
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM article_tags dt WHERE dt.article_id = a.id `
        + `AND dt.dimension = ?)`);
      params.push(dimension);
    }

    // OR, not AND: picking "Switzerland" and "Not classified" asks for both
    // sets, exactly as picking two regions does.
    where.push(clauses.length === 1 ? clauses[0]! : `(${clauses.join(' OR ')})`);
  }

  if (!filters.includeDuplicates) where.push(`a.duplicate_of IS NULL`);

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

  if (filters.grades?.length) {
    const real = filters.grades.filter((g) => g !== 'unreviewed');
    const wantsUnreviewed = real.length !== filters.grades.length;
    const clauses: string[] = [];
    if (real.length > 0) {
      clauses.push(`rv.grade IN (${real.map(() => '?').join(', ')})`);
      params.push(...real);
    }
    // Same rule as the taxonomy filters: "not reviewed" is an option like any
    // other, so no article is unreachable from this filter either.
    if (wantsUnreviewed) clauses.push(`rv.article_id IS NULL`);
    where.push(clauses.length === 1 ? clauses[0]! : `(${clauses.join(' OR ')})`);
  }

  if (filters.maturities?.length) {
    where.push(`COALESCE(rv.maturity, sc.maturity, 'unknown') IN `
      + `(${filters.maturities.map(() => '?').join(', ')})`);
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
  // recency, which answers a different one. The Lens asks for 'grade' instead,
  // which puts the confirmed use cases first and falls back to promise inside
  // each grade.
  const sortKey: SortKey = filters.sort && filters.sort in SORT_COLUMNS
    ? filters.sort
    : 'promise';
  const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  // Four ranks over a thousand rows leaves huge ties, and date alone inside a
  // grade would bury a deployment under a week of unreviewed noise. Promise is
  // what the table sorted by before grades existed, so it is what the ties fall
  // back to. Always DESC: an ascending grade sort asks for the weakest grade
  // first, not for the weakest article within it.
  const tiebreak = sortKey === 'grade' ? `${PROMISE} DESC,\n         ` : '';

  const sql = `
SELECT
  a.id, a.url_canonical AS url, a.title, a.summary,${opts.includeBody ? '\n  a.excerpt,' : ''}
  a.source_name, a.publisher_kind,
  a.published_at, a.fetched_at, a.enriched_by,
  sc.summary_extract,
  COALESCE(sc.relevance_score, 0) AS relevance_score,
  COALESCE(sc.ai_intensity, 0) AS ai_intensity,
  -- A review overrides the rules where it has an opinion. COALESCE, not
  -- replacement: a reviewer who left maturity alone meant "the rules were
  -- right", not "unknown".
  COALESCE(rv.maturity, sc.maturity, 'unknown') AS maturity,
  sc.maturity_evidence,
  sc.use_case_evidence,
  rv.grade AS review_grade,
  rv.headline AS review_headline,
  rv.actor AS review_actor,
  rv.task AS review_task,
  rv.technique AS review_technique,
  rv.outcome AS review_outcome,
  rv.evidence AS review_evidence,
  rv.confidence AS review_confidence,
  rv.l1_process AS review_l1_process,
  rv.ai_type AS review_ai_type,
  rv.use_case AS review_use_case,
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
         ${tiebreak}COALESCE(a.published_at, a.fetched_at) DESC,
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
  // Alias fx, not ft: the dimension filters in the WHERE clause use their own
  // alias, and two identical aliases in one statement work only because SQLite
  // resolves the inner scope first. Correct by accident is a trap, not a design.
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    'SELECT fx.dimension, fx.value, COUNT(DISTINCT a.id) AS n '
    + 'FROM articles a JOIN article_tags fx ON fx.article_id = a.id AND fx.dimension = ?',
  ) + '\nGROUP BY fx.dimension, fx.value ORDER BY n DESC';

  // The replacement puts this JOIN first in the statement, so its placeholder
  // binds ahead of every other parameter — including the two user ids in the
  // joins that follow.
  return { sql, params: [dimension, ...base.params] };
}

/**
 * How many articles in this view carry no tag at all in one dimension — the
 * count behind the "Not classified" option.
 *
 * Built by asking buildArticleQuery for exactly the selection the option
 * represents, so the number and the result set it promises are the same SQL.
 * Counting it any other way invites the failure where an option advertises 40
 * articles and returns 37, and nobody can tell which figure is wrong.
 *
 * The dimension's own selection is cleared first, for the same reason
 * buildFacetQueryFor clears it: an option must keep its count once chosen, or
 * it cannot be unchosen.
 */
export function buildUnclassifiedFacetQuery(
  user: UserContext, filters: ArticleFilters, dimension: Dimension,
): BuiltQuery {
  const key = DIMENSION_OF_FILTER.find(([, d]) => d === dimension)?.[0];
  const scoped: ArticleFilters = key
    ? { ...filters, [key]: [UNCLASSIFIED] }
    : { ...filters };

  return buildArticleQuery(user, { ...scoped, limit: MAX_LIMIT }, { countOnly: true });
}

/**
 * Headline figures for the whole filtered view, not just the loaded page.
 *
 * The stat tiles used to count maturity from the 200 articles the Lens had
 * loaded, so with 260 in view "In production: 31" quietly meant "in production
 * among the top 200" under a label that said otherwise. Everything reported as
 * a number about the view is counted here, across the view.
 */
export function buildMeasuresQuery(
  user: UserContext, filters: ArticleFilters,
): BuiltQuery {
  const base = buildArticleQuery(user, filters, { countOnly: true });
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    `SELECT COUNT(*) AS total,
       -- Reviewed grades where a review exists, the rule heuristic where it
       -- does not. Both are reported so the tile can say how much of the view
       -- has actually been read rather than inferred.
       SUM(CASE WHEN rv.grade IN ('A','B') THEN 1 ELSE 0 END) AS reviewed_use_cases,
       SUM(CASE WHEN rv.grade = 'A' THEN 1 ELSE 0 END) AS deployed_use_cases,
       SUM(CASE WHEN rv.article_id IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_total,
       SUM(CASE WHEN rv.article_id IS NULL AND ${COMPLETENESS_TIER} = 2 THEN 1 ELSE 0 END)
         AS confirmed_use_cases,
       SUM(CASE WHEN rv.article_id IS NULL AND ${COMPLETENESS_TIER} = 1 THEN 1 ELSE 0 END)
         AS possible_use_cases
FROM articles a`,
  );

  return { sql, params: base.params };
}

/**
 * Counts for the reviewed-grade filter, including the articles with no review.
 *
 * Its own builder rather than buildColumnFacetQuery because the interesting
 * bucket is the NULL one — how much of the view has not been read yet is the
 * number that says how far to trust the rest.
 */
export function buildGradeFacetQuery(
  user: UserContext, filters: ArticleFilters,
): BuiltQuery {
  const base = buildArticleQuery(user, { ...filters, grades: [], limit: MAX_LIMIT },
                                 { countOnly: true });
  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    "SELECT COALESCE(rv.grade, 'unreviewed') AS value, COUNT(DISTINCT a.id) AS n FROM articles a",
  ) + "\nGROUP BY COALESCE(rv.grade, 'unreviewed') ORDER BY n DESC";

  return { sql, params: base.params };
}

/** Counts for a column-backed filter (publisher kind, maturity). */
export function buildColumnFacetQuery(
  user: UserContext, filters: ArticleFilters, column: 'publisher_kind' | 'maturity',
): BuiltQuery {
  const without: ArticleFilters = column === 'publisher_kind'
    ? { ...filters, publisherKinds: [] }
    : { ...filters, maturities: [] };

  const expr = column === 'publisher_kind'
    ? 'a.publisher_kind'
    : "COALESCE(rv.maturity, sc.maturity, 'unknown')";
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
export type TrendBucket = 'day' | 'week' | 'month';

export function buildTrendQuery(
  user: UserContext, filters: ArticleFilters, bucket: TrendBucket = 'day',
): BuiltQuery {
  const base = buildArticleQuery(user, filters, { countOnly: true });

  // Day and month are prefixes of the ISO timestamp already stored, so they are
  // a substr. A week is labelled by the date of its Monday rather than a week
  // number: it stays a real date, which means empty weeks can be filled in by
  // stepping and the axis reads as something a person recognises. ('-6 days',
  // 'weekday 1') is the SQLite idiom for "the Monday of this date's week", and
  // it puts Sunday in the week that began six days earlier, as ISO does.
  const expr = bucket === 'week'
    ? `date(substr(COALESCE(a.published_at, a.fetched_at), 1, 10), '-6 days', 'weekday 1')`
    : `substr(COALESCE(a.published_at, a.fetched_at), 1, ${bucket === 'month' ? 7 : 10})`;

  const sql = base.sql.replace(
    'SELECT COUNT(*) AS total FROM articles a',
    `SELECT ${expr} AS day, COUNT(*) AS n FROM articles a`,
  ) + '\nGROUP BY day ORDER BY day ASC';

  return { sql, params: base.params };
}
