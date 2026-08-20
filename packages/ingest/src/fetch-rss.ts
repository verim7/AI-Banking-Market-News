import { XMLParser } from 'fast-xml-parser';
import type { RawItem } from './normalize.ts';

const UA = 'ai-banking-market-news/1.0 (+https://github.com/verim7/AI-Banking-Market-News)';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Feed values may be a string, or an object with #text / CDATA. */
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['#text'] === 'string') return o['#text'];
  }
  return String(v);
}

/** Atom links are attributes; RSS links are text. Prefer rel="alternate". */
function atomLink(entry: Record<string, unknown>): string {
  const links = asArray(entry['link'] as unknown);
  for (const l of links) {
    if (typeof l === 'object' && l !== null) {
      const o = l as Record<string, unknown>;
      const rel = o['@_rel'];
      if (rel === undefined || rel === 'alternate') return String(o['@_href'] ?? '');
    }
  }
  const first = links[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null) {
    return String((first as Record<string, unknown>)['@_href'] ?? '');
  }
  return '';
}

/**
 * Parse an RSS 2.0, RDF or Atom document into raw items.
 *
 * Kept separate from fetchRss so the parsing — the part that actually breaks
 * when a publisher restyles their feed — is testable without a network.
 */
export function parseFeed(body: string): RawItem[] {
  const doc = parser.parse(body) as Record<string, any>;

  // RSS 2.0 / RDF
  const rssItems = asArray(doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item);
  if (rssItems.length > 0) {
    return rssItems.map((it: Record<string, unknown>) => ({
      title: text(it['title']),
      link: text(it['link']) || String(it['guid'] ?? ''),
      description: text(it['description']),
      content: text(it['content:encoded']),
      pubDate: text(it['pubDate']) || text(it['dc:date']) || null,
    }));
  }

  // Atom
  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length > 0) {
    return atomEntries.map((e: Record<string, unknown>) => ({
      title: text(e['title']),
      link: atomLink(e),
      description: text(e['summary']),
      content: text(e['content']),
      pubDate: text(e['published']) || text(e['updated']) || null,
    }));
  }

  throw new Error('no <item> or <entry> elements found — not an RSS/Atom feed?');
}

export async function fetchRss(url: string, timeoutMs = 20_000): Promise<RawItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let body: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    body = await res.text();
  } finally {
    clearTimeout(timer);
  }

  return parseFeed(body);
}
