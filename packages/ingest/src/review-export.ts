import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY } from '@portal/shared';
import { credentialsFromEnv, queryRows, type D1Credentials } from './load-d1.ts';

/**
 * Export articles for review, as a file.
 *
 * The pipeline classifies by matching terms, which answers "what does this
 * article say" and cannot answer "is this a use case" — a survey, a vendor
 * launch and a real deployment contain the same words. That judgement needs
 * reading, so this writes the corpus out to be read, and `review-apply` writes
 * the judgements back.
 *
 * A file rather than an API call, on purpose: nothing here calls a model,
 * nothing needs a key, and the daily refresh is untouched. The loop only moves
 * when someone asks it to.
 */

export const PENDING_PATH = 'data/review/pending.jsonl';
export const LEDGER_PATH = 'data/review/reviewed.json';

export interface ExportRow {
  id: string;
  title: string;
  source: string;
  publishedAt: string | null;
  url: string;
  summary: string | null;
  /** The stored body, where one could be read. Most articles have none. */
  excerpt: string | null;
  /** What the rules currently think, so the review can correct it rather than start blind. */
  rules: {
    aiIntensity: number;
    maturity: string;
    useCaseEvidence: string | null;
    tags: string[];
  };
}

export interface Ledger {
  /** article id -> the reviewer string that last wrote it. */
  reviewed: Record<string, string>;
}

export function loadLedger(path = LEDGER_PATH): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger>;
    return { reviewed: parsed.reviewed ?? {} };
  } catch {
    // A missing or unreadable ledger means "nothing reviewed yet", which is the
    // safe reading: it exports more than needed rather than silently skipping.
    return { reviewed: {} };
  }
}

export function saveLedger(ledger: Ledger, path = LEDGER_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Articles worth a reviewer's time, hardest-working first.
 *
 * The gate used to be "the rules found an AI type, or extracted a use-case
 * sentence". The second half stopped meaning anything when the evidence guard
 * shipped: most stored evidence was the headline quoted back, so clearing it
 * took the review queue down with it — an export that should have offered 188
 * unreviewed articles offered 9. A change aimed at the display had quietly
 * narrowed what could be reviewed at all.
 *
 * So the gate is now the product's own: an article the reader is shown as
 * AI-in-banking news is an article a reviewer can grade. The queue and the view
 * are the same set, which is the only version of this that stays true as the
 * derived columns change underneath it.
 *
 * "The product's own" means *both* thresholds. The first attempt used only
 * MIN_AI_INTENSITY and offered 200 articles where the Lens showed 70 unreviewed,
 * because the Lens also applies DEFAULT_RELEVANCE_THRESHOLD and the queue did
 * not. Half a gate is its own kind of wrong: it sends a reviewer through
 * articles nobody will ever see graded.
 */
export function pendingQuery(
  limit: number, reviewedIds: string[], since: string | null = null,
): string {
  const exclude = reviewedIds.length > 0
    ? `AND a.id NOT IN (${reviewedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')})`
    : '';

  // Quoted, not bound: queryRows sends SQL to the D1 HTTP API without
  // parameters. Validated by the caller against a date shape, which is why
  // nothing here tries to escape it.
  const window = since ? `AND COALESCE(a.published_at, a.fetched_at) >= '${since}'` : '';

  return `
SELECT a.id, a.title, a.source_name AS source, a.published_at AS publishedAt,
       a.url_canonical AS url, a.summary, a.excerpt,
       COALESCE(sc.ai_intensity, 0) AS ai_intensity,
       COALESCE(sc.maturity, 'unknown') AS maturity,
       sc.use_case_evidence,
       (SELECT GROUP_CONCAT(t.dimension || ':' || t.value, '|')
          FROM article_tags t WHERE t.article_id = a.id) AS tags
FROM articles a
LEFT JOIN article_scores sc ON sc.article_id = a.id
WHERE COALESCE(sc.ai_intensity, 0) >= ${MIN_AI_INTENSITY}
  AND COALESCE(sc.relevance_score, 0) >= ${DEFAULT_RELEVANCE_THRESHOLD}
-- A row already marked as a re-report of another story. Pass 2 spent seven of
-- its eighty slots on one Starling launch; every one of those is a slot a
-- different story did not get. The kept row of each cluster is still exported.
AND a.duplicate_of IS NULL
${exclude}
${window}
ORDER BY COALESCE(sc.ai_intensity, 0) DESC, COALESCE(a.published_at, a.fetched_at) DESC
LIMIT ${limit}`.trim();
}

interface RawRow {
  id: string; title: string; source: string; publishedAt: string | null;
  url: string; summary: string | null; excerpt: string | null;
  ai_intensity: number; maturity: string;
  use_case_evidence: string | null; tags: string | null;
}

export function toExportRow(r: RawRow): ExportRow {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    publishedAt: r.publishedAt,
    url: r.url,
    summary: r.summary,
    excerpt: r.excerpt,
    rules: {
      aiIntensity: Number(r.ai_intensity) || 0,
      maturity: r.maturity,
      useCaseEvidence: r.use_case_evidence,
      tags: r.tags ? r.tags.split('|') : [],
    },
  };
}

export function renderJsonl(rows: ExportRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
}

export async function exportPending(
  creds: D1Credentials, limit: number, ledger: Ledger, since: string | null = null,
): Promise<ExportRow[]> {
  const rows = await queryRows<RawRow>(
    creds, pendingQuery(limit, Object.keys(ledger.reviewed), since));
  return rows.map(toExportRow);
}

/** A plain ISO date and nothing else, since it is interpolated into SQL. */
export function parseSince(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--since expects YYYY-MM-DD, got "${value}"`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 80;

  // Optional, because the archive goes back three years and the Lens opens on
  // the last twelve months: a grade written on a 2023 article is a grade nobody
  // sees unless they widen the window.
  let since: string | null;
  try {
    since = parseSince(args.find((a) => a.startsWith('--since='))?.split('=')[1]);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
    return;
  }

  const creds = credentialsFromEnv();
  if (!creds) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN.');
    process.exitCode = 1;
    return;
  }

  const ledger = loadLedger();
  const already = Object.keys(ledger.reviewed).length;
  const rows = await exportPending(creds, limit, ledger, since);

  mkdirSync(dirname(PENDING_PATH), { recursive: true });
  writeFileSync(PENDING_PATH, renderJsonl(rows));

  const withBody = rows.filter((r) => (r.excerpt ?? '').length > 200).length;
  console.log(`\n${rows.length} article(s) written to ${PENDING_PATH}.`);
  console.log(`  already reviewed:      ${already}`);
  console.log(`  published since:       ${since ?? 'no limit'}`);
  // Stated every time, because it is the ceiling on how good the review can be:
  // a headline and two lines cannot support a grade A.
  console.log(`  with a readable body:  ${withBody} (${rows.length === 0 ? 0
    : Math.round((withBody / rows.length) * 100)}%)`);
  console.log('\nReview them, then apply the decisions with: npm run review:apply\n');
}

if (import.meta.filename === process.argv[1]) await main();
