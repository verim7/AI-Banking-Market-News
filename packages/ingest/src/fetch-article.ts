import { stripHtml } from './normalize.ts';
import { UA } from './fetch-rss.ts';

/**
 * The article's own words.
 *
 * Feeds do not carry them. Measured across a real day's collection: not one of
 * 159 stored articles had an excerpt, and the median stored body was 87
 * characters — usually the headline repeated with the publisher appended. Every
 * judgement the classifier made, and every use case it quoted, came from a
 * headline.
 *
 * So the body is fetched from the page. That is the difference between a table
 * that says an article exists and one that says what the bank actually did.
 *
 * Politeness: one request per article, only for articles that already passed
 * the relevance gate, and only once — the excerpt is stored, so a second run
 * does not re-fetch. Failure is always null and never throws: a publisher that
 * blocks us costs one article its depth, not the run.
 */

/** Matches `articles.excerpt`, which is what this fills. */
export const MAX_BODY_CHARS = 4000;

/** Anything below this is a cookie wall or a stub, not an article. */
const MIN_USEFUL_CHARS = 200;

const STRIP_BLOCKS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside',
  'form', 'button', 'figure', 'iframe', 'svg',
];

/**
 * The main text, preferring the element that claims to hold it.
 *
 * `<article>` and `<main>` are the semantic answer and are common enough to be
 * worth trying first: taking the whole body instead drags in the nav, the
 * cookie banner, the newsletter pitch and the "most read" sidebar, and those
 * carry banking vocabulary that would then be read as this article's.
 */
export function extractBody(html: string): string | null {
  let text = html;

  for (const tag of STRIP_BLOCKS) {
    text = text.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }

  const container =
    text.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? text;

  // Paragraph boundaries become sentence boundaries, or headings run into the
  // sentence below them and the summariser quotes a fused non-sentence.
  const spaced = container.replace(/<\/(p|div|li|h[1-6]|br)\s*>/gi, '. ');

  const body = stripHtml(spaced)
    .replace(/\s*\.\s*(\.\s*)+/g, '. ')
    .trim();

  if (body.length < MIN_USEFUL_CHARS) return null;
  return body.slice(0, MAX_BODY_CHARS);
}

/** True for a response we can read as an article page. */
export function isHtmlResponse(contentType: string | null): boolean {
  if (!contentType) return false;
  return /text\/html|application\/xhtml/i.test(contentType);
}

/**
 * Why a read failed, so a low rate can be diagnosed instead of guessed at.
 *
 * The first production run read 3 of 332 pages and the log said only "1%".
 * That number cannot be acted on: a 403 wall, a redirect that never leaves the
 * aggregator and a page of pure JavaScript all look identical from outside,
 * and they need completely different fixes.
 */
export type FailureReason =
  | 'http-error' | 'not-html' | 'too-short' | 'network' | 'still-aggregator';

export interface ReadResult {
  body: string | null;
  reason?: FailureReason;
  /** Status or host, whichever explains the failure. Kept short for logging. */
  detail?: string;
}

const AGGREGATOR_HOSTS = /(^|\.)news\.google\.com$/i;

/**
 * The publisher URL hidden inside a Google News interstitial.
 *
 * Google no longer encodes the destination in the link — the CBMi… token is an
 * opaque server-side identifier, and base64-decoding 322 real links from a
 * day's collection yielded a URL for none of them. What the interstitial page
 * does still carry is the destination, in a data attribute or an anchor, so it
 * is read from the HTML rather than from the token.
 */
export function destinationFrom(html: string): string | null {
  const patterns = [
    /data-n-au="([^"]+)"/i,
    /<c-wiz[^>]*data-p="[^"]*?(https?:\/\/[^"\\]+)/i,
    /rel="canonical"[^>]*href="(https?:\/\/[^"]+)"/i,
    /<a[^>]+href="(https?:\/\/(?!news\.google\.com)[^"]+)"[^>]*>\s*(?:Continue|Read)/i,
  ];
  for (const re of patterns) {
    const found = html.match(re)?.[1];
    if (found && !/news\.google\.com/i.test(found)) return decodeEntities(found);
  }
  return null;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

