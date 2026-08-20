import { describe, expect, it } from 'vitest';
import { classify, type ClassifiedArticle } from '@portal/shared';
import { parseFeed } from '../src/fetch-rss.ts';
import { dedupe, normalize } from '../src/normalize.ts';
import { articleStatements } from '../src/load-d1.ts';
import { loadSources } from '../src/sources.ts';

/**
 * End-to-end over a fixture feed: XML in, SQL out. This is the path the daily
 * job takes, minus the network, so a regression anywhere along it fails here.
 */

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>McKinsey Financial Services</title>
    <item>
      <title>How Swiss private banks are deploying generative AI copilots</title>
      <link>https://example.com/study?utm_campaign=newsletter</link>
      <description>A McKinsey study finds relationship managers at wealth
        management firms using AI copilots for meeting preparation.</description>
      <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
    </item>
    <item>
      <title>How Swiss private banks are deploying generative AI copilots</title>
      <link>https://www.example.com/study/</link>
      <description>Duplicate of the story above, arriving from a second feed.</description>
      <pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Quarterly results announcement</title>
      <link>https://example.com/results</link>
      <description>Revenue rose four percent.</description>
      <pubDate>Tue, 18 Aug 2026 11:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const SOURCE = { id: 'mck', name: 'McKinsey Financial Services', publisherKind: 'consultancy' as const };

function run(): ClassifiedArticle[] {
  const items = parseFeed(FEED);
  const normalized = dedupe(
    items.map((i) => normalize(i, SOURCE)).filter((a): a is NonNullable<typeof a> => a !== null),
  );
  return normalized.map((a) => ({
    ...a,
    classification: classify({
      title: a.title, summary: a.summary, excerpt: a.excerpt,
      publisherKind: a.publisherKind, publishedAt: a.publishedAt,
      regionHint: null, now: new Date('2026-08-20T00:00:00Z'),
    }),
  }));
}

describe('feed → normalise → classify → SQL', () => {
  it('collapses the duplicate that arrived under a different URL form', () => {
    const out = run();
    expect(out).toHaveLength(2);
  });

  it('scores the AI study high and the results announcement at zero', () => {
    const out = run();
    const study = out.find((a) => a.title.includes('generative AI'))!;
    const results = out.find((a) => a.title.includes('Quarterly'))!;
    expect(study.classification.relevanceScore).toBeGreaterThan(40);
    expect(results.classification.relevanceScore).toBe(0);
  });

  it('tags the study across all four dimensions', () => {
    const study = run().find((a) => a.title.includes('generative AI'))!;
    const dims = new Set(study.classification.tags.map((t) => t.dimension));
    expect(dims).toContain('region');
    expect(dims).toContain('banking_area');
    expect(dims).toContain('bank_category');
    expect(dims).toContain('use_case');
  });

  it('emits SQL that inserts the article, clears old tags and writes a score', () => {
    const study = run().find((a) => a.title.includes('generative AI'))!;
    const sql = articleStatements(study);
    expect(sql.some((s) => s.startsWith('INSERT INTO articles'))).toBe(true);
    expect(sql.some((s) => s.startsWith('DELETE FROM article_tags'))).toBe(true);
    expect(sql.some((s) => s.includes('INSERT INTO article_scores'))).toBe(true);
    // Every statement must be terminated, since they are batched into one body.
    for (const s of sql) expect(s.trim().endsWith(';')).toBe(true);
  });

  it('quotes an apostrophe in a headline rather than breaking the batch', () => {
    const [article] = run();
    const withQuote: ClassifiedArticle = { ...article!, title: "Europe's banks and AI" };
    const insert = articleStatements(withQuote).find((s) => s.startsWith('INSERT INTO articles'))!;
    expect(insert).toContain("Europe''s banks and AI");
  });
});

describe('sources.yaml', () => {
  it('loads, and every entry passes validation', () => {
    const sources = loadSources();
    expect(sources.length).toBeGreaterThan(20);
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
  });

  it('includes each region the brief called out', () => {
    const hints = new Set(loadSources().map((s) => s.region_hint).filter(Boolean));
    expect(hints).toContain('singapore_apac');
    expect(hints).toContain('usa_north_america');
    expect(hints).toContain('switzerland');
    expect(hints).toContain('germany_dach');
  });
});
