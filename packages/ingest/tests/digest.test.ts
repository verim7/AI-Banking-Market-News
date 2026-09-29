import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isoWeek, validateDigest, type DigestSummary } from '@portal/shared';
import { weeklyBuckets } from '../src/digest/data.ts';
import {
  applyExclusions, buildModel, DEFAULT_RULES, factsFor, keyMessage, rowsFrom, summaryKey, tier1Period,
  type DigestInput, type DigestRow, type DigestRules,
} from '../src/digest/model.ts';
import {
  CONTACT_TOKEN, INTRO, monthLensUrl, renderDigest, subjectFor, weekRange, withContact,
} from '../src/digest/render.ts';
import { addressList, chunks, redactAddresses } from '../src/digest/send.ts';
import {
  loadRules, nextReviewAndSend, recipients, sendableDraft, summaryFor, type ApprovedDraft,
} from '../src/digest.ts';
import { weeklyInvites } from '../src/digest/calendar.ts';

const AS_OF = '2026-09-28';

let n = 0;
const row = (over: Partial<DigestRow>): DigestRow => ({
  id: `r${++n}`,
  url: `https://example.test/${n}`,
  title: 'A headline',
  source: 'Finextra',
  publishedAt: '2026-09-25T08:00:00Z',
  fetchedAt: '2026-09-25T09:00:00Z',
  aiIntensity: 60,
  maturity: 'in_production',
  agentStage: 'none',
  grade: 'A',
  headline: 'Someone does something',
  actor: 'Acme Savings',
  task: 'does something',
  evidence: 'Acme said it does something.',
  useCaseEvidence: null,
  groupKey: null,
  ...over,
});

const input = (rows: DigestRow[]): DigestInput => ({
  asOf: AS_OF,
  rows,
  articlesCollected: 120,
  weekly: Array.from({ length: 8 }, (_, i) => ({ week: `2026-08-${String(4 + i).padStart(2, '0')}`, n: 10 + i })),
});

const model = (rows: DigestRow[]) => buildModel(input(rows), isoWeek(AS_OF));
/** The two-week issue the brief used to be, for what only exists in one. */
const TWO_WEEKS: DigestRules = { ...DEFAULT_RULES, windowDays: 14 };
const model14 = (rows: DigestRow[]) => buildModel(input(rows), isoWeek(AS_OF), TWO_WEEKS);

const week = () => model([
  row({ id: 'sokin', actor: 'Sokin', agentStage: 'running', task: 'lines up payments' }),
  row({ id: 'db', actor: 'Deutsche Bank', agentStage: 'running', task: 'checks source of wealth',
        evidence: 'Deutsche Bank runs agents on 30% of reviews.' }),
  row({ id: 'dbs', actor: 'DBS', agentStage: 'pilot', maturity: 'pilot', task: 'trials a coding agent' }),
  row({ id: 'zopa', actor: 'Zopa', task: 'answers customers', fetchedAt: '2026-09-17T09:00:00Z' }),
  row({ id: 'hsbc', actor: 'HSBC', maturity: 'announced', task: 'plans an assistant' }),
  row({ id: 'news', grade: 'B', actor: null, headline: 'Regulator publishes AI principles' }),
  row({ id: 'd', grade: 'D', actor: 'Nobody', headline: 'Shares rise' }),
]);

