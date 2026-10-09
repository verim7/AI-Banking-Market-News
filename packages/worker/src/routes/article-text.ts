import { Hono } from 'hono';
import { DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY, readerNote } from '@portal/shared';
import { PRIVATE_SOURCE as SOURCE } from '../../../ingest/src/rescore-sql.ts';
import { INSTITUTIONS } from '../../../web/src/lib/tiers.ts';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

/**
 * Article text from the editor's own browser.
 *
 * The crawler and the headless Chromium on GitHub both read pages as an
 * anonymous visitor. What neither can read is listed here, and a Claude
 * routine on the editor's computer, using Claude in Chrome, opens each one in
 * the editor's own browser, copies the article's text into the box, and saves.
 * Saving only stores the text; the next ingest run rescores the article.
 * Nothing is installed and no key leaves GitHub: the routine signs in to the
 * tracker as the editor, like the editor would.
 *
 * That browser may be signed in to subscriptions, so this text is private by
 * design: stored for grading only, never shown in the app (the article drawer
 * leaves it out), and never written to the public repository (review-export
 * leaves it out of pending.jsonl; the grading Routine reads it from the
 * database). At most one sentence of it appears, as a use case's quoted
 * evidence.
 *
 * Administrators only, like the email review.
 */
export const articleTextRoutes = new Hono<AppEnv>();

const PERMISSION = 'admin.users';
/** Below this it is a cookie wall or a teaser, not the article. */
export const MIN_CHARS = 200;
/** How far back the list goes: older news is graded already and rarely worth a reread. */
const DAYS = 7;

/**
 * Candidates: articles in the reader's view that no layer could read, tried
 * by no browser yet, and not graded C or D. A C or D does not move with more
 * text (the first summary run confirmed 14 of 14), so those slots go to
 * articles that can: B grades and new ones.
 */
export function queueSql(limit: number): string {
  return `
SELECT a.id, a.title, a.source_name AS source, a.published_at AS publishedAt,
       a.url_canonical AS url, a.resolved_url AS resolvedUrl,
       COALESCE(sc.ai_intensity, 0) AS aiIntensity,
       a.chromium_tried_at IS NOT NULL AS chromiumTried,
       rv.grade AS grade
FROM articles a
JOIN article_scores sc ON sc.article_id = a.id
LEFT JOIN article_reviews rv ON rv.article_id = a.id
WHERE sc.ai_intensity >= ${MIN_AI_INTENSITY}
  AND sc.relevance_score >= ${DEFAULT_RELEVANCE_THRESHOLD}
  AND a.duplicate_of IS NULL
  AND (a.excerpt IS NULL OR length(a.excerpt) < ${MIN_CHARS})
  AND a.browser_tried_at IS NULL
  AND COALESCE(rv.grade, '') NOT IN ('C', 'D')
  AND a.fetched_at >= datetime('now', '-${DAYS} days')
ORDER BY sc.ai_intensity DESC, a.fetched_at DESC
LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`.trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Every tracked institution's name and aliases, lowercased, with a whole-word
 * pattern built once. A plain substring test runs first and the pattern only
 * on a hit: hundreds of names against hundreds of headlines must stay well
 * inside the free plan's CPU limit, which a long request already broke once.
 */
const NAMES = INSTITUTIONS.flatMap((i) => [i.name, ...(i.aliases ?? [])])
  .filter((n) => n.length >= 3)
  .map((n) => ({ lower: n.toLowerCase(), re: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, 'iu') }));

/** Whether a headline names a bank or provider in the tier registry. */
export function namesInstitution(title: string): boolean {
  const lower = title.toLowerCase();
  return NAMES.some((n) => lower.includes(n.lower) && n.re.test(title));
}

export interface QueueRow { title: string; aiIntensity: number; grade: string | null }

/**
 * The order the routine works in, most likely to become an A first: a B whose
 * headline names a tracked institution (the GoCardless case: text turned it
 * into an A), then a new article naming one, then other B's, other new ones,
 * and A's last (text can only confirm those). AI focus breaks ties.
 */
export function rankQueue<T extends QueueRow>(rows: readonly T[]): (T & { namesInstitution: boolean })[] {
  const band = (r: T, named: boolean) =>
    (r.grade === 'A' ? 4 : 0) + (named ? 0 : 2) + (r.grade === 'B' ? 0 : r.grade === 'A' ? 0 : 1);
  return rows
    .map((r) => ({ ...r, namesInstitution: namesInstitution(r.title) }))
    .sort((a, b) => band(a, a.namesInstitution) - band(b, b.namesInstitution) || b.aiIntensity - a.aiIntensity);
}

