import { describe, expect, it } from 'vitest';
import { DEFAULT_RELEVANCE_THRESHOLD, evidenceInArticle, MIN_AI_INTENSITY } from '@portal/shared';
import { looksLikeTheArticle, onAggregator, queueQuery, resultStatements } from '../src/browser-bodies.ts';
import { classifyStored, PRIVATE_SOURCE, rescoreStatements, type StoredArticle } from '../src/rescore-sql.ts';
import { newestFile } from '../src/review-apply.ts';
import { pendingQuery, renderJsonl, toExportRow } from '../src/review-export.ts';

/**
 * The two browser layers that fill in text the crawler could not read, and
 * what they change downstream: a second grade, private text kept out of the
 * public repository, and a grade A's quote checked against the article.
 */

const stored = (over: Partial<StoredArticle> = {}): StoredArticle => ({
  id: 'a1',
  title: 'HSBC rolls out AI agents',
  summary: null,
  excerpt: null,
  publisher_kind: 'media',
  published_at: '2026-10-06T00:00:00Z',
  region_hint: null,
  url_original: 'https://news.google.com/rss/articles/x',
  ...over,
});

const BODY = 'HSBC has rolled out AI agents that review trade finance documents for its corporate clients. '
  .repeat(4);

describe('the headless browser step', () => {
  it('only takes articles the reader is shown, still without text, and tries each once', () => {
    const sql = queueQuery('2026-10-04T00:00:00Z', 80);
    expect(sql).toContain(`sc.ai_intensity >= ${MIN_AI_INTENSITY}`);
    expect(sql).toContain(`sc.relevance_score >= ${DEFAULT_RELEVANCE_THRESHOLD}`);
    expect(sql).toContain('a.duplicate_of IS NULL');
    expect(sql).toContain('a.chromium_tried_at IS NULL');
    expect(sql).toContain("a.fetched_at >= '2026-10-04T00:00:00Z'");
    expect(sql).toContain('LIMIT 80');
  });

  it('knows when the redirect has not left Google', () => {
    expect(onAggregator('https://news.google.com/rss/articles/abc')).toBe(true);
    expect(onAggregator('https://consent.google.com/ml?continue=x')).toBe(true);
    expect(onAggregator('https://www.finextra.com/newsarticle/1')).toBe(false);
    expect(onAggregator('not a url')).toBe(true);
  });

  it('keeps only text that is the article the headline promised', () => {
    const title = 'HSBC rolls out AI agents for trade finance checks';
    expect(looksLikeTheArticle(title, BODY + ' Trade checks are faster now.')).toBe(true);
    expect(looksLikeTheArticle(title, 'Just a moment... Checking your browser before accessing the site. '
      + 'HSBC trade finance agents '.repeat(10))).toBe(false);
    expect(looksLikeTheArticle(title, 'Our cookie policy explains how we use cookies on this website. '.repeat(6)))
      .toBe(false);
  });

  it('records a failed try and nothing else', () => {
    const out = resultStatements(stored(), null, '2026-10-07T10:00:00Z', null);
    expect(out).toEqual([`UPDATE articles SET chromium_tried_at = '2026-10-07T10:00:00Z' WHERE id = 'a1';`]);
  });

  it('stores the text with its source and rescores the article from it', () => {
    const out = resultStatements(stored(), BODY, '2026-10-07T10:00:00Z', 'https://www.hsbc.com/news/1').join('\n');
    expect(out).toContain('UPDATE articles SET excerpt = ');
    expect(out).toContain("excerpt_source = 'chromium'");
    expect(out).toContain("resolved_url = 'https://www.hsbc.com/news/1'");
    expect(out).toContain('INSERT INTO article_scores');
    expect(out).toContain('chromium_tried_at');
  });
});

