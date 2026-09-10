import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, MIN_AI_INTENSITY, useCaseKey } from '../src/classify.ts';
import { chNexusOf } from '../src/swiss.ts';
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
  actor?: string | null;
  l1Process?: string;
}

const readJsonl = <T>(p: string): T[] =>
  readFileSync(resolve(ROOT, p), 'utf8').split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

const batches = readdirSync(resolve(ROOT, 'data/review/graded'))
  .filter((f) => f.endsWith('.jsonl')).sort();

const articles = batches.flatMap((f) => readJsonl<Pending>(`data/review/graded/${f}`));

/**
 * Every decision ever recorded, oldest pass first, so a later record supersedes
 * an earlier one for the same article. A correction is written as a new file
 * rather than an edit to the pass that got it wrong — the same rule
 * `review:apply` follows — and reading only the files paired with a graded
 * batch would measure the rules against a decision the reader has since
 * retracted. Sorted by pass number, because pass 10 follows pass 9.
 */
const passNumber = (f: string) => Number(f.match(/-(\d+)\.jsonl$/)?.[1] ?? 0);
const decisions = readdirSync(resolve(ROOT, 'data/review/decisions'))
  .filter((f) => f.endsWith('.jsonl'))
  .sort((a, b) => passNumber(a) - passNumber(b))
  .flatMap((f) => readJsonl<Decision>(`data/review/decisions/${f}`));

const effective = new Map(decisions.map((d) => [d.articleId, d]));
const grades = new Map([...effective.values()].map((d) => [d.articleId, d.grade]));

/** The process a reviewer chose, where they chose one. */
const reviewProcess = new Map(
  [...effective.values()].filter((d) => d.l1Process)
    .map((d) => [d.articleId, d.l1Process!]));

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

  it('does not read a clinical trial as a banking pilot', () => {
    // A Capgemini piece on pharma R&D, admitted because it says "regulator",
    // "research" and "AI" — and read as a running pilot on the word "trial".
    // Bare "trial" and "trials" are gone from the pilot terms for it.
    const hit = scored.find((s) => s.title.startsWith('Unlocking system-wide productivity'));
    expect(hit).toBeTruthy();
    expect(deployed(hit!), `${hit!.title} → ${hit!.c.maturity}`).toBe(false);
  });

  it('still reads the banking pilots that used to lean on that word', () => {
    // The cost of removing it, checked rather than assumed. Both headlines are
    // "<bank> trials AI for <thing>" and both still land on pilot, through
    // "proof of concept" and "piloting" in their own text.
    for (const prefix of ['Incore Bank trials AI for customer onboarding',
                          'OCBC trials generative AI']) {
      const hit = scored.find((s) => s.title.startsWith(prefix));
      if (!hit) continue;   // OCBC is an e2e fixture, not always in the corpus
      expect(hit.c.maturity, `${prefix} → ${hit.c.maturity}`).toBe('pilot');
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

    // Ratchets a couple of points below the measured values, and that margin is
    // deliberate rather than slack.
    //
    // These two are ratios over a corpus that grows every pass, so a batch of
    // headline-only articles moves them a point without anything changing in
    // the rules: pass 8 measured 0.500 and 0.851, pass 9 measured 0.493 and
    // 0.849 on eleven more A's and an unchanged classifier. Pinned at the exact
    // measured value they failed on arithmetic, which trains whoever sees it to
    // edit the number rather than read it.
    //
    // So: a margin, and one rule about moving them. Lower them only when the
    // corpus has grown and the classifier has not. Never to let a change to the
    // rules through — that is the regression they exist to catch, and it is
    // still the case that a term added to widen coverage which drags agreement
    // down is a term matching the wrong articles.
    // 23/48 at the 2026-08-28 re-cut. Lower than the 0.46-of-A/B it replaced
    // reads, and not comparable to it: A is now 48 articles rather than 121,
    // and the ones that left were the strategy and vendor pieces whose process
    // the term lists found easiest. What is left is the harder half.
    expect(withProcess / useCases.length).toBeGreaterThanOrEqual(0.47);
    expect(agreed.length / both.length).toBeGreaterThanOrEqual(0.83);
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
    // An absolute count, not a ratio, so it only goes up as the corpus grows
    // and needs no margin.
    expect(aAsDeployment).toBeGreaterThanOrEqual(32);
    expect(bAsDeployment / bGraded.length).toBeLessThanOrEqual(0.14);
  });

  it('folds the reports of one use case, whoever the institution is', () => {
    // The tile's honesty rests on this: "AI use cases identified" is a fold of
    // the reports, and a report that cannot be keyed counts on its own. When
    // the key came from a term list, 31 of the 77 A-graded reports had no key
    // at all — every institution nobody had thought to add — and Incore Bank's
    // one KYC proof of concept showed four times. Keying on the reviewer's
    // actor took the same 77 reports from 57 apparent use cases to 49.
    const graded = articles.filter((a) => grades.get(a.id) === 'A');
    const keys = graded.map((a) => {
      const d = effective.get(a.id)!;
      return useCaseKey({ title: a.title, actor: d.actor, l1Process: d.l1Process });
    });

    // No A row whose reviewer named an institution may go unkeyed. This is an
    // invariant rather than a ratchet: an unkeyed row is silently counted as
    // its own use case, which is exactly the failure that hid Incore.
    const unkeyed = graded.filter((a, i) => keys[i] === null
      && effective.get(a.id)!.actor?.trim() && effective.get(a.id)!.l1Process);
    expect(unkeyed.map((a) => a.title)).toEqual([]);

    // Raise as the corpus grows; lower only when the corpus grew and the fold
    // did not.
    const distinct = new Set(keys.map((k, i) => k ?? `article:${graded[i]!.id}`));
    console.log(`  A reports folded: ${graded.length} -> ${distinct.size} use cases`);
    expect(distinct.size).toBeLessThanOrEqual(graded.length - 25);
  });

  it('reports how much Swiss content the sources actually reach', () => {
    // The Swiss Lens is only as good as the corpus behind it, and the corpus
    // is thin: the registry names 75 institutions and this corpus contains
    // five of them. That is a sourcing number, not a classifier number — see
    // docs/swiss-coverage.md — and it belongs here so it moves as a measured
    // fact rather than as a claim in a document nobody re-runs.
    const nexus = articles.map((a) =>
      chNexusOf({ title: a.title, body: [a.summary ?? '', a.excerpt ?? ''].join(' ') }));

    const count = (g: string) => nexus.filter((n) => n.nexus === g).length;
    const swiss = count('institution') + count('mention');
    const institutions = new Set(
      nexus.filter((n) => n.nexus !== 'press' && n.evidence).map((n) => n.evidence!));

    console.log(`  Swiss Lens default:          ${swiss}/${articles.length}`);
    console.log(`  …of which in the headline:   ${count('institution')}`);
    console.log(`  Swiss press or place only:   ${count('press')}`);
    console.log(`  distinct institutions seen:  ${institutions.size}`);

    // Raise as coverage grows; lower only when the corpus grew and the
    // registry did not. A drop here means either the registry lost an
    // institution or the sources stopped reaching Switzerland, and both are
    // worth failing a build over.
    expect(swiss).toBeGreaterThanOrEqual(17);
    expect(institutions.size).toBeGreaterThanOrEqual(5);

    // No article may claim the strongest grade without naming who. The Lens
    // shows that name as the reason the row is there, and a row that cannot
    // say why it is Swiss is the region filter again under a new name.
    const unevidenced = nexus.filter((n) => n.nexus === 'institution' && !n.evidence);
    expect(unevidenced).toEqual([]);
  });
});