describe('the digest model', () => {
  it('puts agents in production first, then pilots, then the rest', () => {
    const m = week();
    expect(m.agenticLive.map((e) => e.actor)).toEqual(['Deutsche Bank', 'Sokin']);
    expect(m.agenticPilot.map((e) => e.actor)).toEqual(['DBS']);
    // Tier 1 before a digital bank, whatever arrived first.
    expect(m.other.map((e) => e.actor)).toEqual(['HSBC']);
  });

  it('covers the last seven days only, by collected date', () => {
    const m = week();
    // Zopa was collected on the 17th: last week, so not in this issue.
    expect([...m.agenticLive, ...m.agenticPilot, ...m.other].map((e) => e.id)).not.toContain('zopa');
    expect(m.windowStart).toBe('2026-09-22');
    expect(m.windowDays).toBe(7);
    // The rules can widen it again without code.
    const two = model14([row({ id: 'zopa', actor: 'Zopa', fetchedAt: '2026-09-17T09:00:00Z' }),
      row({ actor: 'HSBC' })]);
    expect(two.other.map((e) => e.actor)).toEqual(['HSBC', 'Zopa']);
  });

  it('counts use cases, not articles, and splits this week from last', () => {
    const m = model14([
      row({ id: 'a', actor: 'HSBC', groupKey: 'hsbc|p24' }),
      row({ id: 'b', actor: 'HSBC', groupKey: 'hsbc|p24' }),
      row({ id: 'c', actor: 'UBS', fetchedAt: '2026-09-16T00:00:00Z' }),
    ]);
    expect(m.counts.useCases).toBe(2);
    expect(m.other.find((e) => e.actor === 'HSBC')!.reports).toBe(2);
    expect(m.counts.thisWeek).toBe(1);
    expect(m.counts.lastWeek).toBe(1);
  });

  it('leaves out B and D from the use cases, and D from the news', () => {
    const m = week();
    const ids = [...m.agenticLive, ...m.agenticPilot, ...m.other].map((e) => e.id);
    expect(ids).not.toContain('news');
    expect(ids).not.toContain('d');
    expect(m.news.map((x) => x.id)).toEqual(['news']);
  });

  it('marks what arrived in the last seven days as new, in a two-week issue only', () => {
    const rows = () => [row({ id: 'zopa', actor: 'Zopa', fetchedAt: '2026-09-17T09:00:00Z' }),
      row({ id: 'db', actor: 'Deutsche Bank', agentStage: 'running' })];
    const two = model14(rows());
    expect(two.other.find((e) => e.actor === 'Zopa')!.isNew).toBe(false);
    expect(two.agenticLive[0]!.isNew).toBe(true);
    // In a one-week issue every line is new, so none is marked.
    expect(model(rows()).agenticLive[0]!.isNew).toBe(false);
  });

  it('says so plainly when nothing was reviewed, in the issue\'s own span', () => {
    expect(keyMessage(0, 0, 7)).toBe('No named use cases were reviewed this week.');
    expect(keyMessage(1, 3, 7)).toBe('1 of 3 named use cases this week is already running.');
    expect(keyMessage(1, 3, 14)).toBe('1 of 3 named use cases in these two weeks is already running.');
    expect(week().message).toMatch(/this week/);
  });
});

