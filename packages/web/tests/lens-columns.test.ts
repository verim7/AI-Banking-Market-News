import { describe, expect, it } from 'vitest';
import {
  COLUMNS, FROZEN, keepsFrozenPair, LENS_HIDDEN, LENS_SHOWN, visibleColumns, type ColumnId,
} from '../src/components/columns.ts';

const ids = (hide: ColumnId[] = [], show: ColumnId[] = []) =>
  visibleColumns(hide, show).map((c) => c.id);
const lens = () => ids(LENS_HIDDEN, LENS_SHOWN);

describe('the analysis table columns', () => {
  it('opens with the date, then the headline', () => {
    // The whole point of the reorder. The date used to be eighth of ten, which
    // on any laptop meant off the right edge until the reader scrolled.
    expect(ids().slice(0, 2)).toEqual(['published', 'title']);
  });

  it('shows the Archive all ten, and not the Lens-only columns', () => {
    // The merged use-case column is opt-in. The Archive asks for nothing and
    // keeps the article and its use case side by side, as it always has.
    expect(ids()).toHaveLength(10);
    expect(ids()).not.toContain('lead');
    expect(ids()).not.toContain('tier');
    expect(COLUMNS).toHaveLength(12);
  });

  it('gives the Lens seven columns, led by the date, the use case and its tier', () => {
    // Article and use case merge into one cell, so the use case — the thing a
    // reader came for — gets the width instead of a 150px column beside the
    // journalist's headline.
    expect(lens()).toEqual(
      ['published', 'lead', 'tier', 'ai_intensity', 'agent_stage', 'l1_process', 'maturity']);
  });

  it('never leaves a page without a headline in the second column', () => {
    // `title` can be hidden only by a page that shows `lead` in its place.
    // Hiding it alone would put AI focus under the freeze.
    expect(ids(['title'])).toContain('title');
    expect(keepsFrozenPair(visibleColumns(['title']))).toBe(true);
    expect(keepsFrozenPair(visibleColumns(LENS_HIDDEN, LENS_SHOWN))).toBe(true);
    expect(keepsFrozenPair(visibleColumns())).toBe(true);
  });

  it('keeps Stage on the Lens, which is the decision worth guarding', () => {
    // Stage was on the cut list once. It carries the quoted sentence the
    // maturity claim was read from, so dropping it would have taken the
    // evidence with it and left "in production" as an assertion. If someone
    // adds 'maturity' back to LENS_HIDDEN to save width, this is what should
    // stop them long enough to read the comment there.
    expect(lens()).toContain('maturity');
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
    expect(lens()).toContain('agent_stage');
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
