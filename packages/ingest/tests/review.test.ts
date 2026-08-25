import { describe, expect, it } from 'vitest';
import { validateBatch, validateReview, type ReviewRecord } from '@portal/shared';
import {
  parseJsonl, reviewStatement, updatedLedger,
} from '../src/review-apply.ts';
import { pendingQuery, renderJsonl, toExportRow } from '../src/review-export.ts';

const deployed = (over: Partial<ReviewRecord> = {}): Partial<ReviewRecord> => ({
  articleId: 'a1',
  grade: 'A',
  headline: 'OCBC — credit memo drafting for underwriters',
  actor: 'OCBC',
  task: 'drafts credit memos for underwriters',
  technique: 'large language model',
  l1Process: 'p13_lending_credit_solutions',
  maturity: 'pilot',
  evidence: 'The lender is piloting a large language model that drafts credit memos.',
  ...over,
});

describe('the rubric is enforced, not merely documented', () => {
  it('accepts a complete deployed use case', () => {
    expect(validateReview(deployed(), 1)).toEqual([]);
  });

  it('refuses grade A without a named actor', () => {
    // The failure that produced the complaint: a survey reads like a
    // deployment once a plausible sentence is quoted next to it.
    const errors = validateReview(deployed({ actor: '  ' }), 1);
    expect(errors.map((e) => e.problem)).toContain('grade A requires a named actor');
  });

  it('refuses grade A without a task or a technique', () => {
    expect(validateReview(deployed({ task: null }), 1)[0]!.problem)
      .toContain('requires a task');
    expect(validateReview(deployed({ technique: null }), 1)[0]!.problem)
      .toContain('requires a technique');
  });

  it('refuses A and B without the sentence they were read from', () => {
    // The written line is the only composed text in the product, so it may
    // never travel without the evidence that lets a reader check it.
    for (const grade of ['A', 'B'] as const) {
      const errors = validateReview(deployed({ grade, evidence: null }), 1);
      expect(errors.some((e) => e.problem.includes('sentence it was read from'))).toBe(true);
    }
  });

  it('lets C and D stand on their own', () => {
    // A survey has no actor and no task by definition. Demanding them would
    // make the honest grade impossible to record.
    expect(validateReview({
      articleId: 'a1', grade: 'C', headline: 'Industry survey on AI adoption plans',
    }, 1)).toEqual([]);
  });

  it('rejects a taxonomy value that does not exist', () => {
    expect(validateReview(deployed({ l1Process: 'p99_invented' }), 1)[0]!.problem)
      .toContain('unknown l1Process');
    expect(validateReview(deployed({ aiType: 'telepathy' }), 1)[0]!.problem)
      .toContain('unknown aiType');
    expect(validateReview(deployed({ maturity: 'shipped' }), 1)[0]!.problem)
      .toContain('unknown maturity');
  });

  it('rejects an article id the database does not have', () => {
    // Otherwise the row joins to nothing and the mistake is invisible.
    const errors = validateReview(deployed({ articleId: 'typo' }), 1, new Set(['a1']));
    expect(errors[0]!.problem).toContain('not in the database');
  });

  it('rejects one article judged twice in the same file', () => {
    const errors = validateBatch([deployed(), deployed({ grade: 'D' })]);
    expect(errors.some((e) => e.problem.includes('duplicate'))).toBe(true);
  });
});

describe('a bad file is never partly applied', () => {
  it('reports a malformed line rather than skipping it', () => {
    const parsed = parseJsonl('{"articleId":"a1"}\nnot json\n', 'batch.jsonl');
    expect(parsed.records).toHaveLength(1);
    expect(parsed.parseErrors[0]).toMatchObject({ line: 2, problem: 'not valid JSON' });
  });

  it('ignores blank lines without counting them as errors', () => {
    expect(parseJsonl('{"articleId":"a1"}\n\n\n', 'b.jsonl').parseErrors).toEqual([]);
  });
});

describe('writing and exporting', () => {
  it('quotes every value it writes', () => {
    const sql = reviewStatement(
      { ...deployed(), actor: "O'Connor Bank" } as ReviewRecord, '2026-08-24T00:00:00Z');
    expect(sql).toContain("'O''Connor Bank'");
    expect(sql).toContain('INSERT OR REPLACE INTO article_reviews');
  });

  it('writes NULL, not the string "null", for absent fields', () => {
    const sql = reviewStatement(
      { articleId: 'a1', grade: 'D', headline: 'Share price commentary' } as ReviewRecord,
      '2026-08-24T00:00:00Z');
    expect(sql).toContain('NULL');
    expect(sql).not.toContain("'null'");
  });

  it('excludes already-reviewed articles from the next export', () => {
    // Without this every pass re-reads what the last one already judged.
    const sql = pendingQuery(50, ['a1', 'a2']);
    expect(sql).toContain("NOT IN ('a1','a2')");
    expect(sql).toContain('LIMIT 50');
  });

  it('only offers articles the rules found a signal in', () => {
    const sql = pendingQuery(50, []);
    expect(sql).toContain("dimension = 'ai_type'");
    expect(sql).toContain('use_case_evidence IS NOT NULL');
  });

  it('round-trips a row through export and back', () => {
    const row = toExportRow({
      id: 'a1', title: 'T', source: 'S', publishedAt: '2026-08-01', url: 'u',
      summary: 's', excerpt: null, ai_intensity: 80, maturity: 'pilot',
      use_case_evidence: 'e', tags: 'ai_type:generative_ai|region:switzerland',
    });
    expect(row.rules.tags).toEqual(['ai_type:generative_ai', 'region:switzerland']);
    expect(JSON.parse(renderJsonl([row]).trim())).toEqual(row);
  });

  it('records what it applied so the next export skips it', () => {
    const next = updatedLedger({ reviewed: { old: 'ai-review' } },
                               [deployed() as ReviewRecord]);
    expect(Object.keys(next.reviewed).sort()).toEqual(['a1', 'old']);
  });
});
