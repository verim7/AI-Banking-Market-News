import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * What the backfill has already collected.
 *
 * GDELT refuses most of a long run — the first two-year attempt landed 21 of 75
 * requests — and without a memory each re-run asks for all 75 again and lands a
 * different quarter of them. Three runs of that buy roughly what one run buys.
 * Recording the slices that succeeded turns re-running into progress: the next
 * run asks only for what is still missing, and coverage converges.
 *
 * Kept as a file in the repository rather than a database table so a run
 * carries its own memory, is visible in git history, and needs no credentials
 * to read.
 */

/** One (month, query) request that returned data. */
export interface Slice {
  month: string;      // YYYY-MM
  sourceId: string;
  items: number;
  /** The response hit the per-request cap, so this month is truncated. */
  truncated: boolean;
  collectedAt: string;
}

export interface BackfillState {
  version: 1;
  slices: Slice[];
}

const EMPTY: BackfillState = { version: 1, slices: [] };

export const sliceKey = (month: string, sourceId: string): string => `${month}|${sourceId}`;

export function loadState(path: string): BackfillState {
  if (!existsSync(path)) return { ...EMPTY, slices: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BackfillState>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.slices)) return { ...EMPTY, slices: [] };
    return { version: 1, slices: parsed.slices };
  } catch {
    // A corrupt state file must not stop a run: the worst case of ignoring it
    // is re-fetching slices we already had, which is safe and merely slow.
    return { ...EMPTY, slices: [] };
  }
}

/** Slice keys already collected, for skipping. */
export function collectedKeys(state: BackfillState): Set<string> {
  return new Set(state.slices.map((s) => sliceKey(s.month, s.sourceId)));
}

/**
 * Union of what was known and what this run collected, newest wins per slice.
 * A union rather than a replacement: each run only attempts part of the window,
 * so overwriting would discard everything the previous runs achieved.
 */
export function mergeState(previous: BackfillState, collected: Slice[]): BackfillState {
  const byKey = new Map<string, Slice>();
  for (const s of previous.slices) byKey.set(sliceKey(s.month, s.sourceId), s);
  for (const s of collected) byKey.set(sliceKey(s.month, s.sourceId), s);

  const slices = [...byKey.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.sourceId.localeCompare(b.sourceId),
  );
  return { version: 1, slices };
}

export function saveState(path: string, state: BackfillState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Months with no collected slice at all — the holes a re-run should target. */
export function missingMonths(state: BackfillState, allMonths: string[]): string[] {
  const covered = new Set(state.slices.filter((s) => s.items > 0).map((s) => s.month));
  return allMonths.filter((m) => !covered.has(m));
}