describe('the rendered email', () => {
  const m = week();
  const r = renderDigest(m, { dashboardUrl: 'https://tracker.example', summary: null });

  it('leads the subject with who moved, largest first, not with a tally', () => {
    expect(r.subject).toBe(subjectFor(m));
    expect(r.subject).toBe('Synpulse AI in Banking Weekly Brief, 28 September: Agentic AI live at Deutsche Bank and Sokin');
    // No counts after the date: the body carries the numbers. And a capital
    // after the colon: it is a headline.
    expect(r.subject.split(': ')[1]).not.toMatch(/\d/);
    expect(r.subject.split(': ')[1]).toMatch(/^[A-Z]/);
  });

  it('adds the pilots when a single institution is live', () => {
    const m = model([row({ actor: 'Deutsche Bank', agentStage: 'running' }),
      row({ actor: 'DBS', agentStage: 'pilot', maturity: 'pilot' })]);
    expect(subjectFor(m)).toMatch(/: Agentic AI live at Deutsche Bank, pilots at DBS$/);
  });

  it('falls back through pilots, other use cases and the market news', () => {
    const pilots = model([row({ actor: 'DBS', agentStage: 'pilot', maturity: 'pilot' })]);
    expect(subjectFor(pilots)).toMatch(/: Agentic AI pilots at DBS$/);
    const other = model([row({ actor: 'UBS' }), row({ actor: 'HSBC' }), row({ actor: 'Zopa' })]);
    // Two names at most, Tier 1 first.
    expect(subjectFor(other)).toMatch(/: New AI use cases at (UBS and HSBC|HSBC and UBS)$/);
    expect(subjectFor(model([row({ grade: 'B', actor: null })]))).toMatch(/: The market news$/);
  });

  it('says who it is from, at the top and in the sign-off, in both parts', () => {
    for (const body of [r.html, r.text]) {
      expect(body).toContain('Compiled by Verim Ajdini, AI Consultant, NGOM Team.');
      expect(body).toContain('Best regards,');
    }
    expect(r.html).toContain('<strong>Verim Ajdini</strong>');
  });

  it('says the review is AI-assisted and checked, not that a person read everything', () => {
    expect(r.html).toContain('in an AI-assisted review and checked by Verim Ajdini before sending.');
    expect(r.html).not.toContain('written by a reviewer');
  });

  it('carries the Synpulse title, and no footnote under the numbers', () => {
    expect(r.html).toContain('>Synpulse AI in Banking Weekly Brief</h1>');
    expect(r.html).toContain('news articles screened');
    expect(r.html).not.toContain('several often report the same use case');
    expect(r.html).toContain('AI around the market');
    expect(r.html).not.toContain('Strategy, launches and regulation');
  });

  it('shows how many of each week\'s articles were use cases, one line per week', () => {
    const w = renderDigest(buildModel({ ...input([row({ actor: 'HSBC' })]), weekly: [
      { week: '2026-09-15', n: 184, useCases: 22 }, { week: '2026-09-22', n: 189, useCases: 31 }] },
    isoWeek(AS_OF)), { dashboardUrl: 'https://x', summary: null }).html;
    expect(w).toContain('<strong>31</strong> of 189');
    expect(w).toContain('22\u201328 Sep');
    expect(w).toContain('Use cases (in production, pilot or announced)');
    expect(w).not.toContain('Week of');
    expect(weekRange('2026-09-29')).toBe('29 Sep\u20135 Oct');
  });

  it('opens the dashboard on this month\'s use cases', () => {
    expect(r.html).toContain('href="https://tracker.example/?tab=lens&amp;from=2026-09-01&amp;to=2026-09-30&amp;grade=A"');
    expect(monthLensUrl('https://x/', '2027-02-10')).toBe('https://x/?tab=lens&from=2027-02-01&to=2027-02-28&grade=A');
  });

  it('uses only what Outlook on Windows renders', () => {
    // Word's engine: no flexbox, no grid, no SVG, no script, no images.
    expect(r.html).not.toMatch(/display:\s*(flex|grid)/);
    expect(r.html).not.toMatch(/<svg|<script/i);
    // Images only as logos, from the tracker's own copy, each with a fixed size.
    const imgs = [...r.html.matchAll(/<img [^>]*>/g)].map((x) => x[0]);
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img).toMatch(/src="https:\/\/tracker\.example\/logos\/[a-z0-9-]+\.png"/);
      expect(img).toMatch(/width="\d+" height="\d+"/);
      expect(img).toContain('alt=""');
    }
    // Deutsche Bank has a logo; Sokin, a provider without one, has none.
    expect(r.html).toContain('/logos/deutsche-bank.png');
    expect(r.html).not.toContain('/logos/sokin.png');
  });

  it('keeps sections in order and every entry linked', () => {
    const at = (s: string) => r.html.indexOf(s);
    expect(at('Agentic AI in production')).toBeGreaterThan(0);
    expect(at('Agentic AI in production')).toBeLessThan(at('Agentic AI in pilot'));
    expect(at('Agentic AI in pilot')).toBeLessThan(at('Other AI use cases'));
    expect(at('Other AI use cases')).toBeLessThan(at('AI around the market'));
    const all = [...m.agenticLive, ...m.agenticPilot, ...m.other];
    expect(all).toHaveLength(4);
    for (const e of all) expect(r.html).toContain(`href="${e.url}"`);
  });

  it('escapes what it prints', () => {
    const m = model([row({ actor: 'HSBC', task: '<b>bold</b> & "quoted"' })]);
    const html = renderDigest(m, { dashboardUrl: 'https://x', summary: null }).html;
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('never carries an email address', () => {
    expect(r.html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(r.text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('keeps no text under 14px and no capitals by CSS', () => {
    const sizes = [...r.html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes.filter((s) => s > 0))).toBeGreaterThanOrEqual(14);
    expect(r.html).not.toMatch(/text-transform:\s*uppercase/);
  });

  it('says the same in the plain-text part', () => {
    for (const e of [...m.agenticLive, ...m.agenticPilot, ...m.other]) {
      expect(r.text).toContain(e.actor);
      expect(r.text).toContain(e.url);
    }
  });

  it('still goes out when nothing was reviewed', () => {
    const empty = renderDigest(model([row({ grade: 'B', actor: null })]),
      { dashboardUrl: 'https://x', summary: null });
    expect(empty.html).toContain('No named use cases were reviewed');
    expect(empty.subject).toMatch(/: The market news$/);
  });

  it('shows a summary with its label, and a preview note only when asked', () => {
    const summary: DigestSummary = { week: '2026-W40', sentences: [{ text: 'Deutsche Bank led.', cites: ['db'] }] };
    const with_ = renderDigest(m, { dashboardUrl: 'https://x', summary, previewNote: 'check me' });
    expect(with_.html).toContain('This week in brief');
    expect(with_.html).toContain('Written with AI from the reviewed use cases below');
    expect(with_.html).toContain('Preview note: check me');
    expect(r.html).not.toContain('This week in brief');
    expect(r.html).not.toContain('Preview note');
  });
});

describe('the written summary', () => {
  const m = week();
  const facts = factsFor(m);
  const ok = (sentences: DigestSummary['sentences']) =>
    validateDigest({ week: m.week, sentences }, facts);

  it('passes when every claim rests on a cited use case', () => {
    expect(ok([
      { text: 'Deutsche Bank now runs agents on 30% of source-of-wealth reviews.', cites: ['db'] },
      { text: 'Two agentic use cases are live and DBS is piloting a coding agent.', cites: ['db', 'sokin', 'dbs'] },
    ])).toEqual([]);
  });

  it('refuses an article that is not in the issue', () => {
    expect(ok([{ text: 'Something happened.', cites: ['nope'] }]).join()).toMatch(/not in this issue/);
  });

  it('refuses an institution none of its citations is about', () => {
    expect(ok([{ text: 'UBS followed Deutsche Bank.', cites: ['db'] }]).join()).toMatch(/names UBS/);
  });

  it('refuses a number nobody printed', () => {
    expect(ok([{ text: 'Deutsche Bank runs agents on 45% of reviews.', cites: ['db'] }]).join())
      .toMatch(/states 45/);
  });

  it('reads numbers written as words too', () => {
    expect(ok([{ text: 'Deutsche Bank runs agents on nine desks.', cites: ['db'] }]).join())
      .toMatch(/states 9/);
    // A count the email prints may be written either way.
    expect(ok([{ text: 'Four named use cases, two of them agentic and live.', cites: ['db', 'sokin'] }]))
      .toEqual([]);
  });

  it('refuses shouting, length and an empty summary', () => {
    expect(ok([{ text: 'Deutsche Bank is AMAZING!', cites: ['db'] }]).join())
      .toMatch(/capitals.*exclamation|exclamation.*capitals/s);
    expect(ok([{ text: 'x'.repeat(701), cites: ['db'] }]).join()).toMatch(/700/);
    expect(ok([]).join()).toMatch(/no sentences/);
    expect(validateDigest({ week: '2026-W01', sentences: [{ text: 'Fine.', cites: ['db'] }] }, facts).join())
      .toMatch(/written for 2026-W01/);
  });

  it('is read from the week file and dropped, with the reason, when refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'));
    expect(summaryFor(m, dir)).toMatchObject({ summary: null, missing: true });
    writeFileSync(join(dir, `${m.week}.json`), JSON.stringify({
      week: m.week, sentences: [{ text: 'UBS did it.', cites: ['db'] }] }));
    const bad = summaryFor(m, dir);
    expect(bad.summary).toBeNull();
    expect(bad.problems.length).toBeGreaterThan(0);
  });
});

