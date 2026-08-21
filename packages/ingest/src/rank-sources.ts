import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentialsFromEnv, queryRows, type D1Credentials } from './load-d1.ts';
import { loadSources } from './sources.ts';

/**
 * Which sources are actually worth having.
 *
 * Built from the database rather than from one fetch, because a single check
 * shows what a source returned this morning and the question is what it
 * returns over time. A feed that lands one excellent piece a week beats one
 * that lands forty near-misses a day, and only accumulated history separates
 * them.
 *
 * Four measures, because no single one is honest on its own:
 *
 *   articles     volume. Necessary, and the easiest to mistake for quality.
 *   mean AI      how central AI is to what this source contributes. A source
 *                can clear the gate constantly while sitting just above it.
 *   production   the share with evidence of something actually running. This
 *                is the closest thing to "did we learn about a real use case",
 *                and it is the measure worth optimising.
 *   use case     the share where the article describes the use case in words
 *                we can quote. Low here means a source announces things
 *                without saying what they do.
 *
 * The report is written to a file and committed, so the ranking is a record
 * that accumulates rather than a number that scrolls past in a log.
 *
 * Two tables, because there are two different questions and one table cannot
 * answer both.
 *
 * A *source* is something configured in sources.yaml — a feed or a query. That
 * table decides what to keep and what to drop.
 *
 * An *outlet* is whoever actually published the article. For a Google News
 * query those differ: one configured source returns Reuters, Citywire, IBS
 * Intelligence and a hundred others. Grouping by outlet answers the opposite
 * question — which publications keep producing material worth having, and so
 * which are worth adding as sources in their own right. That is the table to
 * read when looking for the next source.
 */

interface SourceRow {
  source_id: string;
  source_name: string;
  publisher_kind: string;
  articles: number;
  mean_ai: number;
  max_ai: number;
  in_production: number;
  piloting: number;
  with_use_case: number;
  first_seen: string | null;
  last_seen: string | null;
}

interface ProcessRow { source_id: string; value: string; n: number }

const BAR_WIDTH = 12;
const bar = (fraction: number): string => {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * BAR_WIDTH);
  return '█'.repeat(filled) + '·'.repeat(BAR_WIDTH - filled);
};

/**
 * One number to sort by.
 *
 * Production evidence is weighted highest because it is what the brief asked
 * for — banks running AI, not banks discussing it. Mean AI focus comes next.
 * Volume is deliberately dampened with a logarithm: it should break ties
 * between comparable sources, not let a firehose outrank a specialist.
 */
export function qualityScore(r: {
  articles: number; mean_ai: number; in_production: number; with_use_case: number;
}): number {
  if (r.articles === 0) return 0;
  const productionRate = r.in_production / r.articles;
  const useCaseRate = r.with_use_case / r.articles;
  return Math.round(
    productionRate * 50
    + (r.mean_ai / 100) * 30
    + useCaseRate * 20
    + Math.log10(r.articles + 1) * 4,
  );
}

/** Minimum articles before an outlet's rates mean anything. */
const OUTLET_MIN = 3;

/**
 * How many deployments a source must be *expected* to produce before its
 * having none counts as evidence against it.
 *
 * The first version of this flagged five articles with no production, which
 * named eight of the seventeen sources — including the best-performing
 * queries. At a corpus rate near 4%, a thirteen-article source expects half a
 * deployment; zero is the single most likely outcome and says nothing. Acting
 * on that list would have meant deleting the sources actually working.
 *
 * Three expected hits is the point where a run of zero is a real signal rather
 * than a small sample.
 */
const EXPECTED_PRODUCTION_BEFORE_JUDGING = 3;

/** AI focus this close to the gate floor means a source is only ever scraping in. */
const AI_FLOOR = 36;

export function corpusProductionRate(rows: { articles: number; in_production: number }[]): number {
  const articles = rows.reduce((n, r) => n + r.articles, 0);
  if (articles === 0) return 0;
  return rows.reduce((n, r) => n + r.in_production, 0) / articles;
}

/**
 * Sources genuinely underperforming, measured against how this corpus actually
 * behaves rather than against a hoped-for absolute.
 */
export function candidatesToDrop<T extends {
  articles: number; in_production: number; mean_ai: number;
}>(rows: T[]): T[] {
  const rate = corpusProductionRate(rows);
  const enoughVolume = rate > 0
    ? EXPECTED_PRODUCTION_BEFORE_JUDGING / rate
    : Number.POSITIVE_INFINITY;

  return rows.filter((r) =>
    (r.articles >= enoughVolume && r.in_production === 0)
    || (r.articles >= OUTLET_MIN && r.mean_ai > 0 && r.mean_ai < AI_FLOOR));
}

