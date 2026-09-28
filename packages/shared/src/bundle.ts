import { useCaseKey } from './classify.ts';

/**
 * Which proposals are the same thing, so the editor decides them once.
 *
 * A week's review pass proposes a grade per article, and a launch that three
 * outlets covered arrives as three cards: Deutsche Bank's source-of-wealth KYC
 * was three in a row in the first week, and a union demand in Germany was
 * four. Reading each card against its article is the point of the gate;
 * reading the same story three times is not.
 *
 * Two ways to be the same, and never across grades — an A and a B about one
 * launch are two different claims, and the editor has to see both:
 *
 *  - **The same use case.** For a proposal with an institution and a process,
 *    `useCaseKey`, the key the Market Lens folds rows on. What is bundled here
 *    is exactly what will be one line on the dashboard once published.
 *  - **The same story.** For the rest — market news has no institution field
 *    — the headlines share enough distinctive words. Deliberately strict: an
 *    over-merge would put a proposal under a card the editor might accept
 *    without opening, while a missed merge only costs one extra card.
 *
 * Nothing is decided here. A bundle is a way of showing cards, and every
 * member stays visible and can be decided on its own.
 */
export interface Bundleable {
  articleId: string;
  grade: string;
  title: string;
  actor?: string | null;
  l1Process?: string | null;
}

/**
 * Words that say nothing about which story this is: they are in every
 * headline this tracker collects. English and German, because a quarter of
 * the sources are German.
 */
const GENERIC = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'what', 'why', 'how', 'will',
  'its', 'are', 'has', 'have', 'new', 'now', 'over', 'more', 'than', 'about', 'after', 'amid',
  'your', 'their', 'says', 'said', 'first', 'next', 'age', 'era', 'via',
  'ai', 'artificial', 'intelligence', 'agentic', 'agent', 'agents', 'genai', 'generative',
  'bank', 'banks', 'banking', 'banker', 'bankers', 'financial', 'finance', 'fintech',
  'launch', 'launches', 'launched', 'unveils', 'unveil', 'announces', 'announce', 'introduces',
  'powered', 'driven', 'based', 'tool', 'tools', 'solution', 'solutions', 'platform',
  'der', 'die', 'das', 'und', 'mit', 'für', 'von', 'bei', 'ein', 'eine', 'den', 'dem', 'des',
  'bis', 'zu', 'im', 'auf', 'ki', 'banken', 'jetzt', 'wie', 'warum',
]);

/**
 * The distinctive words of a headline, crudely stemmed.
 *
 * Five letters is enough for "fordert"/"fordern", "training"/"train" and
 * "financial"/"finance" to meet, and short enough to be wrong only in ways
 * the overlap threshold absorbs. Figures keep their digits whole, with the
 * thousands separator dropped, so "80,000" in two headlines is one token.
 */
export function storyTokens(title: string): Set<string> {
  const out = new Set<string>();
  const text = title.toLowerCase().replace(/(\d),(\d{3})/g, '$1$2');
  // Hyphens split too: "AI-powered" is two generic words, not one rare one,
  // and "KI-Entlastungstage" is the distinctive "Entlastungstage".
  for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!word || GENERIC.has(word)) continue;
    if (/^\d+$/.test(word)) { out.add(word); continue; }
    if (word.length < 3) continue;
    out.add(word.slice(0, 5));
  }
  return out;
}

/**
 * Whether two headlines tell the same story.
 *
 * Two words that are rare this week — a product name and a vendor, a figure
 * and a year — are enough on their own: "Feedzai" and "Farol" in two headlines
 * are one launch however differently the rest is worded. Otherwise, either most of the shorter headline's distinctive words are in the other
 * (three at least), or the two share a third of all their words (two at
 * least). The first catches a long and a short headline for one story; the
 * second keeps two short headlines that share a single theme, such as "wealth
 * management", from meeting on that alone.
 */
export function sameStory(a: Set<string>, b: Set<string>, rare?: (t: string) => boolean): boolean {
  let shared = 0, sharedRare = 0;
  for (const t of a) {
    if (!b.has(t)) continue;
    shared += 1;
    if (rare?.(t)) sharedRare += 1;
  }
  if (shared < 2) return false;
  if (sharedRare >= 2) return true;
  const union = a.size + b.size - shared;
  if (shared >= 3 && shared / Math.min(a.size, b.size) >= 0.5) return true;
  return shared / union >= 0.34;
}

const RARE_IN = 4;
/**
 * Below this many proposals "rare" means nothing — in a list of five, every
 * word is in at most four headlines — so the rare-word rule is off.
 */
const MIN_FOR_RARE = 20;

/**
 * Bundle a list of proposals.
 *
 * Returns the bundles in the order their first member appears, members in
 * list order, so the caller's sort survives. A proposal that matches nothing
 * is a bundle of one.
 */
export function bundleProposals<T extends Bundleable>(rows: readonly T[]): T[][] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  // Union by the earlier index, so the root is always the first member and
  // the bundle keeps its place in the list.
  const join = (i: number, j: number) => {
    const a = find(i), b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };

  const byUseCase = new Map<string, number>();
  const tokens = rows.map((r) => storyTokens(r.title));

  // How many of this list's headlines use each word. A word in at most
  // RARE_IN of them names something specific to a few stories; the threshold
  // is small enough that a theme ("wealth", "fraud", "payments") never counts,
  // and large enough that a story covered four times still does.
  const df = new Map<string, number>();
  for (const set of tokens) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const rare = rows.length >= MIN_FOR_RARE
    ? (t: string) => (df.get(t) ?? 0) <= RARE_IN
    : undefined;

  rows.forEach((r, i) => {
    const key = useCaseKey({ title: r.title, actor: r.actor, l1Process: r.l1Process });
    if (key) {
      const k = `${r.grade}|${key}`;
      const seen = byUseCase.get(k);
      if (seen === undefined) byUseCase.set(k, i); else join(seen, i);
      // A named use case is bundled by what it is, not by how it was
      // headlined: two different Deutsche Bank launches in one week must stay
      // two cards even when both headlines say "Deutsche Bank deploys AI".
      return;
    }
    for (let j = 0; j < i; j++) {
      const other = rows[j]!;
      if (other.grade !== r.grade) continue;
      if (useCaseKey({ title: other.title, actor: other.actor, l1Process: other.l1Process })) continue;
      if (sameStory(tokens[i]!, tokens[j]!, rare)) join(j, i);
    }
  });

  const bundles = new Map<number, T[]>();
  rows.forEach((r, i) => {
    const root = find(i);
    const list = bundles.get(root);
    if (list) list.push(r); else bundles.set(root, [r]);
  });
  return [...bundles.values()];
}