describe('the plumbing', () => {
  it('buckets eight seven-day windows ending on the issue day', () => {
    const b = weeklyBuckets([{ day: AS_OF, n: 3 }, { day: '2026-09-22', n: 2 }, { day: '2026-09-21', n: 5 },
      { day: '2026-08-01', n: 99 }], AS_OF);
    expect(b).toHaveLength(8);
    expect(b.at(-1)).toEqual({ week: '2026-09-22', n: 5, useCases: 0 });
    expect(b.at(-2)!.n).toBe(5);
    expect(b.reduce((s, x) => s + x.n, 0)).toBe(10); // the August day is outside the eight weeks
  });

  it('numbers ISO weeks as ISO does', () => {
    expect(isoWeek('2026-09-28')).toBe('2026-W40');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });

  it('reads a recipient secret however it was pasted, once each', () => {
    expect(addressList('a@x.ch, b@x.ch\nc@x.ch;a@x.ch  not-an-address')).toEqual(['a@x.ch', 'b@x.ch', 'c@x.ch']);
    expect(addressList(undefined)).toEqual([]);
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('sends only an approved, unsent issue from the last six days', () => {
    const d = (over: Partial<ApprovedDraft>): ApprovedDraft => ({
      week: '2026-W40', as_of: '2026-09-29', subject: 's', html: 'h', text: 't', sha256: 'x',
      approved_at: '2026-09-29T10:00:00Z', sent_at: null, ...over });
    expect(sendableDraft([], '2026-09-30')).toBeNull();
    expect(sendableDraft([d({})], '2026-09-30')!.week).toBe('2026-W40');
    expect(sendableDraft([d({ approved_at: '' })], '2026-09-30')).toBeNull(); // not approved
    expect(sendableDraft([d({})], '2026-10-07')).toBeNull(); // approved and forgotten
    expect(sendableDraft([d({ sent_at: '2026-09-30T05:47:00Z' })], '2026-09-30')).toBeNull(); // never twice
    // The newest of two, if an old one was never sent.
    expect(sendableDraft([d({ week: '2026-W39', as_of: '2026-09-25' }), d({})], '2026-09-30')!.week).toBe('2026-W40');
  });

  it('reads the rules file over the defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-'));
    const path = join(dir, 'rules.json');
    expect(loadRules(path)).toEqual(DEFAULT_RULES);
    writeFileSync(path, JSON.stringify({ windowDays: 14, tier1Month: { maxItems: 3 } }));
    expect(loadRules(path)).toMatchObject({ windowDays: 14, newsLimit: 5,
      tier1Month: { enabled: true, maxItems: 3, previousMonthBeforeDay: 8 } });
  });
});

