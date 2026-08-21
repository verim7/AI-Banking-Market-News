import { describe, expect, test } from 'vitest';
import { pending, rowsFrom } from '../migrate.ts';

/**
 * The ledger exists because two migrations lie about being re-runnable, so
 * these assertions are about "runs once", not about SQL.
 */

describe('choosing what to apply', () => {
  const all = [
    '0001_init.sql', '0002_ai_dimensions.sql',
    '0003_use_case_evidence.sql', '0004_later.sql',
  ];

  test('applies everything against a database with no ledger entries', () => {
    expect(pending(all, new Set())).toEqual(all);
  });

  test('applies nothing when every migration is recorded', () => {
    expect(pending(all, new Set(all))).toEqual([]);
  });

  test('applies only the new file when the earlier ones are recorded', () => {
    const applied = new Set(all.slice(0, 3));
    expect(pending(all, applied)).toEqual(['0004_later.sql']);
  });

  // The specific failure this whole mechanism is for: 0002 rebuilds
  // article_scores and copies only the three pre-existing columns, so a second
  // run zeroes ai_intensity for every row.
  test('never re-offers a destructive rebuild that is already recorded', () => {
    const applied = new Set(['0001_init.sql', '0002_ai_dimensions.sql']);
    expect(pending(all, applied)).not.toContain('0002_ai_dimensions.sql');
  });

  test('order is preserved, so a later migration cannot run before an earlier one', () => {
    expect(pending(all, new Set(['0002_ai_dimensions.sql']))).toEqual([
      '0001_init.sql', '0003_use_case_evidence.sql', '0004_later.sql',
    ]);
  });
});

describe('reading rows out of wrangler output', () => {
  test('finds results in the array envelope', () => {
    const json = '[{"results":[{"filename":"0001_init.sql"}],"success":true}]';
    expect(rowsFrom(json)).toEqual([{ filename: '0001_init.sql' }]);
  });

  test('skips the human-readable preamble wrangler prints before the JSON', () => {
    const json = '🌀 Executing on remote database portal:\n[{"results":[{"n":1}]}]';
    expect(rowsFrom(json)).toEqual([{ n: 1 }]);
  });

  test('returns nothing rather than throwing on output with no JSON', () => {
    expect(rowsFrom('Executing...')).toEqual([]);
    expect(rowsFrom('[not json')).toEqual([]);
  });

  test('an empty result set reads as no migrations applied', () => {
    expect(rowsFrom('[{"results":[],"success":true}]')).toEqual([]);
  });
});
