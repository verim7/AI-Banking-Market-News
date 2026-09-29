import { describe, expect, it } from 'vitest';
import { CANONICAL_ORIGIN, movedTo } from '../src/canonical.ts';

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