describe('text from the editor\'s browser stays private', () => {
  it('keeps the multi-sentence extract out of the scores, where the drawer would show it', () => {
    const row = stored({ excerpt: BODY, excerpt_source: PRIVATE_SOURCE });
    const c = classifyStored(row);
    const sql = rescoreStatements(row, c).find((s) => s.startsWith('INSERT INTO article_scores'))!;
    expect(sql).not.toContain(c.summaryExtract!.replace(/'/g, "''"));
    const open = stored({ excerpt: BODY });
    const c2 = classifyStored(open);
    const sql2 = rescoreStatements(open, c2).find((s) => s.startsWith('INSERT INTO article_scores'))!;
    expect(c2.summaryExtract).toBeTruthy();
    expect(sql2).toContain(c2.summaryExtract!.replace(/'/g, "''"));
  });

  it('is never written to the public pending file, only flagged', () => {
    const base = {
      id: 'a1', title: 'T', source: 'S', publishedAt: null, url: 'u', summary: null,
      ai_intensity: 80, maturity: 'unknown', use_case_evidence: null, tags: null,
    };
    const priv = toExportRow({ ...base, excerpt: 'subscriber text', excerpt_source: PRIVATE_SOURCE });
    expect(priv.excerpt).toBeNull();
    expect(priv.textPrivate).toBe(true);
    expect(renderJsonl([priv])).not.toContain('subscriber text');
    const open = toExportRow({ ...base, excerpt: 'open text', excerpt_source: 'chromium' });
    expect(open.excerpt).toBe('open text');
    expect(open.textPrivate).toBeUndefined();
  });
});

describe('a grade written before the text existed', () => {
  it('is offered again once text arrives after it', () => {
    const sql = pendingQuery(50, ['a1']);
    expect(sql).toContain("NOT IN ('a1')");
    expect(sql).toContain('a.excerpt_at > rv.reviewed_at');
    expect(sql).toContain('LEFT JOIN article_reviews rv');
  });

  it('carries its previous grade so the reviewer knows it is a second look', () => {
    const row = toExportRow({
      id: 'a1', title: 'T', source: 'S', publishedAt: null, url: 'u', summary: null, excerpt: 'x',
      excerpt_source: 'chromium', previous_grade: 'B',
      ai_intensity: 80, maturity: 'unknown', use_case_evidence: null, tags: null,
    });
    expect(row.regrade).toEqual({ previousGrade: 'B' });
  });
});

describe('a grade A quote is the article\'s own words', () => {
  const article = [
    'Danske Bank Completes Denmark’s AI Agent Payment With Mastercard',
    'The bank&rsquo;s co-president said &ldquo;clearly identifiable&rdquo; gains.',
    'Deutsche Bank Private Bank has introduced an agentic AI tool in Singapore and Hong Kong to support source-of-wealth checks, as it prepares for higher client onboarding volumes.',
  ];

  it('finds a headline, a sentence of the text, and quotes typed with straight marks', () => {
    expect(evidenceInArticle('Danske Bank Completes Denmark\'s AI Agent Payment With Mastercard', article)).toBe(true);
    expect(evidenceInArticle('The bank\'s co-president said "clearly identifiable" gains', article)).toBe(true);
    expect(evidenceInArticle('Deutsche Bank Private Bank has introduced an agentic AI tool in Singapore and Hong Kong '
      + 'to support source‑of‑wealth checks.', article)).toBe(true);
  });

  it('accepts a quote cut with an ellipsis, part by part', () => {
    expect(evidenceInArticle('Deutsche Bank Private Bank has introduced an agentic AI tool … to support '
      + 'source-of-wealth checks', article)).toBe(true);
  });

  it('refuses a sentence the article does not contain', () => {
    expect(evidenceInArticle('Deutsche Bank uses AI agents for KYC in Singapore.', article)).toBe(false);
    expect(evidenceInArticle('', article)).toBe(false);
    expect(evidenceInArticle('Danske Bank Completes', [])).toBe(false);
  });
});

describe('which decision file is the newest', () => {
  it('orders by date, then by number rather than by text', () => {
    expect(newestFile(['d/2026-09-07-9.jsonl', 'd/2026-09-07-10.jsonl'])).toBe('d/2026-09-07-10.jsonl');
    expect(newestFile(['d/2026-10-06-32.jsonl', 'd/2026-10-07-33.jsonl', 'd/2026-09-30-26.jsonl']))
      .toBe('d/2026-10-07-33.jsonl');
    expect(newestFile([])).toBeNull();
  });
});
