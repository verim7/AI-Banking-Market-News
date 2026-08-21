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
import { backfillSources, loadSources } from './sources.ts';
import { fetchGdelt, gapReport, isRateLimited } from './fetch-gdelt.ts';
import { dedupe, normalize } from './normalize.ts';
import { credentialsFromEnv, existingUrls, load, type RunSummary } from './load-d1.ts';
import {
  collectedKeys, loadState, mergeState, missingMonths, saveState, sliceKey, type Slice,
} from './state.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE_PATH = resolve(REPO_ROOT, 'data/backfill-state.json');
/** GDELT's per-response cap. A slice returning exactly this is truncated. */
const MAX_RECORDS = 250;

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

const years = Number(arg('--years') ?? 3);
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const maxRequests = Number(arg('--max-requests') ?? 40);

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

  const sources = backfillSources(loadSources());
  if (sources.length === 0) {
    console.error(
      'No GDELT source is marked `backfill: true` in sources.yaml.'
      + '\nOnly GDELT can reach back in time, and only broad queries belong here.');
    return 1;
  }

  // Checked before the work, not after. credentialsFromEnv needs three
  // variables — D1_DATABASE_ID as well as the two wrangler uses — and the
  // check used to sit at the end, after the fetching. Getting it wrong meant
  // half an hour of GDELT calls followed by "nothing written", with the whole
  // run discarded.
  if (!dryRun && !credentialsFromEnv()) {
    console.error(
      'Cloudflare credentials are incomplete, and this run would throw away its'
      + '\nresults at the end. All three are needed:\n'
      + '\n  CLOUDFLARE_ACCOUNT_ID   ' + (process.env['CLOUDFLARE_ACCOUNT_ID'] ? 'set' : 'MISSING')
      + '\n  CLOUDFLARE_API_TOKEN    ' + (process.env['CLOUDFLARE_API_TOKEN'] ? 'set' : 'MISSING')
      + '\n  D1_DATABASE_ID          ' + (process.env['D1_DATABASE_ID'] ? 'set' : 'MISSING')
      + '\n\nEasier: run the "Backfill history" workflow from the Actions tab, where'
      + '\nthese are already stored as repository secrets. Or pass --dry-run to'
      + '\nfetch without writing.\n');
    return 1;
  }

  const windows = monthWindows(years);
  const allMonths = windows.map((w) => w.start.toISOString().slice(0, 10).slice(0, 7));

  const previous = force ? { version: 1 as const, slices: [] } : loadState(STATE_PATH);
  const already = collectedKeys(previous);

  // Every slice this run could attempt, oldest first, minus what earlier runs
  // already collected. Re-running is now progress rather than repetition.
  const planned: { w: { start: Date; end: Date }; month: string; source: typeof sources[number] }[] = [];
  for (const w of windows) {
    const month = w.start.toISOString().slice(0, 7);
    for (const source of sources) {
      if (already.has(sliceKey(month, source.id))) continue;
      planned.push({ w, month, source });
    }
  }

  const total = windows.length * sources.length;
  if (previous.slices.length > 0) {
    console.log(`${previous.slices.length} of ${total} slices already collected by earlier runs.`);
  }
  if (planned.length === 0) {
    console.log('Nothing left to collect. Use --force to re-fetch everything.');
    return 0;
  }

  const budget = Math.min(planned.length, Math.max(1, maxRequests));
  const batch = planned.slice(0, budget);
  const calls = batch.length;
  console.log(`Backfilling ${years} year(s): ${windows.length} months × ${sources.length} queries`);
  console.log(`${planned.length} slices outstanding; this run attempts ${calls}.`);
  // The gap is measured from when the previous call FINISHED, so each request
  // costs the 5s spacing plus however long GDELT takes to answer — a few
  // seconds more. Estimating from the spacing alone understated a three-year
  // run by roughly half, which reads as a stall rather than a slow job.
  const perCall = 8;
  console.log(`= ${calls} requests at ~${perCall}s each `
            + `(5s spacing for GDELT's rate limit, plus response time).`);
  console.log(`Expect roughly ${Math.ceil((calls * perCall) / 60)} minutes. Leave it running.`);
  console.log(`Progress prints per month, oldest first.\n`);

  const collected: ClassifiedArticle[] = [];
  let ok = 0;
  let failed = 0;

  // Circuit breaker. Once GDELT starts refusing outright it does not relent
  // mid-run: the last attempt spent its final forty minutes failing every
  // request and still walked every remaining month. Stopping keeps what was
  // collected and returns it sooner, instead of deepening the block.
  const GIVE_UP_AFTER = 15;
  let consecutiveFailures = 0;
  let abandoned = false;

  let done = 0;
  // Counted by class, because "24 failed" says nothing about whether the run
  // is worth keeping. Rate-limit refusals mean thin coverage that a re-run can
  // recover; a bad query means the source is broken and re-running will not.
  const failures = new Map<string, number>();
  const fresh: Slice[] = [];

  let month = '';
  let monthCount = 0;
  const flushMonth = () => {
    if (!month) return;
    const pct = Math.round((done / calls) * 100);
    console.log(`  ${month}  ${String(monthCount).padStart(4)} items   `
              + `[${done}/${calls}, ${pct}%]`);
  };

  for (const { w, month: m, source } of batch) {
    if (m !== month) { flushMonth(); month = m; monthCount = 0; }

    try {
      const raw = await fetchGdelt(source.url, {
        startDateTime: stamp(w.start),
        endDateTime: stamp(w.end),
        maxRecords: MAX_RECORDS,
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

      // A response at exactly the cap means GDELT had more to give. Recorded so
      // a later pass can split that month, rather than quietly under-reporting.
      fresh.push({
        month: m,
        sourceId: source.id,
        items: raw.length,
        truncated: raw.length >= MAX_RECORDS,
        collectedAt: new Date().toISOString(),
      });

      monthCount += raw.length;
      ok++;
      consecutiveFailures = 0;
    } catch (err) {
      failed++;
      const kind = isRateLimited(err) ? 'rate-limited' : 'other';
      failures.set(kind, (failures.get(kind) ?? 0) + 1);
      console.log(`  ${m}  ${source.id}: ${(err as Error).message.slice(0, 90)}`);
      consecutiveFailures++;
    } finally {
      done++;
    }

    if (consecutiveFailures >= GIVE_UP_AFTER) {
      abandoned = true;
      flushMonth();
      month = '';
      console.log(
        `\nStopping: ${consecutiveFailures} requests in a row were refused.`
        + `\nGDELT is not answering us any more, and the rest would fail the same`
        + `\nway. Everything collected so far is kept, including in the state file,`
        + `\nso the next run picks up exactly where this one gave up.`);
      break;
    }
  }
  flushMonth();

  // Saved even on a bad run: the slices that did land are progress, and losing
  // them would mean the next run repeats them.
  const state = mergeState(previous, fresh);
  if (!dryRun) saveState(STATE_PATH, state);

  const all = dedupe(collected);
  // Same rule as the daily run: only AI-in-banking is kept. Three years of
  // unfiltered GDELT would bury the signal completely.
  const articles = all.filter((a) => a.classification.relevanceScore > 0);

  const rateLimited = failures.get('rate-limited') ?? 0;
  const attempted = ok + failed;
  const stillMissing = missingMonths(state, allMonths);
  const truncated = state.slices.filter((sl) => sl.truncated).length;

  // Month coverage first. The request rate was the alarming number on the last
  // run — 28% — and the one that mattered was 84%: three queries cover each
  // month, so a month survives if any one of them lands.
  console.log(
    `\nMonths covered: ${allMonths.length - stillMissing.length}/${allMonths.length}`
    + `   (this run: ${ok}/${attempted} requests, `
    + `overall ${state.slices.length}/${windows.length * sources.length} slices)`);

  if (failed > 0) {
    console.log(`  refused: ${rateLimited}   other failures: ${failures.get('other') ?? 0}`);
  }
  if (truncated > 0) {
    console.log(`  ${truncated} slice(s) hit the ${MAX_RECORDS}-record cap, so those months `
              + `are partial.`);
  }

  if (stillMissing.length > 0) {
    console.log(`\nStill empty: ${stillMissing.join(', ')}`);
    console.log(
      'Run this again to fill them. It now skips what is already collected, so'
      + '\neach run is progress rather than a repeat — and nothing is duplicated,'
      + '\nbecause articles are keyed on their canonical URL.');
  } else {
    console.log('\nEvery month in the window has coverage.');
  }

  // A blocked run collects nothing, and the snapshot filename is per-day — so
  // writing it anyway would replace a good morning run with an empty evening
  // one. Nothing collected, nothing written.
  if (articles.length === 0) {
    console.log('\nNo articles collected, so no snapshot was written.');
    return abandoned || ok === 0 ? 1 : 0;
  }

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
