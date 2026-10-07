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

import type { DigestFacts, DigestSummary } from '@portal/shared';
import { groupArticles } from '../../../web/src/lib/group-articles.ts';
import {
  compareTiers, INSTITUTIONS, tier1In, tierLabel, tierOf, type Tier,
} from '../../../web/src/lib/tiers.ts';

/**
 * What the editor can change about the brief without touching code:
 * `data/digest/rules.json`, explained in `data/digest/RULES.md`. The CLI reads
 * the file and passes it in, so this module stays pure.
 */
export interface DigestRules {
  /** How many days an issue covers, ending on its date. */
  windowDays: number;
  /** How many B headlines "Around the market" carries. */
  newsLimit: number;
  tier1Month: {
    enabled: boolean;
    maxItems: number;
    /**
     * Before this day of the month the section shows the previous month in
     * full: on 6 October, "October so far" is the same six days the issue
     * already covers.
     */
    previousMonthBeforeDay: number;
  };
}

export const DEFAULT_RULES: DigestRules = {
  windowDays: 7,
  newsLimit: 5,
  tier1Month: { enabled: true, maxItems: 6, previousMonthBeforeDay: 8 },
};

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
  /** The issue date, YYYY-MM-DD. The window is the `windowDays` ending on it. */
  asOf: string;
  /**
   * Every A and B row collected from the earlier of the window's start and the
   * Tier 1 section's start. The model picks each section's rows by date.
   */
  rows: DigestRow[];
  /** AI-in-banking articles collected in the window, reviewed or not. */
  articlesCollected: number;
  /**
   * Articles collected per week, oldest first, the last one being this week;
   * `useCases` is how many of them were graded A. Optional so that a snapshot
   * or a test written before it still reads.
   */
  weekly: { week: string; n: number; useCases?: number }[];
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

/** One line of "Tier 1 this month": a use case or a headline. */
export interface DigestTier1Item {
  id: string;
  ids: string[];
  institution: string;
  kind: 'use case' | 'news';
  /** The task for a use case, the headline for news. */
  text: string;
  /** For a use case: agentic in production, agentic pilot, or its stage. */
  stage: string | null;
  url: string;
  source: string;
  date: string;
  reports: number;
}

export interface DigestTier1Month {
  /** "October so far" or "September". */
  label: string;
  from: string;
  to: string;
  items: DigestTier1Item[];
}

export interface DigestModel {
  asOf: string;
  week: string;
  windowDays: number;
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
  /** Null when the rules turn the section off. */
  tier1Month: DigestTier1Month | null;
  weekly: { week: string; n: number; useCases?: number }[];
  message: string;
}

export const DAY = 86_400_000;
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** How many B headlines "Around the market" carries, unless the rules say otherwise. */
export const NEWS_LIMIT = DEFAULT_RULES.newsLimit;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** The period the Tier 1 section covers, by the rules' month switch-over. */
export function tier1Period(asOf: string, rules: DigestRules['tier1Month']):
  { label: string; from: string; to: string } {
  const y = Number(asOf.slice(0, 4));
  const mo = Number(asOf.slice(5, 7));
  const day = Number(asOf.slice(8, 10));
  if (day < rules.previousMonthBeforeDay) {
    const py = mo === 1 ? y - 1 : y;
    const pm = mo === 1 ? 12 : mo - 1;
    const from = `${py}-${String(pm).padStart(2, '0')}-01`;
    return { label: MONTH_NAMES[pm - 1]!, from, to: addDays(`${asOf.slice(0, 7)}-01`, -1) };
  }
  return { label: `${MONTH_NAMES[mo - 1]} so far`, from: `${asOf.slice(0, 7)}-01`, to: asOf };
}

/** Where the rows must start for both the window and the Tier 1 section. */
export function rowsFrom(asOf: string, rules: DigestRules = DEFAULT_RULES): string {
  const windowStart = addDays(asOf, -(rules.windowDays - 1));
  if (!rules.tier1Month.enabled) return windowStart;
  const month = tier1Period(asOf, rules.tier1Month).from;
  return month < windowStart ? month : windowStart;
}

interface Groupish extends DigestRow { review: DigestRow | null }

