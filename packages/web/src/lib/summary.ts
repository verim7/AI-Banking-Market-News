/**
 * The headline numbers, and the sentences that read them out.
 *
 * Extracted from the Market Lens when Trends & Summary started needing the
 * same figures. Two pages computing "how many are in production" separately is
 * how two pages come to disagree about it — and this arithmetic has a history
 * of being subtly wrong in ways nobody could see, which the comments below
 * record.
 *
 * Pure, and deliberately: vitest runs in the node environment here with no
 * jsdom, so logic that returns data rather than JSX is logic that can actually
 * be asserted on.
 */

import type { Measures } from './measures.ts';

export interface Facet { dimension: string; value: string; n: number }

export interface HeadlineCounts {
  /** Articles in the filtered view. */
  total: number;
  /** Distinct use cases, folded. */
  useCases: number;
  /** Articles those use cases were folded from. */
  reports: number;
  /** Reviewed A and read as running. */
  deployed: number;
  inProduction: number;
  piloting: number;
  /** How many articles in the view a person has actually read. */
  reviewed: number;
}

export function headlineCounts(
  measures: Measures | null, facets: readonly Facet[],
): HeadlineCounts {
  // From the facets, not from the loaded articles. The page loads 200 rows, so
  // counting maturity from `articles` reported "in production among the top
  // 200" under a label that said "in production" — wrong by exactly the amount
  // nobody could see. The maturity facet is already computed across the whole
  // filtered view, server-side.
  const maturityCount = (value: string) =>
    facets.find((f) => f.dimension === 'maturity' && f.value === value)?.n ?? 0;

  const reviewed = measures?.reviewedTotal ?? 0;

  // Use cases, folded, with the article count they were folded from beside
  // them. One use case is routinely several reports, so counting articles here
  // printed the same number twice — "85 articles in view" next to "85 use
  // cases identified" — and made two different questions look like one.
  return {
    total: measures?.total ?? 0,
    useCases: reviewed > 0
      ? (measures?.reviewedUseCases ?? 0)
      : (measures?.confirmedUseCases ?? 0),
    reports: reviewed > 0
      ? (measures?.reviewedReports ?? 0)
      : (measures?.confirmedReports ?? 0),
    deployed: measures?.deployedUseCases ?? 0,
    inProduction: maturityCount('in_production'),
    piloting: maturityCount('pilot'),
    reviewed,
  };
}

/**
 * The window, spelled out, so a count never reads as a contradiction.
 *
 * `lib/coverage.ts` has a `windowNote` too, and they are deliberately
 * different: that one titles a chip (`Since 1 Jul 2026`), this one finishes a
 * tile's note (`85 · published since 2026-07-01`). Two functions with one name
 * in two modules is how the wrong one gets imported, so this one says where it
 * is used.
 */
export const tileWindowNote = (from: string) =>
  (from ? `published since ${from}` : 'all dates');

/** The biggest value in a dimension, with its count. Null when there is none. */
function topOf(
  facets: readonly Facet[], dimension: string, labels: Map<string, string>,
): { label: string; n: number } | null {
  const best = facets
    .filter((f) => f.dimension === dimension && f.n > 0 && !f.value.startsWith('__'))
    .reduce<Facet | null>((a, b) => (a === null || b.n > a.n ? b : a), null);
  return best
    ? { label: labels.get(`${dimension}:${best.value}`) ?? best.value, n: best.n }
    : null;
}

/**
 * The executive summary, as lines of text.
 *
 * Every line is a number this view already computed, read out in a sentence.
 * Nothing here is inferred, projected or rounded into a trend — the page says
 * what was counted, and the caveat above it says what the counting was of.
 *
 * Returned as strings rather than rendered here so a test can read them. A
 * summary that quietly starts saying something different is exactly the kind
 * of regression that no screenshot catches.
 */
export function summaryLines(
  counts: HeadlineCounts, facets: readonly Facet[], labels: Map<string, string>,
): string[] {
  const lines: string[] = [];
  if (counts.total === 0) return ['Nothing matches these filters yet.'];

  // The fold is the first thing to say, because the two numbers differ and a
  // reader who does not know why will assume one of them is wrong.
  lines.push(
    counts.useCases > 0
      ? `${counts.useCases} distinct AI use cases, reported across ${counts.reports} articles.`
      : `${counts.total} articles, none of them yet describing a named use case.`,
  );

  // Adoption, which is the question the page exists to answer.
  //
  // "articles" is stated rather than left to inference. The maturity facet
  // counts articles, and this line follows one that counted use cases — so
  // "4 are described as running in production" read as four use cases when it
  // meant four articles, two sentences apart and both correct.
  if (counts.inProduction > 0 || counts.piloting > 0) {
    lines.push(
      `${counts.inProduction} articles describe something running in production; `
      + `${counts.piloting} a pilot or a trial.`,
    );
  }

  const type = topOf(facets, 'ai_type', labels);
  if (type) lines.push(`The most common kind of AI is ${type.label}, in ${type.n} articles.`);

  const process = topOf(facets, 'l1_process', labels);
  if (process) lines.push(`The most covered process is ${process.label}, with ${process.n}.`);

  const region = topOf(facets, 'region', labels);
  if (region) lines.push(`Most of the activity reported is in ${region.label} (${region.n}).`);

  // How much of this a person has actually read. Last, and always stated: it
  // is the confidence interval on everything above it.
  //
  // Three cases, not two. "5 of 5 articles have been read by hand; the rest
  // are the classifier's reading" is a sentence about an empty remainder, and
  // it appeared the first time this page was rendered against a small view.
  if (counts.reviewed === 0) {
    lines.push('None of these have been reviewed by hand yet — every figure above is '
      + 'the classifier’s reading.');
  } else if (counts.reviewed >= counts.total) {
    lines.push(`All ${counts.total} articles have been read and graded by hand.`);
  } else {
    lines.push(`${counts.reviewed} of ${counts.total} articles have been read and graded `
      + 'by hand; the rest are the classifier’s reading.');
  }

  return lines;
}

/**
 * The one sentence at the top of the board.
 *
 * Computed, not written. The briefing this page's shape is borrowed from ends
 * on a slogan — "the advantage is moving from access to AI toward the
 * institution built around it" — which is a good line and is not a finding.
 * This says the dominant number and stops, because the page underneath it is
 * evidence and a headline that outruns its evidence discredits both.
 */
export function keyMessage(counts: HeadlineCounts): string {
  if (counts.useCases === 0) return 'No reviewed use cases in this view yet.';
  if (counts.inProduction === 0) {
    return `${counts.useCases} reviewed use cases, none of them yet described as running.`;
  }
  return `${counts.inProduction} of ${counts.total} articles in this view describe `
    + 'something already running in production.';
}

/**
 * What the summary is a summary *of*.
 *
 * Not decoration. Every number on that page counts news coverage: "41 in
 * production" means 41 use cases *that were reported* read as in production,
 * not that 41 exist. A page headed "where banks are with AI" that omits this
 * is claiming a market survey it has not done.
 */
export const COVERAGE_CAVEAT =
  'These count what the news reported, not what banks have built. A use case '
  + 'appears here when somebody published it, so treat every figure as a floor '
  + 'and as a picture of coverage rather than of the market.';
