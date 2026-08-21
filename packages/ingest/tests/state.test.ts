import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectedKeys, loadState, mergeState, missingMonths, saveState, sliceKey,
  type BackfillState, type Slice,
} from '../src/state.ts';

const slice = (month: string, sourceId: string, items = 10, truncated = false): Slice =>
  ({ month, sourceId, items, truncated, collectedAt: '2026-08-21T00:00:00.000Z' });

const stateOf = (...slices: Slice[]): BackfillState => ({ version: 1, slices });

describe('remembering what was collected', () => {
  it('round-trips through a file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bf-')), 'state.json');
    const original = stateOf(slice('2025-01', 'gdelt_ai_banking'));
    saveState(path, original);
    expect(loadState(path).slices).toEqual(original.slices);
  });

  it('treats a missing file as nothing collected', () => {
    expect(loadState(join(tmpdir(), 'definitely-not-here-42.json')).slices).toEqual([]);
  });

  it('ignores a corrupt file rather than failing the run', () => {
    // Re-fetching a slice we already had is safe and merely slow; refusing to
    // start because a JSON file is damaged is not.
    const path = join(mkdtempSync(join(tmpdir(), 'bf-')), 'state.json');
    writeFileSync(path, '{ not json');
    expect(loadState(path).slices).toEqual([]);
  });

  it('ignores a state file from a future version', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bf-')), 'state.json');
    writeFileSync(path, JSON.stringify({ version: 99, slices: [slice('2025-01', 'x')] }));
    expect(loadState(path).slices).toEqual([]);
  });
});

describe('merging runs', () => {
  it('unions rather than replaces, so earlier runs are not discarded', () => {
    // This is the whole point: each run attempts only part of the window, so
    // overwriting would throw away everything the previous runs achieved.
    const first = stateOf(slice('2025-01', 'a'), slice('2025-02', 'a'));
    const merged = mergeState(first, [slice('2025-03', 'a')]);
    expect(merged.slices.map((s) => s.month)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('lets a newer collection of the same slice win', () => {
    const merged = mergeState(stateOf(slice('2025-01', 'a', 5)), [slice('2025-01', 'a', 250)]);
    expect(merged.slices).toHaveLength(1);
    expect(merged.slices[0]!.items).toBe(250);
  });

  it('keeps the ordering stable so the file diffs cleanly in git', () => {
    const merged = mergeState(stateOf(), [
      slice('2025-03', 'b'), slice('2025-01', 'b'), slice('2025-01', 'a'),
    ]);
    expect(merged.slices.map((s) => sliceKey(s.month, s.sourceId)))
      .toEqual(['2025-01|a', '2025-01|b', '2025-03|b']);
  });
});

describe('deciding what to skip', () => {
  it('reports collected slices as keys', () => {
    const keys = collectedKeys(stateOf(slice('2025-01', 'a'), slice('2025-02', 'b')));
    expect(keys.has('2025-01|a')).toBe(true);
    expect(keys.has('2025-01|b')).toBe(false);
  });
});

describe('finding the holes', () => {
  const months = ['2025-01', '2025-02', '2025-03'];

  it('names the months with nothing at all', () => {
    const state = stateOf(slice('2025-01', 'a'), slice('2025-03', 'a'));
    expect(missingMonths(state, months)).toEqual(['2025-02']);
  });

  it('counts a month as missing when its only slice returned nothing', () => {
    // A request that succeeded but returned zero articles leaves the month just
    // as empty as one that was refused, and the Lens cannot tell them apart.
    const state = stateOf(slice('2025-02', 'a', 0));
    expect(missingMonths(state, months)).toContain('2025-02');
  });

  it('needs only one query of several to cover a month', () => {
    const state = stateOf(slice('2025-01', 'a', 0), slice('2025-01', 'b', 12));
    expect(missingMonths(state, ['2025-01'])).toEqual([]);
  });
});
