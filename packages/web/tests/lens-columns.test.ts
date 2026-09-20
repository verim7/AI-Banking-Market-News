import { describe, expect, it } from 'vitest';
import {
  COLUMNS, FROZEN, LENS_HIDDEN, visibleColumns, type ColumnId,
} from '../src/components/columns.ts';

const ids = (hide: ColumnId[] = []) => visibleColumns(hide).map((c) => c.id);

describe('the analysis table columns', () => {
  it('opens with the date, then the headline', () => {
    // The whole point of the reorder. The date used to be eighth of ten, which
    // on any laptop meant off the right edge until the reader scrolled.
    expect(ids().slice(0, 2)).toEqual(['published', 'title']);
  });

  it('shows everything when nothing is hidden', () => {
    expect(ids()).toHaveLength(COLUMNS.length);
    expect(COLUMNS).toHaveLength(10);
  });

  it('gives the Lens seven columns, still led by date and headline', () => {
    const lens = ids(LENS_HIDDEN);
    expect(lens).toHaveLength(7);
    expect(lens.slice(0, 2)).toEqual(['published', 'title']);
    for (const gone of LENS_HIDDEN) expect(lens).not.toContain(gone);
  });

  it('refuses to hide a frozen column', () => {
    // `styles.css` freezes `:first-child` and `:nth-child(2)` by POSITION.
    // Hiding either would slide a different column under the freeze, and the
    // table would look right until someone scrolled sideways. CSS cannot
    // assert its own positional assumption, so this does.
    expect(ids(['published', 'title'])).toEqual(ids());
    expect(FROZEN).toEqual(['published', 'title']);
  });

  it('keeps the agent-stage column under every preset', () => {
    // The Swiss scope opens sorted on `agentStage` and its header is the only
    // way to re-apply that sort. Hiding it would leave that page ordered by a
    // column the reader cannot see or undo.
    const presets: ColumnId[][] = [[], LENS_HIDDEN, ['maturity'], ['banking_area']];
    for (const hide of presets) expect(ids(hide)).toContain('agent_stage');
  });

  it('sorts only on keys the API accepts', () => {
    // Mirrors SORT_COLUMNS in packages/worker/src/queries.ts. A key that is not
    // in that allowlist silently falls back to `promise`, so a header would
    // appear to do nothing.
    const serverKeys = ['grade', 'promise', 'published', 'relevance',
                        'aiIntensity', 'title', 'source', 'maturity', 'agentStage'];
    for (const c of COLUMNS) {
      if (c.key) expect(serverKeys).toContain(c.key);
    }
  });

  it('gives every column a unique id', () => {
    expect(new Set(COLUMNS.map((c) => c.id)).size).toBe(COLUMNS.length);
  });
});
