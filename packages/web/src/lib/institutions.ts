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
import { BANDS, compareTiers, tierOf, type BandKey, type Tier } from './tiers.ts';

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
  // Accents folded first, as nameKey does: "Crédit Agricole" is
  // credit-agricole, not cr-dit-agricole.
  name.normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The institutions whose logo files actually exist in `public/logos/`.
 *
 * A mark that optimistically requested `/logos/<slug>.png` for every
 * institution on the board would be a hundred 404s on every load. To add one,
 * put the file in `packages/web/public/logos/` and add its slug here; a test
 * checks the list and the folder agree, so neither can be forgotten.
 *
 * The files are 128px transparent PNGs from each institution's Wikipedia or
 * Wikimedia Commons page, collected on 29 September 2026. The source and
 * licence of each is in `docs/logo-sources.json`. They are served by the app
 * itself: its CSP is `img-src 'self' data:`, so nothing is hot-linked.
 */
export const LOGO_SLUGS: ReadonlySet<string> = new Set<string>([
  'abn-amro', 'absa', 'adyen', 'agricultural-bank-of-china', 'airwallex', 'american-express',
  'anz', 'avaloq', 'axis-bank', 'bank-of-america', 'bank-of-baroda', 'bank-of-china',
  'bank-of-communications', 'bank-of-georgia', 'bank-of-singapore', 'barclays', 'bbva',
  'betterment', 'blackrock', 'bmo', 'bnp-paribas', 'bny', 'caixabank', 'capital-one',
  'cashfree-payments', 'china-construction-bank', 'cibc', 'citi', 'commerzbank',
  'commonwealth-bank', 'credit-agricole', 'danske-bank', 'dbs', 'deutsche-bank', 'equifax',
  'experian', 'finastra', 'fis', 'fiserv', 'gocardless', 'goldman-sachs', 'groupe-bpce',
  'hana-bank', 'hdfc-bank', 'hsbc', 'icbc', 'icici-bank', 'ing', 'intesa-sanpaolo',
  'jack-henry', 'jpmorgan', 'kb-kookmin-bank', 'lloyds', 'mastercard', 'mizuho',
  'morgan-stanley', 'mufg', 'nab', 'natwest', 'nh-nonghyup-bank', 'nordea', 'ocbc', 'paypal',
  'pnc', 'postfinance', 'rabobank', 'raiffeisen-bank-romania', 'raiffeisen-schweiz',
  'razorpay', 'royal-bank-of-canada', 'santander', 'scotiabank', 'shinhan-bank', 'smbc',
  'societe-generale', 'square', 'standard-bank', 'standard-chartered', 'state-bank-of-india',
  'state-street', 'stripe', 'talkdesk', 'td-bank', 'temenos', 'transunion', 'truist',
  'u-s-bank', 'ubs', 'unicredit', 'uob', 'vanguard', 'visa', 'wells-fargo', 'westpac',
  'woori-bank', 'worldline', 'zurcher-kantonalbank',
]);

/**
 * The logo file for an institution as the reviewer named it, or null.
 *
 * Through the tier registry, so every alias finds the one file: "BofA" and
 * "Bank of America Merrill" are both bank-of-america.png. A name the registry
 * does not know is tried as written.
 */
export function logoOf(actor: string): string | null {
  const canonical = tierOf(actor).institution?.name;
  for (const name of [canonical, actor]) {
    if (!name) continue;
    const slug = logoSlug(name);
    if (LOGO_SLUGS.has(slug)) return slug;
  }
  return null;
}

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
  /** Which band of the board it sits in, and where inside it. */
  tier: Tier;
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
 * Order inside a stage is by size, largest first — the tier of the institution
 * (`lib/tiers.ts`), then how many outlets reported the use case — and only then
 * the order the groups arrived, which is newest first. Sorting is stable, so
 * that last rule needs no code of its own.
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
      slug: logoOf(actor) ?? logoSlug(actor),
      monogram: monogram(actor),
      tier: tierOf(actor),
    });
  }

  for (const st of stages) {
    st.entries.sort((x, y) => compareTiers(x.tier, y.tier) || y.reports - x.reports);
  }
  return stages;
}

export interface BoardBand {
  key: BandKey;
  label: string;
  note: string;
  /** Every entry in this band, across all three stages. */
  count: number;
  /** The band's entries under each stage, in stage order. */
  cells: { stage: StageKey; entries: BoardEntry[] }[];
}

/**
 * The board cut the other way: one row per band, one cell per stage.
 *
 * So that Tier 1 is always the top row whatever the stages hold. Ranked
 * inside each column alone, a stage with ten Tier 1 entries would sit its
 * Tier 1 beside another stage's Tier 3, and the eye reads across. Bands with
 * nothing in them are left out — an empty "Central banks" row is a heading
 * with nothing under it.
 */
export function bandsFor(stages: readonly BoardStage[]): BoardBand[] {
  return BANDS.map((b) => {
    const cells = stages.map((st) => ({
      stage: st.key,
      entries: st.entries.filter((e) => e.tier.band === b.key),
    }));
    return { ...b, cells, count: cells.reduce((n, c) => n + c.entries.length, 0) };
  }).filter((b) => b.count > 0);
}

/** Use cases that were reviewed A but whose stage nobody stated. */
export function unstatedCount(groups: readonly Group<Reviewed>[]): number {
  const rungs = new Set<string>(STAGES.map((s) => s.key));
  return groups.filter((g) =>
    g.lead.review?.grade === 'A'
    && Boolean(g.lead.review.actor?.trim())
    && !rungs.has(g.lead.maturity)).length;
}

/**
 * The sentence at the top of the board, in the board's own unit.
 *
 * It used to count articles — "4 of 5 articles describe something running" —
 * above a board that counts use cases, so the headline and the three columns
 * under it gave two different numbers for one question. It reads the board
 * now, which is the only way the two can never disagree.
 */
export function boardMessage(stages: readonly BoardStage[]): string {
  const total = stages.reduce((n, st) => n + st.entries.length, 0);
  const running = stages.find((st) => st.key === 'in_production')?.entries.length ?? 0;
  const cases = (n: number) => `${n} named use ${n === 1 ? 'case' : 'cases'}`;

  if (total === 0) return 'No named use cases in this view yet.';
  if (running === 0) return `${cases(total)} in this view, none of them running yet.`;
  if (running === total) {
    return total === 1
      ? 'The one named use case in this view is already running.'
      : `All ${cases(total)} in this view are already running.`;
  }
  return `${running} of ${cases(total)} in this view ${running === 1 ? 'is' : 'are'} already running.`;
}
