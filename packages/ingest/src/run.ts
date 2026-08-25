#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, type ClassifiedArticle } from '@portal/shared';
import { dailySources, loadSources, type SourceConfig } from './sources.ts';
import { fetchRss } from './fetch-rss.ts';
import { fetchGdelt } from './fetch-gdelt.ts';
import { dedupe, hostOf, normalize, type RawItem } from './normalize.ts';
import { describeFailures, fetchBodies } from './fetch-article.ts';
import { resolveUrls } from './resolve-url.ts';
import { credentialsFromEnv, existingUrls, load, type RunSummary } from './load-d1.ts';
import { enrich } from './enrich-claude.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Options {
  check: boolean;
  dryRun: boolean;
  limit: number | null;
  snapshot: boolean;
  /**
   * Restrict the run to one kind of source.
   *
   * GDELT paces itself — up to thirty seconds between requests, widening
   * further when refused — so ten GDELT queries can take longer than the
   * other forty-three sources put together. That is correct behaviour for
   * collecting, and wrong for checking: the feeds that actually go stale are
   * the RSS ones, and waiting a quarter of an hour behind a rate limiter to
   * learn that a publisher 404s means nobody runs the check.
   */
  only: 'rss' | 'gdelt' | null;
}

export function parseArgs(argv: string[]): Options {
  const has = (f: string) => argv.includes(f);
  const value = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
  };
  const limit = value('--limit');
  const only = value('--only');
  if (only !== null && only !== 'rss' && only !== 'gdelt') {
    throw new Error(`--only takes "rss" or "gdelt", got "${only}"`);
  }
  return {
    check: has('--check'),
    dryRun: has('--dry-run'),
    limit: limit ? Number(limit) : null,
    snapshot: !has('--no-snapshot'),
    only,
  };
}

interface SourceOutcome {
  id: string;
  name: string;
  ok: boolean;
  items: number;
  /** Of those items, how many passed the AI-in-banking gate. */
  kept?: number;
  /** One headline that passed, so the yield can be judged rather than trusted. */
  sample?: string | null;
  error?: string;
}

