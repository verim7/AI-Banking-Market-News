/**
 * Where this tool's coverage actually begins.
 *
 * Not a rolling window. Daily ingestion started in July 2026 and everything
 * before it is backfill of very uneven density — 25 graded articles in July
 * against 448 in August, and single figures per month across 2024. A rolling
 * twelve months opened the Lens on eighteen months of that thinness, so the
 * trend chart's left half showed the collection ramping up rather than the
 * market moving, which is a different story told in the same shape.
 *
 * Move this date when the backfill is dense enough to be worth showing, and not
 * for any other reason.
 *
 * It lives here rather than in a page because two pages now open on it — the
 * Market Lens and Trends & Summary — and their numbers only reconcile while
 * they start from the same day.
 */
export const COVERAGE_START = '2026-07-01';

/** `2026-07-01` as `1 Jul 2026`. Long enough to read, short enough for a chip. */
export function humanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}

/**
 * What the date window is, in one line.
 *
 * Both ends are optional and each combination reads differently, which is the
 * only reason this is a function rather than a template string at the call
 * site. "All dates" is stated rather than left blank: an empty window is a
 * choice someone made, and a chip row that simply omits it looks like the
 * filter was lost.
 */
export function windowNote(from: string, to: string): string {
  if (from && to) return `${humanDate(from)} to ${humanDate(to)}`;
  if (from) return `Since ${humanDate(from)}`;
  if (to) return `Up to ${humanDate(to)}`;
  return `All dates · back to ${humanDate(COVERAGE_START)}`;
}
