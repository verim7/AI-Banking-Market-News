#!/usr/bin/env node
/**
 * Build history the daily job cannot.
 *
 *   npm run backfill -- --years 3
 *   npm run backfill -- --years 1 --dry-run
 *
 * RSS feeds publish a sliding window — usually the last ten to fifty items —
 * so no amount of polling reaches back a year, let alone three. GDELT's
 * article API does accept an absolute date range, back to 2017, which is the
 * only route to a Market Lens that shows a direction rather than a fortnight.
 *
 * The window is walked one month at a time because GDELT caps how many
 * articles a single response can return: asking for three years at once
 * silently truncates to the most recent slice, which looks like success and
 * produces a hole. Month-sized requests keep each response inside the cap.
 *
 * Every call goes through the same serialiser the daily job uses, so the whole
 * run stays inside GDELT's rate limit. That makes it slow — roughly five
 * seconds per request — and a three-year run over the GDELT sources takes the
 * better part of an hour. It is meant to be run once.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, type ClassifiedArticle } from '@portal/shared';
import { loadSources } from './sources.ts';
import { fetchGdelt } from './fetch-gdelt.ts';
import { dedupe, normalize } from './normalize.ts';
import { credentialsFromEnv, existingUrls, load, type RunSummary } from './load-d1.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

const years = Number(arg('--years') ?? 3);
const dryRun = process.argv.includes('--dry-run');

if (!Number.isFinite(years) || years <= 0 || years > 8) {
  console.error('--years must be between 1 and 8. GDELT indexes from 2017.');
  process.exit(1);
}

/** GDELT wants YYYYMMDDHHMMSS. */
export const stamp = (d: Date): string =>
  d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** Month boundaries from oldest to newest, covering the requested span. */
export function monthWindows(yearsBack: number): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const now = new Date();
  const first = new Date(now);
  first.setFullYear(first.getFullYear() - yearsBack);
  first.setDate(1);

  const cursor = new Date(first);
  while (cursor < now) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setMonth(end.getMonth() + 1);
    out.push({ start, end: end > now ? now : end });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  const sources = loadSources().filter((s) => s.kind === 'gdelt');
  if (sources.length === 0) {
    console.error('No GDELT sources are enabled. Only GDELT can reach back in time.');
    return 1;
  }

  const windows = monthWindows(years);
  const calls = windows.length * sources.length;
  console.log(`Backfilling ${years} year(s): ${windows.length} months × ${sources.length} sources`);
  console.log(`= ${calls} requests, spaced for GDELT's rate limit.`);
  console.log(`Expect roughly ${Math.ceil((calls * 5) / 60)} minutes. Leave it running.\n`);

  const collected: ClassifiedArticle[] = [];
  let ok = 0;
  let failed = 0;

  for (const w of windows) {
    const month = w.start.toISOString().slice(0, 7);
    let monthCount = 0;

    for (const source of sources) {
      try {
        const raw = await fetchGdelt(source.url, {
          startDateTime: stamp(w.start),
          endDateTime: stamp(w.end),
          maxRecords: 250,
        });

        for (const item of raw) {
          const a = normalize(item, {
            id: source.id, name: source.name, publisherKind: source.publisher_kind,
          });
          if (!a) continue;
          collected.push({
            ...a,
            classification: classify({
              title: a.title, summary: a.summary, excerpt: a.excerpt,
              publisherKind: a.publisherKind, publishedAt: a.publishedAt,
              regionHint: source.region_hint ?? null,
            }),
          });
        }
        monthCount += raw.length;
        ok++;
      } catch (err) {
        failed++;
        console.log(`  ${month}  ${source.id}: ${(err as Error).message.slice(0, 90)}`);
      }
    }
    console.log(`  ${month}  ${monthCount} items`);
  }

  const all = dedupe(collected);
  // Same rule as the daily run: only AI-in-banking is kept. Three years of
  // unfiltered GDELT would bury the signal completely.
  const articles = all.filter((a) => a.classification.relevanceScore > 0);

  console.log(`\n${ok}/${ok + failed} requests succeeded.`);
  console.log(`${collected.length} fetched, ${all.length} after dedupe, `
            + `${articles.length} about AI in banking.`);

  const path = resolve(REPO_ROOT, 'data/snapshots', `backfill-${startedAt.slice(0, 10)}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    run_id: runId, generated_at: startedAt, years, months: windows.length,
    articles: articles.map((a) => ({
      id: a.id, url: a.urlCanonical, title: a.title, source: a.sourceName,
      published_at: a.publishedAt,
      relevance: a.classification.relevanceScore,
      ai_intensity: a.classification.aiIntensity,
      maturity: a.classification.maturity,
      tags: a.classification.tags.map((t) => `${t.dimension}:${t.value}`),
    })),
  }, null, 2)}\n`);
  console.log(`Snapshot written to data/snapshots/backfill-${startedAt.slice(0, 10)}.json`);

  const creds = credentialsFromEnv();
  if (dryRun || !creds) {
    console.log(dryRun
      ? '\n--dry-run: nothing written to D1.'
      : '\nD1 credentials not set — nothing written.');
    return 0;
  }

  const before = await existingUrls(creds, articles.map((a) => a.urlCanonical));
  const run: RunSummary = {
    id: runId, startedAt, finishedAt: new Date().toISOString(),
    status: failed === 0 ? 'ok' : ok === 0 ? 'failed' : 'partial',
    itemsFetched: collected.length,
    itemsNew: articles.filter((a) => !before.has(a.urlCanonical)).length,
    sourcesOk: ok, sourcesFailed: failed,
    detail: { backfill: true, years, months: windows.length },
  };

  await load(creds, sources, articles, run);
  console.log(`\nWrote ${articles.length} articles (${run.itemsNew} new).`);
  return ok === 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => { console.error('Backfill failed:', err); process.exit(1); });
}