async function fetchSource(s: SourceConfig): Promise<RawItem[]> {
  return s.kind === 'gdelt' ? fetchGdelt(s.url) : fetchRss(s.url);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  const all = loadSources();
  // Backfill-only sources are excluded here, not filtered out later: a source
  // the daily run must not fetch should never reach the queue.
  const daily = dailySources(all);
  const sources = opts.only ? daily.filter((s) => s.kind === opts.only) : daily;

  console.log(opts.only
    ? `Loaded ${all.length} sources, ${sources.length} of kind "${opts.only}".`
    : `Loaded ${sources.length} sources for the daily run `
      + `(${all.length - daily.length} are backfill-only).`);
  if (opts.check) console.log('--check: fetching, writing nothing.\n');

  const outcomes: SourceOutcome[] = [];
  const collected: ClassifiedArticle[] = [];

  // Sources are fetched with bounded concurrency and each failure is contained.
  // One dead feed must never cost us the other thirty-four.
  const CONCURRENCY = 6;
  const queue = [...sources];

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const source = queue.shift();
      if (!source) break;

      try {
        const raw = await fetchSource(source);
        const limited = opts.limit ? raw.slice(0, opts.limit) : raw;

        const normalized = limited
          .map((item) => normalize(item, {
            id: source.id, name: source.name, publisherKind: source.publisher_kind,
          }))
          .filter((a): a is NonNullable<typeof a> => a !== null);

        let kept = 0;
        let sample: string | null = null;

        for (const a of normalized) {
          const classification = classify({
            title: a.title,
            summary: a.summary,
            excerpt: a.excerpt,
            publisherKind: a.publisherKind,
            publishedAt: a.publishedAt,
            regionHint: source.region_hint ?? null,
          });
          if (classification.relevanceScore > 0) {
            kept += 1;
            sample ??= a.title;
          }
          collected.push({ ...a, classification });
        }

        // Items fetched is not the number that decides whether a source earns
        // its place — a feed can return fifty items a day and none about AI in
        // banking. What it yields after the gate is the useful figure, and a
        // sample headline is how a reader checks that the yield is real.
        outcomes.push({
          id: source.id, name: source.name, ok: true,
          items: normalized.length, kept, sample,
        });
        console.log(`  ok    ${source.name} — ${normalized.length} items, ${kept} on topic`
                    + (sample ? `  e.g. "${sample}"` : ''));
      } catch (err) {
        const message = (err as Error).message.slice(0, 200);
        outcomes.push({ id: source.id, name: source.name, ok: false, items: 0, error: message });
        console.log(`  FAIL  ${source.name} — ${message}`);
      }
    }
  }));

  const sourcesOk = outcomes.filter((o) => o.ok).length;
  const sourcesFailed = outcomes.length - sourcesOk;
  // The story key needs the process, which only exists after classification —
  // so this pass catches re-reports by URL and headline, and the story-key pass
  // runs again below once the articles have been classified.
  let articles = dedupe(collected);

  console.log(`\n${sourcesOk}/${outcomes.length} sources returned data.`);
  console.log(`${collected.length} items fetched, ${articles.length} after dedupe.`);

  // Only AI-in-banking articles are stored. Everything a source publishes gets
  // fetched and classified, but a sanctions notice or a results announcement
  // has no place in this database — keeping them was what filled the Lens with
  // material nobody asked for. The counts below stay in the snapshot, so what
  // was rejected is still visible without polluting the portal.
  const rejected = articles.filter((a) => a.classification.relevanceScore === 0);
  articles = articles.filter((a) => a.classification.relevanceScore > 0);
  console.log(`${articles.length} are about AI in banking; ${rejected.length} rejected.`);

  /*
   * Second pass: read the articles that passed.
   *
   * Feeds carry a headline and, at best, a one-line standfirst — measured
   * across a real day, the median stored body was 87 characters. So every
   * judgement above, and every use case quoted, came from a headline. Fetching
   * the page is what turns "an article about this exists" into "here is what
   * the bank did".
   *
   * Only articles that already passed the gate are fetched. Reading all ~1000
   * deduplicated items to rescue the few a headline undersold would be six
   * times the requests for a fraction of the gain, and would look far more
   * like something to block.
   *
   * The cost of that choice, stated plainly: an article rejected on its
   * headline is never rescued by its body.
   */
  if (!opts.check && articles.length > 0) {
    /*
     * Aggregator links first, because fetching them is known to fail.
     *
     * A production run spent 320 requests learning that Google News tokens do
     * not resolve to publishers. They are not fetched any more: the article is
     * looked up in its publisher's own feed by headline, and only a recovered
     * URL is worth a request.
     */
    const aggregated = articles.filter((a) => hostOf(a.urlOriginal) === 'news.google.com');
    if (aggregated.length > 0) {
      console.log(`\nRecovering real URLs for ${aggregated.length} aggregated articles…`);
      const resolved = await resolveUrls(
        aggregated,
        (a) => a.publisherHost ?? null,
        (a) => a.title,
        (article, url) => { article.urlOriginal = url; },
        { log: (line) => console.log(line) },
      );
      const rate = resolved.unresolved
        ? Math.round((resolved.recovered / resolved.unresolved) * 100) : 0;
      console.log(`  recovered ${resolved.recovered}/${resolved.unresolved} (${rate}%) `
                + `from ${resolved.publishersWithFeed}/${resolved.publishers} publishers.`);
    }

    // Only articles with a real URL are worth a page request now.
    const readable = articles.filter((a) => hostOf(a.urlOriginal) !== 'news.google.com');
    const skipped = articles.length - readable.length;

    console.log(`\nReading ${readable.length} article pages`
              + (skipped > 0 ? ` (${skipped} still have no real link)` : '') + '…');
    const bodies = await fetchBodies(
      readable,
      (a) => a.urlOriginal,
      (article, body) => { article.excerpt = body; },
    );

    // Re-classify with the body in hand. This is where the real gain lands:
    // use-case and maturity evidence now quote the article rather than its
    // headline. It also drops pieces whose body reveals the commentary their
    // headline hid, so the gate is applied twice on purpose.
    let demoted = 0;
    for (const a of articles) {
      if (!a.excerpt) continue;
      const before = a.classification.relevanceScore;
      a.classification = classify({
        title: a.title,
        summary: a.summary,
        excerpt: a.excerpt,
        publisherKind: a.publisherKind,
        publishedAt: a.publishedAt,
        regionHint: null,
      });
      if (before > 0 && a.classification.relevanceScore === 0) demoted += 1;
    }
    articles = articles.filter((a) => a.classification.relevanceScore > 0);

    // Now that every article has a process, the story key can see what the URL
    // and headline keys cannot: eight outlets reporting one rollout in eight
    // different sets of words.
    const beforeStories = articles.length;
    articles = dedupe(articles, {
      processOf: (a) => a.classification.tags
        .find((t) => t.dimension === 'l1_process')?.value ?? null,
    });
    if (articles.length < beforeStories) {
      console.log(`  ${beforeStories - articles.length} re-report(s) of a story already in `
                + 'this run collapsed.');
    }

    const pct = bodies.attempted ? Math.round((bodies.fetched / bodies.attempted) * 100) : 0;
    const mean = bodies.fetched ? Math.round(bodies.chars / bodies.fetched) : 0;
    console.log(`  read ${bodies.fetched}/${bodies.attempted} (${pct}%), `
              + `averaging ${mean} characters.`);
    if (demoted > 0) {
      console.log(`  ${demoted} dropped once the body was read — commentary the headline hid.`);
    }
    if (pct < 40 && bodies.attempted >= 20) {
      // A bare percentage cannot be acted on. The first production run read 3
      // of 332 and reported only "1%", which says nothing about whether the
      // cause is a paywall, a blocked agent, or links that never leave the
      // aggregator — three problems with three different fixes.
      console.log('  Why the rest could not be read:');
      for (const line of describeFailures(bodies)) console.log(line);
    }
  }

  if (opts.check) {
    console.log('\nSources by yield (items that passed the AI-in-banking gate):\n');
    const ranked = [...outcomes].sort((a, b) => (b.kept ?? 0) - (a.kept ?? 0));
    for (const o of ranked) {
      const status = o.ok ? `${String(o.kept ?? 0).padStart(3)} / ${String(o.items).padEnd(3)}` : '  FAILED  ';
      console.log(`  ${status}  ${o.name}`);
      if (o.ok && o.sample) console.log(`             "${o.sample}"`);
      if (!o.ok) console.log(`             ${o.error}`);
    }

    const barren = outcomes.filter((o) => o.ok && (o.kept ?? 0) === 0);
    if (barren.length > 0) {
      console.log(`\n${barren.length} source(s) returned items but nothing on topic: `
                  + barren.map((o) => o.id).join(', '));
    }
    if (sourcesFailed > 0) {
      console.log('\nFailing sources:');
      for (const o of outcomes.filter((x) => !x.ok)) console.log(`  ${o.id}: ${o.error}`);
    }
    // --check reports health; it is not a pass/fail gate on the feeds
    // themselves, because feeds break for reasons outside this repository.
    return 0;
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey) {
    console.log('\nANTHROPIC_API_KEY set — enriching with Claude (this costs money).');
    const result = await enrich(articles, { apiKey });
    articles = result.articles;
    console.log(`  enriched ${result.enriched}, failed ${result.failed}.`);
  } else {
    console.log('\nANTHROPIC_API_KEY not set — rules classification only (free).');
  }

  if (opts.snapshot) {
    const day = startedAt.slice(0, 10);
    const path = resolve(REPO_ROOT, 'data/snapshots', `${day}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({
      run_id: runId,
      generated_at: startedAt,
      sources: outcomes,
      rejected: rejected.length,
      articles: articles.map((a) => ({
        id: a.id, url: a.urlCanonical, title: a.title, summary: a.summary,
        source: a.sourceName, publisher_kind: a.publisherKind, published_at: a.publishedAt,
        relevance: a.classification.relevanceScore,
        ai_intensity: a.classification.aiIntensity,
        maturity: a.classification.maturity,
        maturity_evidence: a.classification.maturityEvidence,
        tags: a.classification.tags.map((t) => `${t.dimension}:${t.value}`),
      })),
    }, null, 2)}\n`);
    console.log(`Snapshot written to data/snapshots/${day}.json`);
  }

  const creds = credentialsFromEnv();
  if (opts.dryRun || !creds) {
    console.log(opts.dryRun
      ? '\n--dry-run: nothing written to D1.'
      : '\nD1 credentials not set (CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN) — nothing written.');
    return 0;
  }

  const before = await existingUrls(creds, articles.map((a) => a.urlCanonical));
  const itemsNew = articles.filter((a) => !before.has(a.urlCanonical)).length;

  const run: RunSummary = {
    id: runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: sourcesFailed === 0 ? 'ok' : sourcesOk === 0 ? 'failed' : 'partial',
    itemsFetched: collected.length,
    itemsNew,
    sourcesOk,
    sourcesFailed,
    detail: { sources: outcomes },
  };

  await load(creds, sources, articles, run);
  console.log(`\nWrote ${articles.length} articles to D1 (${itemsNew} new). Status: ${run.status}.`);

  // Every source failing means the network or the job is broken, not the feeds.
  return sourcesOk === 0 ? 1 : 0;
}

// Only when run as a command. Without this guard, importing anything from this
// module — parseArgs, in a test — starts a full ingest as a side effect: real
// fetches, real rate limiting, and on a machine with credentials, real writes.
if (process.argv[1]?.endsWith('run.ts')) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('Ingest failed:', err);
      process.exit(1);
    });
}
