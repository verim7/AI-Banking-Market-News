/**
 * What a link into the tracker asks for: a tab, a date window and a grade.
 *
 * The weekly email's button opens the Market Lens on the month's use cases:
 * `/?tab=lens&from=2026-09-01&to=2026-09-30&grade=A`. The local browser routine
 * opens the Review Queue with `/?tab=hil#article-text`. Anything that does not
 * parse is ignored rather than trusted, so a mangled link opens the page as
 * usual instead of an empty view. Pure, so it can be tested without a browser.
 */
export interface LinkState {
  tab?: 'lens' | 'trends' | 'hil';
  from?: string;
  to?: string;
  grades?: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GRADES = new Set(['A', 'B', 'C', 'D', 'unreviewed']);

export function readLink(search: string): LinkState {
  const q = new URLSearchParams(search);
  const out: LinkState = {};
  const tab = q.get('tab');
  if (tab === 'lens' || tab === 'trends' || tab === 'hil') out.tab = tab;
  const from = q.get('from');
  if (from && DATE.test(from)) out.from = from;
  const to = q.get('to');
  if (to && DATE.test(to)) out.to = to;
  const grades = q.getAll('grade').filter((g) => GRADES.has(g));
  if (grades.length) out.grades = grades;
  return out;
}

/** Read once, when the page opens. The address is left as it is, so a reload keeps the view. */
export const OPENING_LINK: LinkState = (() => {
  // Typed structurally: the unit tests compile without the browser's types.
  const where = (globalThis as { location?: { search: string } }).location;
  return where ? readLink(where.search) : {};
})();

/** The filter fields a link sets, and only those it set. */
export function linkFilters(link: LinkState): { from?: string; to?: string; grades?: string[] } {
  return {
    ...(link.from ? { from: link.from } : {}),
    ...(link.to ? { to: link.to } : {}),
    ...(link.grades ? { grades: link.grades } : {}),
  };
}
