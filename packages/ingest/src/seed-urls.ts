/**
 * Put one specific article into the app, by its URL.
 *
 * Every other way in is a *feed*: a tap pointed at a publisher, delivering
 * whatever that publisher decides to publish. `sources.yaml` holds about
 * thirty-five of them. What the pipeline had no way to accept was a single
 * article — and that is why Sygnum Bank was missing from the Agentic Swiss
 * Banks page for a week.
 *
 * Sygnum announced the first live AI-agent driven digital asset transactions by
 * a regulated Swiss bank on its own newsroom. Its newsroom is not one of the
 * thirty-five taps, so nothing in the pipeline ever saw it. A hand search found
 * it in minutes; there was then no way to put it in, and `validateReview`
 * refuses an articleId that is not in the database — correctly, since a review
 * joined to nothing is invisible. So a found article could not become a use
 * case at all.
 *
 * This is the missing input. Read a list of URLs, fetch each page, read its
 * headline and date off the page itself, classify it exactly as the daily run
 * does, and load it. From there it is an ordinary article: it exports for
 * review, it grades, it folds, it appears on both pages.
 *
 * What it is not: a crawler. It accepts links, it does not discover them. When
 * the Swiss newsroom crawl in docs/swiss-coverage.md is built, it writes into
 * the same file — which is why this is a command rather than a one-off script.
 *
 * Politeness is the pipeline's, unchanged: one request per URL, six at a time,
 * failure returns null rather than retrying.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { classify, type ClassifiedArticle, type PublisherKind } from '@portal/shared';
import { credentialsFromEnv, load, type RunSummary } from './load-d1.ts';
import { fromWayback, readArticle, readArticleMeta } from './fetch-article.ts';
import { normalize } from './normalize.ts';
import type { SourceConfig } from './sources.ts';

const DEFAULT_FILE = 'data/review/seed-urls.txt';
const CONCURRENCY = 6;

export interface SeedLine {
  url: string;
  /**
   * How much the publisher's word is worth, per PUBLISHER_WEIGHT in classify.
   *
   * Defaults to `media`. It matters for a bank's own newsroom: `bank` carries
   * 1.1 against media's 1.0, and a press release read as anonymous media news
   * is scored as though nobody in particular said it.
   */
  publisherKind: PublisherKind;
}

const KINDS = new Set<PublisherKind>(['consultancy', 'regulator', 'bank', 'media']);

/**
 * One URL per line. `#` starts a comment. An optional `| kind` sets the
 * publisher kind, because a list a person maintains by hand needs to be
 * writable by hand.
 */
