import { XMLParser } from 'fast-xml-parser';
import type { RawItem } from './normalize.ts';

/**
 * A conventional browser User-Agent.
 *
 * An honest custom agent string is the polite default, but several publishers
 * (FinTech Futures among them) answer it with 403 while serving the same feed
 * to a browser. The contact URL is kept in the comment field so the request is
 * still attributable, and requests stay at one per source per day.
 */
export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
         + 'Chrome/130.0.0.0 Safari/537.36 ai-banking-market-news/1.0 '
         + '(+https://github.com/verim7/AI-Banking-Market-News)';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

/** The url attribute on <source>, whatever shape the parser produced. */
function publisherUrlOf(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const url = (node as Record<string, unknown>)['@_url'];
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

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
    return rssItems.map((it: Record<string, unknown>) => {
      const raw = text(it['title']);
      // Google News appends " - Publisher" to every headline and carries the
      // publisher separately in <source>. Left alone the suffix lands in the
      // title, where the classifier weights headline terms most heavily — so
      // "Reuters" and "American Banker" would score as article content.
      const publisher = text(it['source']);
      const title = publisher && raw.endsWith(` - ${publisher}`)
        ? raw.slice(0, -(publisher.length + 3))
        : raw;

      return {
        title,
        link: text(it['link']) || String(it['guid'] ?? ''),
        description: text(it['description']),
        content: text(it['content:encoded']),
        pubDate: text(it['pubDate']) || text(it['dc:date']) || null,
        publisher: publisher || null,
        // <source url="https://www.wealthmanagement.com">WealthManagement</source>
        // The article's own URL is withheld, but the publisher's domain is not
        // — and the publisher's own feed carries both the headline and the real
        // link, which is how an aggregated article gets recovered at all.
        publisherUrl: publisherUrlOf(it['source']),
      };
    });
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

  const head = body.slice(0, 400).toLowerCase();
  if (head.includes('<!doctype html') || head.includes('<html')) {
    throw new Error('returned an HTML page, not a feed — the URL is probably a landing page');
  }
  if (head.trimStart().startsWith('{') || head.trimStart().startsWith('[')) {
    throw new Error('returned JSON, not RSS/Atom — this source needs a JSON adapter');
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
    if (!res.ok) {
      const hint = res.status === 403 ? ' (blocked — the publisher rejects automated requests)'
                 : res.status === 404 ? ' (feed URL is wrong or retired — try: npm run discover)'
                 : '';
      throw new Error(`HTTP ${res.status} ${res.statusText}${hint}`);
    }
    body = await res.text();
  } finally {
    clearTimeout(timer);
  }

  return parseFeed(body);
}
