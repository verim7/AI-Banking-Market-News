import { describe, expect, test } from 'vitest';
import { classifyStored, rescoreStatements, type StoredArticle } from '../src/rescore.ts';

/**
 * Rescoring is the repair path for scores lost to a migration, so the
 * assertions are about recovering real values from stored text — not about
 * the statements merely being well-formed.
 */

const stored = (over: Partial<StoredArticle> = {}): StoredArticle => ({
  id: 'a1',
  title: 'DBS rolls out generative AI assistant for relationship managers',
  summary: 'The bank said the tool is now live across its wealth business after a pilot.',
  excerpt: null,
  publisher_kind: 'media',
  published_at: '2026-06-01T00:00:00Z',
  region_hint: null,
  url_original: 'https://example.com/dbs-ai',
  ...over,
});

describe('recomputing what the migration destroyed', () => {
  test('an AI banking article scores a real intensity, not zero', () => {
    const c = classifyStored(stored());
    expect(c.aiIntensity).toBeGreaterThan(0);
  });

  test('maturity and its evidence come back from the stored text', () => {
    const c = classifyStored(stored());
    expect(c.maturity).toBe('in_production');
    expect(c.maturityEvidence).toBeTruthy();
  });

  test('the use case is quoted from the article, never invented', () => {
    const row = stored();
    const c = classifyStored(row);
    if (c.useCaseEvidence) {
      const source = [row.title, row.summary, row.excerpt].join(' ');
      expect(source).toContain(c.useCaseEvidence);
    }
  });

  test('title alone is enough — a row with no summary still scores', () => {
    const c = classifyStored(stored({ summary: null }));
    expect(c.aiIntensity).toBeGreaterThan(0);
  });
});

describe('the statements it writes', () => {
  test('clears the old tags before writing new ones, so a removed tag disappears', () => {
    const row = stored();
    const sql = rescoreStatements(row, classifyStored(row));
    expect(sql[0]).toMatch(/^DELETE FROM article_tags WHERE article_id = 'a1';$/);
  });

  test('writes every derived column the migration reset', () => {
    const row = stored();
    const scores = rescoreStatements(row, classifyStored(row)).at(-1)!;
    for (const column of ['ai_intensity', 'maturity', 'maturity_evidence', 'use_case_evidence']) {
      expect(scores).toContain(`${column}=excluded.${column}`);
    }
  });

  test('updates the existing score row rather than failing on the primary key', () => {
    const row = stored();
    const scores = rescoreStatements(row, classifyStored(row)).at(-1)!;
    expect(scores).toContain('ON CONFLICT(article_id) DO UPDATE SET');
  });

  test('never touches the articles table — the text is the input, not the output', () => {
    const row = stored();
    for (const sql of rescoreStatements(row, classifyStored(row))) {
      expect(sql).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM) articles\b/);
    }
  });

  test("quotes in an article's own text cannot break the statement", () => {
    const row = stored({ title: "Barclays' AI 'copilot' goes live", summary: null });
    const sql = rescoreStatements(row, classifyStored(row)).at(-1)!;
    expect(sql).toContain("Barclays'' AI ''copilot'' goes live");
  });
});

describe('articles the current rules would no longer admit', () => {
  // The archive is a record of every gate this project has ever had: the
  // ingest stores what passes on the day it runs, so tightening the rules
  // leaves the older, looser admissions in place.
  const commentary = stored({
    id: 'c1',
    title: 'JPMorgan estimates US AI capex will reach $500bn, lifting GDP',
    summary: 'Analysts at the bank said in a note to clients that AI spending '
           + 'will drive the Nasdaq and chipmaker valuations higher.',
  });

  test('a market-commentary piece scores zero relevance under the current rules', () => {
    expect(classifyStored(commentary).relevanceScore).toBe(0);
  });

  test('a genuine adoption story still passes', () => {
    expect(classifyStored(stored()).relevanceScore).toBeGreaterThan(0);
  });

  test('rescoring still writes the rejected row rather than skipping it silently', () => {
    const sql = rescoreStatements(commentary, classifyStored(commentary));
    expect(sql.at(-1)).toContain('INSERT INTO article_scores');
  });
});

describe('rescore cannot reach a reviewed use case', () => {
  it('writes no statement that touches article_reviews', () => {
    // This is why reviews live in their own table. rescore deletes and rewrites
    // everything it owns, and migration 0002 once reset derived columns across
    // a database full of articles. A reviewed judgement costs a reading pass to
    // produce; losing one to a routine rebuild would be unrecoverable.
    const statements = rescoreStatements(
      {
        id: 'a1', title: 'Bank deploys AI', summary: 'A summary.', excerpt: 'Body text.',
        publisher_kind: 'media', published_at: '2026-08-01', region_hint: null,
        url_original: 'https://example.com/a1',
      },
      classifyStored({
        id: 'a1', title: 'Bank deploys AI', summary: 'A summary.', excerpt: 'Body text.',
        publisher_kind: 'media', published_at: '2026-08-01', region_hint: null,
        url_original: 'https://example.com/a1',
      }),
    );

    expect(statements.length).toBeGreaterThan(0);
    for (const sql of statements) {
      expect(sql).not.toContain('article_reviews');
    }
  });
});
