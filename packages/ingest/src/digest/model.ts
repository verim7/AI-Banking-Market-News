/**
 * The weekly digest, as data: what goes in which section, in which order.
 *
 * Pure. `data.ts` fetches the rows from D1 and `render.ts` turns this into
 * HTML; this file decides everything in between, so a test can hand it rows
 * and a date and assert on the result without a database or a mail client.
 *
 * Built from the same pieces as the dashboard, on purpose — the email and the
 * Trends page must never tell a colleague two different things about one week:
 *  - `tierOf` / `compareTiers`, so Tier 1 banks lead here as they do there;
 *  - `groupArticles`, so one use case reported by four outlets is one line;
 *  - the agent stage from `AGENT_STAGE_SQL`, read by `data.ts`.
 */

import type { DigestFacts } from '@portal/shared';
import { groupArticles } from '../../../web/src/lib/group-articles.ts';
import {
  compareTiers, INSTITUTIONS, tierLabel, tierOf, type Tier,
} from '../../../web/src/lib/tiers.ts';

export interface DigestRow {
  id: string;
  url: string;
  title: string;
  source: string;
  publishedAt: string | null;
  /** When the crawler collected it. The window is read on this, not on publication. */
  fetchedAt: string;
  aiIntensity: number;
  /** Reviewer's where there is one, the rules' otherwise. */
  maturity: string;
  /** running | pilot | announced | none. */
  agentStage: string;
  grade: string | null;
  headline: string | null;
  actor: string | null;
  task: string | null;
  evidence: string | null;
  useCaseEvidence: string | null;
  groupKey: string | null;
}

export interface DigestInput {
  /** The issue date, YYYY-MM-DD. The window is the fourteen days ending on it. */
  asOf: string;
  /** Every A and B row collected in the window. */
  rows: DigestRow[];
  /** AI-in-banking articles collected in the window, reviewed or not. */
  articlesCollected: number;
  /** Articles collected per week, oldest first, the last one being this week. */
  weekly: { week: string; n: number }[];
}

export interface DigestEntry {
  id: string;
  actor: string;
  tier: Tier;
  tierText: string;
  task: string;
  evidence: string | null;
  url: string;
  source: string;
  date: string;
  maturity: string;
  isNew: boolean;
  reports: number;
  /** Every article folded into this entry, the lead first. */
  ids: string[];
}

export interface DigestNews {
  id: string;
  actor: string | null;
  headline: string;
  url: string;
  source: string;
  date: string;
  isNew: boolean;
}

export interface DigestModel {
  asOf: string;
  week: string;
  windowStart: string;
  /** Start of "this week"; anything collected on or after it is new. */
  splitAt: string;
  counts: {
    useCases: number;
    thisWeek: number;
    lastWeek: number;
    agenticLive: number;
    agenticPilot: number;
    articles: number;
  };
  agenticLive: DigestEntry[];
  agenticPilot: DigestEntry[];
  other: DigestEntry[];
  news: DigestNews[];
  weekly: { week: string; n: number }[];
  message: string;
}

export const DAY = 86_400_000;
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** How many B headlines "Around the market" carries. */
export const NEWS_LIMIT = 5;

interface Groupish extends DigestRow { review: DigestRow | null }

