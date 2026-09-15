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

  const body = dropChrome(
    stripHtml(spaced)
      .replace(/\s*\.\s*(\.\s*)+/g, '. ')
      .trim());

  if (body.length < MIN_USEFUL_CHARS) return null;
  return body.slice(0, MAX_BODY_CHARS);
}

/** Navigation phrases that only ever appear in page chrome. */
const CHROME_PHRASES = [
  'skip to content', 'skip to main', 'you are at', 'share this', 'follow us',
  'add as a preferred source', 'add bt as a preferred source', 'read in app',
  'sign up for', 'subscribe to our', 'cookie', 'newsletter signup',
];

/**
 * Remove the navigation the extractor could not tell from prose.
 *
 * Real captured bodies in this corpus began "Skip to content YOU ARE AT: Home »"
 * and ". Home . Finance . People . Fintech . High-End . finews first . EAM/MFO",
 * and one carried a raw onclick= attribute. The classifier reads all of it as
 * article text, so a menu of section names became evidence about the article.
 *
 * Two passes, because the chrome takes two forms: named phrases that only occur
 * in navigation, and runs of very short fragments, which is what a menu looks
 * like once every tag has become a full stop.
 */
export function dropChrome(text: string): string {
  // Any residue of an HTML attribute is chrome by definition: prose does not
  // contain onclick= or window.open.
  let out = text.replace(/\bon[a-z]+="[^"]*"/gi, ' ')
                .replace(/window\.open\([^)]*\)/gi, ' ');

  const parts = out.split('.').map((p) => p.trim());
  const words = (p: string) => p.split(/\s+/).filter(Boolean).length;
  const isChrome = (p: string) => {
    const lower = p.toLowerCase();
    return CHROME_PHRASES.some((c) => lower.includes(c));
  };

  // A menu item is one or two words — "Home", "Real Assets", "EAM/MFO". Prose
  // is not. An earlier threshold of five words swallowed the heading "AI at the
  // bank" and then an entire body written in short sentences, which is the
  // failure worth guarding against: losing the article is far worse than
  // keeping a menu.
  //
  // Three in a row before anything is dropped, so an article's own two-word
  // heading survives.
  let run = 0;
  while (run < parts.length && words(parts[run]!) <= 2) run += 1;
  let start = run >= 3 ? run : 0;

  // Named navigation phrases go whatever the run length: "Skip to content"
  // never appears in prose.
  while (start < parts.length && isChrome(parts[start]!)) start += 1;

  // All chrome and no article: return the original rather than nothing, so a
  // page this heuristic misreads still reaches the classifier instead of
  // vanishing from the corpus.
  if (start >= parts.length) return text;

  return parts.slice(start).join('. ').replace(/\s+/g, ' ').trim();
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
  /**
   * The page's markup, on success.
   *
   * Carried back so a caller that also needs the headline or the date can read
   * them from the same response. The alternative is a second request for a page
   * already fetched, which doubles the load on the publisher to learn something
   * that was in hand the first time.
   */
  html?: string;
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

/**
 * HTML entities, decoded.
 *
 * Started as three replacements for the Google News redirect, which only ever
 * needed `&amp;` and a slash. Reading headlines off pages needed the rest: the
 * first real run stored "Switzerland&#039;s Sygnum Bank" — an apostrophe as a
 * numeric entity, in the one field the fold, the search and every review record
 * key on.
 *
 * Numeric forms are handled generically because a publisher can emit any code
 * point; the named ones are the handful that actually appear in headlines.
 * Ampersand is decoded last, so "&amp;#039;" resolves to "&#039;" and not to an
 * apostrophe — decoding it first would let one escape become two.
 */
const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', amp: '&',
};

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match);

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
    return { body, html };
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

/* ------------------------------------------------- reading a page's identity */

