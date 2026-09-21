/**
 * The active filters, as chips — one per value, each removing exactly itself.
 *
 * The Market Lens used to explain its filters in prose above the table: two
 * paragraphs saying what the date window was and which grades were showing.
 * Prose cannot be clicked, so the reader had to find the matching dropdown to
 * undo anything, and the two could drift — the paragraph said "showing A only"
 * whatever the grade filter actually held.
 *
 * A chip is that sentence and the undo button at once, so they cannot disagree.
 *
 * Pure, and in `lib/` rather than beside the component, for the reason
 * `sort-keys.ts` gives: vitest here runs in the node environment with no jsdom,
 * and `tsconfig.test.json` loads `@cloudflare/workers-types`, under which
 * `api.ts` does not compile. A chip whose ✕ quietly clears the wrong field is
 * a bug no screenshot catches, so this has to be assertable.
 */

import { COVERAGE_START, windowNote } from './coverage.ts';
import { FILTER_KEY, type Filters } from './filters.ts';

export interface Chip {
  /** Stable across renders: `${field}:${value}`, or the field alone. */
  id: string;
  /** What the chip reads, dimension included. */
  text: string;
  /** The filters with this chip's value removed — or, for the date chip in its
   *  "all dates" state, with the default window put back. */
  next: Filters;
  /**
   * `remove` draws an ✕ beside the text. `restore` makes the whole chip the
   * button, because there is nothing to remove — it is the old "Back to
   * 1 July 2026" link, which is an offer rather than a filter.
   */
  action: 'remove' | 'restore';
}

/** `Region: United Kingdom`, falling back to the raw key rather than to blank. */
const describe = (labels: Map<string, string>, dimension: string, value: string) =>
  `${labels.get(dimension) ?? dimension}: ${labels.get(`${dimension}:${value}`) ?? value}`;

/**
 * One chip per active filter, in a fixed order.
 *
 * The date window comes first because it is the one filter the reader did not
 * choose — the Lens opens with it applied — and an unexplained window is what
 * made the Archive's larger total look like a different set of articles.
 *
 * `labels` is the map `filterLabels()` builds, keyed both by `dimension` and by
 * `dimension:value`. Passed in rather than imported so this stays pure and so
 * the chips cannot label a value differently from the dropdown it came from.
 */
export function chipsFor(filters: Filters, labels: Map<string, string>): Chip[] {
  const chips: Chip[] = [];

  // Always present, in one of two states. A row that simply omitted the window
  // when there was none would look like the filter had been lost rather than
  // widened, and there would be no way back to the default.
  chips.push(
    filters.from || filters.to
      ? {
        id: 'window',
        text: windowNote(filters.from, filters.to),
        next: { ...filters, from: '', to: '' },
        action: 'remove',
      }
      : {
        id: 'window',
        text: windowNote('', ''),
        next: { ...filters, from: COVERAGE_START },
        action: 'restore',
      },
  );

  // Declaration order of FILTER_KEY, so the chips do not reshuffle as values
  // are added and removed. A row whose chips move when you click one is a row
  // you have to re-read before every click.
  for (const [dimension, field] of Object.entries(FILTER_KEY)) {
    const values = (filters[field] as string[] | undefined) ?? [];
    for (const value of values) {
      chips.push({
        id: `${field}:${value}`,
        text: describe(labels, dimension, value),
        next: { ...filters, [field]: values.filter((v) => v !== value) },
        action: 'remove',
      });
    }
  }

  if (filters.search) {
    chips.push({
      id: 'search',
      text: `Search: ${filters.search}`,
      next: { ...filters, search: '' },
      action: 'remove',
    });
  }

  if (filters.minAiIntensity !== null && filters.minAiIntensity !== undefined) {
    chips.push({
      id: 'minAiIntensity',
      text: `AI focus ${filters.minAiIntensity}+`,
      next: { ...filters, minAiIntensity: null },
      action: 'remove',
    });
  }

  return chips;
}

/**
 * Whether "Clear all" would do anything.
 *
 * The date window is deliberately not counted: `clearedFilters` keeps it, so a
 * button enabled by the window alone would be a button that does nothing.
 */
export const clearableCount = (filters: Filters): number =>
  chipsFor(filters, new Map()).filter((c) => c.id !== 'window').length;
