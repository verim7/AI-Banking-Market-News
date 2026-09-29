import { describe, expect, it } from 'vitest';
import { CANONICAL_ORIGIN, isCrossSite, movedTo } from '../src/canonical.ts';

describe('movedTo', () => {
  it('sends the old workers.dev page to the tracker domain, link intact', () => {
    expect(movedTo('https://ai-banking-market-news.example.workers.dev/?tab=lens&from=2026-09-01&to=2026-09-30&grade=A'))
      .toBe(`${CANONICAL_ORIGIN}/?tab=lens&from=2026-09-01&to=2026-09-30&grade=A`);
    expect(movedTo('https://ai-banking-market-news.example.workers.dev/'))
      .toBe(`${CANONICAL_ORIGIN}/`);
  });

  it('leaves the tracker domain and a local run where they are', () => {
    expect(movedTo(`${CANONICAL_ORIGIN}/?tab=lens`)).toBeNull();
    expect(movedTo('http://localhost:8787/?tab=lens')).toBeNull();
    expect(movedTo('http://127.0.0.1:8787/')).toBeNull();
  });
});

describe('isCrossSite', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://tracker.ai-banking-brief.com/api/hil/x', { method: 'PUT', headers });

  it('refuses what a browser marks as another site, or whose Origin is another host', () => {
    expect(isCrossSite(req({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSite(req({ origin: 'https://evil.example' }))).toBe(true);
    expect(isCrossSite(req({ origin: 'null' }))).toBe(true);
    expect(isCrossSite(req({ origin: 'https://tracker.ai-banking-brief.com.evil.example' }))).toBe(true);
  });

  it('refuses a sibling subdomain too', () => {
    expect(isCrossSite(req({ 'sec-fetch-site': 'same-site' }))).toBe(true);
  });

  it('lets the site\'s own pages through, and requests no browser started', () => {
    expect(isCrossSite(req({ origin: 'https://tracker.ai-banking-brief.com', 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isCrossSite(req({ origin: 'https://tracker.ai-banking-brief.com' }))).toBe(false);
    expect(isCrossSite(req({}))).toBe(false);
  });

  it('trusts the browser\'s own verdict over a host name a proxy rewrote', () => {
    // Wrangler presents a local request under the production host; the page's
    // Origin is still the local one.
    expect(isCrossSite(req({ origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' }))).toBe(false);
  });
});
