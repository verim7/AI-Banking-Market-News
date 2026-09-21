import { useRef, type ReactNode } from 'react';
import type { Filters } from '../api.ts';
import { chipsFor, clearableCount } from '../lib/filter-chips.ts';
import { clearedFilters } from '../lib/filters.ts';

/**
 * The active filters, as a row of chips above the table.
 *
 * All of the thinking is in `lib/filter-chips.ts`, which is pure and tested.
 * This draws it.
 */
export function FilterChips({
  filters, labels, onChange, note,
}: {
  filters: Filters;
  /** From `filterLabels(taxonomy)` — see FilterBar.tsx. */
  labels: Map<string, string>;
  onChange: (f: Filters) => void;
  /** A quiet sentence at the end of the row, about the filters beside it. */
  note?: ReactNode;
}) {
  const chips = chipsFor(filters, labels);
  const clearable = clearableCount(filters);

  /**
   * Where focus goes when a chip removes itself.
   *
   * Removing a chip unmounts the button that was focused, and the browser
   * drops focus to <body> — so clearing three filters from the keyboard means
   * tabbing in from the top of the document three times. Focus moves to the
   * row instead, which is where the next chip is.
   */
  const row = useRef<HTMLDivElement>(null);
  const keepFocus = () => row.current?.focus();

  return (
    // tabIndex -1 so it can receive focus programmatically without joining the
    // tab order, which is the standard way to hold a place after a removal.
    <div className="filterchips" ref={row} tabIndex={-1}>
      {chips.map((chip) => (chip.action === 'remove' ? (
        <span key={chip.id} className="fchip">
          {chip.text}
          <button
            type="button"
            className="fchip-x"
            // The visible ✕ is a glyph, which a screen reader announces as
            // nothing useful. The filter it drops is named here instead.
            aria-label={`Remove filter — ${chip.text}`}
            onClick={() => { onChange(chip.next); keepFocus(); }}
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          key={chip.id}
          type="button"
          className="fchip fchip-restore"
          onClick={() => onChange(chip.next)}
        >
          {chip.text}
        </button>
      )))}

      {clearable > 0 && (
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onChange(clearedFilters(filters))}
        >
          Clear all
        </button>
      )}

      {note && <span className="filterchips-note">{note}</span>}
    </div>
  );
}
