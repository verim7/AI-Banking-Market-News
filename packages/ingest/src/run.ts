#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, type ClassifiedArticle } from '@portal/shared';
import { loadSources, type SourceConfig } from './sources.ts';
import { fetchRss } from './fetch-rss.ts';
import { fetchGdelt } from './fetch-gdelt.ts';
import { dedupe, normalize, type RawItem } from './normalize.ts';
import { credentialsFromEnv, existingUrls, load, type RunSummary } from './load-d1.ts';
import { enrich } from './enrich-claude.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Options {
  check: boolean;
  dryRun: boolean;
  limit: number | null;
  snapshot: boolean;
}

function parseArgs(argv: string[]): Options {
  const has = (f: string) => argv.includes(f);
  const value = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
  };
  const limit = value('--limit');
  return {
    check: has('--check'),
    dryRun: has('--dry-run'),
    limit: limit ? Number(limit) : null,
    snapshot: !has('--no-snapshot'),
  };
}

interface SourceOutcome {
  id: string;
  name: string;
  ok: boolean;
  items: number;
  error?: string;
}

async function fetchSource(s: SourceConfig): Promise<RawItem[]> {
  return s.kind === 'gdelt' ? fetchGdelt(s.url) : fetchRss(s.url);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  const sources = loadSources();
  console.log(`Loaded ${sources.length} sources.`);
  if (opts.check) console.log('--check: fetching every source, writing nothing.\n');

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

        for (const a of normalized) {
          collected.push({
            ...a,
            classification: classify({
              title: a.title,
              summary: a.summary,
              excerpt: a.excerpt,
              publisherKind: a.publisherKind,
              publishedAt: a.publishedAt,
              regionHint: source.region_hint ?? null,
            }),
          });
        }

        outcomes.push({ id: source.id, name: source.name, ok: true, items: normalized.length });
        console.log(`  ok    ${source.name} — ${normalized.length} items`);
      } catch (err) {
        const message = (err as Error).message.slice(0, 200);
        outcomes.push({ id: source.id, name: source.name, ok: false, items: 0, error: message });
        console.log(`  FAIL  ${source.name} — ${message}`);
      }
    }
  }));

  const sourcesOk = outcomes.filter((o) => o.ok).length;
  const sourcesFailed = outcomes.length - sourcesOk;
  let articles = dedupe(collected);

  console.log(`\n${sourcesOk}/${outcomes.length} sources returned data.`);
  console.log(`${collected.length} items fetched, ${articles.length} after dedupe.`);

  const scored = articles.filter((a) => a.classification.relevanceScore > 0);
  console.log(`${scored.length} passed the AI-and-banking gate.`);

  if (opts.check) {
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
      articles: articles.map((a) => ({
        id: a.id, url: a.urlCanonical, title: a.title, summary: a.summary,
        source: a.sourceName, publisher_kind: a.publisherKind, published_at: a.publishedAt,
        relevance: a.classification.relevanceScore,
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

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Ingest failed:', err);
    process.exit(1);
  });