/** The reader's summary: long enough to say who did what, short enough not to be the article. */
export const SUMMARY_MIN = 80;
export const SUMMARY_MAX = 1200;
/** One sentence, quoted exactly. */
export const QUOTE_MAX = 400;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A summary and an optional quote, checked; never the whole article. */
export function cleanNote(summary: unknown, quote: unknown): { text: string } | { error: string } {
  if (typeof summary !== 'string') return { error: 'Write a short summary of the article.' };
  const s = tidy(summary);
  if (s.length < SUMMARY_MIN) return { error: `The summary is ${s.length} characters; say who did what with AI, and how far along it is.` };
  if (s.length > SUMMARY_MAX) return { error: `The summary is ${s.length} characters; keep it under ${SUMMARY_MAX}, in your own words, not the article's text.` };
  const q = typeof quote === 'string' ? tidy(quote).replace(/^["\u201C]|["\u201D]$/g, '') : '';
  if (q.length > QUOTE_MAX) return { error: `The quote is ${q.length} characters; quote one sentence, at most ${QUOTE_MAX}.` };
  return { text: readerNote(s, q || null) };
}

articleTextRoutes.get('/queue', requirePermission(PERMISSION), async (c) => {
  const limit = Number(c.req.query('limit') ?? 20) || 20;
  try {
    // All candidates, ranked here: the order depends on the tier registry,
    // which lives in code, not in the database.
    // At most 150 candidates are ranked (about 2 ms of CPU; 500 took 5.6 ms of
    // the free plan's 10); the total is counted in the database.
    const [{ results }, total] = await Promise.all([
      c.env.DB.prepare(queueSql(150)).all<QueueRow & Record<string, unknown>>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM (${queueSql(500)})`).first<{ n: number }>(),
    ]);
    const ranked = rankQueue(results);
    return c.json({ articles: ranked.slice(0, Math.max(1, Math.min(100, limit))), waiting: total?.n ?? ranked.length });
  } catch (e) {
    // Before the migration the columns do not exist yet: nothing to list.
    if (String(e).includes('no such column')) return c.json({ articles: [], waiting: 0 });
    throw e;
  }
});

articleTextRoutes.put('/:id', requirePermission(PERMISSION), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ summary?: unknown; quote?: unknown }>()
    .catch(() => ({ summary: undefined, quote: undefined }));
  const cleaned = cleanNote(body.summary, body.quote);
  if ('error' in cleaned) return c.json({ error: cleaned.error }, 400);

  const at = new Date().toISOString();
  // Store the text and nothing more. Rescoring it here ran the classifier
  // inside the request, and on a long article that went past the free plan's
  // CPU limit: Cloudflare answered 503 after the text was already saved. The
  // next ingest run rescores it (browser-bodies.ts, rescore_requested_at).
  const [saved] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE articles SET excerpt = ?, excerpt_source = ?, excerpt_at = ?, browser_tried_at = ?,
        browser_note = NULL, rescore_requested_at = ? WHERE id = ?`)
      .bind(cleaned.text, SOURCE, at, at, at, id),
    // The extract is several sentences of the old text, shown in the drawer;
    // it is rebuilt without the private text when the article is rescored.
    c.env.DB.prepare(`UPDATE article_scores SET summary_extract = NULL WHERE article_id = ?`).bind(id),
  ]);
  if (!saved?.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, chars: cleaned.text.length });
});

articleTextRoutes.post('/:id/skip', requirePermission(PERMISSION), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ reason?: unknown }>().catch(() => ({ reason: undefined }));
  const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const r = await c.env.DB.prepare(`UPDATE articles SET browser_tried_at = ?, browser_note = ? WHERE id = ?`)
    .bind(new Date().toISOString(), reason || 'could not read', id).run();
  if (!r.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

/**
 * Re-grades made once an article had text from a browser layer: the editor's
 * own (local-browser) or the headless Chromium on GitHub. What the 5-day
 * browser trial is judged on, shown where the editor reviews. Last 30 days.
 */
export const CHANGES_SQL = `
SELECT h.article_id AS id, h.pass_on AS passOn, h.grade, h.previous_grade AS previousGrade,
       a.title, COALESCE(a.resolved_url, a.url_canonical) AS url, a.excerpt_source AS textFrom,
       rv.actor, rv.task
FROM grade_history h
JOIN articles a ON a.id = h.article_id
LEFT JOIN article_reviews rv ON rv.article_id = h.article_id
WHERE a.excerpt_source IN ('local-browser', 'chromium')
  AND a.excerpt_at IS NOT NULL
  AND h.pass_on >= substr(a.excerpt_at, 1, 10)
  AND h.pass_on >= date('now', '-30 days')
ORDER BY (h.grade <> h.previous_grade) DESC, h.pass_on DESC
LIMIT 200`.trim();

articleTextRoutes.get('/changes', requirePermission(PERMISSION), async (c) => {
  try {
    const { results } = await c.env.DB.prepare(CHANGES_SQL).all();
    return c.json({ changes: results });
  } catch (e) {
    // Before migration 0017, or before the first apply that fills it.
    if (String(e).includes('no such table')) return c.json({ changes: [] });
    throw e;
  }
});
