#!/usr/bin/env node
/**
 * Swiss banks' own AI history, back to January 2024.
 *
 *   npm run swiss-backfill -- --max-requests 300
 *   npm run swiss-backfill -- --max-requests 20 --dry-run
 *
 * The daily sources are mostly English and global, and collection only began
 * in July 2026, so "which Swiss bank runs a language model in production" was
 * answerable only from whatever happened to reach an English trade title in
 * the last few months. Swiss banks announce in German and French, in the Swiss
 * press, and often only there.
 *
 * So this asks Google News directly, one bank at a time: the bank's name plus
 * AI vocabulary in three languages, restricted to a date window with Google's
 * after:/before: operators, in the Swiss German and Swiss French editions —
 * and the US English edition for the banks the international press follows.
 * A Google News search returns at most about a hundred items, so UBS gets
 * month windows and everyone else half-years; few cantonal banks produce a
 * hundred AI headlines in six months.
 *
 * Every request is recorded in data/swiss-backfill-state.json, so a run that
 * stops at --max-requests resumes at the next unasked slice when pressed again.
 * Articles go through the same gate, body reading and story dedupe as the daily
 * run, and are graded afterwards like any other.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, SWISS_INSTITUTIONS, type ClassifiedArticle, type SwissInstitution } from '@portal/shared';
import type { SourceConfig } from './sources.ts';
import { fetchRss } from './fetch-rss.ts';
import { dedupe, hostOf, normalize } from './normalize.ts';
import { fetchBodies } from './fetch-article.ts';
import { resolveUrls } from './resolve-url.ts';
import {
  credentialsFromEnv, existingUrls, load, recentTitleKeys, type RunSummary,
} from './load-d1.ts';
import { collectedKeys, loadState, mergeState, saveState, sliceKey, type Slice } from './state.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE_PATH = resolve(REPO_ROOT, 'data/swiss-backfill-state.json');

export const SOURCE: SourceConfig = {
  id: 'gnews_swiss_backfill',
  name: 'Google News — Swiss banks backfill',
  url: 'https://news.google.com/rss/search',
  kind: 'rss',
  publisher_kind: 'media',
  enabled: true,
  backfill: true,
  daily: false,
};

export type Edition = 'de' | 'fr' | 'en';

const EDITION_PARAMS: Record<Edition, string> = {
  de: 'hl=de&gl=CH&ceid=CH%3Ade',
  fr: 'hl=fr&gl=CH&ceid=CH%3Afr',
  en: 'hl=en-US&gl=US&ceid=US%3Aen',
};

/** AI vocabulary in German, French and English, as one OR group. */
const AI_TERMS = [
  'KI', '"künstliche Intelligenz"', '"generative KI"', 'GenAI', 'LLM', 'ChatGPT',
  'Copilot', 'Chatbot', '"intelligence artificielle"', '"IA générative"', 'AI',
];

/** Kinds that are banks. Authorities and market infrastructure are not asked about. */
const BANK_KINDS = new Set(['big_bank', 'cantonal', 'private', 'retail', 'digital', 'crypto']);
/** Kinds the international press covers, so the English edition is worth asking too. */
const ENGLISH_KINDS = new Set(['big_bank', 'private', 'digital', 'crypto']);
/** Merged into UBS in 2023; its AI history before that is not what is being asked. */
const SKIP = new Set(['Credit Suisse']);

export function banks(all: readonly SwissInstitution[] = SWISS_INSTITUTIONS): SwissInstitution[] {
  return all.filter((i) => BANK_KINDS.has(i.kind) && !SKIP.has(i.name));
}

export interface Window { label: string; after: string; before: string }

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Date windows from January 2024 to `now`, oldest first. `before:` is
 * exclusive and `after:` inclusive in practice, so consecutive windows share a
 * boundary date rather than leaving one out.
 */
