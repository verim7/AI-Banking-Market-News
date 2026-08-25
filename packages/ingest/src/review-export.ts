import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
 * "Has a real signal" means the rules found an AI type or extracted a use-case
 * sentence. An article with neither is almost never a use case, and spending a
 * review pass on it costs the passes that would have covered a deployment.
 */
export function pendingQuery(limit: number, reviewedIds: string[]): string {
  const exclude = reviewedIds.length > 0
    ? `AND a.id NOT IN (${reviewedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')})`
    : '';

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
WHERE (
  EXISTS (SELECT 1 FROM article_tags ai WHERE ai.article_id = a.id AND ai.dimension = 'ai_type')
  OR (sc.use_case_evidence IS NOT NULL AND sc.use_case_evidence <> '')
)
${exclude}
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
  creds: D1Credentials, limit: number, ledger: Ledger,
): Promise<ExportRow[]> {
  const rows = await queryRows<RawRow>(creds, pendingQuery(limit, Object.keys(ledger.reviewed)));
  return rows.map(toExportRow);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 80;

  const creds = credentialsFromEnv();
  if (!creds) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN.');
    process.exitCode = 1;
    return;
  }

  const ledger = loadLedger();
  const already = Object.keys(ledger.reviewed).length;
  const rows = await exportPending(creds, limit, ledger);

  mkdirSync(dirname(PENDING_PATH), { recursive: true });
  writeFileSync(PENDING_PATH, renderJsonl(rows));

  const withBody = rows.filter((r) => (r.excerpt ?? '').length > 200).length;
  console.log(`\n${rows.length} article(s) written to ${PENDING_PATH}.`);
  console.log(`  already reviewed:      ${already}`);
  // Stated every time, because it is the ceiling on how good the review can be:
  // a headline and two lines cannot support a grade A.
  console.log(`  with a readable body:  ${withBody} (${rows.length === 0 ? 0
    : Math.round((withBody / rows.length) * 100)}%)`);
  console.log('\nReview them, then apply the decisions with: npm run review:apply\n');
}

if (import.meta.filename === process.argv[1]) await main();
