import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { articleWords, evidenceInArticle, validateBatch, type ReviewRecord, type ValidationError } from '@portal/shared';
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

/** The newest decision file, by its date and then its number: "2026-09-07-10" after "2026-09-07-9". */
export function newestFile(files: readonly string[]): string | null {
  const key = (f: string) => {
    const m = f.match(/(\d{4}-\d{2}-\d{2})-(\d+)\.jsonl$/);
    return m ? `${m[1]}-${m[2]!.padStart(6, '0')}` : '';
  };
  return [...files].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).at(-1) ?? null;
}

/**
 * The grade A's of this pass whose evidence is not in the article.
 *
 * The rubric has always said the evidence is quoted word for word; until now
 * nothing checked it against the article. The text is read from the database
 * rather than from pending.jsonl, because text from the editor's browser is
 * kept out of that public file. Only the newest file is checked: earlier
 * passes were applied already, and a page that changed since must not block
 * today's grades.
 */
export async function unquotedEvidence(
  creds: D1Credentials, records: readonly ReviewRecord[],
): Promise<ReviewRecord[]> {
  const as = records.filter((r) => r.grade === 'A');
  if (as.length === 0) return [];
  const texts = new Map<string, (string | null)[]>();
  for (let i = 0; i < as.length; i += 100) {
    const ids = as.slice(i, i + 100).map((r) => L(r.articleId)).join(',');
    const rows = await queryRows<{ id: string; title: string; summary: string | null; excerpt: string | null }>(
      creds, `SELECT id, title, summary, excerpt FROM articles WHERE id IN (${ids})`);
    // A reader's note counts only for its quote: its summary is not the article's words.
    for (const r of rows) texts.set(r.id, [r.title, r.summary, articleWords(r.excerpt)]);
  }
  return as.filter((r) => !evidenceInArticle(r.evidence, texts.get(r.articleId) ?? []));
}

export interface HistoryRow {
  articleId: string; passOn: string; grade: string; previousGrade: string; file: string;
}

/**
 * Every pass after an article's first, with the grade it replaced, from the
 * decision files in the order they are replayed. Pure, so it is tested
 * against hand-made files.
 */
export function gradeHistory(files: readonly { path: string; records: Partial<ReviewRecord>[] }[]): HistoryRow[] {
  const last = new Map<string, string>();
  const out: HistoryRow[] = [];
  for (const f of files) {
    const name = f.path.split('/').at(-1) ?? f.path;
    const passOn = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
    for (const r of f.records) {
      if (!r.articleId || !r.grade) continue;
      const before = last.get(r.articleId);
      if (before !== undefined) {
        out.push({ articleId: r.articleId, passOn, grade: r.grade, previousGrade: before, file: name });
      }
      last.set(r.articleId, r.grade);
    }
  }
  // One row per article and file: a file that grades an article twice keeps its last word.
  return [...new Map(out.map((h) => [`${h.articleId}|${h.file}`, h])).values()];
}

export function historyStatements(rows: readonly HistoryRow[]): string[] {
  return [
    'DELETE FROM grade_history;',
    ...rows.map((h) => `INSERT INTO grade_history (article_id, pass_on, grade, previous_grade, file) `
      + `VALUES (${L(h.articleId)}, ${L(h.passOn)}, ${L(h.grade)}, ${L(h.previousGrade)}, ${L(h.file)});`),
  ];
}