export function buildModel(input: DigestInput, week: string, rules: DigestRules = DEFAULT_RULES): DigestModel {
  const windowDays = rules.windowDays;
  const windowStart = addDays(input.asOf, -(windowDays - 1));
  const splitAt = addDays(input.asOf, -6);
  // "New" means arrived in the last seven days. In a one-week issue that is
  // every line, and a mark on every line marks nothing, so it is only drawn
  // when the issue covers more than a week.
  const isNew = (r: DigestRow) => windowDays > 7 && r.fetchedAt.slice(0, 10) >= splitAt;
  const inWindow = (r: DigestRow) => r.fetchedAt.slice(0, 10) >= windowStart;

  // Newest first before folding, so each group sits where its newest report
  // does and the lead is the fullest report — the table's rule.
  const allByDate = [...input.rows].sort((a, b) =>
    (b.publishedAt ?? b.fetchedAt).localeCompare(a.publishedAt ?? a.fetchedAt));
  const byDate = allByDate.filter(inWindow);

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
    .slice(0, rules.newsLimit)
    .map((r) => ({
      id: r.id,
      actor: r.actor?.trim() || null,
      headline: (r.headline ?? r.title).trim(),
      url: r.url,
      source: r.source,
      date: (r.publishedAt ?? r.fetchedAt).slice(0, 10),
      isNew: isNew(r),
    }));

  const tier1Month = rules.tier1Month.enabled
    ? tier1MonthOf(allByDate, input.asOf, rules.tier1Month)
    : null;

  return {
    asOf: input.asOf,
    week,
    windowDays,
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
    tier1Month,
    weekly: input.weekly,
    message: keyMessage(running, all.length, windowDays),
  };
}

const STAGE_RANK: Record<string, number> = { running: 0, pilot: 1 };
const MATURITY_RANK: Record<string, number> = { in_production: 0, pilot: 1, announced: 2 };
const STAGE_WORDS: Record<string, string> = {
  in_production: 'In production', pilot: 'Pilot', announced: 'Announced', research: 'Study',
};

/**
 * "Tier 1 this month": the largest banks' AI news over the month, ranked.
 *
 * Use cases before news. Among use cases, agentic AI in production first, then
 * agentic pilots, then everything else by how far along it is; then the most
 * reported. News is ranked by how much it is about AI. The same rules
 * `data/digest/RULES.md` states in words.
 */
export function tier1MonthOf(
  rowsNewestFirst: readonly DigestRow[], asOf: string, rules: DigestRules['tier1Month'],
): DigestTier1Month {
  const period = tier1Period(asOf, rules);
  const rows = rowsNewestFirst.filter((r) => {
    const d = r.fetchedAt.slice(0, 10);
    return d >= period.from && d <= period.to;
  });

  const useCases = groupArticles(rows
    .filter((r) => r.grade === 'A' && r.actor?.trim() && tierOf(r.actor).band === 'tier1')
    .map((r) => ({ ...r, review: r })))
    .map((g) => {
      const all = [g.lead, ...g.members];
      const lead = g.lead;
      const agentic = lead.agentStage === 'running' ? 'Agentic AI in production'
        : lead.agentStage === 'pilot' ? 'Agentic AI pilot' : null;
      return {
        rank: [STAGE_RANK[lead.agentStage] ?? 2, MATURITY_RANK[lead.maturity] ?? 3, -all.length],
        item: {
          id: lead.id,
          ids: all.map((r) => r.id),
          institution: tierOf(lead.actor!).institution?.name ?? lead.actor!.trim(),
          kind: 'use case' as const,
          text: (lead.task ?? lead.headline ?? lead.title).trim(),
          stage: agentic ?? STAGE_WORDS[lead.maturity] ?? null,
          url: lead.url,
          source: lead.source,
          date: (lead.publishedAt ?? lead.fetchedAt).slice(0, 10),
          reports: all.length,
        } satisfies DigestTier1Item,
      };
    });

  const byRank = (a: { rank: number[] }, b: { rank: number[] }) => {
    for (let i = 0; i < a.rank.length; i++) {
      const d = a.rank[i]! - b.rank[i]!;
      if (d) return d;
    }
    return 0;
  };

  const seen = new Set<string>();
  const news = rows
    .filter((r) => r.grade === 'B')
    .map((r) => {
      const text = (r.headline ?? r.title).trim();
      const bank = (r.actor?.trim() && tierOf(r.actor).band === 'tier1' ? tierOf(r.actor).institution : null)
        ?? tier1In(text) ?? tier1In(r.title);
      return { r, text, bank };
    })
    .filter((x) => x.bank && !seen.has(x.text.toLowerCase()) && seen.add(x.text.toLowerCase()))
    .sort((a, b) => b.r.aiIntensity - a.r.aiIntensity)
    .map(({ r, text, bank }) => ({
      id: r.id,
      ids: [r.id],
      institution: bank!.name,
      kind: 'news' as const,
      text,
      stage: null,
      url: r.url,
      source: r.source,
      date: (r.publishedAt ?? r.fetchedAt).slice(0, 10),
      reports: 1,
    } satisfies DigestTier1Item));

  const items = [...useCases.sort(byRank).map((x) => x.item), ...news].slice(0, rules.maxItems);
  return { ...period, items };
}