async function get(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en,de;q=0.8,fr;q=0.7',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readArticle(
  url: string, timeoutMs = 15_000, depth = 0,
): Promise<ReadResult> {
  try {
    const res = await get(url, timeoutMs);

    if (!res.ok) return { body: null, reason: 'http-error', detail: String(res.status) };
    if (!isHtmlResponse(res.headers.get('content-type'))) {
      return { body: null, reason: 'not-html',
               detail: (res.headers.get('content-type') ?? 'none').slice(0, 40) };
    }

    const html = await res.text();

    // Still on the aggregator: redirect following does not run the JavaScript
    // that actually leaves it, so the destination has to be read out and
    // followed once. Once only — a second hop that lands back here is a loop.
    if (AGGREGATOR_HOSTS.test(new URL(res.url || url).hostname)) {
      const destination = depth === 0 ? destinationFrom(html) : null;
      if (!destination) {
        return { body: null, reason: 'still-aggregator',
                 detail: new URL(res.url || url).hostname };
      }
      return readArticle(destination, timeoutMs, depth + 1);
    }

    const body = extractBody(html);
    if (!body) {
      return { body: null, reason: 'too-short',
               detail: new URL(res.url || url).hostname };
    }
    return { body };
  } catch (err) {
    return { body: null, reason: 'network',
             detail: (err as Error)?.name === 'AbortError' ? 'timeout' : 'failed' };
  }
}

export async function fetchArticleText(
  url: string, timeoutMs = 15_000,
): Promise<string | null> {
  return (await readArticle(url, timeoutMs)).body;
}

/** What a body-fetching pass achieved, for the run summary. */
export interface BodyReport {
  attempted: number;
  fetched: number;
  chars: number;
  /** Failures by reason, and by host within the dominant reason. */
  reasons: Record<string, number>;
  hosts: Record<string, number>;
}

/** The breakdown as a line a reader can act on. */
export function describeFailures(r: BodyReport): string[] {
  const lines: string[] = [];
  const ranked = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]);
  for (const [reason, n] of ranked) {
    const pct = r.attempted ? Math.round((n / r.attempted) * 100) : 0;
    lines.push(`    ${String(n).padStart(4)} (${pct}%)  ${reason}`);
  }
  const hosts = Object.entries(r.hosts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (hosts.length > 0) {
    lines.push(`    refused by: ${hosts.map(([h, n]) => `${h} (${n})`).join(', ')}`);
  }
  return lines;
}

/**
 * Fetch bodies for many articles with bounded concurrency.
 *
 * Six at a time matches the source fetcher. Higher would finish sooner and look
 * a great deal more like something to block.
 */
export async function fetchBodies<T>(
  items: T[],
  // The URL is read rather than assumed: articles carry urlOriginal (the link
  // the feed gave, including the Google News redirect that has to be followed
  // to reach the publisher at all) and urlCanonical, and only the caller knows
  // which one should be fetched.
  urlOf: (item: T) => string,
  onBody: (item: T, body: string) => void,
  opts: { concurrency?: number } = {},
): Promise<BodyReport> {
  const report: BodyReport = {
    attempted: 0, fetched: 0, chars: 0, reasons: {}, hosts: {},
  };
  const queue = [...items];
  const concurrency = opts.concurrency ?? 6;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      report.attempted += 1;

      const result = await readArticle(urlOf(item));
      if (result.body) {
        report.fetched += 1;
        report.chars += result.body.length;
        onBody(item, result.body);
      } else if (result.reason) {
        report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
        if (result.detail && result.detail.includes('.')) {
          report.hosts[result.detail] = (report.hosts[result.detail] ?? 0) + 1;
        }
      }
    }
  }));

  return report;
}