export function updatedLedger(ledger: Ledger, records: ReviewRecord[]): Ledger {
  const reviewed = { ...ledger.reviewed };
  for (const r of records) reviewed[r.articleId] = REVIEWER;
  return { reviewed };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const dir = DECISIONS_DIR;
  const files = decisionFiles(dir);

  if (files.length === 0) {
    console.log(`No files in ${dir}. Nothing to apply.`);
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

  // Parse every file, then validate what the database will actually hold.
  //
  // The files are a ledger and they are replayed in order, so an article
  // re-graded by a later pass is written twice and only the second write
  // survives. Validating every line meant a superseded record could block a
  // batch it has no effect on — which is exactly what happened when the rubric
  // changed on 2026-08-28 and 73 A's from earlier passes became B's: every one
  // of them still failed the new rule in a file whose verdict no longer
  // reaches the database.
  //
  // Parse errors are still per-file and still fatal. A line that will not
  // parse is a broken ledger entry whatever supersedes it.
  const effective = new Map<string, { record: ReviewRecord; path: string; line: number }>();
  const parsedFiles: { path: string; records: Partial<ReviewRecord>[] }[] = [];
  let failed = false;

  for (const path of files) {
    const parsed = parseJsonl(readFileSync(path, 'utf8'), path);
    if (parsed.parseErrors.length > 0) {
      console.error(`\n${parsed.parseErrors.length} problem(s) in ${path}:`);
      console.error(describeErrors(parsed.parseErrors, path));
      failed = true;
      continue;
    }
    parsedFiles.push(parsed);
    parsed.records.forEach((record, i) => {
      const id = (record as ReviewRecord).articleId;
      if (id) effective.set(id, { record: record as ReviewRecord, path, line: i + 1 });
    });
    console.log(`  ${path}: ${parsed.records.length} record(s) read`);
  }

  const superseded = files.reduce((n, f) =>
    n + readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length, 0) - effective.size;
  if (superseded > 0) console.log(`  ${superseded} record(s) superseded by a later pass`);

  const live = [...effective.values()];
  const errors = validateBatch(live.map((e) => e.record), known);

  const newest = newestFile(files);
  if (creds && newest) {
    const fresh = live.filter((e) => e.path === newest).map((e) => e.record);
    const bad = await unquotedEvidence(creds, fresh);
    for (const r of bad) {
      const from = live.find((e) => e.record === r)!;
      console.error(`  ${from.path}:${from.line} (${r.articleId}) — grade A evidence is not in the article's `
        + `title, summary or text: "${(r.evidence ?? '').slice(0, 90)}…"`);
    }
    if (bad.length) failed = true;
    else console.log(`  ${fresh.filter((r) => r.grade === 'A').length} grade A quote(s) in ${newest} found in their articles`);
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} problem(s) in the records that would be written:`);
    // Errors carry the line number within the validated array, so they are
    // re-pointed at the file each record actually came from.
    for (const e of errors) {
      const from = live[e.line - 1];
      console.error(`  ${from?.path ?? '?'}:${from?.line ?? '?'} `
                  + `(${e.articleId ?? 'no id'}) — ${e.problem}`);
    }
    failed = true;
  }

  const all: ReviewRecord[] = live.map((e) => e.record);

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

  // The database's own count, before and after. A green run is not proof the
  // grades landed (docs/papercuts.md, first entry); these two lines are, and a
  // reader without database access — the weekly Routine among them — can check
  // the change against the grades it wrote by reading this log.
  const before = await gradeCounts(creds!);
  const reviewedAt = new Date().toISOString();
  await executeAll(creds!, [
    ...all.map((r) => reviewStatement(r, reviewedAt)),
    ...historyStatements(gradeHistory(parsedFiles)),
    ...all.flatMap((r) => reviewTagStatements(r)),
  ]);
  saveLedger(updatedLedger(loadLedger(), all));

  console.log(`\nApplied. The ledger now covers ${Object.keys(loadLedger().reviewed).length} article(s).`);
  const after = await gradeCounts(creds!);
  const line = (c: Record<string, number>) => ['A', 'B', 'D'].map((g) => `${g}=${c[g] ?? 0}`).join(' ');
  console.log(`D1 before: ${line(before)}`);
  console.log(`D1 after:  ${line(after)}`);
  console.log(`D1 change: ${['A', 'B', 'D'].map((g) => `${g}${(after[g] ?? 0) - (before[g] ?? 0) >= 0 ? '+' : ''}${(after[g] ?? 0) - (before[g] ?? 0)}`).join(' ')}`);
}

async function gradeCounts(creds: D1Credentials): Promise<Record<string, number>> {
  const rows = await queryRows<{ grade: string; n: number }>(creds,
    'SELECT grade, COUNT(*) AS n FROM article_reviews GROUP BY grade');
  return Object.fromEntries(rows.map((r) => [r.grade, Number(r.n)]));
}

if (import.meta.filename === process.argv[1]) await main();