describe('Tier 1 this month', () => {
  const rows = () => [
    // This week, Tier 1, agentic and live: first.
    row({ id: 'db', actor: 'Deutsche Bank', agentStage: 'running', task: 'checks source of wealth' }),
    // Earlier this month, outside the week, Tier 1, a plain use case.
    row({ id: 'hsbc', actor: 'HSBC', maturity: 'announced', task: 'checks trade documents',
          fetchedAt: '2026-09-08T09:00:00Z' }),
    // Tier 1 pilot, earlier this month.
    row({ id: 'ubs', actor: 'UBS', agentStage: 'pilot', maturity: 'pilot', task: 'trials an agent',
          fetchedAt: '2026-09-15T09:00:00Z' }),
    // Market news naming a Tier 1 bank only in its headline.
    row({ id: 'bnp', grade: 'B', actor: null, headline: 'BNP Paribas forges agentic AI partnership with Google Cloud',
          fetchedAt: '2026-09-26T09:00:00Z' }),
    // Not Tier 1, not news, or not this month: never in the section.
    row({ id: 'zopa', actor: 'Zopa', agentStage: 'running' }),
    row({ id: 'plain', grade: 'B', actor: null, headline: 'Regulator publishes AI principles' }),
    row({ id: 'scam', grade: 'D', actor: null, headline: 'Scam hits Barclays' }),
    row({ id: 'aug', actor: 'Barclays', fetchedAt: '2026-08-30T09:00:00Z' }),
  ];

  it('ranks the month\'s Tier 1 use cases, agentic first, then the news', () => {
    const t = model(rows()).tier1Month!;
    expect(t.label).toBe('September so far');
    expect(t.items.map((i) => i.id)).toEqual(['db', 'ubs', 'hsbc', 'bnp']);
    expect(t.items[0]).toMatchObject({ institution: 'Deutsche Bank', stage: 'Agentic AI in production' });
    expect(t.items[3]).toMatchObject({ institution: 'BNP Paribas', kind: 'news' });
  });

  it('keeps to the number the rules allow, and can be turned off', () => {
    const rules = (over: Partial<DigestRules['tier1Month']>): DigestRules =>
      ({ ...DEFAULT_RULES, tier1Month: { ...DEFAULT_RULES.tier1Month, ...over } });
    expect(buildModel(input(rows()), 'w', rules({ maxItems: 2 })).tier1Month!.items).toHaveLength(2);
    expect(buildModel(input(rows()), 'w', rules({ enabled: false })).tier1Month).toBeNull();
  });

  it('shows last month in full early in a month, and this month after', () => {
    const rules = DEFAULT_RULES.tier1Month;
    expect(tier1Period('2026-10-06', rules)).toEqual({ label: 'September', from: '2026-09-01', to: '2026-09-30' });
    expect(tier1Period('2026-10-13', rules)).toEqual({ label: 'October so far', from: '2026-10-01', to: '2026-10-13' });
    expect(tier1Period('2027-01-05', rules)).toMatchObject({ label: 'December', from: '2026-12-01', to: '2026-12-31' });
    // The rows must reach back to whichever starts first.
    expect(rowsFrom('2026-09-28')).toBe('2026-09-01');
    expect(rowsFrom('2026-10-13')).toBe('2026-10-01');
    expect(rowsFrom('2026-10-06')).toBe('2026-09-01');
  });

  it('follows the use cases, before the market news and the sign-off, in both parts', () => {
    const m = model(rows());
    const r = renderDigest(m, { dashboardUrl: 'https://x', summary: null });
    const at = (s: string) => r.html.indexOf(s);
    expect(at('named use cases')).toBeGreaterThan(-1);
    expect(at('Tier 1 banks, September so far')).toBeGreaterThan(at('named use cases'));
    expect(at('Tier 1 banks, September so far')).toBeLessThan(at('AI around the market'));
    expect(at('AI around the market')).toBeLessThan(at('Best regards'));
    const t = (s: string) => r.text.indexOf(s);
    expect(t('Tier 1 banks, September so far')).toBeLessThan(t('AI around the market'));
    expect(r.text).toContain('Tier 1 banks, September so far');
    expect(r.text).toContain('BNP Paribas: BNP Paribas forges agentic AI partnership');
    // The Tier 1 lines may be cited by the summary: they are in the issue.
    expect(factsFor(m).articles.has('hsbc')).toBe(true);
  });

  it('says so when the month has no Tier 1 news yet', () => {
    const r = renderDigest(model([row({ actor: 'Zopa' })]), { dashboardUrl: 'https://x', summary: null });
    expect(r.html).toContain('No Tier 1 bank news on AI was reviewed yet this month.');
  });
});

