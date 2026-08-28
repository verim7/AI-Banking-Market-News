import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, MIN_AI_INTENSITY } from '../src/classify.ts';
import type { PublisherKind } from '../src/types.ts';

/**
 * The classifier, measured against every article a reader has graded by hand.
 *
 * This is the only test in the suite with ground truth behind it. Every other
 * assertion says the code does what it was written to do; this one says whether
 * the rules agree with a person who read the articles, which is the question
 * that actually matters and the one the term lists kept getting wrong.
 *
 * Both directions are asserted on purpose. Precision alone is trivially bought
 * by classifying nothing as a deployment, so the A-graded articles have to keep
 * their maturity — if a fix earns its way past the D cases by discarding real
 * deployments, this test fails rather than rewarding it.
 *
 * The corpus lives in data/review/graded/, one file per pass, each paired by
 * filename with its decisions. It reads from there and not from
 * data/review/pending.jsonl because pending.jsonl is a working file: the next
 * `review:export` overwrites it, and the first time that happened it took the
 * ground truth for pass 1 with it and this test failed on inputs it could no
 * longer see. Graded inputs are evidence, so they are written once and kept.
 *
 * Adding a pass means dropping two files in — nothing here needs editing.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const NOW = new Date('2026-08-25T00:00:00Z');

interface Pending {
  id: string; title: string; summary: string | null; excerpt: string | null;
  publishedAt: string | null;
}
interface Decision {
  articleId: string;
  grade: 'A' | 'B' | 'C' | 'D';
  l1Process?: string;
}

const readJsonl = <T>(p: string): T[] =>
  readFileSync(resolve(ROOT, p), 'utf8').split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

const batches = readdirSync(resolve(ROOT, 'data/review/graded'))
  .filter((f) => f.endsWith('.jsonl')).sort();

const articles = batches.flatMap((f) => readJsonl<Pending>(`data/review/graded/${f}`));
const decisions = batches.flatMap((f) => readJsonl<Decision>(`data/review/decisions/${f}`));
const grades = new Map(decisions.map((d) => [d.articleId, d.grade]));

/** The process a reviewer chose, where they chose one. */
const reviewProcess = new Map(
  decisions.filter((d) => d.l1Process).map((d) => [d.articleId, d.l1Process!]));

const scored = articles.map((a) => ({
  ...a,
  grade: grades.get(a.id)!,
  c: classify({
    title: a.title, summary: a.summary, excerpt: a.excerpt,
    publisherKind: 'media' as PublisherKind, publishedAt: a.publishedAt,
    regionHint: null, now: NOW,
  }),
}));

const deployed = (x: typeof scored[number]) =>
  x.c.maturity === 'in_production' || x.c.maturity === 'pilot';

