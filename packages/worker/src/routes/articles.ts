import { Hono } from 'hono';
import {
  DEFAULT_RELEVANCE_THRESHOLD, DIMENSION_LABELS, FILTER_DIMENSIONS, MATURITY_LABELS,
  MIN_AI_INTENSITY, TAXONOMY, DIMENSIONS, UNCLASSIFIED,
} from '@portal/shared';
import {
  buildArticleQuery, buildColumnFacetQuery, buildFacetQueryFor, buildGradeFacetQuery,
  buildMeasuresQuery, buildTrendQuery, buildUnclassifiedFacetQuery,
  type ArticleFilters, type TrendBucket,
} from '../queries.ts';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

export const articleRoutes = new Hono<AppEnv>();

/**
 * The reader chooses the bucket; an unknown value falls back to days.
 *
 * This used to be inferred from the width of the date window, which meant the
 * one question the chart is for — how much moved this week — could not be asked
 * of a twelve-month view at all.
 */
function bucketFromQuery(v: string | undefined): TrendBucket {
  return v === 'week' || v === 'month' ? v : 'day';
}

const list = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

function filtersFromQuery(q: Record<string, string | undefined>): ArticleFilters {
  const minRelevance = q['minRelevance'];
  return {
    regions: list(q['regions']),
    bankingAreas: list(q['bankingAreas']),
    bankCategories: list(q['bankCategories']),
    useCases: list(q['useCases']),
    aiTypes: list(q['aiTypes']),
    l1Processes: list(q['l1Processes']),
    maturities: list(q['maturities']),
    grades: list(q['grades']),
    includeDuplicates: q['includeDuplicates'] === 'true',
    minAiIntensity: q['minAiIntensity'] !== undefined && q['minAiIntensity'] !== ''
      ? Number(q['minAiIntensity'])
      : null,
    publisherKinds: list(q['publisherKinds']),
    search: q['search'] ?? null,
    from: q['from'] ?? null,
    to: q['to'] ?? null,
    minRelevance: minRelevance !== undefined && minRelevance !== ''
      ? Number(minRelevance)
      : DEFAULT_RELEVANCE_THRESHOLD,
    favoritesOnly: q['favoritesOnly'] === 'true',
    hilDecision: (q['hilDecision'] as ArticleFilters['hilDecision']) ?? null,
    sort: q['sort'] as ArticleFilters['sort'],
    sortDir: q['sortDir'] === 'asc' ? 'asc' : 'desc',
    limit: q['limit'] ? Number(q['limit']) : 50,
    offset: q['offset'] ? Number(q['offset']) : 0,
  };
}

/** The taxonomy the UI renders its filter controls from. */
articleRoutes.get('/taxonomy', (c) =>
  c.json({
    // Every dimension, with a flag for the ones the filter bar offers. All of
    // them are returned because the analysis table and the export label tags in
    // dimensions nobody filters on — dropping them here would blank those cells.
    dimensions: DIMENSIONS.map((d) => ({
      dimension: d,
      label: DIMENSION_LABELS[d],
      filterable: FILTER_DIMENSIONS.includes(d),
      values: TAXONOMY[d].map((e) => ({ value: e.value, label: e.label })),
    })),
    maturities: Object.entries(MATURITY_LABELS).map(([value, label]) => ({ value, label })),
    defaultRelevanceThreshold: DEFAULT_RELEVANCE_THRESHOLD,
    minAiIntensity: MIN_AI_INTENSITY,
  }));

articleRoutes.get('/', requirePermission('articles.read'), async (c) => {
  const filters = filtersFromQuery(c.req.query());
  const user = c.get('user');

  const listQuery = buildArticleQuery(user, filters);
  const countQuery = buildArticleQuery(user, filters, { countOnly: true });

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(listQuery.sql).bind(...listQuery.params).all(),
    c.env.DB.prepare(countQuery.sql).bind(...countQuery.params).first<{ total: number }>(),
  ]);

  return c.json({
    total: count?.total ?? 0,
    limit: filters.limit,
    offset: filters.offset,
    articles: (rows.results ?? []).map(shapeArticle),
  });
});

/**
 * Option counts for every filter, each computed with the other filters applied
 * but not its own — see buildFacetQueryFor. One query per dimension rather than
 * one query for all of them, which is the only way a dimension can be excluded
 * from its own counts. Cheap here: these tables are small and D1 time is I/O.
 */
