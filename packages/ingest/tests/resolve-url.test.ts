import { describe, expect, test } from 'vitest';
import { configuredFeeds, indexFeed, lookup, resolveUrls } from '../src/resolve-url.ts';

const feed = (titles: [string, string][]) =>
  indexFeed(titles.map(([title, link]) => ({ title, link })));

describe('matching an aggregated headline to the publisher feed', () => {
  const index = feed([
    ['DBS deploys specialist AI agents for 1,500 employees',
     'https://www.finextra.com/newsarticle/1/dbs-ai-agents'],
    ['HSBC scales machine learning fraud detection bank-wide',
     'https://www.finextra.com/newsarticle/2/hsbc-ml'],
  ]);

  test('recovers the real URL for an exact headline', () => {
    expect(lookup(index, 'DBS deploys specialist AI agents for 1,500 employees'))
      .toBe('https://www.finextra.com/newsarticle/1/dbs-ai-agents');
  });

  // Google News appends the publisher and varies trailing punctuation, both
  // already handled by titleKey — which is why it is reused rather than
  // rebuilt. Deliberately not asserted: that "1,500" matches "1500". titleKey
  // does not normalise digit separators, and there is no evidence the
  // aggregator rewrites them; changing shared dedupe behaviour on a guess is
  // how a matcher starts attaching the wrong article's text.
  test('matches across trailing punctuation and case', () => {
    expect(lookup(index, 'DBS deploys specialist AI agents for 1,500 employees.'))
      .toBeTruthy();
    expect(lookup(index, 'dbs DEPLOYS specialist ai agents for 1,500 employees'))
      .toBeTruthy();
  });

  // A wrong URL is worse than no URL: it would attach one article's text to
  // another's classification, and every quote below it would be false.
  test('does not match a different article about the same bank', () => {
    expect(lookup(index, 'DBS reports record quarterly profit')).toBeNull();
  });

  test('a headline too short to be distinctive never matches', () => {
    const short = feed([['AI at DBS', 'https://x.example/1']]);
    expect(lookup(short, 'AI at DBS')).toBeNull();
  });

  test('never returns another aggregator link as the recovered URL', () => {
    const circular = feed([
      ['DBS deploys specialist AI agents for 1,500 employees',
       'https://news.google.com/rss/articles/CBMiAbc'],
    ]);
    expect(lookup(circular, 'DBS deploys specialist AI agents for 1,500 employees'))
      .toBeNull();
  });
});

describe('doing it without a request per article', () => {
  const items = [
    { host: 'finextra.com', title: 'DBS deploys specialist AI agents for 1,500 employees' },
    { host: 'finextra.com', title: 'HSBC scales machine learning fraud detection bank-wide' },
    { host: 'finextra.com', title: 'An article that is not in the feed at all today' },
  ];

  test('one feed lookup serves every article from that publisher', async () => {
    const asked: string[] = [];
    const resolved: string[] = [];

    // The feed fetch is stubbed; what is under test is that the publisher is
    // consulted once for three articles, not three times.
    const report = await resolveUrls(
      items, (i) => i.host, (i) => i.title,
      (_i, url) => resolved.push(url),
      { feedForHost: async (host) => { asked.push(host); return null; } },
    );

    expect(asked).toEqual(['finextra.com']);
    expect(report.publishers).toBe(1);
    expect(report.recovered).toBe(0);
  });

  test('an article with no publisher host is skipped rather than guessed at', async () => {
    const report = await resolveUrls(
      [{ host: null as string | null, title: 'Something with no publisher' }],
      (i) => i.host, (i) => i.title, () => {},
      { feedForHost: async () => 'https://x.example/feed' },
    );
    expect(report.publishers).toBe(0);
    expect(report.recovered).toBe(0);
  });

  test('a publisher with no feed costs nothing and loses no articles', async () => {
    const report = await resolveUrls(
      items, (i) => i.host, (i) => i.title, () => {},
      { feedForHost: async () => null },
    );
    expect(report.publishersWithFeed).toBe(0);
    expect(report.unresolved).toBe(3);
  });
});

describe('feeds already configured', () => {
  const byHost = configuredFeeds();

  test('a known publisher is never re-discovered', () => {
    expect(byHost.get('finextra.com')).toContain('finextra.com');
  });

  // A Google News query lives at news.google.com but is not a publisher feed;
  // treating it as one would send resolution straight back to the aggregator.
  test('Google News queries are not offered as publisher feeds', () => {
    expect(byHost.has('news.google.com')).toBe(false);
  });
});
