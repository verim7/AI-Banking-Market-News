import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateBatch, type ReviewRecord, type ValidationError } from '@portal/shared';
import { credentialsFromEnv, executeAll, queryRows, type D1Credentials } from './load-d1.ts';
import { sqlLiteral as L } from './sql.ts';
import { loadLedger, saveLedger, type Ledger } from './review-export.ts';

/**
 * Apply reviewed use cases to the database.
 *
 * Validates the whole batch before writing anything. A partially applied file
 * is the worst outcome available: the database ends up in a state no file
 * describes, and the next export cannot tell what was written from what was
 * not. So one bad record rejects the file, and the message names the line.
 */

export const DECISIONS_DIR = 'data/review/decisions';
export const REVIEWER = 'ai-review';

export interface ParsedFile {
  path: string;
  records: Partial<ReviewRecord>[];
  parseErrors: ValidationError[];
}

/** Read one JSONL file. A malformed line is an error, never a skipped line. */
export function parseJsonl(text: string, path: string): ParsedFile {
  const records: Partial<ReviewRecord>[] = [];
  const parseErrors: ValidationError[] = [];

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      records.push(JSON.parse(line) as Partial<ReviewRecord>);
    } catch {
      parseErrors.push({ line: i + 1, articleId: null, problem: 'not valid JSON' });
    }
  });

  return { path, records, parseErrors };
}

export function decisionFiles(dir = DECISIONS_DIR): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * One row per reviewed article. INSERT OR REPLACE rather than INSERT: a later
 * pass reviewing the same article should correct the earlier judgement, not
 * fail on it.
 */
export function reviewStatement(r: ReviewRecord, reviewedAt: string): string {
  const cols = [
    'article_id', 'grade', 'headline', 'actor', 'task', 'technique', 'outcome',
    'ai_type', 'l1_process', 'use_case', 'maturity', 'evidence', 'confidence',
    'notes', 'reviewed_at', 'reviewer',
  ];
  const values = [
    L(r.articleId), L(r.grade), L(r.headline), L(r.actor ?? null), L(r.task ?? null),
    L(r.technique ?? null), L(r.outcome ?? null), L(r.aiType ?? null), L(r.l1Process ?? null),
    L(r.useCase ?? null), L(r.maturity ?? null), L(r.evidence ?? null),
    L(r.confidence ?? 'medium'), L(r.notes ?? null), L(reviewedAt), L(REVIEWER),
  ];
  return `INSERT OR REPLACE INTO article_reviews (${cols.join(', ')}) `
       + `VALUES (${values.join(', ')});`;
}

/**
 * The review's classification, written where everything reads it.
 *
 * article_tags is what the charts, the filters, the table column and the export
 * all consult; article_reviews is read by none of them. So a review that names
 * an L1 process has to put it here too, or it is a judgement nobody can see.
 *
 * A review REPLACES the rules for the dimensions it speaks to, rather than
 * adding to them. The reviewer read the article and the rules matched terms
 * against it; keeping both would put two processes on one use case and
 * reinstate exactly the over-tagging the first pass measured. Dimensions the
 * review is silent on are left to the rules, which is the same precedence
 * maturity has had all along.
 */
export function reviewTagStatements(r: ReviewRecord): string[] {
  const tags: [string, string | null | undefined][] = [
    ['l1_process', r.l1Process],
    ['ai_type', r.aiType],
    ['use_case', r.useCase],
  ];

  const out: string[] = [];
  for (const [dimension, value] of tags) {
    if (!value) continue;
    // Both sources go, not just the review's own row: a second pass that moves
    // an article from P13 to P20 must not leave P13 behind, and the rules'
    // guesses for this dimension are superseded.
    out.push(`DELETE FROM article_tags WHERE article_id = ${L(r.articleId)} `
           + `AND dimension = ${L(dimension)};`);
    out.push(`INSERT OR REPLACE INTO article_tags (article_id, dimension, value, `
           + `confidence, source) VALUES (${L(r.articleId)}, ${L(dimension)}, `
           + `${L(value)}, 1.0, 'review');`);
  }
  return out;
}

export function describeErrors(errors: ValidationError[], path: string): string {
  const lines = errors.slice(0, 20).map((e) =>
    `  ${path}:${e.line}${e.articleId ? ` (${e.articleId})` : ''} — ${e.problem}`);
  if (errors.length > 20) lines.push(`  …and ${errors.length - 20} more`);
  return lines.join('\n');
}

export function updatedLedger(ledger: Ledger, records: ReviewRecord[]): Ledger {
  const reviewed = { ...ledger.reviewed };
  for (const r of records) reviewed[r.articleId] = REVIEWER;
  return { reviewed };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const files = decisionFiles();

  if (files.length === 0) {
    console.log(`No decision files in ${DECISIONS_DIR}. Nothing to apply.`);
    return;
  }

  const creds = credentialsFromEnv();
  if (!creds && !dryRun) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN.');
    process.exitCode = 1;
    return;
  }

  // Every article id, so a typo'd one is caught here rather than written as a
  // row that joins to nothing and is invisible in the app.
  const known = creds
    ? new Set((await queryRows<{ id: string }>(creds, 'SELECT id FROM articles'))
        .map((r) => r.id))
    : undefined;

  const all: ReviewRecord[] = [];
  let failed = false;

  for (const path of files) {
    const parsed = parseJsonl(readFileSync(path, 'utf8'), path);
    const errors = [...parsed.parseErrors, ...validateBatch(parsed.records, known)];
    if (errors.length > 0) {
      console.error(`\n${errors.length} problem(s) in ${path}:`);
      console.error(describeErrors(errors, path));
      failed = true;
      continue;
    }
    all.push(...(parsed.records as ReviewRecord[]));
    console.log(`  ${path}: ${parsed.records.length} record(s) ok`);
  }

  if (failed) {
    console.error('\nNothing was written. Fix the records above and run again.');
    process.exitCode = 1;
    return;
  }

  const byGrade = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.grade] = (acc[r.grade] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n${all.length} reviewed use case(s) ready.`);
  for (const g of ['A', 'B', 'C', 'D']) console.log(`  grade ${g}: ${byGrade[g] ?? 0}`);

  if (dryRun) {
    console.log('\nDry run: nothing written.');
    return;
  }

  const reviewedAt = new Date().toISOString();
  await executeAll(creds!, [
    ...all.map((r) => reviewStatement(r, reviewedAt)),
    ...all.flatMap((r) => reviewTagStatements(r)),
  ]);
  saveLedger(updatedLedger(loadLedger(), all));

  console.log(`\nApplied. The ledger now covers ${Object.keys(loadLedger().reviewed).length} article(s).`);
}

if (import.meta.filename === process.argv[1]) await main();
