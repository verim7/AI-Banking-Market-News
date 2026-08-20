import type { RawItem } from './normalize.ts';

const UA = 'ai-banking-market-news/1.0 (+https://github.com/verim7/AI-Banking-Market-News)';
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
export async function fetchGdelt(
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
