import { Hono } from 'hono';
import type { DigestSummary } from '@portal/shared';
import { applyExclusions, type DigestModel } from '../../../ingest/src/digest/model.ts';
import { renderDigest } from '../../../ingest/src/digest/render.ts';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

/**
 * The editor's review of the weekly email, in the tracker.
 *
 * The Tuesday Routine stores a snapshot of the issue in digest_drafts. Here the
 * editor sees it rendered by the same code that renders the email, leaves out
 * what should not go, and approves. Approval renders the email one last time
 * and stores it with its hash; Wednesday's send mails exactly that and refuses
 * anything whose hash differs. So the email colleagues receive is the one on
 * this screen when the editor pressed Approve.
 *
 * Administrators only: this is the editor's gate, not a shared queue.
 */
export const digestRoutes = new Hono<AppEnv>();

const PERMISSION = 'admin.users';

interface DraftRow {
  week: string; as_of: string; built_at: string; model: string; summary: string | null;
  summary_note: string | null; excluded: string; subject: string | null; sha256: string | null;
  approved_at: string | null; approved_by: string | null; sent_at: string | null;
  recipients: number | null;
}

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The newest draft. A sent one too: the screen then says it went, and when. */
async function latest(db: D1Database): Promise<DraftRow | null> {
  try {
    return await db.prepare(`SELECT week, as_of, built_at, model, summary, summary_note, excluded,
        subject, sha256, approved_at, approved_by, sent_at, recipients
      FROM digest_drafts ORDER BY week DESC LIMIT 1`).first<DraftRow>();
  } catch (e) {
    // Before the migration there is simply no draft yet.
    if (String(e).includes('no such table')) return null;
    throw e;
  }
}

/** The email as it would go out with these exclusions: subject, HTML, and what is left. */
function render(row: DraftRow, excluded: string[], dashboardUrl: string) {
  const model = parse<DigestModel | null>(row.model, null);
  if (!model) throw new Error(`The draft for ${row.week} could not be read. Draft it again.`);
  const summary = parse<DigestSummary | null>(row.summary, null);
  const final = applyExclusions(model, summary, excluded);
  return { model, summary, final, ...renderDigest(final.model, { dashboardUrl, summary: final.summary }) };
}

/** The email's "Open the dashboard" link: wherever the editor is approving it from. */
const dashboardOf = (c: { req: { url: string } }) => new URL(c.req.url).origin;

digestRoutes.get('/draft', requirePermission(PERMISSION), async (c) => {
  const row = await latest(c.env.DB);
  if (!row) return c.json({ draft: null });
  const excluded = parse<string[]>(row.excluded, []);
  const r = render(row, excluded, dashboardOf(c));
  return c.json({
    draft: {
      week: row.week,
      asOf: row.as_of,
      builtAt: row.built_at,
      // The whole snapshot, so every line can be listed and left out, and the
      // summary as written, so a left-out sentence can be put back.
      model: r.model,
      summary: r.summary,
      summaryNote: row.summary_note,
      excluded,
      subject: r.subject,
      html: r.html,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      sentAt: row.sent_at,
      recipients: row.recipients,
    },
  });
});

/**
 * Leave out, or put back. Any change withdraws an approval: what was approved
 * is no longer what would be sent.
 */
digestRoutes.patch('/draft', requirePermission(PERMISSION), async (c) => {
  const row = await latest(c.env.DB);
  if (!row) return c.json({ error: 'There is no draft to change.' }, 404);
  if (row.sent_at) return c.json({ error: `${row.week} was already sent.` }, 409);
  const body = await c.req.json<{ excluded?: unknown }>();
  if (!Array.isArray(body.excluded) || body.excluded.some((x) => typeof x !== 'string' || x.length > 80)) {
    return c.json({ error: 'excluded must be a list of article ids and summary keys.' }, 400);
  }
  const excluded = [...new Set(body.excluded as string[])];
  await c.env.DB.prepare(`UPDATE digest_drafts SET excluded = ?, subject = NULL, html = NULL, text = NULL,
      sha256 = NULL, approved_at = NULL, approved_by = NULL WHERE week = ?`)
    .bind(JSON.stringify(excluded), row.week).run();
  if (row.approved_at) {
    await c.env.DB.prepare(`DELETE FROM digest_issues WHERE week = ? AND sent_at IS NULL`).bind(row.week).run();
  }
  return c.json({ ok: true, withdrawn: Boolean(row.approved_at) });
});

/** Approve: render once, store the email and its hash, and publish the brief to the Trends page. */
digestRoutes.post('/draft/approve', requirePermission(PERMISSION), async (c) => {
  const row = await latest(c.env.DB);
  if (!row) return c.json({ error: 'There is no draft to approve.' }, 404);
  if (row.sent_at) return c.json({ error: `${row.week} was already sent.` }, 409);
  const r = render(row, parse<string[]>(row.excluded, []), dashboardOf(c));
  const hash = await sha256(r.html);
  const now = new Date().toISOString();
  const by = c.get('user').email;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE digest_drafts SET subject = ?, html = ?, text = ?, sha256 = ?,
        approved_at = ?, approved_by = ? WHERE week = ?`)
      .bind(r.subject, r.html, r.text, hash, now, by, row.week),
    // The Trends page's copy: only ever an issue someone approved.
    c.env.DB.prepare(`INSERT INTO digest_issues (week, as_of, subject, message, summary, approved_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(week) DO UPDATE SET as_of = excluded.as_of, subject = excluded.subject,
          message = excluded.message, summary = excluded.summary, approved_at = excluded.approved_at`)
      .bind(row.week, row.as_of, r.subject, r.final.model.message,
        r.final.summary ? JSON.stringify(r.final.summary) : null, now),
  ]);
  return c.json({ ok: true, week: row.week, subject: r.subject, approvedAt: now });
});

/** Withdraw an approval before Wednesday. */
digestRoutes.post('/draft/withdraw', requirePermission(PERMISSION), async (c) => {
  const row = await latest(c.env.DB);
  if (!row) return c.json({ error: 'There is no draft.' }, 404);
  if (row.sent_at) return c.json({ error: `${row.week} was already sent.` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE digest_drafts SET subject = NULL, html = NULL, text = NULL, sha256 = NULL,
        approved_at = NULL, approved_by = NULL WHERE week = ?`).bind(row.week),
    c.env.DB.prepare(`DELETE FROM digest_issues WHERE week = ? AND sent_at IS NULL`).bind(row.week),
  ]);
  return c.json({ ok: true });
});
