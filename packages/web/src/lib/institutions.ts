/**
 * The executive board: which institutions are doing what, and how far along.
 *
 * The shape is borrowed from a printed briefing — a left-to-right progression
 * with named organisations under each stage. The *spine* is not borrowed. That
 * briefing's stages (tools → workflows → operating model → assurance) are an
 * editorial reading, and nothing in this schema measures them, so filling them
 * would mean composing a classification per article. The rule this project
 * does not bend is extractive, never generative, so the ladder here is the one
 * the data actually holds: how far along the reported use case is.
 *
 * Every name on the board is `review.actor` and every line under it is
 * `review.task` — both written by a person who read the article. Nothing on
 * this page is inferred from a headline.
 *
 * Pure, and in `lib/` for the reason `sort-keys.ts` gives: vitest here runs in
 * the node environment with no jsdom, and `tsconfig.test.json` loads the
 * Workers types, under which `api.ts` does not compile.
 */

import { type Group, type Groupable } from './group-articles.ts';

/**
 * What the board reads off an article.
 *
 * Structural and a subset of `Article`, so the page passes its rows straight
 * in and a test can pass four fields and a literal.
 */
export interface Reviewed extends Groupable {
  id: string;
  url: string;
  title: string;
  publishedAt: string | null;
  /** Already `COALESCE(rv.maturity, sc.maturity, 'unknown')` server-side, so a
   *  reviewer's judgement has already won over the rules engine. */
  maturity: string;
  review: {
    grade: string;
    headline: string;
    actor: string | null;
    task: string | null;
  } | null;
}

export type StageKey = 'announced' | 'pilot' | 'in_production';

export const STAGES: readonly { key: StageKey; label: string; note: string }[] = [
  {
    key: 'announced',
    label: 'Announced',
    note: 'Stated as coming, not yet as running.',
  },
  {
    key: 'pilot',
    label: 'Pilot or testing',
    note: 'A trial, a proof of concept, a limited rollout.',
  },
  {
    key: 'in_production',
    label: 'In production',
    note: 'Described as live, rolled out or in daily use.',
  },
];

/**
 * Words that carry no identity, so they do not get a letter.
 *
 * Deliberately short. "Bank" stays in, because dropping it turns Deutsche Bank
 * and Deutsche Börse into the same two letters — and a monogram that collides
 * is worse than a long one.
 */
const NOISE = new Set(['of', 'the', 'and', 'for', 'de', 'du', 'des']);

/** Already an acronym — `DBS`, `HSBC`, `BBVA`, `ING`. */
const ACRONYM = /^[A-Z0-9]{2,4}$/;

/**
 * An institution's initials.
 *
 * The letters come out capitalised because initials *are* capitals — this is
 * content, not `text-transform: uppercase`, which the house style forbids and
 * which this deliberately does not use. Worth saying, because the two look
 * identical on screen and only one of them is allowed.
 */
export function monogram(name: string): string {
  const words = name
    .split(/[\s&/,·–—-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0 && !NOISE.has(w.toLowerCase()));

  if (words.length === 0) return '?';
  if (words.length === 1) {
    const only = words[0]!;
    // An acronym is already a monogram; shortening `DBS` to `DB` would name a
    // different bank.
    return ACRONYM.test(only) ? only : only.slice(0, 2).toUpperCase();
  }
  return words.slice(0, 3).map((w) => w[0]!).join('').toUpperCase();
}

/** `Starling Bank` → `starling-bank`, the filename a logo would be dropped at. */
export const logoSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The institutions whose logo files actually exist in `public/logos/`.
 *
 * Empty, and that is the whole point of the list: a mark that optimistically
 * requested `/logos/<slug>.svg` for every institution on the board would be a
 * hundred 404s on every load. To add one, put the file in
 * `packages/web/public/logos/` and add its slug here — the two go together, so
 * neither can be forgotten.
 *
 * Logos are not fetched from the web, and could not be even if they were
 * wanted: the app's own CSP is `img-src 'self' data:`.
 */
export const LOGO_SLUGS: ReadonlySet<string> = new Set<string>([]);

export interface BoardEntry {
  id: string;
  actor: string;
  task: string | null;
  headline: string;
  url: string;
  publishedAt: string | null;
  /** How many outlets reported this one use case, this one included. */
  reports: number;
  slug: string;
  monogram: string;
}

export interface BoardStage {
  key: StageKey;
  label: string;
  note: string;
  entries: BoardEntry[];
}

/**
 * The board, from folded groups.
 *
 * Only reviewed `A` rows with a named actor get on it. That is strict on
 * purpose: this is the page an executive reads, so every line has to be a
 * named institution doing a named thing, read from the article by a person.
 * A `B` is the news around the use cases and an unreviewed row is the
 * classifier's guess; neither belongs under a bank's name.
 *
 * Order inside a stage is the order the groups arrived, which is the order the
 * page asked for — newest first.
 */
export function boardFor(groups: readonly Group<Reviewed>[]): BoardStage[] {
  const stages: BoardStage[] = STAGES.map((s) => ({ ...s, entries: [] }));
  const byKey = new Map(stages.map((s) => [s.key as string, s]));

  for (const g of groups) {
    const a = g.lead;
    const actor = a.review?.actor?.trim();
    if (!a.review || a.review.grade !== 'A' || !actor) continue;

    const stage = byKey.get(a.maturity);
    // `research` and `unknown` are not rungs on this ladder — a use case with
    // no stated stage is not "early", it is unstated, and putting it under
    // "announced" would be reading something the article did not say. The
    // page's note says how many are held back for that reason.
    if (!stage) continue;

    stage.entries.push({
      id: a.id,
      actor,
      task: a.review.task,
      headline: a.review.headline,
      url: a.url,
      publishedAt: a.publishedAt,
      reports: g.members.length + 1,
      slug: logoSlug(actor),
      monogram: monogram(actor),
    });
  }

  return stages;
}

/** Use cases that were reviewed A but whose stage nobody stated. */
export function unstatedCount(groups: readonly Group<Reviewed>[]): number {
  const rungs = new Set<string>(STAGES.map((s) => s.key));
  return groups.filter((g) =>
    g.lead.review?.grade === 'A'
    && Boolean(g.lead.review.actor?.trim())
    && !rungs.has(g.lead.maturity)).length;
}
