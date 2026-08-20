import { Hono } from 'hono';
import { buildArticleQuery, MAX_EXPORT_LIMIT, type ArticleFilters } from '../queries.ts';
import { requirePermission } from '../middleware.ts';
import { shapeArticle } from './articles.ts';
import { toCsv } from '../csv.ts';
import type { AppEnv } from '../types.ts';

export const hilRoutes = new Hono<AppEnv>();

const DECISIONS = new Set(['relevant', 'not_relevant', 'undecided']);

hilRoutes.put('/:articleId', requirePermission('hil.review'), async (c) => {
  const { decision, note } = await c.req.json<{ decision?: string; note?: string }>();
  if (!decision || !DECISIONS.has(decision)) {
    return c.json({ error: 'decision must be relevant, not_relevant or undecided' }, 400);
  }

  const user = c.get('user');
  await c.env.DB
    .prepare(`INSERT INTO hil_decisions (user_id, article_id, decision, note, decided_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id, article_id) DO UPDATE SET
                decision = excluded.decision, note = excluded.note,
                decided_at = excluded.decided_at`)
    .bind(user.userId, c.req.param('articleId'), decision, note ?? '')
    .run();

  return c.json({ ok: true, decision, note: note ?? '' });
});

/** Bulk decisions, so triaging thirty articles is one request rather than thirty. */
hilRoutes.post('/bulk', requirePermission('hil.review'), async (c) => {
  const { articleIds, decision, note } = await c.req.json<{
    articleIds?: string[]; decision?: string; note?: string;
  }>();

  if (!Array.isArray(articleIds) || articleIds.length === 0) {
    return c.json({ error: 'articleIds required' }, 400);
  }
  if (!decision || !DECISIONS.has(decision)) {
    return c.json({ error: 'decision must be relevant, not_relevant or undecided' }, 400);
  }
  if (articleIds.length > MAX_EXPORT_LIMIT) {
    return c.json({ error: `at most ${MAX_EXPORT_LIMIT} articles per request` }, 400);
  }

  const user = c.get('user');
  const stmt = c.env.DB.prepare(
    `INSERT INTO hil_decisions (user_id, article_id, decision, note, decided_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       decision = excluded.decision, note = excluded.note, decided_at = excluded.decided_at`);

  await c.env.DB.batch(
    articleIds.map((id) => stmt.bind(user.userId, id, decision, note ?? '')),
  );

  return c.json({ ok: true, updated: articleIds.length });
});

const EXPORT_HEADERS = [
  'Title', 'Summary', 'Relevance', 'Region', 'Banking area', 'Bank category',
  'AI use case', 'Source', 'Publisher type', 'Published', 'Decision', 'Note', 'URL',
];

function tagsOf(article: ReturnType<typeof shapeArticle>, dimension: string): string {
  return article.tags.filter((t) => t.dimension === dimension).map((t) => t.value).join('; ');
}

/**
 * Export whatever the HIL tab currently has selected. Accepts either an
 * explicit list of ids or the same filters as the list endpoint, so "export
 * everything I marked relevant this month" is one call.
 */
hilRoutes.post('/export', requirePermission('hil.export'), async (c) => {
  const body = await c.req.json<{ articleIds?: string[]; filters?: ArticleFilters }>();
  const user = c.get('user');

  // Explicit ids and filters both go through buildArticleQuery, so a user can
  // never export by id something the scope rules hide from their list.
  const filters: ArticleFilters = {
    ...(body.filters ?? {}),
    ...(body.articleIds?.length
      ? { articleIds: body.articleIds.slice(0, MAX_EXPORT_LIMIT) }
      : {}),
    limit: MAX_EXPORT_LIMIT,
    offset: 0,
  };

  const q = buildArticleQuery(user, filters, { maxLimit: MAX_EXPORT_LIMIT });
  const res = await c.env.DB.prepare(q.sql).bind(...q.params).all();
  const rows = res.results ?? [];

  const articles = rows.map(shapeArticle);
  const csv = toCsv(EXPORT_HEADERS, articles.map((a) => [
    a.title, a.summary, a.relevance,
    tagsOf(a, 'region'), tagsOf(a, 'banking_area'),
    tagsOf(a, 'bank_category'), tagsOf(a, 'use_case'),
    a.source, a.publisherKind, a.publishedAt, a.hilDecision, a.hilNote, a.url,
  ]));

  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="market-lens-${day}.csv"`,
    },
  });
});
