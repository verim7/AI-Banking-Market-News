/**
 * The analysis table's columns, as data.
 *
 * In its own file, with no React and no `xlsx` import, for two reasons. The
 * table module pulls in the spreadsheet writer, so importing it from a test
 * costs half a megabyte to assert on an array. And the sticky CSS that freezes
 * the first two columns is positional — `:first-child` and `:nth-child(2)` —
 * so which columns those are is a fact worth being able to test.
 */

import type { SortKey } from '../lib/sort-keys.ts';

/** Stable ids, so a page can hide a column without knowing its position. */
export type ColumnId =
  | 'published' | 'title' | 'lead' | 'tier' | 'use_case' | 'ai_intensity' | 'agent_stage'
  | 'ai_type' | 'l1_process' | 'maturity' | 'banking_area' | 'bank_category';

export interface Column {
  id: ColumnId;
  /** Null where the column is not sortable. */
  key: SortKey | null;
  label: string;
  className?: string;
  /**
   * Shown only when a page asks for it. The Archive has always listed the
   * article and its use case side by side, and keeps doing so; the Lens asks
   * for the merged column instead.
   */
  optIn?: boolean;
}

// Banking area and bank category live in this table and in the article drawer,
// and nowhere else. They are facts about a row rather than useful ways to slice
// the market, so they are not filters and not charts — but absent from the app
// entirely they would leave the export carrying two columns the page never
// showed.
//
// Neither is sortable: both are multi-valued tags, and a sort key that silently
// ordered by whichever value happened to come first would be a lie in a table
// whose whole point is being checkable.
export const COLUMNS: Column[] = [
  // First, and deliberately. It used to be eighth, on the argument that the
  // table is wider than most screens so the least-needed columns belong at the
  // edge — but that put the publication date past the edge on every laptop,
  // and "when was this" is not a supporting detail in a market view. It is
  // frozen with the headline, and it carries the recency badge beneath it:
  // the date says 2026-08-28 and the badge says whether that is recent, which
  // is arithmetic no reader should have to do per row.
  { id: 'published', key: 'published', label: 'Date' },
  { id: 'title', key: 'title', label: 'Article' },
  // The Lens's headline column: the use case and the article it came from,
  // in one cell. Side by side, the reviewer's line — the one thing a reader
  // came for — got a 150px column and wrapped to nine lines, while the
  // journalist's headline beside it took more room than it. Merged, the use
  // case leads the row at full width and the article becomes its source line.
  // Not sortable: its headline is the reviewer's where there is one and the
  // article's where there is not, and a sort over that mix orders nothing.
  { id: 'lead', key: null, label: 'Use case', optIn: true },
  // Who is doing it, by size: the tier of the institution the reviewer named
  // (lib/tiers.ts). Beside the use case because it qualifies it — a Tier 1
  // bank running something is a different fact from a start-up running it.
  // Not sortable: sorting is done by the API over the whole view, and the tier
  // is read off the reviewer's `actor` here, per row, so a sort on it could
  // only order the 200 rows on the page and would claim to order them all.
  { id: 'tier', key: null, label: 'Tier', optIn: true },
  { id: 'use_case', key: null, label: 'AI use case in this article' },
  { id: 'ai_intensity', key: 'aiIntensity', label: 'AI focus', className: 'num' },
  // Was first, on the argument that it is the question the tool is asked most
  // and the one no other column answers: "Type" says agentic and stops, "Stage"
  // says in production and not of what. That argument still holds and the
  // column still leads the unfrozen half — but it is a narrow question, and on
  // the Swiss page rather than the global one. It must never be removed: the
  // Swiss scope opens sorted on it, and this header is the only way back.
  { id: 'agent_stage', key: 'agentStage', label: 'Agents running?' },
  { id: 'ai_type', key: null, label: 'Type' },
  { id: 'l1_process', key: null, label: 'L1 process' },
  { id: 'maturity', key: 'maturity', label: 'Stage' },
  { id: 'banking_area', key: null, label: 'Banking area' },
  { id: 'bank_category', key: null, label: 'Bank category' },
];

/**
 * The first two columns are frozen by CSS and cannot be hidden.
 *
 * `styles.css` pins `:first-child` and `:nth-child(2)` by position. Hiding
 * either would slide a different column under the freeze and produce a table
 * that looks correct until it is scrolled sideways — the kind of break no unit
 * test would catch, which is exactly why this list exists to be asserted on.
 */
/**
 * The two columns `styles.css` freezes, by POSITION — `:first-child` and
 * `:nth-child(2)`. The date is always first. The second is always a
 * headline: the article's, or on the Lens the merged use case. A page may
 * swap one headline for the other and may never have neither, or a
 * different column would slide under the freeze and the table would look
 * right until someone scrolled sideways.
 */
export const FROZEN: ColumnId[] = ['published', 'title'];
const HEADLINES: ColumnId[] = ['title', 'lead'];

/** The columns a page shows, in order: its `hide` list removed, its `show` list added. */
export function visibleColumns(
  hide: readonly ColumnId[] = [], show: readonly ColumnId[] = [],
): Column[] {
  const shown = new Set(show);
  const hidden = new Set(hide);
  hidden.delete('published');
  // The article headline may go only when the merged one replaces it.
  if (!shown.has('lead')) hidden.delete('title');
  return COLUMNS.filter((c) => (c.optIn ? shown.has(c.id) : !hidden.has(c.id)));
}

/** Whether a column list keeps the frozen pair the CSS assumes. */
export const keepsFrozenPair = (cols: readonly Column[]): boolean =>
  cols[0]?.id === 'published' && HEADLINES.includes(cols[1]?.id as ColumnId);

/**
 * What the Market Lens leaves out.
 *
 * **Stage is deliberately not on this list.** It was, and it should not have
 * been: how far along something is is the most useful per-row fact a market
 * view has, and the chip carries the sentence it was read from — which is what
 * makes "in production" checkable rather than merely asserted. Cutting it
 * would have saved the most width and lost the most meaning.
 *
 * Type of AI goes instead. It appears in the right pane as a breakdown of the
 * whole view, and the quoted use-case sentence beside it usually names the
 * technique anyway, so the column mostly repeated what the row already said.
 *
 * Banking area and bank category are facts about one article rather than ways
 * to slice a market. All three are still in the drawer and still in the CSV
 * and Excel exports, which carry every field whatever the page shows. *
 * Article and use case go as columns and come back as one: `lead`, below,
 * which puts the use case first and the article under it as its source.
 */
export const LENS_HIDDEN: ColumnId[] = [
  'title', 'use_case', 'ai_type', 'banking_area', 'bank_category',
];
/** What the Lens adds: the merged use-case column, in place of the two above. */
export const LENS_SHOWN: ColumnId[] = ['lead', 'tier'];
