import type { RawItem } from './normalize.ts';

/**
 * An honest, identifying User-Agent — deliberately NOT the browser string the
 * RSS fetcher uses.
 *
 * That browser string exists because some publishers serve feeds to browsers
 * and 403 anything else. GDELT is the opposite case: it is a free API that
 * asks to be told who is calling, and a Chrome User-Agent making hundreds of
 * sequential API requests looks precisely like scraping. Sharing one User-Agent
 * across both fetchers was a mistake that turned roughly half the backfill's
 * requests into 403s.
 */
const UA = 'ai-banking-market-news/1.0 (+https://github.com/verim7/AI-Banking-Market-News)';

/**
 * GDELT rate-limits per client, not per query, so every call is serialised
 * process-wide and spaced.
 *
 * The spacing adapts rather than being a fixed guess. A constant gap is either
 * too fast — and half the run is refused — or too slow, and a three-year
 * backfill takes hours it did not need. So the gap widens whenever GDELT
 * pushes back and narrows again after a run of clean responses, settling near
 * whatever the service is actually willing to serve today.
 */
const MIN_GAP_MS = 5_000;
const MAX_GAP_MS = 30_000;

let currentGap = MIN_GAP_MS;
let cleanRun = 0;

/**
 * Consecutive refusals. Past a handful, retrying is not optimism — it is
 * waiting 80 seconds per request to be told no again. A fully blocked backfill
 * spends nearly all its time inside those waits, which would have made giving
 * up take twenty minutes rather than two.
 */
let refusalStreak = 0;
const STOP_RETRYING_AFTER = 6;

/**
 * Multiplier on every wait. Production leaves it at 1; tests set it tiny so the
 * real widen/give-up logic runs without real pauses. Scaling the clock keeps
 * the code under test identical to the code that ships — the alternative,
 * asserting only on the pure arithmetic, would leave the serialiser untested.
 */
let pacingScale = 1;

let gdeltChain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Has GDELT told us to back off?
 *
 * It escalates: 429 first, then 403, and finally it stops completing the
 * connection at all — which surfaces as a bare "fetch failed" with no status.
 * That last form was the majority of failures in a two-year backfill, and
 * matching only on status codes made the worst state the one the back-off
 * logic could not see: the gap never widened and pointless retries continued.
 *
 * A connection failure could also be an ordinary network blip. Backing off is
 * the right response either way, so the ambiguity costs nothing.
 */
export const isRateLimited = (err: unknown): boolean =>
  /\b429\b|Too Many Requests|\b403\b|Forbidden/i.test(String(err))
  || /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|network|aborted/i.test(String(err));

/** Widen hard on pushback; recover slowly, so one bad patch does not stick. */
export function nextGap(gap: number, pushedBack: boolean, consecutiveClean: number): number {
  if (pushedBack) return Math.min(Math.round(gap * 1.6), MAX_GAP_MS);
  if (consecutiveClean >= 5) return Math.max(Math.round(gap * 0.85), MIN_GAP_MS);
  return gap;
}

/**
 * Record one request's outcome and re-pace accordingly.
 *
 * Split out of the serialiser so the back-off state machine can be tested
 * without a network. The previous test drove it through real fetchGdelt calls
 * and passed only because the authoring sandbox cannot reach GDELT — every
 * call failed instantly at the connection. On CI, where GDELT is reachable,
 * the same test made six real rate-limited requests and timed out. A test that
 * needs the network to be broken is not a test of this code.
 */
export function noteOutcome(pushedBack: boolean): void {
  if (pushedBack) {
    cleanRun = 0;
    refusalStreak++;
    currentGap = nextGap(currentGap, true, 0);
  } else {
    cleanRun++;
    refusalStreak = 0;
    currentGap = nextGap(currentGap, false, cleanRun);
  }
}

/** How the spacing ended up, for the run summary. */
export const gapReport = (): { gapSeconds: number; blocked: boolean } =>
  ({ gapSeconds: currentGap / 1000, blocked: refusalStreak >= STOP_RETRYING_AFTER });

/** Test seam: reset the module-level rate-limit state between cases. */
export function resetGdeltState(opts: { pacingScale?: number } = {}): void {
  currentGap = MIN_GAP_MS;
  cleanRun = 0;
  refusalStreak = 0;
  lastCallAt = 0;
  pacingScale = opts.pacingScale ?? 1;
}

function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const result = gdeltChain.then(async () => {
    const wait = (currentGap - (Date.now() - lastCallAt)) * pacingScale;
    if (wait > 0) await sleep(wait);
    try {
      const value = await fn();
      noteOutcome(false);
      return value;
    } catch (err) {
      if (isRateLimited(err)) noteOutcome(true);
      throw err;
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
export interface GdeltOptions {
  timespan?: string;
  /** Absolute window, YYYYMMDDHHMMSS. Overrides timespan — used by the backfill. */
  startDateTime?: string;
  endDateTime?: string;
  maxRecords?: number;
  timeoutMs?: number;
  /** Waits between retries. Overridable so tests need not really wait. */
  retryWaitsMs?: number[];
}

export function fetchGdelt(
  query: string,
  opts: GdeltOptions = {},
): Promise<RawItem[]> {
  // Retries sit outside the serialiser so each attempt re-enters the queue and
  // picks up the widened gap, rather than hammering through it.
  return (async () => {
    const waits = opts.retryWaitsMs ?? [20_000, 60_000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await serialised(() => fetchGdeltOnce(query, opts));
      } catch (err) {
        // Only pushback is worth waiting out; a malformed query never improves.
        if (!isRateLimited(err) || attempt >= waits.length) throw err;
        // And once we are plainly blocked, a retry is only a slower refusal.
        if (refusalStreak >= STOP_RETRYING_AFTER) throw err;
        await sleep(waits[attempt]! * pacingScale);
      }
    }
  })();
}

async function fetchGdeltOnce(query: string, opts: GdeltOptions = {}): Promise<RawItem[]> {
  const { timespan = '2d', maxRecords = 75, timeoutMs = 25_000,
          startDateTime, endDateTime } = opts;

  const url = new URL(ENDPOINT);
  url.searchParams.set('query', `${query} sourcelang:english`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(maxRecords));
  // An absolute window and a relative timespan are mutually exclusive; GDELT
  // ignores the pair silently and returns the wrong period, so send only one.
  if (startDateTime && endDateTime) {
    url.searchParams.set('startdatetime', startDateTime);
    url.searchParams.set('enddatetime', endDateTime);
  } else {
    url.searchParams.set('timespan', timespan);
  }
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
