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
  A: 'AI use case',
  B: 'AI market news',
  C: 'Retired — re-graded as B',
  D: 'Not relevant',
};

export const GRADE_HINTS: Record<Grade, string> = {
  A: 'A named institution and a named banking task the AI performs, both in the quoted sentence. '
   + 'How far along it is lives in Stage, not here.',
  B: 'Real AI-in-banking news with no named task: strategy and capability announcements, research '
   + 'units, internal adoption programmes, vendor launches, regulation, surveys.',
  C: 'No longer assigned. Every C was re-graded as B when "generic" and "market news" turned out '
   + 'to be the same bucket.',
  D: 'Not worth reading: share-price pieces, funding rounds, opinion.',
};

/**
 * Words too common to say anything about what an AI does.
 *
 * Deliberately short. This list only has to stop a task and a sentence from
 * agreeing on "the" and "using"; every term that names a banking activity has
 * to survive it, so anything arguable is left in.
 */
const TASK_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'its', 'their', 'our', 'this', 'that', 'are', 'was', 'were',
  'been', 'being', 'has', 'have', 'had', 'from', 'into', 'use', 'uses', 'used', 'using',
  'new', 'not', 'they', 'them', 'who', 'which', 'will', 'would', 'can', 'could', 'may',
  'might', 'all', 'also', 'other', 'more', 'most', 'first', 'than', 'then', 'over',
  'under', 'across', 'via', 'artificial', 'intelligence',
]);

/**
 * Crudely strip an inflection so "executes" matches "executed".
 *
 * The same tolerance `matcher()` in classify.ts applies to plurals, widened to
 * verb endings because a task is written as a verb phrase and an article is
 * not: a reviewer writes "drafts credit memos" about a sentence that says
 * "drafted". Crude is correct here — this decides whether two words are the
 * same claim, not what either means.
 */
const stem = (w: string): string => {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
};

const contentWords = (s: string): Set<string> => new Set(
  (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 2 && !TASK_STOPWORDS.has(w))
    .map(stem),
);

/** How much of the task the quoted sentence actually says. Tuned in taskAttested. */
export const TASK_ATTESTATION = 0.5;

/**
 * Is the task the reviewer claims actually in the sentence they quoted?
 *
 * This is the rule the whole grade turns on. The rubric asks for a task, a
 * required field always gets filled, and nothing used to check that the task
 * came from the article. So `ruya — agentic AI at a UAE digital bank` was
 * graded A on the task "runs customer-facing banking operations on agentic AI",
 * with a note on the same record reading "the specific task is not described".
 * Across the 121 A/B decisions of the first five passes, 71% of tasks were less
 * than half-attested by any text in their article.
 *
 * A task is the only composed field that decides a grade, and this makes it
 * extractive again — the same principle the summary, the evidence and the use
 * case text have followed since pass 3.
 *
 * Measured on those 121 before it shipped: genuine records cluster at 0.5 and
 * above (Bank of Singapore 4/4, Santander 3/5, DBS 5/5) and the invented ones
 * sit at zero — 21 of the 80 A records shared not one word with their own
 * evidence. The threshold sits in that gap rather than at either edge.
 *
 * A one-word task must appear outright: half of one word is not a claim.
 */
export function taskAttested(
  task: string | null | undefined, evidence: string | null | undefined,
): boolean {
  if (!task?.trim() || !evidence?.trim()) return false;

  const claimed = contentWords(task);
  if (claimed.size === 0) return false;

  const said = contentWords(evidence);
  let shared = 0;
  for (const w of claimed) if (said.has(w)) shared += 1;

  if (claimed.size === 1) return shared === 1;
  return shared >= 2 && shared / claimed.size >= TASK_ATTESTATION;
}

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

  // The rubric, enforced rather than merely documented.
  //
  // Only A carries these now. A used to mean "deployed" and B "announced",
  // which made the grade answer a question the Stage column already answers —
  // and put ruya, live but with no task named, above Santander's concrete
  // agent-executed payment because that one was a pilot. A now answers one
  // question only: is there a named institution doing a named banking task.
  //
  // Technique is recorded when the article states it, but not required. The
  // second review pass showed why: "How Wells Fargo deploys AI in payments"
  // and "Bank of Singapore Deploys AI To Accelerate Source Of Wealth
  // Verification" name the institution and the work and never say which
  // technique. Forcing those down made the grade depend on whether a
  // journalist mentioned the model, when what a bank wants to know is whether
  // a peer is running it.
  if (record.grade === 'A') {
    if (!record.actor?.trim()) fail('grade A requires a named actor');
    if (!record.task?.trim()) fail('grade A requires a task');
    if (!record.evidence?.trim()) fail('grade A requires the sentence it was read from');

    // The one that stops an A being written about an article that does not
    // support one. Reported as the two strings so the fix is obvious: quote
    // the sentence that names the task, or the article has not got one and
    // this is a B.
    if (record.task?.trim() && record.evidence?.trim()
        && !taskAttested(record.task, record.evidence)) {
      fail(`grade A task "${record.task}" is not in its evidence `
         + `"${record.evidence.slice(0, 80)}${record.evidence.length > 80 ? '…' : ''}" `
         + '— quote the sentence naming the task, or grade it B');
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
