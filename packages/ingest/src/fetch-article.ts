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

export async function fetchArticleText(
  url: string, timeoutMs = 15_000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Follows the opaque news.google.com/rss/articles/... link through to the
      // publisher, which is the only way to read an aggregated article at all.
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en,de;q=0.8,fr;q=0.7',
      },
    });

    if (!res.ok) return null;
    if (!isHtmlResponse(res.headers.get('content-type'))) return null;

    return extractBody(await res.text());
  } catch {
    // Timeouts, DNS failures, TLS errors, consent redirects that loop. None of
    // them are worth distinguishing here: the article keeps what it had.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What a body-fetching pass achieved, for the run summary. */
export interface BodyReport {
  attempted: number;
  fetched: number;
  chars: number;
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
  const report: BodyReport = { attempted: 0, fetched: 0, chars: 0 };
  const queue = [...items];
  const concurrency = opts.concurrency ?? 6;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      report.attempted += 1;

      const body = await fetchArticleText(urlOf(item));
      if (body) {
        report.fetched += 1;
        report.chars += body.length;
        onBody(item, body);
      }
    }
  }));

  return report;
}