articleRoutes.get('/facets', requirePermission('articles.read'), async (c) => {
  const user = c.get('user');
  const filters = filtersFromQuery(c.req.query());

  const tagQueries = FILTER_DIMENSIONS.map((d) => buildFacetQueryFor(user, filters, d));

  // One "Not classified" count per filterable dimension, so no article is
  // unreachable from any filter. Two dimensions need nothing: maturity funnels
  // untagged articles into 'unknown' through COALESCE, and publisher_kind is
  // NOT NULL with a four-value CHECK, so both facets are already total.
  const noneQueries = FILTER_DIMENSIONS.map((d) =>
    ({ dimension: d, q: buildUnclassifiedFacetQuery(user, filters, d) }));

  const columnQueries = (['publisher_kind', 'maturity'] as const)
    .map((col) => ({ col, q: buildColumnFacetQuery(user, filters, col) }));

  const gradeQuery = buildGradeFacetQuery(user, filters);
  const measuresQuery = buildMeasuresQuery(user, filters);

  const [tagResults, noneResults, columnResults, gradeRows, measures] = await Promise.all([
    Promise.all(tagQueries.map((q) =>
      c.env.DB.prepare(q.sql).bind(...q.params)
        .all<{ dimension: string; value: string; n: number }>())),
    Promise.all(noneQueries.map(async ({ dimension, q }) => ({
      dimension,
      n: (await c.env.DB.prepare(q.sql).bind(...q.params)
        .first<{ total: number }>())?.total ?? 0,
    }))),
    Promise.all(columnQueries.map(async ({ col, q }) => ({
      col,
      rows: (await c.env.DB.prepare(q.sql).bind(...q.params)
        .all<{ value: string; n: number }>()).results ?? [],
    }))),
    c.env.DB.prepare(gradeQuery.sql).bind(...gradeQuery.params)
      .all<{ value: string; n: number }>(),
    c.env.DB.prepare(measuresQuery.sql).bind(...measuresQuery.params)
      .first<{
        total: number; confirmed_use_cases: number; possible_use_cases: number;
        reviewed_use_cases: number; deployed_use_cases: number; reviewed_total: number;
      }>(),
  ]);

  const facets = [
    ...tagResults.flatMap((r) => r.results ?? []),
    // Emitted even at zero. An option that appears only when it is non-empty
    // makes its absence something the reader has to interpret.
    ...noneResults.map(({ dimension, n }) => ({ dimension, value: UNCLASSIFIED, n })),
    ...columnResults.flatMap(({ col, rows }) =>
      rows.map((r) => ({ dimension: col, value: r.value, n: r.n }))),
    ...(gradeRows.results ?? []).map((r) => ({ dimension: 'grade', value: r.value, n: r.n })),
  ];

  return c.json({
    facets,
    measures: {
      total: measures?.total ?? 0,
      // SUM over no rows is NULL, not 0.
      confirmedUseCases: measures?.confirmed_use_cases ?? 0,
      possibleUseCases: measures?.possible_use_cases ?? 0,
      reviewedUseCases: measures?.reviewed_use_cases ?? 0,
      deployedUseCases: measures?.deployed_use_cases ?? 0,
      reviewedTotal: measures?.reviewed_total ?? 0,
    },
  });
});

articleRoutes.get('/trend', requirePermission('articles.read'), async (c) => {
  const filters = filtersFromQuery(c.req.query());
  const bucket = bucketFromQuery(c.req.query('bucket'));
  const q = buildTrendQuery(c.get('user'), filters, bucket);
  const rows = await c.env.DB.prepare(q.sql).bind(...q.params).all<{ day: string; n: number }>();
  return c.json({ bucket, trend: rows.results ?? [] });
});

/** Flatten the GROUP_CONCAT'ed tag string back into structured tags. */
export function shapeArticle(row: Record<string, unknown>) {
  const tagString = (row['tags'] as string | null) ?? '';
  const tags = tagString
    ? tagString.split('|').map((pair) => {
        const [dimension, ...rest] = pair.split(':');
        return { dimension: dimension!, value: rest.join(':') };
      })
    : [];

  let ruleHits: unknown = [];
  try {
    ruleHits = JSON.parse((row['rule_hits'] as string | null) ?? '[]');
  } catch { /* a malformed score explanation must not break the feed */ }

  return {
    id: row['id'],
    url: row['url'],
    title: row['title'],
    summary: row['summary'],
    source: row['source_name'],
    publisherKind: row['publisher_kind'],
    publishedAt: row['published_at'],
    fetchedAt: row['fetched_at'],
    enrichedBy: row['enriched_by'],
    relevance: row['relevance_score'],
    aiIntensity: row['ai_intensity'],
    maturity: row['maturity'],
    maturityEvidence: row['maturity_evidence'],
    useCaseEvidence: row['use_case_evidence'],
    summaryExtract: row['summary_extract'],
    ruleHits,
    // Present only when the article has been reviewed. The client uses its
    // absence to say "rules only", which a reader needs to know.
    review: row['review_grade']
      ? {
          grade: row['review_grade'],
          headline: row['review_headline'],
          actor: row['review_actor'],
          task: row['review_task'],
          technique: row['review_technique'],
          outcome: row['review_outcome'],
          evidence: row['review_evidence'],
          confidence: row['review_confidence'],
        }
      : null,
    isFavorite: row['is_favorite'] === 1,
    hilDecision: row['hil_decision'],
    hilNote: row['hil_note'],
    tags,
  };
}

/**
 * One article with its body text.
 *
 * A separate endpoint rather than more columns on the list: the extract runs to
 * 4000 characters, and carrying it across a 200-row Lens page would add most of
 * a megabyte to every load for text nobody has opened yet.
 *
 * Built through buildArticleQuery with the articleIds filter so RBAC scopes
 * apply exactly as they do to the list. Reaching an article by guessing its id
 * must not be a way around a scope, and a bespoke SELECT here would be a second
 * place for that rule to be got wrong.
 *
 * Registered last on purpose. Hono matches in registration order, so a
 * wildcard placed above /facets or /taxonomy captures those words as an id and
 * the endpoints they belong to stop existing.
 */
articleRoutes.get('/:id', requirePermission('articles.read'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  // A duplicate reached by its own id is still a real article: the drill-down
  // must open it rather than report it missing.
  const query = buildArticleQuery(user, { articleIds: [id], limit: 1, includeDuplicates: true },
                                  { includeBody: true });
  const row = await c.env.DB.prepare(query.sql).bind(...query.params).first();

  // Out of scope and not existing are the same answer on purpose: a 403 here
  // would confirm the article exists to someone not allowed to see it.
  if (!row) return c.json({ error: 'not found' }, 404);

  return c.json({ article: { ...shapeArticle(row), excerpt: row['excerpt'] ?? null } });
});
