import { classify, type Classification, type PublisherKind } from '@portal/shared';
import { credentialsFromEnv, executeAll, queryRows, type D1Credentials } from './load-d1.ts';
import { sqlLiteral as L } from './sql.ts';

/**
 * Re-classify every article already in the database.
 *
 * Every judgement the product shows — AI focus, AI type, L1 process, maturity,
 * the quoted use case — is derived from the article's own title, summary and
 * excerpt. Those are stored. So none of it ever needs re-fetching: it can be
 * recomputed from what is already here, offline, in one pass.
 *
 * That matters twice over.
 *
 * It is the repair for a migration that reset those columns to their defaults
 * on a database full of articles. The text survived; only the derived numbers
 * were lost, and this rebuilds them exactly.
 *
 * And it is how a classifier change reaches the archive. Improving the rules
 * used to mean the improvement applied only to articles fetched afterwards,
 * leaving the archive scored by whatever the rules were on the day it arrived
 * — the same article ranked differently depending on when it was collected.
 * Now the whole corpus can be re-scored on one consistent set of rules.
 */

export interface StoredArticle {
  id: string;
  title: string;
  summary: string | null;
  excerpt: string | null;
  publisher_kind: string;
  published_at: string | null;
  region_hint: string | null;
}

const PAGE = 500;

/** How a stored row is presented to the classifier, in one place. */
export function classifyStored(row: StoredArticle): Classification {
  return classify({
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    publisherKind: row.publisher_kind as PublisherKind,
    publishedAt: row.published_at,
    regionHint: row.region_hint,
  });
}

/**
 * Statements that replace one article's tags and scores, leaving the article
 * itself alone. Takes the classification rather than computing it, because the
 * caller needs the same result for its report and classifying twice is two
 * chances for the written row and the reported number to disagree.
 */
export function rescoreStatements(row: StoredArticle, c: Classification): string[] {
  const out: string[] = [
    // Wholesale replacement, not merge: re-classification can *remove* a tag,
    // and a stale tag left behind silently widens every filter that uses it.
    `DELETE FROM article_tags WHERE article_id = ${L(row.id)};`,
  ];

  for (const t of c.tags) {
    out.push(
      `INSERT OR REPLACE INTO article_tags (article_id, dimension, value, confidence) `
      + `VALUES (${L(row.id)}, ${L(t.dimension)}, ${L(t.value)}, ${L(t.confidence)});`);
  }

  out.push(
    `INSERT INTO article_scores (article_id, relevance_score, rule_hits, ai_intensity, `
    + `maturity, maturity_evidence, use_case_evidence) `
    + `VALUES (${L(row.id)}, ${L(c.relevanceScore)}, ${L(JSON.stringify(c.ruleHits))}, `
    + `${L(c.aiIntensity)}, ${L(c.maturity)}, ${L(c.maturityEvidence)}, `
    + `${L(c.useCaseEvidence)}) `
    + `ON CONFLICT(article_id) DO UPDATE SET relevance_score=excluded.relevance_score, `
    + `rule_hits=excluded.rule_hits, ai_intensity=excluded.ai_intensity, `
    + `maturity=excluded.maturity, maturity_evidence=excluded.maturity_evidence, `
    + `use_case_evidence=excluded.use_case_evidence;`);

  return out;
}

/** What changed, so a run reports a result rather than just finishing. */
export interface RescoreReport {
  scanned: number;
  intensityWasZero: number;
  intensityNowZero: number;
  withUseCase: number;
  withMaturity: number;
  /**
   * Articles the current rules would no longer admit.
   *
   * The ingest stores only what passes the gate, so the archive is a record of
   * every gate this project has ever had. When the rules tightened to reject
   * market commentary, the US-GDP-and-AI-spending pieces already stored stayed
   * stored — the complaint that prompted the tightening was about articles the
   * new rules would have caught and the old ones let in.
   */
  nowRejected: number;
  rejectedIds: string[];
}

export async function rescoreAll(
  creds: D1Credentials,
  opts: { dryRun: boolean; purge?: boolean; log?: (s: string) => void },
): Promise<RescoreReport> {
  const log = opts.log ?? (() => {});
  const report: RescoreReport = {
    scanned: 0, intensityWasZero: 0, intensityNowZero: 0, withUseCase: 0, withMaturity: 0,
    nowRejected: 0, rejectedIds: [],
  };

  for (let offset = 0; ; offset += PAGE) {
    const rows = await queryRows<StoredArticle & { ai_intensity: number | null }>(creds,
      `SELECT a.id, a.title, a.summary, a.excerpt, a.publisher_kind, a.published_at,
              s.region_hint, COALESCE(sc.ai_intensity, 0) AS ai_intensity
         FROM articles a
         LEFT JOIN sources s ON s.id = a.source_id
         LEFT JOIN article_scores sc ON sc.article_id = a.id
        ORDER BY a.id
        LIMIT ${PAGE} OFFSET ${offset};`);

    if (rows.length === 0) break;

    const statements: string[] = [];
    for (const row of rows) {
      report.scanned += 1;
      if (!row.ai_intensity) report.intensityWasZero += 1;

      const c = classifyStored(row);
      if (!c.aiIntensity) report.intensityNowZero += 1;
      if (c.useCaseEvidence) report.withUseCase += 1;
      if (c.maturity !== 'unknown') report.withMaturity += 1;

      if (c.relevanceScore === 0) {
        report.nowRejected += 1;
        if (report.rejectedIds.length < 2000) report.rejectedIds.push(row.id);
      }

      if (!opts.dryRun) statements.push(...rescoreStatements(row, c));
    }

    if (statements.length > 0) await executeAll(creds, statements);
    log(`  ${report.scanned} articles processed…`);

    if (rows.length < PAGE) break;
  }

  // Opt-in, and last. Removing articles a reader may have starred or ruled on
  // is not something to do as a side effect of recomputing a score, so the
  // default is to count them and say so.
  if (opts.purge && !opts.dryRun && report.rejectedIds.length > 0) {
    const deletes = [];
    for (let i = 0; i < report.rejectedIds.length; i += 100) {
      const ids = report.rejectedIds.slice(i, i + 100).map(L).join(',');
      deletes.push(`DELETE FROM articles WHERE id IN (${ids});`);
    }
    await executeAll(creds, deletes);
    log(`  removed ${report.rejectedIds.length} articles the current rules reject.`);
  }

  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const purge = process.argv.includes('--purge-rejected');
  const creds = credentialsFromEnv();

  if (!creds) {
    const missing = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']
      .filter((k) => !process.env[k]);
    // Checked before the work, not after: the previous version of this pattern
    // did half an hour of work and then discarded it for a missing variable.
    console.error(`Missing credentials: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(dryRun
    ? 'Re-classifying every stored article (dry run — nothing will be written).\n'
    : 'Re-classifying every stored article.\n');

  const report = await rescoreAll(creds, { dryRun, purge, log: (s) => console.log(s) });

  console.log(`
${report.scanned} articles re-classified.
  AI focus was zero before:  ${report.intensityWasZero}
  AI focus is zero after:    ${report.intensityNowZero}
  with a quoted use case:    ${report.withUseCase}
  with a maturity signal:    ${report.withMaturity}`);

  if (report.nowRejected > 0) {
    console.log(`
${report.nowRejected} article(s) in the archive would not be admitted by the current
rules — they were collected when the gate was looser. They are still stored and
still shown. Re-run with --purge-rejected to remove them.`);
  }

  if (dryRun) console.log('\nDry run: nothing was written.');
}

if (import.meta.url.endsWith('rescore.ts') && process.argv[1]?.endsWith('rescore.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