/**
 * The one sentence under the masthead. The same arithmetic as the Trends
 * board's `boardMessage`, in the email's own unit — "these two weeks" rather
 * than "this view", because an email has no view.
 */
export function keyMessage(running: number, total: number, windowDays = 14): string {
  const span = windowSpan(windowDays);
  const cases = (n: number) => `${n} named use ${n === 1 ? 'case' : 'cases'}`;
  if (total === 0) return `No named use cases were reviewed ${span}.`;
  if (running === 0) return `${cases(total)} ${span}, none of them in production yet.`;
  if (running === total) {
    return total === 1
      ? `The one named use case ${span} is already running in production.`
      : `All ${cases(total)} ${span} are already running in production.`;
  }
  return `${running} of ${cases(total)} ${span} ${running === 1 ? 'is' : 'are'} already running in production.`;
}

/** "this week", "in these two weeks", "in these 10 days". */
export function windowSpan(windowDays: number): string {
  if (windowDays === 7) return 'this week';
  if (windowDays === 14) return 'in these two weeks';
  return `in these ${windowDays} days`;
}

/** What the written summary is checked against — see `validateDigest`. */
export function factsFor(model: DigestModel): DigestFacts {
  const articles = new Map<string, { actor: string | null; text: string }>();
  for (const e of [...model.agenticLive, ...model.agenticPilot, ...model.other]) {
    const text = [e.task, e.evidence ?? '', e.tierText].join(' ');
    for (const id of e.ids) articles.set(id, { actor: e.actor, text });
  }
  for (const n of model.news) articles.set(n.id, { actor: n.actor, text: n.headline });
  for (const t of model.tier1Month?.items ?? []) {
    for (const id of t.ids) {
      if (!articles.has(id)) articles.set(id, { actor: t.institution, text: t.text });
    }
  }

  const c = model.counts;
  const all = [...model.agenticLive, ...model.agenticPilot, ...model.other];
  const counts = [c.useCases, c.thisWeek, c.lastWeek, c.agenticLive, c.agenticPilot, c.articles,
    ...model.weekly.map((w) => w.n),
    ...model.weekly.map((w) => w.useCases ?? 0),
    // "7 reports" is printed beside an entry, so a sentence may repeat it.
    ...all.map((e) => e.reports)];
  const tierWords = [1, 2, 3]; // "Tier 1 banks" is a name for a tier, not a claim
  const names = INSTITUTIONS.flatMap((i) => [i.name, ...(i.aliases ?? [])]);
  return { week: model.week, articles, counts: [...counts, ...tierWords], names };
}

/** The key a summary sentence is left out by: `summary:0` is the first. */
export const summaryKey = (i: number): string => `summary:${i}`;

/**
 * The issue with what the editor left out taken out.
 *
 * `excluded` holds article ids and `summary:<n>` keys. An article left out
 * leaves every section it appears in, the Tier 1 month included: an item wrong
 * enough to drop from the week is wrong in the recap too. The counts and the
 * key line are recomputed, so the numbers never count a line nobody will see.
 *
 * A summary sentence goes when it is left out, or when every article it cites
 * was: a claim with nothing left behind it is exactly what `validateDigest`
 * exists to refuse. When no sentence is left, the issue has no summary.
 */
export function applyExclusions(
  model: DigestModel, summary: DigestSummary | null, excluded: readonly string[],
): { model: DigestModel; summary: DigestSummary | null } {
  const out = new Set(excluded);
  const keep = (e: { id: string }) => !out.has(e.id);

  const agenticLive = model.agenticLive.filter(keep);
  const agenticPilot = model.agenticPilot.filter(keep);
  const other = model.other.filter(keep);
  const all = [...agenticLive, ...agenticPilot, ...other];
  const thisWeek = all.filter((e) => e.isNew).length;
  const running = all.filter((e) => e.maturity === 'in_production').length;

  const sentences = (summary?.sentences ?? []).filter((s, i) =>
    !out.has(summaryKey(i)) && !(s.cites.length > 0 && s.cites.every((id) => out.has(id))));

  return {
    model: {
      ...model,
      agenticLive,
      agenticPilot,
      other,
      news: model.news.filter(keep),
      tier1Month: model.tier1Month
        ? { ...model.tier1Month, items: model.tier1Month.items.filter(keep) }
        : null,
      counts: {
        ...model.counts,
        useCases: all.length,
        thisWeek,
        lastWeek: all.length - thisWeek,
        agenticLive: agenticLive.length,
        agenticPilot: agenticPilot.length,
      },
      message: keyMessage(running, all.length, model.windowDays),
    },
    summary: summary && sentences.length ? { ...summary, sentences } : null,
  };
}
