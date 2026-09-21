/**
 * One use case, however many outlets reported it.
 *
 * `groupKey` comes from the API — the same bank and the same L1 process. Rows
 * arrive already sorted, so the first member of a group is its best row and
 * leads it; the rest fold underneath and stay one click away. Nothing is
 * hidden, which is what makes a coarse key safe here: an over-merge is a fold
 * the reader can open, not a row they never see.
 *
 * A row with no key is its own group, always. That is the common case — no
 * institution in the headline, or no process — and it must never collapse
 * with another.
 *
 * Lifted out of `AnalysisTable.tsx` when the executive board needed the same
 * fold. Two places counting "one use case" separately is how two places come
 * to disagree about it — and that module imports `xlsx`, which a unit test
 * should not have to load to assert on an array.
 *
 * Typed structurally rather than against `Article`, for the reason
 * `lib/sort-keys.ts` gives at length: `tsconfig.test.json` loads
 * `@cloudflare/workers-types`, under which `api.ts` does not compile, so what
 * a test imports must not drag the API client in behind it — not even for a
 * type.
 */

/** The three fields the fold actually reads. */
export interface Groupable {
  groupKey: string | null;
  review: unknown;
  useCaseEvidence: string | null;
}

export interface Group<T> {
  lead: T;
  members: T[];
}

/**
 * How much of the use case this particular report actually describes.
 *
 * A reviewed article has a headline and a quote written by someone who read
 * it; an unreviewed one may still carry the sentence the classifier extracted;
 * some carry neither and say so.
 */
export const describes = (a: Groupable): number =>
  (a.review ? 2 : a.useCaseEvidence ? 1 : 0);

export function groupArticles<T extends Groupable>(articles: readonly T[]): Group<T>[] {
  const groups: Group<T>[] = [];
  const at = new Map<string, number>();

  for (const a of articles) {
    const key = a.groupKey;
    if (!key) { groups.push({ lead: a, members: [] }); continue; }

    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, groups.length);
      groups.push({ lead: a, members: [] });
    } else {
      // Two different questions, and they used to have the same answer.
      //
      // WHERE the group sits is decided by the first member the sort
      // delivered — that is what makes the fold obey the chosen ordering.
      // WHICH member leads it is decided here, by how much of the use case
      // the report actually describes.
      //
      // They were the same answer only because the Lens sorted by AI focus,
      // which correlates with being the fuller write-up. Sorting by date broke
      // that: the newest of eight reports on one rollout is often a two-line
      // aggregator piece, and it would lead the group with "Not described in
      // the article" while the sibling holding the quote sat folded underneath
      // it. The fold exists to show one use case once, at its best — not to
      // show whichever report happened to land last.
      const g = groups[seen]!;
      if (describes(a) > describes(g.lead)) {
        g.members.push(g.lead);
        g.lead = a;
      } else {
        g.members.push(a);
      }
    }
  }

  return groups;
}
