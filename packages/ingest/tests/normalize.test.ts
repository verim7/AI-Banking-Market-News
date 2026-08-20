import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl, dedupe, normalize, parseDate, stripHtml,
} from '../src/normalize.ts';
import { parseGdeltDate } from '../src/fetch-gdelt.ts';

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