export function windows(size: 'month' | 'half', now = new Date()): Window[] {
  const out: Window[] = [];
  const step = size === 'month' ? 1 : 6;
  for (let cursor = new Date(Date.UTC(2024, 0, 1)); cursor < now;) {
    const start = cursor;
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, 1));
    const label = size === 'month'
      ? ymd(start).slice(0, 7)
      : `${start.getUTCFullYear()}H${start.getUTCMonth() < 6 ? 1 : 2}`;
    // A day before the start, because `after:` drops items dated on that day.
    const after = new Date(start.getTime() - 86_400_000);
    out.push({ label, after: ymd(after), before: ymd(end) });
    cursor = end;
  }
  return out;
}

/** The quoted name, plus a short alias when the name alone is ambiguous or long. */
export function nameClause(bank: SwissInstitution): string {
  const names = [bank.name, ...bank.terms.filter((t) => /^[a-z]{2,5}$/.test(t) && t !== bank.name.toLowerCase())
    .map((t) => t.toUpperCase())];
  const unique = [...new Set(names)];
  const quoted = unique.map((n) => `"${n}"`);
  return quoted.length === 1 ? quoted[0]! : `(${quoted.join(' OR ')})`;
}

export function queryUrl(bank: SwissInstitution, w: Window, edition: Edition): string {
  const q = `${nameClause(bank)} (${AI_TERMS.join(' OR ')}) after:${w.after} before:${w.before}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${EDITION_PARAMS[edition]}`;
}

export interface Request { key: string; window: string; url: string; bank: string }