describe('the rules file', () => {
  it('is what the model expects, so an edit to it cannot break the brief silently', () => {
    const rules = JSON.parse(readFileSync(
      join(import.meta.dirname, '../../../data/digest/rules.json'), 'utf8')) as DigestRules;
    expect(Object.keys(rules).sort()).toEqual(Object.keys(DEFAULT_RULES).sort());
    expect(Object.keys(rules.tier1Month).sort()).toEqual(Object.keys(DEFAULT_RULES.tier1Month).sort());
    expect(rules.windowDays).toBeGreaterThanOrEqual(1);
    expect(rules.tier1Month.maxItems).toBeGreaterThanOrEqual(1);
  });
});

describe('the editor leaving things out', () => {
  const m = week();
  const summary: DigestSummary = { week: m.week, sentences: [
    { text: 'Deutsche Bank runs agents.', cites: ['db'] },
    { text: 'DBS trials a coding agent.', cites: ['dbs'] },
    { text: 'Regulators wrote principles.', cites: ['news'] },
  ] };

  it('takes an item out of every section and recounts', () => {
    const r = applyExclusions(m, summary, ['db']);
    expect(r.model.agenticLive.map((e) => e.id)).toEqual(['sokin']);
    expect(r.model.counts.agenticLive).toBe(1);
    expect(r.model.counts.useCases).toBe(m.counts.useCases - 1);
    expect(r.model.message).not.toBe(m.message);
    // And the summary sentence that rested on it alone.
    expect(r.summary!.sentences.map((s) => s.text)).not.toContain('Deutsche Bank runs agents.');
    expect(renderDigest(r.model, { dashboardUrl: 'https://x', summary: r.summary }).html)
      .not.toContain('checks source of wealth');
  });

  it('drops a summary sentence on its own, and the summary when none is left', () => {
    expect(applyExclusions(m, summary, [summaryKey(1)]).summary!.sentences).toHaveLength(2);
    expect(applyExclusions(m, summary, [summaryKey(0), summaryKey(1), summaryKey(2)]).summary).toBeNull();
    expect(applyExclusions(m, null, []).summary).toBeNull();
  });

  it('changes nothing when nothing is left out', () => {
    const r = applyExclusions(m, summary, []);
    expect(r.model).toEqual(m);
    expect(r.summary).toEqual(summary);
  });
});