export function parseSeedFile(text: string): SeedLine[] {
  const out: SeedLine[] = [];
  const seen = new Set<string>();

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const [urlPart, kindPart] = line.split('|').map((p) => p.trim());
    if (!urlPart) continue;

    let url: string;
    try {
      url = new URL(urlPart).toString();
    } catch {
      console.log(`  skip  not a URL: ${urlPart.slice(0, 80)}`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const kind = (kindPart ?? '') as PublisherKind;
    out.push({ url, publisherKind: KINDS.has(kind) ? kind : 'media' });
  }

  return out;
}

/**
 * A source row per publisher, so the article's origin is visible in the app.
 *
 * The alternative — one shared "seeded" source — would label a Sygnum press
 * release and a Finextra report identically, and the Sources panel counts by
 * source. `kind` is 'rss' because the sources table has
 * CHECK (kind IN ('rss','gdelt')) and a new kind means a migration for a
 * cosmetic distinction.
 */
export function sourceFor(url: string, publisherKind: PublisherKind): SourceConfig {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return {
    id: `seed-${host}`,
    name: host,
    url: `https://${host}/`,
    kind: 'rss',
    publisher_kind: publisherKind,
    daily: false,
    backfill: false,
  };
}

export interface SeedOutcome {
  url: string;
  ok: boolean;
  title?: string;
  publishedAt?: string | null;
  chars?: number;
  via?: 'direct' | 'wayback';
  reason?: string;
  scored?: number;
}

/** Fetch one URL and turn it into a classified article, or explain why not. */
export async function seedOne(
  seed: SeedLine,
): Promise<{ outcome: SeedOutcome; article?: ClassifiedArticle; source?: SourceConfig }> {
  let read = await readArticle(seed.url);
  let via: 'direct' | 'wayback' = 'direct';

  // A bot wall or a page whose text is assembled by JavaScript. The archive
  // holds a public snapshot of a public page; nothing is spoofed or bypassed.
  if (!read.body && (read.reason === 'http-error' || read.reason === 'too-short')) {
    const archived = await fromWayback(seed.url);
    if (archived.body) { read = archived; via = 'wayback'; }
  }

  if (!read.body) {
    return { outcome: { url: seed.url, ok: false,
                        reason: `${read.reason ?? 'unknown'}${read.detail ? ` (${read.detail})` : ''}` } };
  }

  // The headline is read from the page, never guessed. An article stored under
  // an invented headline is wrong in the one field the fold, the search and
  // every review record key on — worse than not storing it.
  const meta = readArticleMeta(read.html ?? '');
  if (!meta.title) {
    return { outcome: { url: seed.url, ok: false, reason: 'no readable headline' } };
  }

  const source = sourceFor(seed.url, seed.publisherKind);
  const article = normalize(
    { title: meta.title, link: seed.url, description: null,
      pubDate: meta.publishedAt ?? undefined },
    { id: source.id, name: source.name, publisherKind: seed.publisherKind },
  );
  if (!article) {
    return { outcome: { url: seed.url, ok: false, reason: 'normalize rejected it' } };
  }

  article.excerpt = read.body;
  const classification = classify({
    title: article.title,
    summary: article.summary,
    excerpt: article.excerpt,
    publisherKind: article.publisherKind,
    publishedAt: article.publishedAt,
    regionHint: null,
  });

  return {
    outcome: { url: seed.url, ok: true, title: meta.title, publishedAt: meta.publishedAt,
               chars: read.body.length, via, scored: classification.relevanceScore },
    article: { ...article, classification },
    source,
  };
}

function parseArgs(argv: string[]) {
  const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    file: arg('file') ?? DEFAULT_FILE,
    limit: arg('limit') ? Number(arg('limit')) : null,
    // Writing is the exception, not the default: this command reaches the live
    // database, and a run that only reports costs nothing to repeat.
    dryRun: !argv.includes('--apply'),
  };
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const startedAt = new Date().toISOString();

  let text: string;
  try {
    text = readFileSync(`${root}/${opts.file}`, 'utf8');
  } catch {
    console.log(`No seed file at ${opts.file}. Nothing to do.`);
    return 0;
  }

  const all = parseSeedFile(text);
  const seeds = opts.limit ? all.slice(0, opts.limit) : all;
  console.log(`${all.length} URLs in ${opts.file}`
            + (seeds.length !== all.length ? `, taking ${seeds.length}` : '') + '.');
  if (opts.dryRun) console.log('Dry run: fetching and classifying, writing nothing.\n');

  const outcomes: SeedOutcome[] = [];
  const articles: ClassifiedArticle[] = [];
  const sources = new Map<string, SourceConfig>();
  const queue = [...seeds];

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const seed = queue.shift();
      if (!seed) return;

      const { outcome, article, source } = await seedOne(seed);
      outcomes.push(outcome);
      if (article && source) {
        articles.push(article);
        sources.set(source.id, source);
      }

      const host = new URL(seed.url).hostname.replace(/^www\./, '');
      console.log(outcome.ok
        ? `  ok    ${host} — ${outcome.chars} chars ${outcome.via}, `
          + `score ${outcome.scored}  "${(outcome.title ?? '').slice(0, 70)}"`
        : `  FAIL  ${host} — ${outcome.reason}`);
    }
  }));

  const ok = outcomes.filter((o) => o.ok).length;
  const viaWayback = outcomes.filter((o) => o.via === 'wayback').length;
  const scored = outcomes.filter((o) => (o.scored ?? 0) > 0).length;

  console.log('');
  console.log(`read          ${ok}/${outcomes.length}`);
  console.log(`  direct      ${ok - viaWayback}`);
  console.log(`  via Wayback ${viaWayback}`);
  console.log(`past the relevance gate  ${scored}/${ok}`);
  // Scoring zero is a real answer, not a failure: the article is stored either
  // way and the review decides. It is worth naming, because a seeded URL that
  // scores zero will not appear on the Lens and that would otherwise look like
  // the seed having silently failed.
  if (ok > scored) {
    console.log(`  ${ok - scored} scored zero — stored, but below the gate the Lens filters on.`);
  }

  for (const o of outcomes.filter((x) => !x.ok)) {
    console.log(`  could not read: ${o.url} — ${o.reason}`);
  }

  if (opts.dryRun) {
    console.log('\nDry run: nothing written. Re-run with --apply to load these.');
    return 0;
  }

  const creds = credentialsFromEnv();
  if (!creds) {
    console.log('\nNo D1 credentials in the environment; nothing written.');
    return 1;
  }
  if (articles.length === 0) {
    console.log('\nNothing readable to write.');
    return 0;
  }

  const run: RunSummary = {
    id: randomUUID(), startedAt, finishedAt: new Date().toISOString(),
    status: ok === outcomes.length ? 'ok' : 'partial',
    itemsFetched: outcomes.length, itemsNew: articles.length,
    sourcesOk: sources.size, sourcesFailed: 0,
    detail: { command: 'seed-urls', file: opts.file },
  };

  await load(creds, [...sources.values()], articles, run);
  console.log(`\nWrote ${articles.length} articles from ${sources.size} publishers.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
