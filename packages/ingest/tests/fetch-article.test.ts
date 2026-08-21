import { describe, expect, test } from 'vitest';
import {
  describeFailures, destinationFrom, extractBody, isHtmlResponse, MAX_BODY_CHARS,
} from '../src/fetch-article.ts';

const long = (s: string, n = 8) => Array.from({ length: n }, () => s).join(' ');

describe('pulling the article out of the page', () => {
  test('prefers <article> over the surrounding furniture', () => {
    const html = `<html><body>
      <nav>Home Markets Subscribe Most read</nav>
      <article><p>${long('DBS deployed AI agents across its wealth business.')}</p></article>
      <aside>Newsletter signup. Related: banks and lending.</aside>
    </body></html>`;
    const body = extractBody(html)!;
    expect(body).toContain('DBS deployed AI agents');
    expect(body).not.toContain('Newsletter signup');
    expect(body).not.toContain('Most read');
  });

  test('falls back to <main>, then to the body', () => {
    const main = extractBody(
      `<html><body><main><p>${long('UBS rolled out a copilot for advisers.')}</p></main></body></html>`)!;
    expect(main).toContain('UBS rolled out a copilot');

    const plain = extractBody(
      `<html><body><p>${long('HSBC expanded machine learning in fraud.')}</p></body></html>`)!;
    expect(plain).toContain('HSBC expanded machine learning');
  });

  // Sidebars carry banking vocabulary. Read as the article's own words they
  // would decide its classification, which is the same fault the Google News
  // link-list had.
  test('drops scripts, styles and navigation rather than reading them as prose', () => {
    const html = `<html><body><article>
      <script>var bank = "lending";</script>
      <style>.bank { color: red }</style>
      <p>${long('Barclays put an AI assistant into compliance review.')}</p>
    </article></body></html>`;
    const body = extractBody(html)!;
    expect(body).toContain('Barclays put an AI assistant');
    expect(body).not.toContain('var bank');
    expect(body).not.toContain('color: red');
  });

  test('gives paragraphs sentence boundaries so a heading does not fuse with the text', () => {
    const html = `<html><body><article>
      <h1>AI at the bank</h1><p>${long('The rollout reached 1,500 employees.')}</p>
    </article></body></html>`;
    expect(extractBody(html)).toMatch(/AI at the bank\.\s/);
  });

  test('a cookie wall or a stub is nothing, not a short article', () => {
    expect(extractBody('<html><body><p>Accept cookies to continue.</p></body></html>')).toBeNull();
    expect(extractBody('<html><body></body></html>')).toBeNull();
    expect(extractBody('')).toBeNull();
  });

  test('caps at the column width so a long feature cannot overflow the row', () => {
    const html = `<html><body><article><p>${long('A bank deployed AI.', 900)}</p></article></body></html>`;
    expect(extractBody(html)!.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });

  test('entities are decoded, so quotes read as quotes', () => {
    const html = `<html><body><article><p>${long('The bank&#39;s &quot;copilot&quot; is live now.')}</p></article></body></html>`;
    const body = extractBody(html)!;
    expect(body).toContain("bank's");
    expect(body).toContain('"copilot"');
  });
});

describe('what counts as a page worth reading', () => {
  test('accepts HTML and XHTML', () => {
    expect(isHtmlResponse('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlResponse('application/xhtml+xml')).toBe(true);
  });

  // A PDF or an image would otherwise be run through the tag stripper and
  // stored as gibberish that the classifier then reads.
  test('rejects anything else, including a missing header', () => {
    expect(isHtmlResponse('application/pdf')).toBe(false);
    expect(isHtmlResponse('image/jpeg')).toBe(false);
    expect(isHtmlResponse(null)).toBe(false);
  });
});

describe('links that never leave the aggregator', () => {
  // 322 of 331 articles in a real day arrive as news.google.com tokens, and
  // base64-decoding every one of them yielded a publisher URL for none: the
  // destination is not in the link. It is in the interstitial page.
  test('reads the destination out of a data attribute', () => {
    expect(destinationFrom('<a data-n-au="https://www.reuters.com/tech/dbs-ai">x</a>'))
      .toBe('https://www.reuters.com/tech/dbs-ai');
  });

  test('reads it from a canonical link', () => {
    expect(destinationFrom('<link rel="canonical" href="https://www.ft.com/x"/>'))
      .toBe('https://www.ft.com/x');
  });

  test('decodes entities, so a query string survives intact', () => {
    expect(destinationFrom('<a data-n-au="https://x.example/a?b=1&amp;c=2">x</a>'))
      .toBe('https://x.example/a?b=1&c=2');
  });

  // A link back to Google is not an escape from Google.
  test('never returns another aggregator URL as the destination', () => {
    expect(destinationFrom('<a data-n-au="https://news.google.com/rss/articles/CBMiAbc">x</a>'))
      .toBeNull();
  });

  test('says so when the page carries no destination at all', () => {
    expect(destinationFrom('<html><body>Before you continue to Google</body></html>'))
      .toBeNull();
  });
});

describe('reporting why a read failed', () => {
  const report = {
    attempted: 332, fetched: 3, chars: 11517,
    reasons: { 'still-aggregator': 300, 'http-error': 20, 'too-short': 9 },
    hosts: { 'news.google.com': 300, 'www.ft.com': 5 },
  };

  test('ranks the reasons, so the dominant one is the first thing read', () => {
    const lines = describeFailures(report);
    expect(lines[0]).toContain('still-aggregator');
    expect(lines[0]).toContain('90%');
  });

  test('names the hosts refusing, which is what a fix has to target', () => {
    expect(describeFailures(report).at(-1)).toContain('news.google.com (300)');
  });

  test('an empty breakdown produces no misleading lines', () => {
    expect(describeFailures({ attempted: 0, fetched: 0, chars: 0, reasons: {}, hosts: {} }))
      .toEqual([]);
  });
});
