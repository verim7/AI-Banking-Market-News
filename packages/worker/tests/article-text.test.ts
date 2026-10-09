import { describe, expect, it } from 'vitest';
import { articleWords, READER_QUOTE, READER_SUMMARY } from '@portal/shared';
import { cleanNote, QUOTE_MAX, queueSql, SUMMARY_MAX } from '../src/routes/article-text.ts';

describe('the article text list', () => {
  it('lists what no layer could read, once each, from the last week', () => {
    const sql = queueSql(20);
    expect(sql).toContain('a.browser_tried_at IS NULL');
    expect(sql).toContain('a.duplicate_of IS NULL');
    expect(sql).toContain("datetime('now', '-7 days')");
    expect(sql).toContain('LIMIT 20');
    expect(queueSql(5000)).toContain('LIMIT 100');
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
