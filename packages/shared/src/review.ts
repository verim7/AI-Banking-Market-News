import { AI_TYPES, L1_PROCESSES, MATURITY_LABELS, USE_CASES } from './taxonomy.ts';

/**
 * A reviewed AI use case: the judgement that a person and a model made by
 * reading the article, as opposed to what the term matcher inferred from it.
 *
 * The rules answer "what does this article say". They cannot answer "is this a
 * use case", because a survey, a vendor launch and a real deployment all
 * contain the same words. That decision is what this record carries.
 */

export const GRADES = ['A', 'B', 'C', 'D'] as const;
export type Grade = (typeof GRADES)[number];

/**
 * What each grade means. These are the definitions the review is held to, and
 * they are exported so the UI shows the same words the reviewer worked from —
 * a legend that drifts from the rubric is worse than none.
 */
export const GRADE_LABELS: Record<Grade, string> = {
  A: 'Deployed use case',
  B: 'Announced use case',
  C: 'Generic / no named deployment',
  D: 'Not a use case',
};

export const GRADE_HINTS: Record<Grade, string> = {
  A: 'A named institution running a concrete task, with evidence it is live or piloting.',
  B: 'A named institution and a concrete task, but stated as intent — no evidence it runs yet.',
  C: 'Real AI-in-banking content with nobody named as deploying it: vendor launches, surveys, market reports.',
  D: 'Not a use case at all: commentary, share-price pieces, funding rounds, regulation, opinion.',
};

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export interface ReviewRecord {
  articleId: string;
  grade: Grade;
  /** The written one-line use case. The only composed text in the product. */
  headline: string;
  actor?: string | null;
  task?: string | null;
  technique?: string | null;
  outcome?: string | null;
  /** Overrides for rule-derived dimensions. Absent means "leave the rules alone". */
  aiType?: string | null;
  l1Process?: string | null;
  useCase?: string | null;
  maturity?: string | null;
  /** The sentence from the article supporting the headline. Required for A and B. */
  evidence?: string | null;
  confidence?: Confidence;
  notes?: string | null;
}

export interface ValidationError {
  line: number;
  articleId: string | null;
  problem: string;
}

const has = (list: readonly { value: string }[], v: string) => list.some((e) => e.value === v);

/**
 * Check one record against the taxonomy and the rubric.
 *
 * Strict on purpose, and the caller rejects the whole file rather than skipping
 * bad lines. A partially applied batch is the worst outcome available here:
 * the database ends up in a state no file describes, and the next export cannot
 * tell what was written from what was not.
 */
export function validateReview(
  record: Partial<ReviewRecord>, line: number, knownArticleIds?: Set<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = typeof record.articleId === 'string' ? record.articleId : null;
  const fail = (problem: string) => errors.push({ line, articleId: id, problem });

  if (!id) fail('articleId is missing');
  else if (knownArticleIds && !knownArticleIds.has(id)) {
    // A typo'd id would otherwise write a row that joins to nothing and is
    // invisible in the app — the hardest kind of mistake to notice.
    fail(`articleId "${id}" is not in the database`);
  }

  if (!record.grade || !GRADES.includes(record.grade)) {
    fail(`grade must be one of ${GRADES.join(', ')}`);
  }

  if (!record.headline || record.headline.trim().length < 8) {
    fail('headline is missing or too short to say anything');
  }

  // The rubric, enforced rather than merely documented: a grade claiming a
  // deployment has to name who and what, or it is a C wearing an A's badge.
  //
  // Technique is recorded when the article states it, but not required. The
  // second review pass showed why: "How Wells Fargo deploys AI in payments"
  // and "Bank of Singapore Deploys AI To Accelerate Source Of Wealth
  // Verification" name the institution and the work and never say which
  // technique. Forcing those to B made the grade depend on whether a
  // journalist mentioned the model, when what a bank wants to know is whether
  // a peer is running it.
  if (record.grade === 'A' || record.grade === 'B') {
    if (!record.actor?.trim()) fail(`grade ${record.grade} requires a named actor`);
    if (!record.task?.trim()) fail(`grade ${record.grade} requires a task`);
    if (!record.evidence?.trim()) {
      fail(`grade ${record.grade} requires the sentence it was read from`);
    }
  }

  if (record.aiType && !has(AI_TYPES, record.aiType)) fail(`unknown aiType "${record.aiType}"`);
  if (record.l1Process && !has(L1_PROCESSES, record.l1Process)) {
    fail(`unknown l1Process "${record.l1Process}"`);
  }
  if (record.useCase && !has(USE_CASES, record.useCase)) fail(`unknown useCase "${record.useCase}"`);
  if (record.maturity && !(record.maturity in MATURITY_LABELS)) {
    fail(`unknown maturity "${record.maturity}"`);
  }
  if (record.confidence && !CONFIDENCES.includes(record.confidence)) {
    fail(`unknown confidence "${record.confidence}"`);
  }

  return errors;
}

/** Validate a whole batch. An empty array means the file is safe to apply. */
export function validateBatch(
  records: Partial<ReviewRecord>[], knownArticleIds?: Set<string>,
): ValidationError[] {
  const errors = records.flatMap((r, i) => validateReview(r, i + 1, knownArticleIds));

  // One article twice in a file means two different judgements and no way to
  // know which was meant.
  const seen = new Map<string, number>();
  for (const [i, r] of records.entries()) {
    if (typeof r.articleId !== 'string') continue;
    const first = seen.get(r.articleId);
    if (first !== undefined) {
      errors.push({
        line: i + 1, articleId: r.articleId,
        problem: `duplicate of line ${first} — one article cannot have two judgements`,
      });
    } else seen.set(r.articleId, i + 1);
  }

  return errors;
}
