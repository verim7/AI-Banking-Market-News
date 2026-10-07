import { DEFAULT_RELEVANCE_THRESHOLD, MIN_AI_INTENSITY } from '@portal/shared';
import { extractBody } from './fetch-article.ts';
import { credentialsFromEnv, executeAll, queryRows, type D1Credentials } from './load-d1.ts';
import { classifyStored, rescoreStatements, type StoredArticle } from './rescore-sql.ts';
import { sqlLiteral as L } from './sql.ts';

/**
 * A second try at the articles the crawler could only store as a headline,
 * with a real browser.
 *
 * Most articles arrive through Google News, whose links are tokens that only a
 * page running JavaScript turns into the publisher's address
 * (`resolve-url.ts` explains why the crawler cannot). A headline cannot carry
 * a grade A: the grade needs a sentence from the article naming who did what.
 * So these articles were capped at B however concrete the story was.
 *
 * This opens each one in a headless Chromium, the way a reader's browser
 * would, follows the redirect to the publisher, and keeps the main text with
 * the crawler's own extractor. It is logged in nowhere, so it reads what any
 * visitor could; a paywall stays a paywall.
 *
 * Polite and bounded: only articles that passed the relevance gate, only from
 * the last few days, at most `limit` per run, four pages at a time, and each
 * article is tried once. A failure is recorded and never retried here; the
 * editor's own browser (the Review Queue's "Article text" list) is the next
 * layer.
 *
 * Runs in GitHub Actions after the daily ingest (`.github/workflows/ingest.yml`).
 */

export const SOURCE = 'chromium';
const MIN_USEFUL_CHARS = 200;

export interface Pending extends StoredArticle {
  /** Where to start: the stored address, a Google News link for most. */
  url_canonical: string;
}

/** Articles in the reader's view that still have no readable text and no try yet. */
export function queueQuery(sinceIso: string, limit: number): string {
  return `
SELECT a.id, a.title, a.summary, a.excerpt, a.publisher_kind, a.published_at,
       a.url_original, a.url_canonical, s.region_hint
FROM articles a
JOIN article_scores sc ON sc.article_id = a.id
LEFT JOIN sources s ON s.id = a.source_id
WHERE sc.ai_intensity >= ${MIN_AI_INTENSITY}
  AND sc.relevance_score >= ${DEFAULT_RELEVANCE_THRESHOLD}
  AND a.duplicate_of IS NULL
  AND (a.excerpt IS NULL OR length(a.excerpt) < ${MIN_USEFUL_CHARS})
  AND a.chromium_tried_at IS NULL
  AND a.fetched_at >= ${L(sinceIso)}
ORDER BY sc.ai_intensity DESC, a.fetched_at DESC
LIMIT ${Math.max(1, Math.floor(limit))}`.trim();
}

/** Still on the aggregator: the redirect has not happened (yet). */
export function onAggregator(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'news.google.com' || host.endsWith('.google.com');
  } catch {
    return true;
  }
}

/**
 * What to write for one article: its text and fresh scores, or only the try.
 * The scores are recomputed from the new text, so an article whose page turns
 * out to be about something else falls out of the view on its own.
 */
export function resultStatements(
  row: StoredArticle, text: string | null, at: string, resolvedUrl: string | null,
  source = SOURCE,
): string[] {
  const tried = `UPDATE articles SET chromium_tried_at = ${L(at)} WHERE id = ${L(row.id)};`;
  if (!text) return [tried];
  const withText = { ...row, excerpt: text };
  return [
    ...rescoreStatements(withText, classifyStored(withText)),
    `UPDATE articles SET excerpt_source = ${L(source)}, excerpt_at = ${L(at)}, `
    + `resolved_url = ${L(resolvedUrl)} WHERE id = ${L(row.id)};`,
    tried,
  ];
}

type Outcome = 'read' | 'stayed on Google News' | 'no article text' | 'failed to load';

async function readOne(
  context: import('@playwright/test').BrowserContext, url: string,
): Promise<{ outcome: Outcome; text: string | null; finalUrl: string | null }> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    if (onAggregator(page.url())) {
      // Google News sends the browser on with JavaScript after the page loads.
      await page.waitForURL((u) => !onAggregator(u.toString()), { timeout: 15_000 }).catch(() => {});
    }
    const finalUrl = page.url();
    if (onAggregator(finalUrl)) return { outcome: 'stayed on Google News', text: null, finalUrl: null };
    // Many publishers fill the article in after the first paint.
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    const text = extractBody(await page.content());
    return text
      ? { outcome: 'read', text, finalUrl }
      : { outcome: 'no article text', text: null, finalUrl };
  } catch {
    return { outcome: 'failed to load', text: null, finalUrl: null };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function readWithChromium(
  creds: D1Credentials, opts: { days: number; limit: number; dryRun: boolean },
): Promise<Record<Outcome, number>> {
  const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const rows = await queryRows<Pending>(creds, queueQuery(since, opts.limit));
  const counts: Record<Outcome, number> = {
    read: 0, 'stayed on Google News': 0, 'no article text': 0, 'failed to load': 0,
  };
  console.log(`${rows.length} article(s) with only a headline, collected since ${since.slice(0, 10)}.`);
  if (rows.length === 0) return counts;

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({
    // Set in the workflow only when the runner's Chromium is not Playwright's own.
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    locale: 'en-GB',
    // A plain desktop browser, saying who it is in the usual way.
    viewport: { width: 1280, height: 900 },
  });
  // Pictures, fonts and video are never read; skipping them keeps it quick and light.
  await context.route('**/*', (route) =>
    (['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue()));

  const statements: string[] = [];
  const at = new Date().toISOString();
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      const r = await readOne(context, row.url_canonical || row.url_original);
      counts[r.outcome] += 1;
      console.log(`  ${r.outcome.padEnd(22)} ${row.title.slice(0, 90)}`);
      statements.push(...resultStatements(row, r.text, at, r.finalUrl));
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await browser.close();
  }

  if (!opts.dryRun && statements.length) await executeAll(creds, statements);
  return counts;
}

async function main(): Promise<void> {
  const arg = (name: string, fallback: number) => {
    const v = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
    const n = Number(v);
    return v && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const dryRun = process.argv.includes('--dry-run');
  const creds = credentialsFromEnv();
  if (!creds) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN.');
    process.exitCode = 1;
    return;
  }
  const counts = await readWithChromium(creds, { days: arg('days', 3), limit: arg('limit', 80), dryRun });
  const tried = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\nRead ${counts.read} of ${tried} with Chromium.`);
  for (const [k, v] of Object.entries(counts)) if (k !== 'read' && v) console.log(`  ${k}: ${v}`);
  if (dryRun) console.log('Dry run: nothing was written.');
}

if (import.meta.filename === process.argv[1]) await main();
