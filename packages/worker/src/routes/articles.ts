import { Hono } from 'hono';
import { DEFAULT_RELEVANCE_THRESHOLD, DIMENSION_LABELS, TAXONOMY, DIMENSIONS } from '@portal/shared';
import { buildArticleQuery, buildFacetQuery, buildTrendQuery, type ArticleFilters } from '../queries.ts';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

export const articleRoutes = new Hono<AppEnv>();

const list = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

function filtersFromQuery(q: Record<string, string | undefined>): ArticleFilters {
  const minRelevance = q['minRelevance'];
  return {
    regions: list(q['regions']),
    bankingAreas: list(q['bankingAreas']),
    bankCategories: list(q['bankCategories']),
    useCases: list(q['useCases']),
    publisherKinds: list(q['publisherKinds']),
    search: q['search'] ?? null,
    from: q['from'] ?? null,
    to: q['to'] ?? null,
    minRelevance: minRelevance !== undefined && minRelevance !== ''
      ? Number(minRelevance)
      : DEFAULT_RELEVANCE_THRESHOLD,
    favoritesOnly: q['favoritesOnly'] === 'true',
    hilDecision: (q['hilDecision'] as ArticleFilters['hilDecision']) ?? null,
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
    defaultRelevanceThreshold: DEFAULT_RELEVANCE_THRESHOLD,
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

articleRoutes.get('/facets', requirePermission('articles.read'), async (c) => {
  const q = buildFacetQuery(c.get('user'), filtersFromQuery(c.req.query()));
  const rows = await c.env.DB.prepare(q.sql).bind(...q.params).all<{
    dimension: string; value: string; n: number;
  }>();
  return c.json({ facets: rows.results ?? [] });
});

articleRoutes.get('/trend', requirePermission('articles.read'), async (c) => {
  const q = buildTrendQuery(c.get('user'), filtersFromQuery(c.req.query()));
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
    ruleHits,
    isFavorite: row['is_favorite'] === 1,
    hilDecision: row['hil_decision'],
    hilNote: row['hil_note'],
    tags,
  };
}
