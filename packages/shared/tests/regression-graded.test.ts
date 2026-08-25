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
interface Decision { articleId: string; grade: 'A' | 'B' | 'C' | 'D' }

const readJsonl = <T>(p: string): T[] =>
  readFileSync(resolve(ROOT, p), 'utf8').split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

const batches = readdirSync(resolve(ROOT, 'data/review/graded'))
  .filter((f) => f.endsWith('.jsonl')).sort();

const articles = batches.flatMap((f) => readJsonl<Pending>(`data/review/graded/${f}`));
const grades = new Map(
  batches.flatMap((f) => readJsonl<Decision>(`data/review/decisions/${f}`))
    .map((d) => [d.articleId, d.grade]));

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

  it('reports the overall agreement, so a regression is visible as a number', () => {
    const dGraded = scored.filter((s) => s.grade === 'D');
    const aGraded = scored.filter((s) => s.grade === 'A');
    const dAsDeployment = dGraded.filter(deployed).length;
    const aAsDeployment = aGraded.filter(deployed).length;

    console.log(`  D graded read as deployment: ${dAsDeployment}/${dGraded.length}`);
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
    expect(aAsDeployment).toBeGreaterThanOrEqual(31);
  });
});
