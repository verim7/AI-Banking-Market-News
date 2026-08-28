/**
 * Can GDELT give us the publisher URL that Google News withholds?
 *
 * 379 of the 559 hand-graded articles are still `news.google.com` links. They
 * are never fetched — `run.ts` skips them deliberately, because 320 such
 * requests once returned nothing — so two-thirds of the corpus reaches the
 * classifier as a headline and nothing else.
 *
 * `resolveUrls` already recovers some by looking the headline up in the
 * publisher's own feed, but a feed is a few days wide and most of these
 * articles are older than that. GDELT indexes roughly three months, is free and
 * keyless, is already a dependency, and returns **direct publisher URLs**. So
 * the same join `resolveUrls` does against a feed is worth trying against a far
 * wider index.
 *
 * This measures it and writes nothing. A rate is the whole output: if GDELT
 * recovers a usable share of the 321 in-window articles the resolver is worth
 * building, and if it does not, that is a route ruled out with a number rather
 * than an idea that gets proposed again next quarter.
 *
 * Run it where there is real network access. A remote Claude Code session has
 * none — its egress proxy refuses publishers and GDELT alike — so this ships
 * with a workflow and is meant to run there.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchGdelt, resetGdeltState } from './fetch-gdelt.ts';
import { hostOf, titleKey } from './normalize.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

interface Graded {
  id: string; title: string; url: string | null; publishedAt: string | null;
}

const arg = (name: string, fallback: number): number => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** Every graded article, from the immutable corpus rather than the database. */
function corpus(): Graded[] {
  const dir = resolve(ROOT, 'data/review/graded');
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => readFileSync(resolve(dir, f), 'utf8').split('\n')
      .filter((l) => l.trim()).map((l) => JSON.parse(l) as Graded));
}

/**
 * The headline as a GDELT phrase query.
 *
 * Quoted, so GDELT matches the words in order rather than scattering them
 * across unrelated stories, and truncated: a phrase long enough to be unique is
 * also long enough that one word the outlet changed defeats it. Ten words is
 * distinctive without being brittle.
 */
export function phraseFor(title: string, words = 10): string | null {
  const parts = titleKey(title).split(' ').filter((w) => w.length > 1);
  if (parts.length < 4) return null;
  return `"${parts.slice(0, words).join(' ')}"`;
}

/** GDELT wants YYYYMMDDHHMMSS. A story is re-reported over days, not months. */
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
function window(publishedAt: string | null, days: number) {
  if (!publishedAt) return {};
  const at = new Date(publishedAt);
  if (Number.isNaN(at.getTime())) return {};
  const span = days * 86_400_000;
  return {
    startDateTime: stamp(new Date(at.getTime() - span)),
    endDateTime: stamp(new Date(at.getTime() + span)),
  };
}

/**
 * The candidate that is the same article, or null.
 *
 * Exact title-key equality first, then a high token overlap, because outlets
 * re-title. Anything looser would count a different story about the same bank
 * as a recovery and inflate the only number this script exists to produce.
 */
export function bestMatch(
  title: string, candidates: { title: string; link: string }[],
): string | null {
  const want = titleKey(title);

  // The same floor phraseFor applies, and it has to come before the exact-match
  // path rather than after it. "AI in banking" matches "AI in banking" exactly
  // and identifies nothing — a headline that short is a topic, not an article,
  // and counting it would be the one way this measurement lies to us.
  if (want.split(' ').filter((w) => w.length > 1).length < 4) return null;

  const exact = candidates.find((c) => titleKey(c.title) === want);
  if (exact) return exact.link;

  const wanted = new Set(want.split(' ').filter((w) => w.length > 3));
  if (wanted.size < 4) return null;

  let best: { link: string; score: number } | null = null;
  for (const c of candidates) {
    const got = new Set(titleKey(c.title).split(' ').filter((w) => w.length > 3));
    let shared = 0;
    for (const w of wanted) if (got.has(w)) shared += 1;
    const score = shared / wanted.size;
    if (score >= 0.8 && (!best || score > best.score)) best = { link: c.link, score };
  }
  return best?.link ?? null;
}

async function main(): Promise<void> {
  const sample = arg('sample', 60);
  const days = arg('days', 3);
  resetGdeltState();

  const all = corpus();
  const stuck = all.filter((r) => hostOf(r.url ?? '') === 'news.google.com');

  // Newest first: GDELT indexes about three months, so an older article is a
  // question about GDELT's window rather than about this join.
  const inWindow = stuck
    .filter((r) => r.publishedAt)
    .sort((a, b) => (b.publishedAt! < a.publishedAt! ? -1 : 1))
    .slice(0, sample);

  console.log(`${all.length} graded articles; ${stuck.length} still on news.google.com.`);
  console.log(`Probing the ${inWindow.length} newest, ±${days} days each.\n`);

  let attempted = 0; let recovered = 0; let noPhrase = 0; let failed = 0;
  const hosts = new Map<string, number>();

  for (const row of inWindow) {
    const phrase = phraseFor(row.title);
    if (!phrase) { noPhrase += 1; continue; }
    attempted += 1;
    try {
      const items = await fetchGdelt(phrase, {
        ...window(row.publishedAt, days), maxRecords: 25,
      });
      const link = bestMatch(row.title, items.map((i) => ({ title: i.title, link: i.link })));
      if (link) {
        recovered += 1;
        const h = hostOf(link) ?? 'unknown';
        hosts.set(h, (hosts.get(h) ?? 0) + 1);
        console.log(`  OK   ${h.padEnd(30)} ${row.title.slice(0, 62)}`);
      } else {
        console.log(`  --   ${String(items.length).padStart(2)} candidates, no match  `
                  + `${row.title.slice(0, 52)}`);
      }
    } catch (err) {
      failed += 1;
      console.log(`  ERR  ${String(err).slice(0, 60)}`);
    }
  }

  const rate = attempted ? Math.round((recovered / attempted) * 100) : 0;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`attempted        ${attempted}`);
  console.log(`recovered        ${recovered}  (${rate}%)`);
  console.log(`no usable phrase ${noPhrase}`);
  console.log(`errors           ${failed}`);
  console.log(`\nprojected over all ${stuck.length} stuck articles: `
            + `~${Math.round(stuck.length * (recovered / (attempted || 1)))}`);
  if (hosts.size > 0) {
    console.log('\npublishers recovered:');
    for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${String(n).padStart(3)}  ${h}`);
    }
  }
}

if (import.meta.filename === process.argv[1]) await main();
