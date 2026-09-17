/**
 * What the gate refused, and why.
 *
 * `run.ts` has always counted what each source *yielded*. Nothing recorded what
 * was thrown away, and that asymmetry is exactly how a vocabulary hole stays
 * invisible: a Finextra piece — "Anthropic launches Claude for Financial
 * Advisors" — came down a feed this project already polls, scored zero because
 * no AI term and no banking term matched, and was noticed only because a person
 * read the publisher's own site and asked where it was.
 *
 * A rejection is not a failure. Most of what the feeds carry genuinely is not
 * AI in banking, and a run that rejected nothing would mean the gate was open.
 * The point is that the rejections are *readable*: a tally by reason, and real
 * headlines under each, so the next hole is found by reading one report rather
 * than by a reader noticing an absence.
 */

import type { Classification } from '@portal/shared';

/** The four gates in classify(), in the order they are applied. */
export const GATE_REASONS = [
  'no_ai_term',
  'no_banking_evidence',
  'ai_not_central',
  'market_commentary',
] as const;

export type GateReason = (typeof GATE_REASONS)[number] | 'unscored';

export interface RejectedItem {
  title: string;
  sourceName: string;
  classification: Pick<Classification, 'ruleHits'>;
}

export interface RejectionExample {
  reason: GateReason;
  title: string;
  sourceName: string;
  /** The evidence the gate recorded — an intensity, or the commentary terms. */
  detail: string;
}

export interface RejectionReport {
  total: number;
  /** Reason and count, in gate order; reasons nothing hit are left out. */
  byReason: { reason: GateReason; count: number }[];
  /** Which feed contributed which rejections, so a noisy source is visible. */
  bySource: { reason: GateReason; sourceName: string; count: number }[];
  examples: RejectionExample[];
}

/**
 * The first gate an article failed, which is the only one worth reporting.
 *
 * classify() records both `no_ai_term` and `no_banking_evidence` when neither
 * matched, and that pair tells a reader nothing they could act on — an article
 * about crop yields fails both and is meant to. The *first* failure is the
 * actionable one, because it names the list that would have to change.
 */
export function gateReasonOf(c: Pick<Classification, 'ruleHits'>): GateReason {
  for (const reason of GATE_REASONS) {
    if (c.ruleHits.some((h) => h.rule === `gate.${reason}`)) return reason;
  }
  // A zero score with no gate hit means the rules awarded nothing at all —
  // possible, and worth seeing rather than silently bucketed under a gate.
  return 'unscored';
}

function detailOf(c: Pick<Classification, 'ruleHits'>, reason: GateReason): string {
  const hit = c.ruleHits.find((h) => h.rule === `gate.${reason}`);
  return hit && hit.term !== '-' ? hit.term : '';
}

const ORDER: GateReason[] = [...GATE_REASONS, 'unscored'];
const rank = (r: GateReason): number => ORDER.indexOf(r);

/**
 * @param examplesPerReason how many headlines to keep under each reason. One
 *   example proves nothing about a list of 300, and twenty is a page of
 *   reading. Spending the budget per reason rather than over the report as a
 *   whole is what stops the commonest gate from crowding out the informative
 *   one — `no_ai_term` is always the biggest bucket and always the least
 *   interesting.
 *
 * The examples are drawn one per source before any source gets a second, which
 * the first production run showed to be the difference between a sample and a
 * coincidence. Taking the first five gave five Capgemini and McKinsey
 * headlines, because those feeds are polled first — while the same report's
 * tally said 95 rejections came from allnews.ch and 87 from Agefi.com, neither
 * of which a reader could see a single headline from. A sample that cannot
 * show you the bucket it just pointed at is not doing its job.
 */
