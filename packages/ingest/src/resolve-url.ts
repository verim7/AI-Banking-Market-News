import { autodiscover } from './discover.ts';
import { fetchRss, UA } from './fetch-rss.ts';
import { hostOf, titleKey } from './normalize.ts';
import { loadSources } from './sources.ts';

/**
 * Recover the real article URL that an aggregator withholds.
 *
 * Google News links are opaque tokens. A production run read 3 of 331 pages
 * and 320 of the failures never left news.google.com; decoding all 322 tokens
 * from an earlier run yielded a URL for none of them, and reading the
 * destination out of the interstitial recovered nothing either. The link does
 * not contain the article, and there is no honest way to make it.
 *
 * What the feed does supply is the headline and, in `<source url="…">`, the
 * publisher's own domain. The publisher's own feed carries both the headline
 * and the real link. So the article is found where it was published, using a
 * public feed exactly as intended, rather than by working around an
 * interstitial that is there on purpose.
 *
 * One feed fetch serves every article from that publisher, so the cost is tens
 * of requests rather than hundreds — and fewer than the 320 doomed fetches
 * this replaces.
 *
 * Coverage is inherently partial. A feed is a short window: an article older
 * than a few days is no longer in it, and a publisher may run no feed at all.
 * The run reports the recovery rate rather than assuming one.
 */

/** Feeds are short windows, and a wrong match is worse than no match. */
const MIN_KEY_LENGTH = 25;

export interface FeedIndex {
  /** titleKey -> real article URL. */
  byTitle: Map<string, string>;
  items: number;
}

/**
 * Index a publisher's feed by headline.
 *
 * `titleKey` is reused rather than reinvented: it already lowercases, strips
 * punctuation and collapses whitespace, and it is the same normalisation
 * dedupe uses — so a headline that matches here is a headline that would have
 * been treated as the same article anyway.
 */
export function indexFeed(items: { title: string; link: string }[]): FeedIndex {
  const byTitle = new Map<string, string>();
  for (const item of items) {
    const key = titleKey(item.title);
    // Too short to be distinctive: matching on it would attach a real URL to
    // the wrong article, which is worse than leaving it unread.
    if (key.length < MIN_KEY_LENGTH) continue;
    if (!item.link || !/^https?:/i.test(item.link)) continue;
    if (hostOf(item.link) === 'news.google.com') continue;
    if (!byTitle.has(key)) byTitle.set(key, item.link);
  }
  return { byTitle, items: items.length };
}

export function lookup(index: FeedIndex, headline: string): string | null {
  const key = titleKey(headline);
  if (key.length < MIN_KEY_LENGTH) return null;
  return index.byTitle.get(key) ?? null;
}

/** Feeds already configured, so a known publisher is never re-discovered. */
export function configuredFeeds(): Map<string, string> {
  const byHost = new Map<string, string>();
  for (const source of loadSources()) {
    if (source.kind !== 'rss') continue;
    const host = hostOf(source.url);
    // A Google News query is not the publisher's feed, whatever its host says.
    if (!host || host === 'news.google.com') continue;
    if (!byHost.has(host)) byHost.set(host, source.url);
  }
  return byHost;
}

const COMMON_PATHS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/index.xml', '/atom.xml'];

/** Ask a site for its feed. Returns the first address that actually parses. */
export async function findFeed(host: string, timeoutMs = 12_000): Promise<string | null> {
  const base = `https://www.${host}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let html = '';
    try {
      const res = await fetch(base, {
        signal: controller.signal, redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      });
      if (res.ok) html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    // The site's own declaration first; guessing is the fallback, not the plan.
    const candidates = [...autodiscover(html, base), ...COMMON_PATHS.map((p) => base + p)];

    for (const candidate of candidates.slice(0, 6)) {
      try {
        const items = await fetchRss(candidate, timeoutMs);
        if (items.length > 0) return candidate;
      } catch { /* not a feed; try the next candidate */ }
    }
  } catch { /* the site is unreachable; the article keeps its aggregator link */ }

  return null;
}

export interface ResolveReport {
  /** Articles that arrived with an unusable aggregator link. */
  unresolved: number;
  /** Of those, how many got a real URL back. */
  recovered: number;
  /** Publishers consulted, and how many had a usable feed. */
  publishers: number;
  publishersWithFeed: number;
}

/**
 * Give aggregator-linked articles their real URLs.
 *
 * Grouped by publisher so each feed is fetched once. `onResolved` receives the
 * real URL; nothing is written here, because whether a recovered URL is worth
 * storing is the caller's decision.
 */
export async function resolveUrls<T>(
  items: T[],
  hostOfItem: (item: T) => string | null,
  titleOfItem: (item: T) => string,
  onResolved: (item: T, url: string) => void,
  opts: {
    feedForHost?: (host: string) => Promise<string | null>;
    log?: (s: string) => void;
  } = {},
): Promise<ResolveReport> {
  const report: ResolveReport = {
    unresolved: items.length, recovered: 0, publishers: 0, publishersWithFeed: 0,
  };
  const log = opts.log ?? (() => {});

  const byHost = new Map<string, T[]>();
  for (const item of items) {
    const host = hostOfItem(item);
    if (!host) continue;
    byHost.set(host, [...(byHost.get(host) ?? []), item]);
  }
  report.publishers = byHost.size;

  const configured = configuredFeeds();
  const feedFor = opts.feedForHost ?? (async (host: string) =>
    configured.get(host) ?? await findFeed(host));

  for (const [host, group] of byHost) {
    const feed = await feedFor(host);
    if (!feed) continue;

    let index: FeedIndex;
    try {
      index = indexFeed(await fetchRss(feed));
    } catch {
      continue;
    }
    if (index.items === 0) continue;
    report.publishersWithFeed += 1;

    let hit = 0;
    for (const item of group) {
      const url = lookup(index, titleOfItem(item));
      if (url) {
        hit += 1;
        report.recovered += 1;
        onResolved(item, url);
      }
    }
    if (hit > 0) log(`    ${host}: ${hit}/${group.length} recovered`);
  }

  return report;
}
