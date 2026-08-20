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
}

export interface SourceMeta {
  id: string;
  name: string;
  publisherKind: PublisherKind;
}

export function normalize(item: RawItem, source: SourceMeta): NormalizedArticle | null {
  const title = stripHtml(item.title);
  const link = (item.link ?? '').trim();
  if (!title || !link) return null;

  const urlCanonical = canonicalizeUrl(link);
  const summary = stripHtml(item.description).slice(0, 1000) || null;
  const excerpt = stripHtml(item.content).slice(0, 4000) || null;

  return {
    id: articleId(urlCanonical),
    urlCanonical,
    urlOriginal: link,
    title: title.slice(0, 500),
    summary,
    excerpt,
    sourceId: source.id,
    sourceName: source.name,
    publisherKind: source.publisherKind,
    language: item.language ?? null,
    publishedAt: parseDate(item.pubDate),
  };
}

/**
 * Keep the first occurrence of each canonical URL.
 *
 * Generic over the article type so a list of already-classified articles keeps
 * its classification instead of being widened back to NormalizedArticle.
 */
export function dedupe<T extends NormalizedArticle>(articles: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of articles) {
    if (seen.has(a.urlCanonical)) continue;
    seen.add(a.urlCanonical);
    out.push(a);
  }
  return out;
}
