import { Hono } from 'hono';
import { validateReview, type ReviewRecord } from '@portal/shared';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

/**
 * The editor's review of the weekly Routine's proposed grades.
 *
 * The Routine writes its grades to review_proposals, where nothing on the
 * dashboard or in the weekly email reads them. Here the editor sees each one
 * beside its article, accepts it, changes it, or discards it — and then
 * publishes the accepted ones, which copies them into article_reviews exactly
 * as review-apply would have. Until that button is pressed, a proposal is a
 * suggestion and nothing else.
 *
 * Administrators only: this is the editor's gate, not a shared queue.
 */
export const proposalRoutes = new Hono<AppEnv>();

const PERMISSION = 'admin.users';

/** The fields the editor may change. Everything else is the Routine's reading. */
const EDITABLE = ['grade', 'maturity', 'actor', 'task', 'headline'] as const;
type Editable = typeof EDITABLE[number];

const STATUSES = new Set(['pending', 'accepted', 'discarded']);

interface Row {
  article_id: string; grade: string; headline: string; actor: string | null;
  task: string | null; technique: string | null; outcome: string | null;
  ai_type: string | null; l1_process: string | null; use_case: string | null;
  maturity: string | null; evidence: string | null; confidence: string;
  notes: string | null; proposed_at: string; status: string; edited: number;
}

const toRecord = (r: Row): ReviewRecord => ({
  articleId: r.article_id,
  grade: r.grade as ReviewRecord['grade'],
  headline: r.headline,
  actor: r.actor, task: r.task, technique: r.technique, outcome: r.outcome,
  aiType: r.ai_type, l1Process: r.l1_process, useCase: r.use_case,
  maturity: r.maturity, evidence: r.evidence,
  confidence: r.confidence as ReviewRecord['confidence'], notes: r.notes,
});

/** Everything not yet published: what is waiting, and what the editor has decided so far. */
proposalRoutes.get('/', requirePermission(PERMISSION), async (c) => {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = (await c.env.DB.prepare(`
      SELECT p.*, a.title, a.url_canonical AS url, a.source_name AS source,
             a.published_at, a.fetched_at
        FROM review_proposals p JOIN articles a ON a.id = p.article_id
       WHERE p.status != 'published'
       ORDER BY CASE p.grade WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END,
                a.fetched_at DESC`).all()).results ?? [];
  } catch (e) {
    // Before the migration there is simply nothing proposed yet.
    if (!String(e).includes('no such table')) throw e;
  }
  return c.json({
    proposals: rows.map((r) => ({
      articleId: r['article_id'],
      title: r['title'], url: r['url'], source: r['source'],
      publishedAt: r['published_at'] ?? null, fetchedAt: r['fetched_at'],
      grade: r['grade'], headline: r['headline'], actor: r['actor'] ?? null,
      task: r['task'] ?? null, maturity: r['maturity'] ?? null,
      evidence: r['evidence'] ?? null, notes: r['notes'] ?? null,
      status: r['status'], edited: r['edited'] === 1,
      proposedAt: r['proposed_at'],
    })),
  });
});

/**
 * Decide one proposal: accept, discard, reopen, and optionally change fields.
 *
 * A changed proposal is validated exactly as a decision file is — an A still
 * needs a named institution, a task, and a quote that attests the task — so
 * the editor's change cannot publish a grade the rubric would refuse.
 */
proposalRoutes.patch('/:articleId', requirePermission(PERMISSION), async (c) => {
  const id = c.req.param('articleId');
  const body = await c.req.json<Partial<Record<Editable | 'status', string | null>>>();

  const row = await c.env.DB.prepare(`SELECT * FROM review_proposals WHERE article_id = ?`)
    .bind(id).first<Row>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.status === 'published') return c.json({ error: 'already published' }, 409);

  const status = body.status ?? row.status;
  if (!STATUSES.has(status)) return c.json({ error: `status must be pending, accepted or discarded` }, 400);

  const next: Row = { ...row };
  let changed = false;
  for (const f of EDITABLE) {
    if (!(f in body)) continue;
    const value = typeof body[f] === 'string' ? body[f]!.trim() || null : null;
    if (value !== row[f]) { (next[f] as string | null) = value; changed = true; }
  }

  if (status === 'accepted') {
    const problems = validateReview(toRecord(next), 1).map((e) => e.problem);
    // The problems themselves are the error: "grade A task … is not in its
    // evidence" tells the editor what to change; "invalid" does not.
    if (problems.length) return c.json({ error: problems.join(' '), problems }, 400);
  }

  await c.env.DB.prepare(`
    UPDATE review_proposals
       SET grade = ?, maturity = ?, actor = ?, task = ?, headline = ?,
           status = ?, edited = ?, decided_at = ?, decided_by = ?
     WHERE article_id = ?`)
    .bind(next.grade, next.maturity, next.actor, next.task, next.headline,
      status, changed || row.edited === 1 ? 1 : 0,
      status === 'pending' ? null : new Date().toISOString(),
      status === 'pending' ? null : c.get('user').email, id)
    .run();

  return c.json({ ok: true, status, edited: changed || row.edited === 1 });
});

/**
 * Publish every accepted proposal.
 *
 * The same two writes review-apply makes — the review row, and the review's
 * dimensions into article_tags, replacing the rules' guesses for the
 * dimensions it names — in one batch, so a publish is all or nothing. The
 * reviewer column says who decided: `editor-approved` for a proposal taken as
 * written, `editor-edited` for one the editor changed.
 */
proposalRoutes.post('/publish', requirePermission(PERMISSION), async (c) => {
  const accepted = (await c.env.DB.prepare(
    `SELECT * FROM review_proposals WHERE status = 'accepted'`).all<Row>()).results ?? [];
  if (accepted.length === 0) return c.json({ ok: true, published: 0 });

  const now = new Date().toISOString();
  const db = c.env.DB;
  const statements = accepted.flatMap((r) => {
    const out = [
      db.prepare(`
        INSERT OR REPLACE INTO article_reviews
          (article_id, grade, headline, actor, task, technique, outcome, ai_type,
           l1_process, use_case, maturity, evidence, confidence, notes, reviewed_at, reviewer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(r.article_id, r.grade, r.headline, r.actor, r.task, r.technique, r.outcome,
          r.ai_type, r.l1_process, r.use_case, r.maturity, r.evidence, r.confidence, r.notes,
          now, r.edited ? 'editor-edited' : 'editor-approved'),
    ];
    for (const [dimension, value] of [['l1_process', r.l1_process], ['ai_type', r.ai_type],
      ['use_case', r.use_case]] as const) {
      if (!value) continue;
      out.push(db.prepare(`DELETE FROM article_tags WHERE article_id = ? AND dimension = ?`)
        .bind(r.article_id, dimension));
      out.push(db.prepare(`INSERT OR REPLACE INTO article_tags
          (article_id, dimension, value, confidence, source) VALUES (?, ?, ?, 1.0, 'review')`)
        .bind(r.article_id, dimension, value));
    }
    out.push(db.prepare(`UPDATE review_proposals SET status = 'published' WHERE article_id = ?`)
      .bind(r.article_id));
    return out;
  });
  await db.batch(statements);

  return c.json({ ok: true, published: accepted.length });
});
