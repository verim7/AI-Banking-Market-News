import { describe, expect, it } from 'vitest';
import { parseSeedFile, sourceFor } from '../src/seed-urls.ts';
import { readArticleMeta } from '../src/fetch-article.ts';

describe('the seed list, which a person maintains by hand', () => {
  it('reads a URL per line and ignores comments and blanks', () => {
    const seeds = parseSeedFile(`
# A comment line

https://example.com/a    # and a trailing comment
https://example.com/b
`);
    expect(seeds.map((s) => s.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('takes the publisher kind after a pipe, and defaults to media', () => {
    // It matters for a bank's own newsroom: `bank` weighs 1.1 against media's
    // 1.0, so a press release read as anonymous media news is scored as though
    // nobody in particular said it.
    const seeds = parseSeedFile(
      'https://www.sygnum.com/news/x | bank\nhttps://example.com/y\n'
      + 'https://example.com/z | nonsense\n');
    expect(seeds.map((s) => s.publisherKind)).toEqual(['bank', 'media', 'media']);
  });

  it('drops a duplicate rather than fetching the same page twice', () => {
    expect(parseSeedFile('https://example.com/a\nhttps://example.com/a\n')).toHaveLength(1);
  });

  it('skips a line that is not a URL instead of failing the run', () => {
    // One typo in a hand-maintained file must not cost the other ten articles.
    expect(parseSeedFile('not a url\nhttps://example.com/a\n').map((s) => s.url))
      .toEqual(['https://example.com/a']);
  });

  it('gives each publisher its own source row', () => {
    // One shared "seeded" source would label a Sygnum press release and a
    // Finextra report identically, and the Sources panel counts by source.
    const sygnum = sourceFor('https://www.sygnum.com/news/x', 'bank');
    expect(sygnum.id).toBe('seed-sygnum.com');
    expect(sygnum.name).toBe('sygnum.com');
    expect(sygnum.publisher_kind).toBe('bank');
    // The sources table has CHECK (kind IN ('rss','gdelt')), so a new kind
    // would mean a migration for a cosmetic distinction.
    expect(sygnum.kind).toBe('rss');
    // Never in the daily run: this source is a label, not a feed to poll.
    expect(sygnum.daily).toBe(false);
  });
});

describe('reading a headline and a date off the page', () => {
  it('prefers og:title, which carries the headline without the publisher', () => {
    const html = `<html><head>
      <meta property="og:title" content="Sygnum completes live AI-agent transactions">
      <title>Sygnum completes live AI-agent transactions | Sygnum</title>
    </head><body></body></html>`;
    expect(readArticleMeta(html).title).toBe('Sygnum completes live AI-agent transactions');
  });

  it('falls back to the title tag, trimming the publisher off the end', () => {
    const html = '<html><head><title>Incore Bank trials agentic AI for KYC | Finextra</title>'
               + '</head><body></body></html>';
    expect(readArticleMeta(html).title).toBe('Incore Bank trials agentic AI for KYC');
  });

  it('does not eat a dash that belongs to the headline', () => {
    // "AI vs AI in banks - why real-time checks matter" is one headline, not a
    // headline and a publisher.
    const html = '<html><head><title>AI vs AI in banks - why real-time fraud checks are '
               + 'becoming critical</title></head><body></body></html>';
    expect(readArticleMeta(html).title)
      .toBe('AI vs AI in banks - why real-time fraud checks are becoming critical');
  });

  it('reads the date from the publisher’s own machine-readable field', () => {
    const html = '<html><head><meta property="article:published_time" '
               + 'content="2026-05-18T08:00:00Z"></head><body></body></html>';
    expect(readArticleMeta(html).publishedAt).toBe('2026-05-18T08:00:00.000Z');
  });

  it('reads JSON-LD when there is no meta tag', () => {
    const html = '<html><head><script type="application/ld+json">'
               + '{"@type":"NewsArticle","datePublished":"2026-09-04T20:41:55Z"}'
               + '</script></head><body></body></html>';
    expect(readArticleMeta(html).publishedAt).toBe('2026-09-04T20:41:55.000Z');
  });

  it('returns null rather than a guess when the page says nothing', () => {
    // A null title tells the caller to skip the URL. An article stored under an
    // invented headline is wrong in the one field the fold, the search and
    // every review record key on — worse than not storing it.
    expect(readArticleMeta('<html><body>no head at all</body></html>'))
      .toEqual({ title: null, publishedAt: null });
  });

  it('ignores a date it cannot parse instead of storing an invalid one', () => {
    const html = '<html><head><meta property="article:published_time" content="soon">'
               + '<title>A headline long enough to be kept</title></head></html>';
    const meta = readArticleMeta(html);
    expect(meta.publishedAt).toBeNull();
    expect(meta.title).toBe('A headline long enough to be kept');
  });

  it('decodes entities so a headline is not stored with &amp; in it', () => {
    const html = '<html><head><meta property="og:title" '
               + 'content="M&amp;A desks adopt AI"></head></html>';
    expect(readArticleMeta(html).title).toBe('M&A desks adopt AI');
  });
});
