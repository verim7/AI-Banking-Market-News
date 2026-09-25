import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isoWeek, validateDigest, type DigestSummary } from '@portal/shared';
import { weeklyBuckets } from '../src/digest/data.ts';
import { buildModel, factsFor, keyMessage, type DigestInput, type DigestRow } from '../src/digest/model.ts';
import { renderDigest, subjectFor } from '../src/digest/render.ts';
import { addressList, chunks } from '../src/digest/send.ts';
import { sendable, summaryFor } from '../src/digest.ts';

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
    expect(m.other.map((e) => e.actor)).toEqual(['HSBC', 'Zopa']);
  });

  it('counts use cases, not articles, and splits this week from last', () => {
    const m = model([
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

  it('marks what arrived in the last seven days as new, by collected date', () => {
    const m = week();
    expect(m.other.find((e) => e.actor === 'Zopa')!.isNew).toBe(false);
    expect(m.agenticLive[0]!.isNew).toBe(true);
  });

  it('says so plainly when nothing was reviewed', () => {
    expect(keyMessage(0, 0)).toMatch(/No named use cases/);
    expect(keyMessage(1, 3)).toBe('1 of 3 named use cases in these two weeks is already running.');
  });
});

describe('the rendered email', () => {
  const m = week();
  const r = renderDigest(m, { dashboardUrl: 'https://tracker.example', summary: null });

  it('names the week and what is in it in the subject', () => {
    expect(r.subject).toBe(subjectFor(m));
    expect(r.subject).toMatch(/^AI in banking, week 40: 5 named use cases, 2 agentic live, 1 agentic in pilot$/);
  });

  it('uses only what Outlook on Windows renders', () => {
    // Word's engine: no flexbox, no grid, no SVG, no script, no images.
    expect(r.html).not.toMatch(/display:\s*(flex|grid)/);
    expect(r.html).not.toMatch(/<svg|<script|<img/i);
  });

  it('keeps sections in order and every entry linked', () => {
    const at = (s: string) => r.html.indexOf(s);
    expect(at('Agentic AI in production')).toBeGreaterThan(0);
    expect(at('Agentic AI in production')).toBeLessThan(at('Agentic AI in pilot'));
    expect(at('Agentic AI in pilot')).toBeLessThan(at('Other AI use cases'));
    expect(at('Other AI use cases')).toBeLessThan(at('Around the market'));
    const all = [...m.agenticLive, ...m.agenticPilot, ...m.other];
    expect(all).toHaveLength(5);
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
    expect(empty.subject).toMatch(/the market news$/);
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
    expect(b.at(-1)).toEqual({ week: '2026-09-22', n: 5 });
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
    const dir = mkdtempSync(join(tmpdir(), 'digest-'));
    expect(sendable(dir, '2026-09-29')).toBeNull();
    const issue = (w: string, asOf: string) =>
      writeFileSync(join(dir, `${w}.issue.json`), JSON.stringify({ week: w, asOf }));
    issue('2026-W40', '2026-09-28');
    expect(sendable(dir, '2026-09-29')).toBeNull(); // not approved
    writeFileSync(join(dir, '2026-W40.approved.json'), '{}');
    expect(sendable(dir, '2026-09-29')).toBe('2026-W40');
    expect(sendable(dir, '2026-10-06')).toBeNull(); // approved and forgotten
    writeFileSync(join(dir, '2026-W40.sent.json'), '{}');
    expect(sendable(dir, '2026-09-29')).toBeNull(); // never twice
  });
});
