import { Hono } from 'hono';
import {
  DEFAULT_RELEVANCE_THRESHOLD, DIMENSION_LABELS, MATURITY_LABELS, MIN_AI_INTENSITY,
  TAXONOMY, DIMENSIONS,
} from '@portal/shared';
import {
  buildArticleQuery, buildColumnFacetQuery, buildFacetQueryFor, buildTrendQuery,
  type ArticleFilters,
} from '../queries.ts';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

export const articleRoutes = new Hono<AppEnv>();

/** Long ranges get monthly buckets; see buildTrendQuery. */
function spansMonths(f: ArticleFilters): boolean {
  if (!f.from) return true;               // no lower bound means all of history
  const from = Date.parse(f.from);
  if (Number.isNaN(from)) return false;
  const to = f.to ? Date.parse(f.to) : Date.now();
  return (to - from) > 62 * 86_400_000;
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
    dimensions: DIMENSIONS.map((d) => ({
      dimension: d,
      label: DIMENSION_LABELS[d],
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

  const tagQueries = DIMENSIONS.map((d) => buildFacetQueryFor(user, filters, d));
  const columnQueries = (['publisher_kind', 'maturity'] as const)
    .map((col) => ({ col, q: buildColumnFacetQuery(user, filters, col) }));

  const [tagResults, columnResults] = await Promise.all([
    Promise.all(tagQueries.map((q) =>
      c.env.DB.prepare(q.sql).bind(...q.params)
        .all<{ dimension: string; value: string; n: number }>())),
    Promise.all(columnQueries.map(async ({ col, q }) => ({
      col,
      rows: (await c.env.DB.prepare(q.sql).bind(...q.params)
        .all<{ value: string; n: number }>()).results ?? [],
    }))),
  ]);

  const facets = [
    ...tagResults.flatMap((r) => r.results ?? []),
    ...columnResults.flatMap(({ col, rows }) =>
      rows.map((r) => ({ dimension: col, value: r.value, n: r.n }))),
  ];

  return c.json({ facets });
});

articleRoutes.get('/trend', requirePermission('articles.read'), async (c) => {
  const filters = filtersFromQuery(c.req.query());
  const q = buildTrendQuery(c.get('user'), filters, spansMonths(filters) ? 'month' : 'day');
  const rows = await c.env.DB.prepare(q.sql).bind(...q.params).all<{ day: string; n: number }>();
  return c.json({ trend: rows.results ?? [] });
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
    ruleHits,
    isFavorite: row['is_favorite'] === 1,
    hilDecision: row['hil_decision'],
    hilNote: row['hil_note'],
    tags,
  };
}
