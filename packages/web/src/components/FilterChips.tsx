import type { ReactNode } from 'react';
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

  return (
    <div className="filterchips">
      {chips.map((chip) => (chip.action === 'remove' ? (
        <span key={chip.id} className="fchip">
          {chip.text}
          <button
            type="button"
            className="fchip-x"
            // The visible ✕ is a glyph, which a screen reader announces as
            // nothing useful. The filter it drops is named here instead.
            aria-label={`Remove filter — ${chip.text}`}
            onClick={() => onChange(chip.next)}
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