/**
 * The headline and the date, from the page itself.
 *
 * A feed hands over a title and a timestamp. A bare URL does not, so anything
 * seeded by hand has to read them off the page — and it has to read them rather
 * than infer them, because an article stored under a guessed headline is worse
 * than one not stored at all: it is wrong in the one field every fold, every
 * search and every review record keys on.
 *
 * Order of preference, and the reason for it:
 *
 *  - `og:title` first. It is what the publisher chose for the story when it is
 *    shared, so it carries the headline without the " | Publisher Name" that
 *    `<title>` usually appends.
 *  - `<title>` as the fallback, trimmed at a trailing separator when the
 *    publisher's own name follows one.
 *  - `article:published_time` then JSON-LD `datePublished` for the date. Both
 *    are machine-readable fields the publisher wrote deliberately; a date
 *    scraped out of prose is a guess about a format, and a wrong date puts a
 *    story in the wrong week.
 *
 * Null title means the caller must skip the URL. Null date is survivable —
 * `normalize()` already handles an article with no publication date.
 */
export interface ArticleMeta {
  title: string | null;
  publishedAt: string | null;
}

const META_CONTENT = (html: string, patterns: RegExp[]): string | null => {
  for (const re of patterns) {
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return null;
};

/** " Headline | Publisher" and " Headline - Publisher" lose the tail. */
function trimPublisher(title: string): string {
  // Only at the end, only around a spaced separator, and only when what follows
  // is short. "AI vs AI: banks - what next" must survive; "Headline | Finextra"
  // must not keep its tail.
  const m = title.match(/^(.{20,})\s+[|\u2013\u2014-]\s+([^|\u2013\u2014-]{2,30})$/);
  return m ? m[1]!.trim() : title.trim();
}

export function readArticleMeta(html: string): ArticleMeta {
  const title =
    META_CONTENT(html, [
      /<meta[^>]+property=["']og:title["'][^>]*>/i,
      /<meta[^>]+name=["']og:title["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:title["'][^>]*>/i,
    ])
    ?? (() => {
      const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      return raw ? trimPublisher(decodeEntities(stripHtml(raw))) : null;
    })();

  const published =
    META_CONTENT(html, [
      /<meta[^>]+property=["']article:published_time["'][^>]*>/i,
      /<meta[^>]+name=["']article:published_time["'][^>]*>/i,
      /<meta[^>]+name=["']date["'][^>]*>/i,
    ])
    // JSON-LD, read with a regex rather than parsed: a page can carry several
    // blocks, some of them malformed, and one bad block must not cost the date.
    ?? html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]
    ?? null;

  const when = published ? new Date(published) : null;

  return {
    title: title?.trim() || null,
    publishedAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
  };
}

/* ------------------------------------------------------------- the archive */

/**
 * The same page, as the Internet Archive saw it.
 *
 * Used only when the live page will not give up its text: a 403 from a bot
 * wall, or markup that extracts to nothing because the article is assembled by
 * JavaScript. The Wayback Machine holds a public snapshot of a public page,
 * taken by an archive that publishers have long known about — so nothing here
 * defeats an access control, spoofs an identity or evades a paywall, which is
 * the line docs/content-sourcing.md draws and this stays on the right side of.
 *
 * Keyless and free, which is the standing constraint on every route this
 * project adds. No snapshot is a normal answer, not an error.
 */
export async function fromWayback(
  url: string, timeoutMs = 15_000,
): Promise<ReadResult> {
  try {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const res = await get(api, timeoutMs);
    if (!res.ok) return { body: null, reason: 'http-error', detail: `wayback ${res.status}` };

    const data = await res.json() as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } };
    };
    const snapshot = data.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot.url) {
      return { body: null, reason: 'too-short', detail: 'no snapshot' };
    }

    // https, because the API still hands back http for older captures and the
    // redirect costs a round trip.
    return await readArticle(snapshot.url.replace(/^http:/, 'https:'), timeoutMs);
  } catch (err) {
    return { body: null, reason: 'network',
             detail: (err as Error)?.name === 'AbortError' ? 'timeout' : 'wayback failed' };
  }
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
