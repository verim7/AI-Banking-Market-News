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
  | 'published' | 'title' | 'use_case' | 'ai_intensity' | 'agent_stage'
  | 'ai_type' | 'l1_process' | 'maturity' | 'banking_area' | 'bank_category';

export interface Column {
  id: ColumnId;
  /** Null where the column is not sortable. */
  key: SortKey | null;
  label: string;
  className?: string;
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
export const FROZEN: ColumnId[] = ['published', 'title'];

/** The columns a page shows, in order, honouring its `hide` list. */
export function visibleColumns(hide: readonly ColumnId[] = []): Column[] {
  const hidden = new Set(hide.filter((id) => !FROZEN.includes(id)));
  return COLUMNS.filter((c) => !hidden.has(c.id));
}

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
 * and Excel exports, which carry every field whatever the page shows.
 */
export const LENS_HIDDEN: ColumnId[] = ['ai_type', 'banking_area', 'bank_category'];