export function buildModel(input: DigestInput, week: string): DigestModel {
  const windowStart = addDays(input.asOf, -13);
  const splitAt = addDays(input.asOf, -6);
  const isNew = (r: DigestRow) => r.fetchedAt.slice(0, 10) >= splitAt;

  // Newest first before folding, so each group sits where its newest report
  // does and the lead is the fullest report — the table's rule.
  const byDate = [...input.rows].sort((a, b) =>
    (b.publishedAt ?? b.fetchedAt).localeCompare(a.publishedAt ?? a.fetchedAt));

  const useCaseRows: Groupish[] = byDate
    .filter((r) => r.grade === 'A' && r.actor?.trim())
    .map((r) => ({ ...r, review: r }));

  const entries = groupArticles(useCaseRows).map((g) => {
    const lead = g.lead;
    const all = [lead, ...g.members];
    const actor = lead.actor!.trim();
    const tier = tierOf(actor);
    return {
      entry: {
        id: lead.id,
        actor,
        tier,
        tierText: tierLabel(tier),
        task: (lead.task ?? lead.headline ?? lead.title).trim(),
        evidence: lead.evidence,
        url: lead.url,
        source: lead.source,
        date: (lead.publishedAt ?? lead.fetchedAt).slice(0, 10),
        maturity: lead.maturity,
        // New if any report of it arrived this week: a use case first seen
        // last week and reported again today is still news today.
        isNew: all.some(isNew),
        reports: all.length,
        ids: all.map((r) => r.id),
      } satisfies DigestEntry,
      agentStage: lead.agentStage,
    };
  });

  const ranked = (list: typeof entries) => list
    .map((x) => x.entry)
    // Largest institution first, then the most reported, then — the sort is
    // stable — newest first, as they arrived.
    .sort((a, b) => compareTiers(a.tier, b.tier) || b.reports - a.reports);

  const agenticLive = ranked(entries.filter((x) => x.agentStage === 'running'));
  const agenticPilot = ranked(entries.filter((x) => x.agentStage === 'pilot'));
  const other = ranked(entries.filter((x) => x.agentStage !== 'running' && x.agentStage !== 'pilot'));

  const all = [...agenticLive, ...agenticPilot, ...other];
  const thisWeek = all.filter((e) => e.isNew).length;
  const running = all.filter((e) => e.maturity === 'in_production').length;

  const news = byDate
    .filter((r) => r.grade === 'B' && (r.headline ?? r.title).trim())
    .sort((a, b) => {
      const ta = a.actor?.trim() ? tierOf(a.actor) : null;
      const tb = b.actor?.trim() ? tierOf(b.actor) : null;
      // Named institutions first, largest first; then the article most about AI.
      if (ta && tb) return compareTiers(ta, tb) || b.aiIntensity - a.aiIntensity;
      if (ta || tb) return ta ? -1 : 1;
      return b.aiIntensity - a.aiIntensity;
    })
    .slice(0, NEWS_LIMIT)
    .map((r) => ({
      id: r.id,
      actor: r.actor?.trim() || null,
      headline: (r.headline ?? r.title).trim(),
      url: r.url,
      source: r.source,
      date: (r.publishedAt ?? r.fetchedAt).slice(0, 10),
      isNew: isNew(r),
    }));

  return {
    asOf: input.asOf,
    week,
    windowStart,
    splitAt,
    counts: {
      useCases: all.length,
      thisWeek,
      lastWeek: all.length - thisWeek,
      agenticLive: agenticLive.length,
      agenticPilot: agenticPilot.length,
      articles: input.articlesCollected,
    },
    agenticLive,
    agenticPilot,
    other,
    news,
    weekly: input.weekly,
    message: keyMessage(running, all.length),
  };
}

/**
 * The one sentence under the masthead. The same arithmetic as the Trends
 * board's `boardMessage`, in the email's own unit — "these two weeks" rather
 * than "this view", because an email has no view.
 */
export function keyMessage(running: number, total: number): string {
  const cases = (n: number) => `${n} named use ${n === 1 ? 'case' : 'cases'}`;
  if (total === 0) return 'No named use cases were reviewed in these two weeks.';
  if (running === 0) return `${cases(total)} in these two weeks, none of them running yet.`;
  if (running === total) {
    return total === 1
      ? 'The one named use case in these two weeks is already running.'
      : `All ${cases(total)} in these two weeks are already running.`;
  }
  return `${running} of ${cases(total)} in these two weeks ${running === 1 ? 'is' : 'are'} already running.`;
}

/** What the written summary is checked against — see `validateDigest`. */
export function factsFor(model: DigestModel): DigestFacts {
  const articles = new Map<string, { actor: string | null; text: string }>();
  for (const e of [...model.agenticLive, ...model.agenticPilot, ...model.other]) {
    const text = [e.task, e.evidence ?? '', e.tierText].join(' ');
    for (const id of e.ids) articles.set(id, { actor: e.actor, text });
  }
  for (const n of model.news) articles.set(n.id, { actor: n.actor, text: n.headline });

  const c = model.counts;
  const counts = [c.useCases, c.thisWeek, c.lastWeek, c.agenticLive, c.agenticPilot, c.articles,
    ...model.weekly.map((w) => w.n)];
  const tierWords = [1, 2, 3]; // "Tier 1 banks" is a name for a tier, not a claim
  const names = INSTITUTIONS.flatMap((i) => [i.name, ...(i.aliases ?? [])]);
  return { week: model.week, articles, counts: [...counts, ...tierWords], names };
}