/** Every request the backfill would make, oldest window first so a partial run is still a timeline. */
export function plan(now = new Date(), all: readonly SwissInstitution[] = SWISS_INSTITUTIONS): Request[] {
  const out: Request[] = [];
  for (const bank of banks(all)) {
    const editions: Edition[] = ENGLISH_KINDS.has(bank.kind) ? ['de', 'fr', 'en'] : ['de', 'fr'];
    const size = bank.kind === 'big_bank' ? 'month' : 'half';
    for (const w of windows(size, now)) {
      for (const e of editions) {
        out.push({ key: `${bank.name}|${e}`, window: w.label, url: queryUrl(bank, w, e), bank: bank.name });
      }
    }
  }
  return out.sort((a, b) => a.window.slice(0, 4).localeCompare(b.window.slice(0, 4)));
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  const maxRequests = Number(arg('--max-requests') ?? 300);
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    console.error('--max-requests must be a positive number.');
    return 1;
  }

  const startedAt = new Date().toISOString();
  const state = loadState(STATE_PATH);
  const done = collectedKeys(state);
  const all = plan();
  const pending = all.filter((r) => !done.has(sliceKey(r.window, r.key)));
  const batch = pending.slice(0, maxRequests);
  console.log(`${banks().length} banks, ${all.length} requests in total, `
            + `${pending.length} not yet asked; asking ${batch.length} now.`);

  const collected: ClassifiedArticle[] = [];
  const slices: Slice[] = [];
  let failed = 0;

  for (const [n, r] of batch.entries()) {
    try {
      // A search with no hits comes back as a valid feed with no items, which
      // fetchRss reports as an error. Here that is an answer: nothing to find.
      const raw = await fetchRss(r.url).catch((err: Error) => {
        if (/no <item> or <entry> elements/.test(err.message)) return [];
        throw err;
      });
      for (const item of raw) {
        const a = normalize(item, { id: SOURCE.id, name: SOURCE.name, publisherKind: SOURCE.publisher_kind });
        if (!a) continue;
        const classification = classify({
          title: a.title, summary: a.summary, excerpt: a.excerpt,
          publisherKind: a.publisherKind, publishedAt: a.publishedAt, regionHint: null,
        });
        collected.push({ ...a, classification });
      }
      slices.push({ month: r.window, sourceId: r.key, items: raw.length,
                    truncated: raw.length >= 100, collectedAt: startedAt });
      console.log(`  ${String(n + 1).padStart(4)}  ${r.window}  ${r.key.padEnd(40)} ${raw.length}`);
    } catch (err) {
      failed += 1;
      console.log(`  ${String(n + 1).padStart(4)}  ${r.window}  ${r.key.padEnd(40)} FAIL ${(err as Error).message.slice(0, 120)}`);
      // Five in a row is Google refusing, not five bad queries: stop and keep what landed.
      if (failed >= 5 && slices.length === 0) break;
    }
    await pause(1500);
  }

  const unique = dedupe(collected);
  let articles = unique.filter((a) => a.classification.relevanceScore > 0);
  console.log(`\n${collected.length} items, ${articles.length} about AI in banking after dedupe.`);
  if (dryRun) {
    // The searches already ask for a Swiss bank and AI, so what the gate turns
    // away here is worth reading: it shows where the rules lack German or French.
    const turned = unique.filter((a) => a.classification.relevanceScore === 0);
    console.log(`Turned away by the gate (${turned.length}), first 40:`);
    for (const a of turned.slice(0, 40)) console.log(`  x ${a.title}`);
  }

  if (articles.length > 0) {
    const aggregated = articles.filter((a) => hostOf(a.urlOriginal) === 'news.google.com');
    const resolved = await resolveUrls(
      aggregated, (a) => a.publisherHost ?? null, (a) => a.title,
      (article, url) => { article.urlOriginal = url; },
    );
    console.log(`  recovered real links for ${resolved.recovered}/${resolved.unresolved}.`);

    const readable = articles.filter((a) => hostOf(a.urlOriginal) !== 'news.google.com');
    const bodies = await fetchBodies(readable, (a) => a.urlOriginal, (a, body) => { a.excerpt = body; });
    console.log(`  read ${bodies.fetched}/${bodies.attempted} article pages.`);

    for (const a of articles) {
      if (!a.excerpt) continue;
      a.classification = classify({
        title: a.title, summary: a.summary, excerpt: a.excerpt,
        publisherKind: a.publisherKind, publishedAt: a.publishedAt, regionHint: null,
      });
    }
    articles = articles.filter((a) => a.classification.relevanceScore > 0);
  }

  const swiss = articles.filter((a) => a.classification.chNexus !== null);
  console.log(`${articles.length} kept, ${swiss.length} with a Swiss nexus.`);

  const creds = credentialsFromEnv();
  if (dryRun || !creds) {
    console.log(dryRun ? '\n--dry-run: nothing written, state unchanged.'
      : '\nD1 credentials not set — nothing written, state unchanged.');
    for (const a of swiss.slice(0, 30)) console.log(`  ${a.publishedAt?.slice(0, 10)}  ${a.title}`);
    return 0;
  }

  articles = dedupe(articles, {
    knownTitleKeys: await recentTitleKeys(creds),
    processOf: (a) => a.classification.tags.find((t) => t.dimension === 'l1_process')?.value ?? null,
  });
  const before = await existingUrls(creds, articles.map((a) => a.urlCanonical));
  const itemsNew = articles.filter((a) => !before.has(a.urlCanonical)).length;
  const run: RunSummary = {
    id: randomUUID(), startedAt, finishedAt: new Date().toISOString(),
    status: failed === 0 ? 'ok' : slices.length === 0 ? 'failed' : 'partial',
    itemsFetched: collected.length, itemsNew, sourcesOk: slices.length, sourcesFailed: failed,
    detail: { swissBackfill: { asked: batch.length, remaining: pending.length - slices.length } },
  };
  await load(creds, [SOURCE], articles, run);
  saveState(STATE_PATH, mergeState(state, slices));
  console.log(`\nWrote ${articles.length} articles (${itemsNew} new). `
            + `${pending.length - slices.length} requests left for the next run.`);
  return slices.length === 0 && batch.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith('swiss-backfill.ts')) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('Swiss backfill failed:', err);
    process.exit(1);
  });
}
