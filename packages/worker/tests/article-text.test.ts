import { describe, expect, it } from 'vitest';
import { cleanText, MAX_CHARS, MIN_CHARS, queueSql } from '../src/routes/article-text.ts';

describe('the article text list', () => {
  it('lists what no layer could read, once each, from the last week', () => {
    const sql = queueSql(20);
    expect(sql).toContain('a.browser_tried_at IS NULL');
    expect(sql).toContain('a.duplicate_of IS NULL');
    expect(sql).toContain("datetime('now', '-7 days')");
    expect(sql).toContain('LIMIT 20');
    expect(queueSql(5000)).toContain('LIMIT 100');
  });

  it('refuses a teaser and keeps a long article to the cap', () => {
    expect(cleanText('Subscribe to read.')).toHaveProperty('error');
    expect(cleanText(42)).toHaveProperty('error');
    const ok = cleanText(`  ${'word '.repeat(MIN_CHARS)}\r\n\r\n\r\n\r\nend `);
    expect('text' in ok && ok.text.endsWith('end')).toBe(true);
    expect('text' in ok && ok.text.includes('\n\n\n')).toBe(false);
    const long = cleanText('x'.repeat(MAX_CHARS * 2));
    expect('text' in long && long.text.length).toBe(MAX_CHARS);
  });
});
