import { describe, expect, it } from 'vitest';
import { articleWords, READER_QUOTE, READER_SUMMARY } from '@portal/shared';
import {
  CHANGES_SQL, cleanNote, namesInstitution, QUOTE_MAX, queueSql, rankQueue, SUMMARY_MAX,
} from '../src/routes/article-text.ts';

describe('the article text list', () => {
  it('lists what no layer could read, once each, from the last week', () => {
    const sql = queueSql(20);
    expect(sql).toContain('a.browser_tried_at IS NULL');
    expect(sql).toContain('a.duplicate_of IS NULL');
    expect(sql).toContain("datetime('now', '-7 days')");
    expect(sql).toContain('LIMIT 20');
    expect(queueSql(5000)).toContain('LIMIT 500');
  });

  it('leaves out articles graded C or D: more text does not move them', () => {
    expect(queueSql(20)).toContain("COALESCE(rv.grade, '') NOT IN ('C', 'D')");
  });

  it('knows a tracked institution in a headline, as a whole word', () => {
    expect(namesInstitution('Deutsche Bank rolls out agentic AI for KYC')).toBe(true);
    expect(namesInstitution('How GoCardless set up an agentic Direct Debit')).toBe(true);
    expect(namesInstitution('World Bank says India should scale small AI')).toBe(false);
  });

  it('puts first what can most likely become an A', () => {
    const rows = [
      { title: 'World Bank AI report', aiIntensity: 99, grade: null },
      { title: 'Barclays deploys AI agents in operations', aiIntensity: 50, grade: 'B' },
      { title: 'HSBC trials an AI assistant', aiIntensity: 60, grade: null },
      { title: 'Vendor launches agentic platform', aiIntensity: 80, grade: 'B' },
      { title: 'UBS AI copilot for advisers', aiIntensity: 90, grade: 'A' },
    ];
    expect(rankQueue(rows).map((r) => r.title)).toEqual([
      'Barclays deploys AI agents in operations', // B, names a bank
      'HSBC trials an AI assistant', // new, names a bank
      'Vendor launches agentic platform', // B
      'World Bank AI report', // new
      'UBS AI copilot for advisers', // already A
    ]);
  });
});

describe('what the browser routine saves: a summary and one quote, never the article', () => {
  const summary = 'Toss Bank has expanded its generative AI chat agent to all customers; it handles card and loss requests.';

  it('labels the summary as the reader\'s and keeps the quote apart', () => {
    const r = cleanNote(summary, '"Toss Bank expanded its AI chat agent to all customers."');
    expect('text' in r).toBe(true);
    const text = (r as { text: string }).text;
    expect(text.startsWith(READER_SUMMARY)).toBe(true);
    expect(text).toContain(`${READER_QUOTE} Toss Bank expanded its AI chat agent to all customers.`);
    // Only the quote counts as the article's words.
    expect(articleWords(text)).toBe('Toss Bank expanded its AI chat agent to all customers.');
    expect(articleWords('A crawler excerpt.')).toBe('A crawler excerpt.');
  });

  it('a note without a quote has no article words at all', () => {
    const r = cleanNote(summary, '');
    expect(articleWords((r as { text: string }).text)).toBeNull();
  });

  it('refuses a teaser, a pasted article and a quote longer than a sentence', () => {
    expect(cleanNote('Too short.', '')).toHaveProperty('error');
    expect(cleanNote('word '.repeat(SUMMARY_MAX), '')).toHaveProperty('error');
    expect(cleanNote(summary, 'x'.repeat(QUOTE_MAX + 1))).toHaveProperty('error');
    expect(cleanNote(42, '')).toHaveProperty('error');
  });
});

describe('the re-grades the Review Queue lists', () => {
  it('only counts passes made once a browser layer supplied the text', () => {
    expect(CHANGES_SQL).toContain("a.excerpt_source IN ('local-browser', 'chromium')");
    expect(CHANGES_SQL).toContain('h.pass_on >= substr(a.excerpt_at, 1, 10)');
    expect(CHANGES_SQL).toContain("date('now', '-30 days')");
  });
});
