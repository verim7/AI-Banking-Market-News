import { describe, expect, it } from 'vitest';
import { autodiscover } from '../src/discover.ts';

describe('autodiscover', () => {
  it('finds an RSS link and resolves it against the page URL', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="Feed" href="/insights/rss.xml">
    </head></html>`;
    expect(autodiscover(html, 'https://www.bcg.com/'))
      .toEqual(['https://www.bcg.com/insights/rss.xml']);
  });

  it('finds Atom links too', () => {
    const html = `<link rel="alternate" type="application/atom+xml" href="https://x.com/atom">`;
    expect(autodiscover(html, 'https://x.com')).toEqual(['https://x.com/atom']);
  });

  it('ignores stylesheets, icons and non-feed alternates', () => {
    const html = `
      <link rel="stylesheet" href="/a.css">
      <link rel="icon" href="/favicon.ico">
      <link rel="alternate" hreflang="de" href="/de/">
      <link rel="alternate" type="application/rss+xml" href="/real.xml">`;
    expect(autodiscover(html, 'https://x.com')).toEqual(['https://x.com/real.xml']);
  });

  it('handles single quotes and attribute order', () => {
    const html = `<link href='/f.xml' type='application/rss+xml' rel='alternate'>`;
    expect(autodiscover(html, 'https://x.com')).toEqual(['https://x.com/f.xml']);
  });

  it('deduplicates repeated declarations', () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="/f.xml">
      <link rel="alternate" type="application/rss+xml" href="/f.xml">`;
    expect(autodiscover(html, 'https://x.com')).toEqual(['https://x.com/f.xml']);
  });

  it('skips malformed hrefs instead of throwing', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="ht tp://:::">`;
    expect(() => autodiscover(html, 'https://x.com')).not.toThrow();
  });

  it('returns nothing for a page with no feed', () => {
    expect(autodiscover('<html><body>no feed here</body></html>', 'https://x.com')).toEqual([]);
  });
});