export function summariseRejections(
  items: RejectedItem[],
  examplesPerReason = 5,
): RejectionReport {
  const counts = new Map<GateReason, number>();
  const sources = new Map<GateReason, Map<string, number>>();
  // reason -> source -> the headlines seen, so the draw below can go round the
  // sources rather than down the arrival order.
  const seen = new Map<GateReason, Map<string, RejectionExample[]>>();

  for (const item of items) {
    const reason = gateReasonOf(item.classification);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);

    const perSource = sources.get(reason) ?? new Map<string, number>();
    perSource.set(item.sourceName, (perSource.get(item.sourceName) ?? 0) + 1);
    sources.set(reason, perSource);

    const byReason = seen.get(reason) ?? new Map<string, RejectionExample[]>();
    const forSource = byReason.get(item.sourceName) ?? [];
    // Two headlines per source is all the round-robin can ever need, and it
    // keeps this bounded on a run that rejects a thousand items.
    if (forSource.length < examplesPerReason) {
      forSource.push({
        reason, title: item.title, sourceName: item.sourceName,
        detail: detailOf(item.classification, reason),
      });
    }
    byReason.set(item.sourceName, forSource);
    seen.set(reason, byReason);
  }

  const examples: RejectionExample[] = [];
  for (const [reason, byReason] of seen) {
    // Busiest source first, so the feed the tally just named is the first
    // headline a reader sees under that reason.
    const queues = [...byReason.entries()]
      .sort((a, b) => (sources.get(reason)!.get(b[0]) ?? 0)
                    - (sources.get(reason)!.get(a[0]) ?? 0)
                    || a[0].localeCompare(b[0]))
      .map(([, queue]) => queue);
    let taken = 0;
    for (let round = 0; taken < examplesPerReason; round += 1) {
      const before = taken;
      for (const queue of queues) {
        if (taken >= examplesPerReason) break;
        const next = queue[round];
        if (next) { examples.push(next); taken += 1; }
      }
      if (taken === before) break;  // every queue exhausted
    }
  }

  const bySource: RejectionReport['bySource'] = [];
  for (const [reason, perSource] of sources) {
    for (const [sourceName, count] of perSource) bySource.push({ reason, sourceName, count });
  }

  return {
    total: items.length,
    byReason: ORDER.filter((r) => counts.has(r))
      .map((reason) => ({ reason, count: counts.get(reason)! })),
    bySource: bySource.sort((a, b) => b.count - a.count
      || rank(a.reason) - rank(b.reason)
      || a.sourceName.localeCompare(b.sourceName)),
    examples: examples.sort((a, b) => rank(a.reason) - rank(b.reason)),
  };
}

const HUMAN: Record<GateReason, string> = {
  no_ai_term: 'no AI term matched',
  no_banking_evidence: 'no banking term or named institution matched',
  ai_not_central: 'AI mentioned but not the subject',
  market_commentary: 'commentary on AI, not an institution applying it',
  unscored: 'scored zero without hitting a named gate',
};

/** The report as plain lines. Markdown-safe, so the same text serves both. */
export function formatRejections(report: RejectionReport): string[] {
  if (report.total === 0) return ['Nothing was rejected, which is itself worth checking.'];

  const lines = [`${report.total} rejected at the gate:`];
  for (const { reason, count } of report.byReason) {
    lines.push(`  ${String(count).padStart(4)}  ${reason} — ${HUMAN[reason]}`);
  }

  const noisy = report.bySource.filter((s) => s.count >= 10).slice(0, 5);
  if (noisy.length > 0) {
    lines.push('', 'Feeds contributing most to one reason:');
    for (const s of noisy) {
      lines.push(`  ${String(s.count).padStart(4)}  ${s.sourceName} — ${s.reason}`);
    }
  }

  lines.push('', 'A sample, so a vocabulary hole is visible without a reader noticing one:');
  let current: GateReason | null = null;
  for (const e of report.examples) {
    if (e.reason !== current) {
      current = e.reason;
      lines.push(`  ${e.reason}:`);
    }
    lines.push(`    "${e.title}" — ${e.sourceName}${e.detail ? ` (${e.detail})` : ''}`);
  }
  return lines;
}
