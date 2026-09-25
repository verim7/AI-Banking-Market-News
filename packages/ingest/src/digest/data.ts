/**
 * The digest's rows, from D1.
 *
 * Read over the Cloudflare REST API with the same helper the review export
 * uses, so the workflow needs no credentials the repo does not already hold.
 *
 * The window is read on the date an article was **collected**, not the date
 * it says it was published. The review export read publication date for four
 * passes and stepped over 21 articles that were crawled days after they were
 * written (docs/papercuts.md). A digest that did the same would never mention
 * them at all: too old to be "this week" by the time anyone graded them.
 */

import {
  AGENT_STAGE_SQL, DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY, useCaseKey,
} from '@portal/shared';
import { queryRows, type D1Credentials } from '../load-d1.ts';
import { sqlLiteral as L } from '../sql.ts';
import { addDays, type DigestInput, type DigestRow } from './model.ts';

/** The same floor the Market Lens opens on. */
const IN_SCOPE = `a.duplicate_of IS NULL
  AND COALESCE(sc.ai_intensity, 0) >= ${MIN_AI_INTENSITY}
  AND COALESCE(sc.relevance_score, 0) >= ${DEFAULT_RELEVANCE_THRESHOLD}`;

export interface RawRow {
  id: string; url: string; title: string; source: string;
  published_at: string | null; fetched_at: string;
  ai_intensity: number; maturity: string; agent_stage: string;
  use_case_evidence: string | null;
  grade: string | null; headline: string | null; actor: string | null;
  task: string | null; evidence: string | null; review_l1_process: string | null;
  tags: string | null;
}

export async function loadDigestInput(creds: D1Credentials, asOf: string): Promise<DigestInput> {
  const from = addDays(asOf, -13);
  const until = addDays(asOf, 1); // the issue day itself is included
  const weeksFrom = addDays(asOf, -55);

  const rows = await queryRows<RawRow>(creds, `
SELECT a.id, a.url_canonical AS url, a.title, a.source_name AS source,
       a.published_at, a.fetched_at,
       COALESCE(sc.ai_intensity, 0) AS ai_intensity,
       COALESCE(rv.maturity, sc.maturity, 'unknown') AS maturity,
       ${AGENT_STAGE_SQL} AS agent_stage,
       sc.use_case_evidence,
       rv.grade, rv.headline, rv.actor, rv.task, rv.evidence,
       rv.l1_process AS review_l1_process,
       (SELECT GROUP_CONCAT(t.dimension || ':' || t.value, '|')
          FROM article_tags t WHERE t.article_id = a.id) AS tags
FROM articles a
LEFT JOIN article_scores sc ON sc.article_id = a.id
JOIN article_reviews rv ON rv.article_id = a.id
WHERE a.duplicate_of IS NULL
  AND rv.grade IN ('A', 'B')
  AND a.fetched_at >= ${L(from)} AND a.fetched_at < ${L(until)}
ORDER BY COALESCE(a.published_at, a.fetched_at) DESC, a.id ASC`);

  const [count] = await queryRows<{ n: number }>(creds, `
SELECT COUNT(*) AS n FROM articles a
LEFT JOIN article_scores sc ON sc.article_id = a.id
WHERE ${IN_SCOPE}
  AND a.fetched_at >= ${L(from)} AND a.fetched_at < ${L(until)}`);

  const days = await queryRows<{ day: string; n: number }>(creds, `
SELECT substr(a.fetched_at, 1, 10) AS day, COUNT(*) AS n FROM articles a
LEFT JOIN article_scores sc ON sc.article_id = a.id
WHERE ${IN_SCOPE}
  AND a.fetched_at >= ${L(weeksFrom)} AND a.fetched_at < ${L(until)}
GROUP BY day`);

  return {
    asOf,
    rows: rows.map(toRow),
    articlesCollected: Number(count?.n ?? 0),
    weekly: weeklyBuckets(days, asOf),
  };
}

export function toRow(r: RawRow): DigestRow {
  const l1 = r.review_l1_process
    ?? (r.tags ?? '').split('|').find((t) => t.startsWith('l1_process:'))?.slice('l1_process:'.length)
    ?? null;
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    source: r.source,
    publishedAt: r.published_at,
    fetchedAt: r.fetched_at,
    aiIntensity: Number(r.ai_intensity),
    maturity: r.maturity,
    agentStage: r.agent_stage,
    grade: r.grade,
    headline: r.headline,
    actor: r.actor,
    task: r.task,
    evidence: r.evidence,
    useCaseEvidence: r.use_case_evidence,
    // The worker's `groupKeyOf`, from the same shared function, so the email
    // folds reports into use cases exactly where the Lens does.
    groupKey: useCaseKey({ title: r.title, actor: r.actor, l1Process: l1 }),
  };
}

/**
 * Eight seven-day buckets ending on the issue day, oldest first.
 *
 * Seven-day windows rather than calendar weeks: the issue goes out on a
 * Tuesday, and a calendar week that started the day before would show "this
 * week" as one day tall. The last bucket is exactly the "new" window the
 * entries are marked against, so the bar and the marks agree.
 */
export function weeklyBuckets(
  days: readonly { day: string; n: number }[], asOf: string,
): { week: string; n: number }[] {
  const buckets = Array.from({ length: 8 }, (_, i) => ({ week: addDays(asOf, -7 * (8 - i) + 1), n: 0 }));
  for (const { day, n } of days) {
    const i = buckets.findIndex((b, j) =>
      day >= b.week && (j === buckets.length - 1 || day < buckets[j + 1]!.week));
    if (i >= 0) buckets[i]!.n += Number(n);
  }
  return buckets;
}
