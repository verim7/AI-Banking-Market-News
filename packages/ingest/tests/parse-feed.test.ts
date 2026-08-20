import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/fetch-rss.ts';

const RSS_2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Bank Insights</title>
    <item>
      <title>Generative AI in retail banking</title>
      <link>https://example.com/a?utm_source=rss</link>
      <description><![CDATA[<p>A study of <b>AI</b> in consumer banking.</p>]]></description>
      <content:encoded><![CDATA[Full text about fraud detection.]]></content:encoded>
      <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Second story</title>
      <link>https://example.com/b</link>
      <pubDate>Mon, 17 Aug 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Regulator Feed</title>
  <entry>
    <title>Supervisory expectations for AI</title>
    <link rel="edit" href="https://example.org/edit/1"/>
    <link rel="alternate" href="https://example.org/news/1"/>
    <summary>Guidance on model governance for banks.</summary>
    <published>2026-08-15T12:00:00Z</published>
    <updated>2026-08-16T12:00:00Z</updated>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item>
    <title>AI and payments</title>
    <link>https://example.net/p</link>
    <dc:date>2026-08-10T00:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

const SINGLE_ITEM = `<?xml version="1.0"?>
<rss version="2.0"><channel><item>
  <title>Only one</title><link>https://example.com/one</link>
</item></channel></rss>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 including CDATA and content:encoded', () => {
    const items = parseFeed(RSS_2);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('Generative AI in retail banking');
    expect(items[0]!.link).toBe('https://example.com/a?utm_source=rss');
    expect(items[0]!.description).toContain('AI');
    expect(items[0]!.content).toContain('fraud detection');
    expect(items[0]!.pubDate).toBe('Tue, 18 Aug 2026 09:30:00 GMT');
  });

  it('parses Atom and prefers the alternate link over edit', () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]!.link).toBe('https://example.org/news/1');
    expect(items[0]!.pubDate).toBe('2026-08-15T12:00:00Z');
  });

  it('parses RDF feeds and their dc:date', () => {
    const items = parseFeed(RDF);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('AI and payments');
    expect(items[0]!.pubDate).toBe('2026-08-10T00:00:00Z');
  });

  it('handles a feed with exactly one item, which XML parsers collapse to an object', () => {
    const items = parseFeed(SINGLE_ITEM);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Only one');
  });

  // The message must name what actually came back. "not an RSS/Atom feed" sent
  // us hunting through parser code when the real answer was "that URL is a
  // landing page".
  it('says so when handed an HTML page', () => {
    expect(() => parseFeed('<html><body>404 Not Found</body></html>'))
      .toThrow(/HTML page, not a feed/);
    expect(() => parseFeed('<!DOCTYPE html>\n<html><body>hi</body></html>'))
      .toThrow(/HTML page, not a feed/);
  });

  it('says so when handed JSON', () => {
    expect(() => parseFeed('{"articles":[]}')).toThrow(/returned JSON/);
  });

  it('still reports an unrecognised XML document as not a feed', () => {
    expect(() => parseFeed('<?xml version="1.0"?><catalog><book/></catalog>'))
      .toThrow(/not an RSS\/Atom feed/);
  });
});
