import { createHash } from 'node:crypto';
import type { NormalizedArticle, PublisherKind } from '@portal/shared';

/** Query parameters that identify a campaign, not a document. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source', 'cmpid',
  'sc_channel', 'sc_campaign', 'ito', 'at_medium', 'at_campaign', '_hsenc', '_hsmi',
];

/**
 * Reduce a URL to the thing it identifies, so the same article arriving from
 * two feeds collapses to one row. Deliberately conservative: it strips tracking
 * and normalises case/trailing slash, but never touches the path, because for
 * some sites the path *is* the identity down to the last segment.
 */
export function canonicalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  u.protocol = u.protocol === 'http:' ? 'https:' : u.protocol;
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';

  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  // Sort what remains so ?a=1&b=2 and ?b=2&a=1 are the same article.
  u.searchParams.sort();

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.toString();
}

export function articleId(urlCanonical: string): string {
  return createHash('sha256').update(urlCanonical).digest('hex').slice(0, 32);
}

/** Strip HTML tags and collapse whitespace; feeds embed markup in descriptions. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Feeds use RFC-822, ISO-8601 and worse. Return ISO-8601 or null, never a guess. */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = Date.parse(input.trim());
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  // A date far in the future is a parse artefact, not a scoop.
  if (d.getTime() > Date.now() + 7 * 86_400_000) return null;
  return d.toISOString();
}

export interface RawItem {
  title: string;
  link: string;
  description?: string | null;
  content?: string | null;
  pubDate?: string | null;
  language?: string | null;
  /**
   * The outlet that actually published the story, when the feed is an
   * aggregator reporting on someone else's behalf. "Google News" in the source
   * column would be true and useless; "Reuters" is what a reader needs to
   * judge the item.
   */
  publisher?: string | null;
  /** The publisher's site, where an aggregator supplies it. */
  publisherUrl?: string | null;
}

export interface SourceMeta {
  id: string;
  name: string;
  publisherKind: PublisherKind;
}

/**
 * Is this "summary" actually a list of links to other articles?
 *
 * Google News puts no summary in <description>. It puts an HTML list of the
 * other headlines in the same story cluster — a dozen unrelated titles from a
 * dozen unrelated outlets. Fed to the classifier as though it were the
 * article's own text, that is worse than having no summary at all: it decides
 * an article using words that belong to different articles.
 *
 * It is how "If AI disappoints? The transmission of US big-tech earnings news"
 * passed the gate. On its own title it scores zero relevance, correctly — the
 * market-commentary rejection working exactly as intended. Borrowed banking
 * vocabulary from a neighbouring headline carried it through.
 *
 * Detected structurally rather than by publisher: two or more anchors in what
 * claims to be one article's summary is a link list, whoever sent it.
 */
export function isLinkList(html: string | null | undefined): boolean {
  if (!html) return false;
  const anchors = html.match(/<a\s[^>]*href=/gi);
  return (anchors?.length ?? 0) >= 2;
}

/** Bare hostname, or null. Never throws on a malformed URL. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

export function normalize(item: RawItem, source: SourceMeta): NormalizedArticle | null {
  const title = stripHtml(item.title);
  const link = (item.link ?? '').trim();
  if (!title || !link) return null;

  const urlCanonical = canonicalizeUrl(link);
  // A link list is not a summary. Dropping it leaves the article judged on its
  // headline, which is the honest basis when the feed supplies nothing else.
  const summary = isLinkList(item.description)
    ? null
    : stripHtml(item.description).slice(0, 1000) || null;
  const excerpt = stripHtml(item.content).slice(0, 4000) || null;

  return {
    id: articleId(urlCanonical),
    urlCanonical,
    urlOriginal: link,
    title: title.slice(0, 500),
    summary,
    excerpt,
    sourceId: source.id,
    // The aggregator's own name is kept as the source id, so a query can still
    // be judged by what it returns, while the displayed name is the outlet.
    sourceName: item.publisher?.trim() || source.name,
    publisherHost: hostOf(item.publisherUrl),
    publisherKind: source.publisherKind,
    language: item.language ?? null,
    publishedAt: parseDate(item.pubDate),
  };
}

/**
 * A headline reduced to a comparable form: lowercase, no punctuation, single
 * spaces. Long enough to be distinctive, and truncated so a publisher's
 * trailing embellishment does not defeat the match.
 */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Keep the first occurrence of each article, by URL and by headline.
 *
 * URL alone was enough while every source linked to the publisher directly.
 * Google News does not: its <link> is an opaque news.google.com redirect, and
 * two different queries returning the same Reuters story produce two URLs that
 * match nothing — including the copy GDELT already found under the real URL.
 * On a query set that overlaps by design, that is a duplicate for every
 * article, not an edge case.
 *
 * So the headline is a second key. Syndication makes this slightly aggressive:
 * a wire story republished by four outlets collapses to one. That is the
 * behaviour worth having — four copies of the same Reuters piece is not four
 * pieces of market intelligence — and the first occurrence wins, which is the
 * source that reported it first in fetch order.
 *
 * Generic over the article type so a list of already-classified articles keeps
 * its classification instead of being widened back to NormalizedArticle.
 */
export function dedupe<T extends NormalizedArticle>(articles: T[]): T[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: T[] = [];

  for (const a of articles) {
    const key = titleKey(a.title);
    if (seenUrl.has(a.urlCanonical)) continue;
    // A title too short to be distinctive is not evidence of a duplicate.
    if (key.length >= 25 && seenTitle.has(key)) continue;

    seenUrl.add(a.urlCanonical);
    if (key.length >= 25) seenTitle.add(key);
    out.push(a);
  }
  return out;
}