describe('the weekly calendar', () => {
  const [review, sent] = weeklyInvites({ dashboardUrl: 'https://tracker.example', firstReview: '2026-10-06',
    firstSend: '2026-10-07', stamp: '20260928T130000Z' });

  it('is one file per event, so Outlook for Windows adds each to your own calendar', () => {
    for (const { ics } of [review!, sent!]) {
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      // A calendar name makes Outlook open the file as a separate calendar.
      expect(ics).not.toContain('X-WR-CALNAME');
    }
    expect(review!.filename).toMatch(/\.ics$/);
  });

  it('reviews on Tuesdays at 09:00 Zurich time, in the zone Windows names', () => {
    expect(review!.ics).toContain('DTSTART;TZID=W. Europe Standard Time:20261006T090000');
    expect(review!.ics).toContain('TZID:W. Europe Standard Time');
    expect(review!.ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU');
    expect(review!.ics).toContain('SUMMARY:Review the AI Banking Weekly Brief');
  });

  it('sends on Wednesdays at 05:47 UTC, the GitHub schedule itself, shown as free', () => {
    expect(sent!.ics).toContain('DTSTART:20261007T054700Z');
    expect(sent!.ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=WE');
    expect(sent!.ics).toContain('X-MICROSOFT-CDO-BUSYSTATUS:FREE');
  });

  it('a resend updates the entries already in the calendar instead of adding more', () => {
    const [later] = weeklyInvites({ dashboardUrl: 'https://tracker.example', firstReview: '2026-10-06',
      firstSend: '2026-10-07', stamp: '20260929T074500Z' });
    const seq = (ics: string) => Number(/SEQUENCE:(\d+)/.exec(ics)?.[1]);
    // Same event id, and a higher sequence, which is what tells Outlook it is newer.
    expect(later!.ics).toContain('UID:ai-banking-brief-review@ai-banking-market-news');
    expect(seq(review!.ics)).toBeGreaterThan(0);
    expect(seq(later!.ics)).toBeGreaterThan(seq(review!.ics));
  });

  it('is well-formed for any mail client', () => {
    for (const { ics } of [review!, sent!]) {
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(ics).toContain('METHOD:PUBLISH');
      for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
      // No address in it: it may be forwarded. The event ids are the only "@".
      expect(ics.split('\r\n').filter((l) => l.includes('@')).every((l) => l.startsWith('UID:'))).toBe(true);
    }
  });

  it('starts on the next Tuesday, and today when today is one', () => {
    expect(nextReviewAndSend('2026-09-28')).toEqual({ review: '2026-09-29', send: '2026-09-30' });
    expect(nextReviewAndSend('2026-09-29')).toEqual({ review: '2026-09-29', send: '2026-09-30' });
    expect(nextReviewAndSend('2026-09-30')).toEqual({ review: '2026-10-06', send: '2026-10-07' });
  });
});

describe('who the list send goes to', () => {
  it('is the list when there is one, and the editor alone until then', () => {
    expect(recipients('a@x.ch, b@x.ch', 'me@x.ch')).toEqual({ to: ['a@x.ch', 'b@x.ch'], pilot: false });
    expect(recipients('', 'me@x.ch')).toEqual({ to: ['me@x.ch'], pilot: true });
    expect(recipients(undefined, undefined)).toEqual({ to: [], pilot: true });
  });
});

describe('the opening, the tiles and the password line', () => {
  const r = renderDigest(week(), { dashboardUrl: 'https://tracker.example', summary: null });

  it('says the brief goes to the NGOM team every week, in both parts', () => {
    expect(INTRO).toContain('sent every week to members of the NGOM team to keep them up to date');
    expect(r.html).toContain('members of the NGOM team');
    expect(r.text).toContain(INTRO);
  });

  it('draws four tiles of one size: an even split, and every label given the same height', () => {
    expect(r.html).toContain('table-layout:fixed');
    const tiles = r.html.match(/<td class="kpi" width="25%"/g) ?? [];
    expect(tiles).toHaveLength(4);
    const heights = [...r.html.matchAll(/<td valign="top" height="(\d+)"/g)].map((x) => x[1]);
    expect(heights).toHaveLength(4);
    expect(new Set(heights).size).toBe(1);
  });

  it('puts the password line under the button, as a link, with no address until it is sent', () => {
    const button = r.html.indexOf('Open this month');
    const line = r.html.indexOf('Forgotten your password for the dashboard?');
    expect(button).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(button);
    expect(line).toBeLessThan(r.html.indexOf('AI-assisted review'));
    expect(r.html).toContain(`href="mailto:${CONTACT_TOKEN}?subject=`);
    expect(r.html).toMatch(/font-style:italic/);
    // Nothing in the stored, hashed email is an address.
    expect(r.html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(r.text).toContain(`Email ${CONTACT_TOKEN}.`);
  });

  it('fills the address in at send time, everywhere the token stood', () => {
    const sent = withContact(r, 'editor@example.com');
    expect(sent.html).not.toContain(CONTACT_TOKEN);
    expect(sent.text).not.toContain(CONTACT_TOKEN);
    expect(sent.html).toContain('href="mailto:editor@example.com?subject=');
    expect(sent.html).toContain('>editor@example.com</a>');
    expect(sent.text).toContain('Email editor@example.com.');
    expect(() => withContact(r, 'not an address')).toThrow();
  });
});

describe('what reaches the public Actions log', () => {
  it('masks every address in a refusal from the mail service', () => {
    const body = '{"message":"You can only send testing emails to your own email address (first.last@corp.example). To send to jane+x@other.example.co.uk, verify a domain."}';
    const out = redactAddresses(body);
    expect(out).not.toMatch(/@/);
    expect(out).toContain('You can only send testing emails to your own email address ([address])');
  });
});
