import { describe, expect, it, test } from 'vitest';
import {
  canonicalizeUrl, dedupe, isLinkList, normalize, parseDate, stripHtml,
} from '../src/normalize.ts';
import { parseGdeltDate } from '../src/fetch-gdelt.ts';
import { parseFeed } from '../src/fetch-rss.ts';

const source = { id: 's1', name: 'Test Source', publisherKind: 'media' as const };

describe('canonicalizeUrl', () => {
  it('strips tracking parameters but keeps real ones', () => {
    expect(canonicalizeUrl('https://example.com/a?id=7&utm_source=x&gclid=y'))
      .toBe('https://example.com/a?id=7');
  });

  it('collapses the variations that make one article look like four', () => {
    const target = 'https://example.com/ai-in-banking';
    expect(canonicalizeUrl('http://www.Example.com/ai-in-banking/')).toBe(target);
    expect(canonicalizeUrl('https://example.com/ai-in-banking#top')).toBe(target);
    expect(canonicalizeUrl('https://EXAMPLE.com/ai-in-banking')).toBe(target);
  });

  it('orders query parameters so argument order stops mattering', () => {
    expect(canonicalizeUrl('https://example.com/a?b=2&a=1'))
      .toBe(canonicalizeUrl('https://example.com/a?a=1&b=2'));
  });

  it('preserves the path, which is often the identity', () => {
    expect(canonicalizeUrl('https://example.com/2026/08/ai-banking-report'))
      .toBe('https://example.com/2026/08/ai-banking-report');
  });

  it('returns unparseable input unchanged rather than throwing', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

describe('stripHtml', () => {
  it('removes markup and decodes entities', () => {
    expect(stripHtml('<p>AI &amp; banking</p>')).toBe('AI & banking');
  });

  it('drops script and style content entirely', () => {
    expect(stripHtml('<script>evil()</script>Real text')).toBe('Real text');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('a\n\n   b')).toBe('a b');
  });
});

describe('parseDate', () => {
  it('accepts RFC-822 as feeds emit it', () => {
    expect(parseDate('Tue, 18 Aug 2026 09:30:00 GMT')).toBe('2026-08-18T09:30:00.000Z');
  });

  it('returns null rather than a guess for junk', () => {
    expect(parseDate('last Tuesday')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });

  it('rejects dates far in the future, which are parse artefacts', () => {
    expect(parseDate('Tue, 18 Aug 2099 09:30:00 GMT')).toBeNull();
  });
});

describe('parseGdeltDate', () => {
  it('handles GDELT’s compact stamp that Date.parse rejects', () => {
    expect(parseGdeltDate('20260818T093000Z')).toBe('2026-08-18T09:30:00.000Z');
  });

  it('returns null for junk', () => {
    expect(parseGdeltDate('nonsense')).toBeNull();
    expect(parseGdeltDate(undefined)).toBeNull();
  });
});

describe('normalize', () => {
  it('produces a stable id derived from the canonical url', () => {
    const a = normalize({ title: 'T', link: 'https://example.com/x?utm_source=a' }, source);
    const b = normalize({ title: 'T', link: 'http://www.example.com/x/' }, source);
    expect(a!.id).toBe(b!.id);
  });

  it('rejects items with no title or no link', () => {
    expect(normalize({ title: '', link: 'https://example.com' }, source)).toBeNull();
    expect(normalize({ title: 'T', link: '' }, source)).toBeNull();
  });
});

describe('dedupe', () => {
  it('keeps the first of each canonical url', () => {
    const mk = (title: string, link: string) => normalize({ title, link }, source)!;
    const out = dedupe([
      mk('First', 'https://example.com/a'),
      mk('Second', 'https://www.example.com/a/'),
      mk('Third', 'https://example.com/b'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toBe('First');
  });
});

describe('Google News, which is an aggregator rather than a publisher', () => {
  test('deduplicates a story that arrived under an opaque redirect and a real URL', () => {
    const title = 'DBS rolls out generative AI assistant for relationship managers';
    const articles = [
      normalize({ title, link: 'https://www.reuters.com/tech/dbs-ai-2026' },
                { id: 'gdelt', name: 'GDELT', publisherKind: 'media' })!,
      normalize({ title, link: 'https://news.google.com/rss/articles/CBMiK2h0dHBz' },
                { id: 'gnews', name: 'Google News', publisherKind: 'media' })!,
    ];
    // Neither URL matches the other, so URL dedupe alone keeps both.
    expect(articles[0]!.urlCanonical).not.toBe(articles[1]!.urlCanonical);
    expect(dedupe(articles)).toHaveLength(1);
  });

  test('the first occurrence wins, so the direct link is the one kept', () => {
    const title = 'HSBC deploys machine learning for fraud detection across retail';
    const kept = dedupe([
      normalize({ title, link: 'https://www.ft.com/hsbc-ml' },
                { id: 'gdelt', name: 'GDELT', publisherKind: 'media' })!,
      normalize({ title, link: 'https://news.google.com/rss/articles/CBMiXyz' },
                { id: 'gnews', name: 'Google News', publisherKind: 'media' })!,
    ]);
    expect(kept[0]!.urlCanonical).toContain('ft.com');
  });

  test('different stories are not collapsed just because both mention a bank', () => {
    const kept = dedupe([
      normalize({ title: 'UBS launches an AI copilot for advisers',
                  link: 'https://a.example/1' },
                { id: 's', name: 'S', publisherKind: 'media' })!,
      normalize({ title: 'Citi expands machine learning in trade surveillance',
                  link: 'https://b.example/2' },
                { id: 's', name: 'S', publisherKind: 'media' })!,
    ]);
    expect(kept).toHaveLength(2);
  });

  test('a headline too short to be distinctive is never treated as a duplicate', () => {
    const kept = dedupe([
      normalize({ title: 'AI at work', link: 'https://a.example/1' },
                { id: 's', name: 'S', publisherKind: 'media' })!,
      normalize({ title: 'AI at work', link: 'https://b.example/2' },
                { id: 's', name: 'S', publisherKind: 'media' })!,
    ]);
    expect(kept).toHaveLength(2);
  });

  test('the publisher suffix is stripped so it cannot be read as headline content', () => {
    const [item] = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>Barclays deploys AI in compliance - Reuters</title>
        <link>https://news.google.com/rss/articles/CBMiAbc</link>
        <source url="https://www.reuters.com">Reuters</source>
        <pubDate>Mon, 17 Aug 2026 09:00:00 GMT</pubDate>
      </item></channel></rss>`);
    expect(item!.title).toBe('Barclays deploys AI in compliance');
    expect(item!.publisher).toBe('Reuters');
  });

  test('the outlet becomes the displayed source, not the query that found it', () => {
    const article = normalize(
      { title: 'Barclays deploys AI in compliance',
        link: 'https://news.google.com/rss/articles/CBMiAbc', publisher: 'Reuters' },
      { id: 'gnews_ai_banking_global', name: 'Google News — AI in banking', publisherKind: 'media' })!;
    expect(article.sourceName).toBe('Reuters');
    expect(article.sourceId).toBe('gnews_ai_banking_global');
  });

  test('a feed with no publisher element still reports its own name', () => {
    const article = normalize(
      { title: 'FINMA publishes AI supervisory guidance', link: 'https://finma.ch/x' },
      { id: 'finma', name: 'FINMA', publisherKind: 'regulator' })!;
    expect(article.sourceName).toBe('FINMA');
  });
});

describe('a description that is a list of links, not a summary', () => {
  // Google News ships the whole story cluster in <description>: a dozen
  // headlines from a dozen outlets, none of them this article's text.
  const cluster = '<ol><li><a href="https://a.example/1">Barclays picks AI vendor</a>'
    + '&nbsp;&nbsp;<font color="#6f6f6f">Reuters</font></li>'
    + '<li><a href="https://b.example/2">HSBC bank profits rise on lending</a>'
    + '&nbsp;&nbsp;<font color="#6f6f6f">FT</font></li></ol>';

  test('is recognised as a link list', () => {
    expect(isLinkList(cluster)).toBe(true);
  });

  test('a real summary with one inline link is not mistaken for one', () => {
    expect(isLinkList('The bank said its <a href="https://x.example">new assistant</a> is live.'))
      .toBe(false);
  });

  test('plain text and empty descriptions are never link lists', () => {
    expect(isLinkList('The bank rolled out an AI assistant.')).toBe(false);
    expect(isLinkList('')).toBe(false);
    expect(isLinkList(null)).toBe(false);
  });

  test('the borrowed text is dropped rather than read as the article', () => {
    const article = normalize(
      { title: 'If AI disappoints? The transmission of US big-tech earnings news',
        link: 'https://news.google.com/rss/articles/CBMiAbc',
        description: cluster },
      { id: 'gnews', name: 'Google News', publisherKind: 'media' })!;
    expect(article.summary).toBeNull();
  });

  test('an ordinary feed summary still survives', () => {
    const article = normalize(
      { title: 'DBS deploys AI agents',
        link: 'https://finextra.example/1',
        description: 'The bank said the agents are live for 1,500 employees.' },
      { id: 'finextra', name: 'Finextra', publisherKind: 'media' })!;
    expect(article.summary).toBe('The bank said the agents are live for 1,500 employees.');
  });
});