export function renderReport(
  rows: SourceRow[], outlets: SourceRow[], processes: ProcessRow[],
  generatedAt: string, names: Map<string, string> = new Map(),
): string {
  const label = (id: string) => names.get(id) ?? id;

  const ranked = [...rows]
    .map((r) => ({ ...r, score: qualityScore(r) }))
    .sort((a, b) => b.score - a.score);

  const byProcess = new Map<string, ProcessRow[]>();
  for (const p of processes) {
    const list = byProcess.get(p.source_id) ?? [];
    list.push(p);
    byProcess.set(p.source_id, list);
  }

  const total = rows.reduce((n, r) => n + r.articles, 0);
  const out: string[] = [];

  out.push('# Which sources are worth having');
  out.push('');
  out.push(`Generated ${generatedAt} from ${total} stored articles across `
         + `${rows.length} configured sources and ${outlets.length} distinct outlets.`);
  out.push('Regenerated by the **Check sources** action — do not edit by hand.');
  out.push('');
  out.push('Ranked by a score that weights **evidence of production** highest (50),');
  out.push('then **mean AI focus** (30), then **whether the use case is described** (20),');
  out.push('with volume dampened logarithmically so a firehose cannot outrank a specialist.');
  out.push('');
  out.push('| # | Source | Articles | Mean AI | In production | Use case described | Score |');
  out.push('|---|---|--:|--:|--:|--:|--:|');

  ranked.forEach((r, i) => {
    const prodRate = r.articles ? r.in_production / r.articles : 0;
    const ucRate = r.articles ? r.with_use_case / r.articles : 0;
    out.push(
      `| ${i + 1} | ${label(r.source_id)} | ${r.articles} | ${Math.round(r.mean_ai)} `
      + `| ${r.in_production} (${Math.round(prodRate * 100)}%) `
      + `| ${r.with_use_case} (${Math.round(ucRate * 100)}%) | **${r.score}** |`);
  });

  out.push('');
  out.push('## Outlets worth adding as their own source');
  out.push('');
  out.push('Who actually published the articles. A Google News query is one source');
  out.push('here and a hundred outlets below it, so this is the table that answers');
  out.push('"where should the next source come from" — a publication that keeps');
  out.push(`appearing with real deployments is one to add directly. Outlets with `
         + `fewer than ${OUTLET_MIN} articles are omitted: a rate computed on one article is not a rate.`);
  out.push('');
  out.push('| Outlet | Articles | Mean AI | In production | Use case described | Score |');
  out.push('|---|--:|--:|--:|--:|--:|');

  const rankedOutlets = outlets
    .filter((o) => o.articles >= OUTLET_MIN)
    .map((o) => ({ ...o, score: qualityScore(o) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  if (rankedOutlets.length === 0) {
    out.push('| _(no outlet has enough articles yet)_ | | | | | |');
  }
  for (const o of rankedOutlets) {
    const prodRate = o.articles ? o.in_production / o.articles : 0;
    const ucRate = o.articles ? o.with_use_case / o.articles : 0;
    out.push(
      `| ${o.source_name} | ${o.articles} | ${Math.round(o.mean_ai)} `
      + `| ${o.in_production} (${Math.round(prodRate * 100)}%) `
      + `| ${o.with_use_case} (${Math.round(ucRate * 100)}%) | **${o.score}** |`);
  }

  out.push('');
  out.push('## What each source covers');
  out.push('');
  out.push('The L1 processes a source writes about most. A source concentrated on one');
  out.push('process is not worse than a broad one — it is the thing to reach for when');
  out.push('that process is the question.');
  out.push('');

  for (const r of ranked.slice(0, 20)) {
    const procs = (byProcess.get(r.source_id) ?? [])
      .sort((a, b) => b.n - a.n).slice(0, 4);
    if (procs.length === 0) continue;
    const share = procs.map((p) => `${p.value} (${p.n})`).join(', ');
    out.push(`- **${label(r.source_id)}** — ${share}`);
  }

  out.push('');
  out.push('## Reading it');
  out.push('');
  out.push('**Mean AI focus** near the floor of 30 means a source clears the gate');
  out.push('without ever being really about AI. Volume from such a source is noise');
  out.push('that happens to be admissible.');
  out.push('');
  out.push('**In production** is the measure to optimise. It is the difference between');
  out.push('a market-intelligence tool and a clippings file. A source at 0% over a');
  out.push('meaningful number of articles publishes commentary, not deployments —');
  out.push('worth keeping only if nothing else covers its region or segment.');
  out.push('');
  out.push('**Use case described** low with production high means a source reports that');
  out.push('things launched without saying what they do. Useful for counting adoption,');
  out.push('weak for understanding it.');
  out.push('');
  out.push('## Where to look for more sources');
  out.push('');
  out.push('The outlet table above is the shortlist. Beyond it, the pattern in the');
  out.push('data has been consistent:');
  out.push('');
  out.push('1. **Trade press beats general press.** A wealth or banking-technology');
  out.push('   title writes about banks deploying things because that is its whole');
  out.push('   beat. A general title writes about AI, and banks appear incidentally.');
  out.push('2. **Search queries beat feed URLs.** Publications retire RSS without');
  out.push('   notice; a site-scoped search reaches them regardless and cannot 404.');
  out.push('3. **Deployment verbs beat topic words.** The query built on "rolls out",');
  out.push('   "goes live" and "deploys" yields fewer articles and better ones than');
  out.push('   the query built on "artificial intelligence".');
  out.push('4. **Regulators and consultancies are low-yield but not worthless.** They');
  out.push('   publish rarely on this topic and matter a great deal when they do.');
  out.push('   Judge them on production evidence, never on volume.');
  out.push('');

  const barren = candidatesToDrop(rows);
  out.push('## Candidates to drop');
  out.push('');
  out.push(`Judged against this corpus, not against zero. Only ${Math.round(corpusProductionRate(rows) * 1000) / 10}% `
         + 'of all stored articles carry evidence of production, so a source with a dozen');
  out.push('articles and none of it is behaving exactly as expected — flagging that would');
  out.push('mean deleting the best queries. A source is listed here only when it has');
  out.push(`enough volume to expect ${EXPECTED_PRODUCTION_BEFORE_JUDGING} deployments at the corpus rate and has none, or when its`);
  out.push('mean AI focus sits at the gate floor, meaning it clears the bar without ever');
  out.push('being about AI.');
  out.push('');

  if (barren.length === 0) {
    out.push('_Nothing qualifies. No source is currently underperforming by enough to drop._');
    out.push('');
  }
  for (const r of barren) {
    const expected = (r.articles * corpusProductionRate(rows)).toFixed(1);
    out.push(`- **${label(r.source_id)}** — ${r.articles} articles, mean AI focus `
           + `${Math.round(r.mean_ai)} ${bar(r.mean_ai / 100)}, `
           + `${r.in_production} in production against ${expected} expected`);
  }
  out.push('');

  return out.join('\n') + '\n';
}

export async function collect(creds: D1Credentials) {
  const rows = await queryRows<SourceRow>(creds, `
    SELECT a.source_id,
           a.source_id AS source_name,
           a.publisher_kind,
           count(*)                                            AS articles,
           avg(COALESCE(sc.ai_intensity, 0))                   AS mean_ai,
           max(COALESCE(sc.ai_intensity, 0))                   AS max_ai,
           sum(CASE WHEN sc.maturity = 'in_production' THEN 1 ELSE 0 END) AS in_production,
           sum(CASE WHEN sc.maturity = 'pilot'         THEN 1 ELSE 0 END) AS piloting,
           sum(CASE WHEN sc.use_case_evidence IS NOT NULL AND sc.use_case_evidence <> ''
                    THEN 1 ELSE 0 END)                         AS with_use_case,
           min(a.published_at)                                 AS first_seen,
           max(a.published_at)                                 AS last_seen
      FROM articles a
      LEFT JOIN article_scores sc ON sc.article_id = a.id
     WHERE COALESCE(sc.relevance_score, 0) > 0
     GROUP BY a.source_id, a.publisher_kind
     HAVING articles > 0
     ORDER BY articles DESC;`);

  const outlets = await queryRows<SourceRow>(creds, `
    SELECT a.source_name                                     AS source_id,
           a.source_name,
           a.publisher_kind,
           count(*)                                          AS articles,
           avg(COALESCE(sc.ai_intensity, 0))                 AS mean_ai,
           max(COALESCE(sc.ai_intensity, 0))                 AS max_ai,
           sum(CASE WHEN sc.maturity = 'in_production' THEN 1 ELSE 0 END) AS in_production,
           sum(CASE WHEN sc.maturity = 'pilot'         THEN 1 ELSE 0 END) AS piloting,
           sum(CASE WHEN sc.use_case_evidence IS NOT NULL AND sc.use_case_evidence <> ''
                    THEN 1 ELSE 0 END)                       AS with_use_case,
           min(a.published_at)                               AS first_seen,
           max(a.published_at)                               AS last_seen
      FROM articles a
      LEFT JOIN article_scores sc ON sc.article_id = a.id
     WHERE COALESCE(sc.relevance_score, 0) > 0
     GROUP BY a.source_name, a.publisher_kind
     ORDER BY articles DESC;`);

  const processes = await queryRows<ProcessRow>(creds, `
    SELECT a.source_id, t.value, count(*) AS n
      FROM articles a
      JOIN article_tags t ON t.article_id = a.id AND t.dimension = 'l1_process'
      LEFT JOIN article_scores sc ON sc.article_id = a.id
     WHERE COALESCE(sc.relevance_score, 0) > 0
     GROUP BY a.source_id, t.value;`);

  return { rows, outlets, processes };
}

const OUT = 'docs/source-quality.md';

async function main(): Promise<void> {
  const creds = credentialsFromEnv();
  if (!creds) {
    const missing = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']
      .filter((k) => !process.env[k]);
    console.error(`Missing credentials: ${missing.join(', ')}`);
    process.exit(1);
  }

  const { rows, outlets, processes } = await collect(creds);

  // Configured names come from the file, not the database: the stored
  // source_name is the outlet that published the article, which for a Google
  // News query differs per row.
  const names = new Map(loadSources().map((s) => [s.id, s.name]));

  const report = renderReport(
    rows, outlets, processes, new Date().toISOString().slice(0, 10), names);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, report);
  console.log(report);
  console.log(`\nWritten to ${OUT}`);
}

if (process.argv[1]?.endsWith('rank-sources.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
