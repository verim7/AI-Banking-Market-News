/**
 * The weekly digest's written summary, and the check that keeps it honest.
 *
 * Everything else in the digest is either counted from D1 or quoted from a
 * reviewer. The summary is the one paragraph a model composes: three to five
 * sentences at the top of the email saying what the week meant. It is written
 * by the weekly Claude Code Routine (see docs/weekly-digest.md), never by a
 * workflow, and it reaches colleagues only after a person has read it.
 *
 * A sentence that sounds right and is not is the failure this exists to stop.
 * So every sentence carries the articles it rests on, and `validateDigest`
 * refuses a summary that:
 *
 *  - cites an article that is not in this issue,
 *  - names an institution that none of its cited articles is about,
 *  - states a number that is neither a count the email shows nor a figure
 *    printed in a cited article,
 *  - runs past the length a summary is allowed,
 *  - shouts: capital-letter words the sources do not use, or exclamation marks.
 *
 * A refused summary is left out of the issue rather than sent wrong.
 */

export interface DigestSentence {
  text: string;
  /** Article ids this sentence rests on. At least one. */
  cites: string[];
}

export interface DigestSummary {
  /** ISO week, e.g. `2026-W40`. Must match the issue it is attached to. */
  week: string;
  sentences: DigestSentence[];
}

/** What the issue actually holds, for the summary to be checked against. */
export interface DigestFacts {
  week: string;
  /** Every article in the issue, by id: its institution and its words. */
  articles: ReadonlyMap<string, { actor: string | null; text: string }>;
  /** Every number the email itself prints. */
  counts: readonly number[];
  /**
   * Institution names the checker should look for in the text. Passed in by
   * the caller (the tier registry lives with the web code), so this module
   * stays free of it.
   */
  names: readonly string[];
}

export const DIGEST_MAX_SENTENCES = 5;
export const DIGEST_MAX_CHARS = 700;

/** `2026-09-28` → `2026-W40`, ISO 8601 (weeks start Monday, week 1 holds 4 January). */
export function isoWeek(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  d.setUTCDate(d.getUTCDate() - day + 3); // the Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000
    - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const unaccent = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
const fold = (s: string) => unaccent(s).toLowerCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether `name` appears in `text` as whole words, ignoring accents.
 *
 * Case matters only when looking for a name in prose (`exactCase`): an
 * institution is written with its capitals, and without them "Block" the
 * payments firm and "block" the verb are one word.
 */
function mentions(text: string, name: string, exactCase = false): boolean {
  const f = exactCase ? unaccent : fold;
  const n = f(name).trim();
  if (n.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, 'u').test(f(text));
}

/** Every number written in digits, with thousands separators and decimals read as one. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

/** Problems with a summary; an empty list means it may be sent. */
export function validateDigest(summary: DigestSummary, facts: DigestFacts): string[] {
  const problems: string[] = [];
  const sentences = summary.sentences ?? [];

  if (summary.week !== facts.week) {
    problems.push(`written for ${summary.week}, but this issue is ${facts.week}`);
  }
  if (sentences.length === 0) problems.push('has no sentences');
  if (sentences.length > DIGEST_MAX_SENTENCES) {
    problems.push(`has ${sentences.length} sentences; at most ${DIGEST_MAX_SENTENCES}`);
  }
  const chars = sentences.reduce((n, s) => n + s.text.length, 0);
  if (chars > DIGEST_MAX_CHARS) {
    problems.push(`is ${chars} characters; at most ${DIGEST_MAX_CHARS}`);
  }

  sentences.forEach((s, i) => {
    const at = `sentence ${i + 1}`;
    const text = s.text ?? '';
    if (!text.trim()) { problems.push(`${at} is empty`); return; }
    if (!s.cites?.length) { problems.push(`${at} cites no article`); return; }

    const cited = s.cites.map((id) => facts.articles.get(id));
    s.cites.forEach((id, j) => {
      if (!cited[j]) problems.push(`${at} cites ${id}, which is not in this issue`);
    });
    const sources = cited.filter((c): c is { actor: string | null; text: string } => Boolean(c));
    const sourceText = sources.map((c) => `${c.actor ?? ''} ${c.text}`).join(' ');

    // Institutions: each one named must be the subject of a cited article.
    // Longest names first, and a name inside a longer one already matched is
    // not checked again — "Bank of America" must not also count as "America".
    const named: string[] = [];
    for (const name of [...facts.names].sort((a, b) => b.length - a.length)) {
      if (!mentions(text, name, true)) continue;
      if (named.some((n) => mentions(n, name))) continue;
      named.push(name);
      const backed = sources.some((c) => c.actor && (mentions(c.actor, name) || mentions(name, c.actor)));
      if (!backed) problems.push(`${at} names ${name}, but no article it cites is about ${name}`);
    }

    // Numbers: a count the email prints, or a figure in a cited article. The
    // institutions' own names are removed first — N26 is a bank, not a claim.
    let bare = text;
    for (const n of named) bare = bare.replace(new RegExp(escape(n), 'gi'), ' ');
    const allowed = new Set([...facts.counts, ...numbersIn(sourceText)]);
    for (const n of numbersIn(bare)) {
      if (!allowed.has(n)) problems.push(`${at} states ${n}, which neither the email nor a cited article says`);
    }

    // Tone. The house style forbids capital-letter words; an acronym the
    // sources themselves use (HSBC, KYC) is a name, not shouting.
    for (const w of text.match(/\b[A-Z]{4,}\b/g) ?? []) {
      if (!new RegExp(`\\b${w}\\b`).test(sourceText) && !facts.names.some((n) => n.includes(w))) {
        problems.push(`${at} writes "${w}" in capitals`);
      }
    }
    if (text.includes('!')) problems.push(`${at} uses an exclamation mark`);
  });

  return problems;
}
