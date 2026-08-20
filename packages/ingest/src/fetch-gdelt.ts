import type { RawItem } from './normalize.ts';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
         + 'Chrome/130.0.0.0 Safari/537.36 ai-banking-market-news/1.0 '
         + '(+https://github.com/verim7/AI-Banking-Market-News)';

/**
 * GDELT rate-limits aggressively and per-client, not per-query. Running the
 * queries inside the ingest job's six-way pool meant they fired simultaneously
 * and both were refused — one with 429, the other with a dropped connection.
 *
 * This gate serialises every GDELT call process-wide and spaces them, so
 * adding more GDELT sources cannot reintroduce the problem.
 */
const MIN_GAP_MS = 5_000;
let gdeltChain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const result = gdeltChain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastCallAt = Date.now();
    }
  });
  // Keep the chain alive even when a call rejects, or one failure stalls the rest.
  gdeltChain = result.catch(() => undefined);
  return result;
}
const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

/** GDELT stamps dates as YYYYMMDDTHHMMSSZ, which Date.parse rejects. */
export function parseGdeltDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim());
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const [, y, mo, d, h, mi, sec] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}.000Z`;
}

/**
 * GDELT is free and needs no key, but it is rate-limited and answers with HTML
 * error pages rather than status codes when it is unhappy — so the JSON parse
 * is guarded and a bad response is reported as a source failure, not a crash.
 */
export function fetchGdelt(
  query: string,
  opts: { timespan?: string; maxRecords?: number; timeoutMs?: number } = {},
): Promise<RawItem[]> {
  return serialised(async () => {
    try {
      return await fetchGdeltOnce(query, opts);
    } catch (err) {
      // One retry, and only for the failure that a longer wait actually fixes.
      if (!/429|Too Many Requests/i.test(String(err))) throw err;
      await sleep(15_000);
      return fetchGdeltOnce(query, opts);
    }
  });
}

async function fetchGdeltOnce(
  query: string,
  opts: { timespan?: string; maxRecords?: number; timeoutMs?: number } = {},
): Promise<RawItem[]> {
  const { timespan = '2d', maxRecords = 75, timeoutMs = 25_000 } = opts;

  const url = new URL(ENDPOINT);
  url.searchParams.set('query', `${query} sourcelang:english`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(maxRecords));
  url.searchParams.set('timespan', timespan);
  url.searchParams.set('sort', 'datedesc');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let raw: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    raw = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let parsed: { articles?: GdeltArticle[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`GDELT returned non-JSON (${raw.slice(0, 120).replace(/\s+/g, ' ')})`);
  }

  return (parsed.articles ?? [])
    .filter((a) => a.url && a.title)
    .map((a) => ({
      title: a.title!,
      link: a.url!,
      description: null,
      content: null,
      pubDate: parseGdeltDate(a.seendate),
      language: a.language ?? null,
    }));
}