describe('the rules against every hand-graded article', () => {
  it('has the whole graded set available', () => {
    // Every graded input has a decision and vice versa. A batch added with a
    // mismatched filename would otherwise score against undefined grades and
    // quietly weaken every ratchet below.
    // Batches are not a fixed size — the fourth cleared a whole backlog and ran
    // to 200 — so this counts what is on disk rather than assuming.
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(scored.length).toBe(articles.length);
    expect(scored.every((s) => s.grade)).toBe(true);
  });

  it('no longer reads corporate news as a running deployment', () => {
    // Each of these scored in_production with AI intensity 89-100 before the
    // corporate-news gate. None describes anything running.
    const named = [
      'ADIB appoints Chief AI officer',
      'DBS Reskills 11,000 Staff',
      'DBS rolls out career advisory',
      'Goldman Sachs Safeguards Apprenticeship',
    ];
    for (const prefix of named) {
      const hit = scored.find((s) => s.title.startsWith(prefix));
      expect(hit, prefix).toBeTruthy();
      expect(deployed(hit!), `${prefix} → ${hit!.c.maturity}`).toBe(false);
    }
  });

  it('no longer reads a vendor launch as a bank deployment', () => {
    for (const prefix of ['Datalign Launches', 'Zeplyn Launches', 'Goodfin Launches',
                          'RightCapital Launches', 'Broadridge Deploys']) {
      const hit = scored.find((s) => s.title.startsWith(prefix));
      expect(hit, prefix).toBeTruthy();
      expect(deployed(hit!), `${prefix} → ${hit!.c.maturity}`).toBe(false);
    }
  });

  it('keeps the real deployments, which is the harder half', () => {
    // Precision bought by dropping these would be worthless.
    for (const prefix of ['DBS rolls out agentic AI for 1,500 bankers',
                          'Starling launches AI assistant',
                          'Bank of Singapore uses agentic AI']) {
      const hit = scored.find((s) => s.title.startsWith(prefix));
      expect(hit, prefix).toBeTruthy();
      expect(deployed(hit!), `${prefix} → ${hit!.c.maturity}`).toBe(true);
    }
  });

  it('stops attaching a process on one incidental word', () => {
    const reskill = scored.find((s) => s.title.startsWith('DBS Reskills'))!;
    const procs = reskill.c.tags.filter((t) => t.dimension === 'l1_process').map((t) => t.value);
    expect(procs).not.toContain('p18_settlement_custody');
  });

  it('classifies the process, and agrees with the reviewer when it does', () => {
    // The question this answers is "are the reviewed use cases and the
    // unreviewed articles classified by the same logic". They cannot be — one
    // is a person reading, the other is term matching — but the taxonomy is
    // shared, the precedence is fixed (review wins, rules fill in), and the
    // gap between them is measurable, which is the part that can be guaranteed.
    //
    // Before the term lists were widened from the graded pairs, the rules
    // reached 15% of the corpus and 13% of the A/B use cases, and 84% of those
    // use cases contained no P1-P38 term at all. The lists were written in
    // process-taxonomy language while headlines are written in product
    // language: "AI assistant for business customers", not "client servicing".
    const processOf = (x: typeof scored[number]) =>
      x.c.tags.filter((t) => t.dimension === 'l1_process').map((t) => t.value);

    // A only. B became AI market news on 2026-08-28, so "of the use cases"
    // has to mean the use cases and not the coverage around them.
    const useCases = scored.filter((s) => s.grade === 'A');
    const withProcess = useCases.filter((s) => processOf(s).length > 0).length;

    const decided = scored.filter((s) => processOf(s).length > 0 && grades.get(s.id));
    const both = decided.filter((s) => reviewProcess.get(s.id));
    const agreed = both.filter((s) => processOf(s).includes(reviewProcess.get(s.id)!));

    console.log(`  rules classify a process:    `
      + `${scored.filter((s) => processOf(s).length > 0).length}/${scored.length}`);
    console.log(`  …of the A use cases:         ${withProcess}/${useCases.length}`);
    console.log(`  agreement where both chose:  ${agreed.length}/${both.length}`);

    // Ratchets at the measured values. Coverage may only go up; agreement may
    // only go up. A term added to widen coverage that drags agreement down is
    // a term matching the wrong articles, and this is what says so.
    // 23/48 at the 2026-08-28 re-cut. Lower than the 0.46-of-A/B it replaced
    // reads, and not comparable to it: A is now 48 articles rather than 121,
    // and the ones that left were the strategy and vendor pieces whose process
    // the term lists found easiest. What is left is the harder half.
    expect(withProcess / useCases.length).toBeGreaterThanOrEqual(0.47);
    expect(agreed.length / both.length).toBeGreaterThanOrEqual(0.82);
  });

  it('reports the overall agreement, so a regression is visible as a number', () => {
    const dGraded = scored.filter((s) => s.grade === 'D');
    const aGraded = scored.filter((s) => s.grade === 'A');
    const bGraded = scored.filter((s) => s.grade === 'B');
    const dAsDeployment = dGraded.filter(deployed).length;
    const aAsDeployment = aGraded.filter(deployed).length;
    // The number the 2026-08-28 re-cut is really about. B is an article a
    // reader looked at and found no banking task in — ruya, a research unit, a
    // vendor launch — and every one the rules call a running deployment is a
    // row the Lens would show as a peer doing something. It cannot reach zero:
    // the rules have no way to tell "deploys agentic AI" from "deploys agentic
    // AI to draft credit memos", which is the whole reason the review exists.
    const bAsDeployment = bGraded.filter(deployed).length;

    console.log(`  D graded read as deployment: ${dAsDeployment}/${dGraded.length}`);
    console.log(`  B graded read as deployment: ${bAsDeployment}/${bGraded.length}`);
    console.log(`  A graded read as deployment: ${aAsDeployment}/${aGraded.length}`);
    console.log(`  above MIN_AI_INTENSITY:      `
      + `${scored.filter((s) => s.c.aiIntensity >= MIN_AI_INTENSITY).length}/${scored.length}`);

    // Ratchets set at the measured values, so a later change that makes either
    // direction worse fails rather than drifting quietly.
    //
    // On pass 1's batch alone the same measurement read 6/25 and 2/15 before
    // the fixes: the rules called six pieces of commentary deployments and
    // recognised two of the fifteen real ones. Both numbers moved at once,
    // which is the only kind of improvement worth having here — precision
    // alone is free if you classify nothing as a deployment.
    //
    // Raise these as the corpus grows; never lower them to make a change pass.
    expect(dAsDeployment).toBeLessThanOrEqual(1);
    expect(aAsDeployment).toBeGreaterThanOrEqual(25);
    expect(bAsDeployment / bGraded.length).toBeLessThanOrEqual(0.16);
  });
});
