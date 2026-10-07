/**
 * The weekly digest as an email: subject, HTML and a plain-text part.
 *
 * Written for the mail client most colleagues read it in, which is Outlook on
 * Windows — and Outlook renders HTML with Word's engine. So this is built the
 * way email has to be, not the way the dashboard is:
 *
 *  - tables for layout, and every style inline; no flexbox, no grid, no
 *    `<style>` block a client may strip;
 *  - no images, SVG or script — the bars are table cells with a background;
 *  - one column, 640px wide at most, readable at 375px;
 *  - the house colours as literal hex, because an email has no CSS variables.
 *    They are the light-theme tokens from `packages/web/src/styles.css`, named
 *    here once so the markup never carries a raw value of its own.
 *
 * The house rules still hold: no capital-letter words, nothing under 14px, and
 * the orange accent spent on one thing — here the "New" marks and this week's
 * bar, which are the same idea: what arrived since the last issue.
 */

import { logoOf } from '../../../web/src/lib/institutions.ts';
import { COVERAGE_CAVEAT as COVERAGE_CAVEAT_TEXT } from '../../../web/src/lib/summary.ts';
import { windowSpan, type DigestEntry, type DigestModel, type DigestNews, type DigestTier1Month } from './model.ts';
import type { DigestSummary } from '@portal/shared';

const C = {
  page: '#f4f4f1',       // --surface-0
  card: '#ffffff',
  text: '#394253',       // --text-primary, the Synpulse main colour
  secondary: '#5a6373',  // --text-secondary
  muted: '#6b7385',      // --text-muted
  rule: '#d9d9d3',       // --border
  tag: '#efefec',        // --surface-2
  accent: '#f7682c',     // --accent, decorative only
  accentInk: '#b33f10',  // --accent-ink, the accent at text contrast
  accentWeak: '#fdeae0', // --accent-weak
  bar: '#b9b9b1',        // --border-strong, the weeks that are not this one
  barDark: '#6b7385',    // --text-muted, the use cases inside those bars
} as const;

const FONT = `'Source Sans 3','Source Sans Pro','Segoe UI',Arial,Helvetica,sans-serif`;

export interface RenderOptions {
  dashboardUrl: string;
  /** A validated summary, or null for an issue without one. */
  summary: DigestSummary | null;
  /**
   * Shown only in the preview that goes to the editor: why a summary was left
   * out, so a refusal is seen on Monday rather than discovered on Tuesday.
   */
  previewNote?: string | null;
  /**
   * Where a colleague who forgot their password writes to. Never in the
   * repository, which is public: it comes from a GitHub secret when the email
   * is sent. Left out, the email carries CONTACT_TOKEN, which the send fills.
   */
  contact?: string;
  /** The editor's own subject line, set in the Review Queue. Blank keeps the built one. */
  subject?: string | null;
}

/** Stands in for the editor's address until the email is sent. No "@", so it is not an address. */
export const CONTACT_TOKEN = '{{editor-contact}}';

/** Two lines of 18px: the longest KPI label wraps to two, and every tile keeps that height. */
const KPI_LABEL_HEIGHT = 50;

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-09-23` → `23 Sep`. */
export const shortDate = (d: string): string =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** `2026-09-23` → `23 Sep 2026`. */
const longDate = (d: string): string => `${shortDate(d)} ${d.slice(0, 4)}`;

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
/** `2026-09-25` → `25 September`. */
const dayMonth = (d: string): string => `${Number(d.slice(8, 10))} ${FULL_MONTHS[Number(d.slice(5, 7)) - 1]}`;

/**
 * Who the brief is from. Asked for by the editor, in these words, so that
 * colleagues know whose judgement the issue carries. One constant, used by the
 * opening, the sign-off and the plain-text part alike.
 */
export const EDITOR = { name: 'Verim Ajdini', role: 'AI Consultant, NGOM Team' } as const;

/** The opening line under the title. */
export const INTRO = 'Your weekly view of how banks and their providers are putting AI to work, '
  + 'agentic AI first, sent every week to members of the NGOM team to keep them up to date. '
  + `Compiled by ${EDITOR.name}, ${EDITOR.role}.`;

/**
 * Under the dashboard button, small and in italics: who to write to for a
 * forgotten password. A mailto link, so one click opens a new email.
 */
function passwordLine(contact: string | undefined): string {
  const to = esc(contact ?? CONTACT_TOKEN);
  return `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:1.4;font-style:italic;color:${C.secondary};">`
    + `Forgotten your password for the dashboard? Email `
    + `<a href="mailto:${to}?subject=${encodeURIComponent('AI Banking Tracker password')}" style="color:${C.accentInk};text-decoration:underline;">${to}</a>.</p>`;
}

/**
 * The email as sent: the editor's address in place of CONTACT_TOKEN. The
 * approved HTML is stored and hashed with the token in it, so the address never
 * reaches the database, the preview artifact or the repository.
 */
export function withContact<T extends { html: string; text: string }>(email: T, contact: string): T {
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(contact)) throw new Error('The contact is not an email address.');
  return {
    ...email,
    html: email.html.split(CONTACT_TOKEN).join(esc(contact)),
    text: email.text.split(CONTACT_TOKEN).join(contact),
  };
}

const BRIEF_TITLE = 'Synpulse AI in Banking Weekly Brief';

/** "Deutsche Bank", "Deutsche Bank and Stripe": at most two, never a count. */
function lead(entries: readonly DigestEntry[]): string {
  const names = [...new Set(entries.map((e) => e.actor))].slice(0, 2);
  return names.join(' and ');
}

/**
 * The subject, as a headline rather than a tally.
 *
 * The first version read "28 named use cases, 5 agentic live, 6 agentic in
 * pilot": accurate, and the kind of line an inbox full of briefings teaches
 * people to skip. It now names who moved, largest institutions first — the
 * order the entries are already ranked in — and leaves the counts to the body.
 */
export function subjectFor(m: DigestModel): string {
  const head = `${BRIEF_TITLE}, ${dayMonth(m.asOf)}`;
  // After the colon a headline, so it starts with a capital: the biggest
  // story first, and the pilots behind it when there is room for them.
  if (m.agenticLive.length) {
    const live = `Agentic AI live at ${lead(m.agenticLive)}`;
    const names = new Set(m.agenticLive.map((e) => e.actor)).size;
    return m.agenticPilot.length && names === 1
      ? `${head}: ${live}, pilots at ${lead(m.agenticPilot)}`
      : `${head}: ${live}`;
  }
  if (m.agenticPilot.length) return `${head}: Agentic AI pilots at ${lead(m.agenticPilot)}`;
  if (m.other.length) return `${head}: New AI use cases at ${lead(m.other)}`;
  return `${head}: The market news`;
}

/**
 * The Market Lens on this month's use cases: grade A, from the first of the
 * month to its last day. The app reads these parameters when it opens.
 */
export function monthLensUrl(dashboardUrl: string, asOf: string): string {
  const [y, mo] = [Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const month = asOf.slice(0, 7);
  const base = dashboardUrl.replace(/\/+$/, '');
  return `${base}/?tab=lens&from=${month}-01&to=${month}-${String(last).padStart(2, '0')}&grade=A`;
}

/* ------------------------------------------------------------------ HTML */

const p = (text: string, style = '') =>
  `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.text};${style}">${text}</p>`;

function newMark(): string {
  return `<span style="display:inline-block;padding:1px 6px;margin-left:6px;background:${C.accentWeak};`
    + `color:${C.accentInk};font-size:14px;font-weight:600;line-height:1.3;">New</span>`;
}

function sectionHead(title: string, note?: string): string {
  return `<tr><td class="px" style="padding:28px 32px 4px;">`
    + `<h2 style="margin:0;font-family:${FONT};font-size:19px;line-height:1.3;font-weight:700;color:${C.text};">${esc(title)}</h2>`
    + (note ? `<p style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:1.4;color:${C.muted};">${esc(note)}</p>` : '')
    + `</td></tr>`;
}

const STAGE_TEXT: Record<string, string> = {
  in_production: 'In production',
  pilot: 'Pilot',
  announced: 'Announced',
  research: 'Study',
  unknown: 'Stage not stated',
};

/**
 * An institution's logo, from the tracker's own copy, or nothing.
 *
 * Hosted rather than attached, and with a fixed width and height, which is
 * what Outlook on Windows needs to lay it out. A client that blocks remote
 * images until asked shows an empty square of the same size, and the name
 * beside it still reads: the alt text is empty because the name is right
 * there. The white ground keeps dark wordmarks legible in a dark-mode client.
 */
function logoImg(actor: string, base: string, size = 36): string {
  const slug = logoOf(actor);
  if (!slug) return '';
  const src = `${base.replace(/\/+$/, '')}/logos/${slug}.png`;
  return `<img src="${esc(src)}" width="${size}" height="${size}" alt="" `
    + `style="display:inline-block;width:${size}px;height:${size}px;border:0;vertical-align:middle;`
    + `margin:0 8px 0 0;background:#ffffff;">`;
}

function tierTag(e: DigestEntry): string {
  return `<span style="display:inline-block;padding:2px 7px;background:${C.tag};font-family:${FONT};font-size:14px;`
    + `line-height:1.35;color:${e.tier.band === 'tier1' ? C.text : C.secondary};`
    + `font-weight:${e.tier.band === 'tier1' ? 700 : 400};white-space:nowrap;">${esc(e.tierText)}</span>`;
}

function entryRow(e: DigestEntry, base: string): string {
  const meta = [
    esc(e.source),
    esc(shortDate(e.date)),
    ...(e.reports > 1 ? [`${e.reports} reports`] : []),
  ].join(' &nbsp;|&nbsp; ');

  return `<tr><td class="px" style="padding:12px 32px 0;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.rule};">`
    + `<tr>`
    + `<td class="tiercol" width="112" valign="top" style="padding:12px 12px 12px 0;width:112px;">${tierTag(e)}</td>`
    + `<td class="maincol" valign="top" style="padding:12px 0;font-family:${FONT};">`
    + `<p style="margin:0;font-size:16px;line-height:1.4;color:${C.text};">`
    + logoImg(e.actor, base)
    + `<a href="${esc(e.url)}" style="color:${C.text};font-weight:700;text-decoration:none;vertical-align:middle;">${esc(e.actor)}</a>`
    + `${e.isNew ? newMark() : ''}</p>`
    + `<p style="margin:2px 0 0;font-size:15px;line-height:1.45;color:${C.text};">${esc(e.task)}</p>`
    + (e.evidence
      ? `<p style="margin:6px 0 0;padding-left:10px;border-left:2px solid ${C.rule};font-size:14px;line-height:1.45;color:${C.secondary};">&ldquo;${esc(e.evidence)}&rdquo;</p>`
      : '')
    + `<p style="margin:6px 0 0;font-size:14px;line-height:1.4;color:${C.muted};">${meta} &nbsp;|&nbsp; `
    + `<a href="${esc(e.url)}" style="color:${C.accentInk};text-decoration:underline;">Read the article</a></p>`
    + `</td></tr></table></td></tr>`;
}

/**
 * One line per use case, for the section below the agentic ones. With a quote
 * each, a fortnight's seventeen "other" use cases made the email three screens
 * longer than the part anyone reads; the quote is one click away.
 */
function compactRow(e: DigestEntry, base: string): string {
  return `<tr><td class="px" style="padding:0 32px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.rule};"><tr>`
    + `<td class="tiercol" width="112" valign="top" style="padding:9px 12px 9px 0;width:112px;">${tierTag(e)}</td>`
    + `<td class="maincol" valign="top" style="padding:9px 0;font-family:${FONT};font-size:15px;line-height:1.45;color:${C.text};">`
    + logoImg(e.actor, base, 28)
    + `<a href="${esc(e.url)}" style="color:${C.text};font-weight:700;text-decoration:none;">${esc(e.actor)}</a>`
    + `${e.isNew ? newMark() : ''} <span style="color:${C.text};">${esc(e.task)}</span>`
    + `<br><span style="font-size:14px;color:${C.muted};">${esc(STAGE_TEXT[e.maturity] ?? STAGE_TEXT.unknown!)}`
    + ` &nbsp;|&nbsp; ${esc(e.source)}, ${esc(shortDate(e.date))}`
    + `${e.reports > 1 ? ` &nbsp;|&nbsp; ${e.reports} reports` : ''}</span>`
    + `</td></tr></table></td></tr>`;
}

function section(title: string, note: string, entries: DigestEntry[], base: string, compact = false): string {
  if (entries.length === 0) return '';
  return sectionHead(title, note)
    + (compact ? `<tr><td style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>` : '')
    + entries.map((e) => (compact ? compactRow(e, base) : entryRow(e, base))).join('');
}

function newsRows(news: DigestNews[]): string {
  if (news.length === 0) return '';
  const rows = news.map((n) =>
    `<tr><td class="px" style="padding:10px 32px 0;">`
    + `<p style="margin:0;padding-top:10px;border-top:1px solid ${C.rule};font-family:${FONT};font-size:15px;line-height:1.45;color:${C.text};">`
    + `<a href="${esc(n.url)}" style="color:${C.text};text-decoration:none;font-weight:600;">${esc(n.headline)}</a>`
    + `${n.isNew ? newMark() : ''}</p>`
    + `<p style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:1.4;color:${C.muted};">`
    + `${esc(n.source)} &nbsp;|&nbsp; ${esc(shortDate(n.date))}</p>`
    + `</td></tr>`).join('');
  return sectionHead('AI around the market') + rows;
}

function kpis(m: DigestModel): string {
  const c = m.counts;
  const cells: [number, string][] = [
    [c.useCases, 'named use cases'],
    [c.agenticLive, 'agentic AI in production'],
    [c.agenticPilot, 'agentic AI in pilot'],
    [c.articles, 'news articles screened'],
  ];
  // Four tiles of one size whatever their labels: a fixed layout splits the
  // width evenly, the background sits on the cell so every tile in the row
  // takes the row's height, and each label is given two lines, so a tile with
  // a one-line label is as tall as one with two, on a phone as well.
  return `<tr><td class="px" style="padding:4px 26px 0;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>`
    + cells.map(([n, label]) =>
      `<td class="kpi" width="25%" valign="top" style="padding:6px;">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};" bgcolor="${C.page}">`
      + `<tr><td style="padding:12px 12px 0;font-family:${FONT};font-size:28px;line-height:32px;font-weight:700;color:${C.text};">${n}</td></tr>`
      + `<tr><td valign="top" height="${KPI_LABEL_HEIGHT}" style="height:${KPI_LABEL_HEIGHT}px;padding:4px 12px 10px;font-family:${FONT};font-size:14px;line-height:18px;color:${C.secondary};">${esc(label)}</td></tr>`
      + `</table></td>`).join('')
    + `</tr></table>`
    // Only an issue longer than a week has a "this week" and a "last week".
    // The note on what "articles screened" counts was dropped at the editor's
    // request; the coverage bars below now show it instead, articles against
    // the use cases found in them.
    + (m.windowDays > 7
      ? `<p style="margin:6px 6px 0;font-family:${FONT};font-size:14px;line-height:1.4;color:${C.muted};">`
        + `${c.thisWeek} of the use cases arrived this week and ${c.lastWeek} last week.</p>`
      : '')
    + `</td></tr>`;
}

/**
 * "Tier 1 banks, October so far": the largest banks' AI news over the month,
 * at the foot of every issue. A reminder rather than news, so it is compact
 * and after everything the week itself brought. Some lines repeat a use case
 * from above; that is the point of a monthly view, and the note says so.
 */
function tier1MonthBlock(t: DigestTier1Month | null, base: string): string {
  if (!t) return '';
  const head = sectionHead(`Tier 1 banks, ${t.label}`,
    'The largest banks\' AI news this month, use cases first. Some appear above as well.');
  if (t.items.length === 0) {
    return head + `<tr><td class="px" style="padding:10px 32px 0;">${p('No Tier 1 bank news on AI was reviewed yet this month.', `color:${C.secondary};font-size:14px;`)}</td></tr>`;
  }
  const rows = t.items.map((i) => {
    const meta = [
      ...(i.stage ? [esc(i.stage)] : i.kind === 'news' ? ['Market news'] : []),
      `${esc(i.source)}, ${esc(shortDate(i.date))}`,
      ...(i.reports > 1 ? [`${i.reports} reports`] : []),
    ].join(' &nbsp;|&nbsp; ');
    return `<tr><td class="px" style="padding:0 32px;">`
      + `<p style="margin:0;padding:9px 0;border-top:1px solid ${C.rule};font-family:${FONT};font-size:15px;line-height:1.45;color:${C.text};">`
      + logoImg(i.institution, base, 28)
      + `<a href="${esc(i.url)}" style="color:${C.text};font-weight:700;text-decoration:none;">${esc(i.institution)}</a> `
      + `${esc(i.text)}<br><span style="font-size:14px;color:${C.muted};">${meta}</span></p>`
      + `</td></tr>`;
  }).join('');
  return head + `<tr><td style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>` + rows;
}

/** `2026-09-22` → `22–28 Sep`, or `29 Sep–5 Oct` across a month: one line, every week alike. */
export function weekRange(start: string): string {
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  return start.slice(5, 7) === end.slice(5, 7)
    ? `${Number(start.slice(8, 10))}\u2013${shortDate(end)}`
    : `${shortDate(start)}\u2013${shortDate(end)}`;
}

/**
 * Articles collected per week, and inside each bar, in a darker shade, how
 * many of them turned out to be use cases (grade A: in production, pilot or
 * announced). This week in the accent, the others in grey. Tables only, so
 * Outlook draws it: a bar is a row of two cells whose widths are percentages.
 */
function coverage(m: DigestModel): string {
  // Weeks before the first article was collected are not quiet weeks, they
  // are weeks before the tracker existed, and a zero there reads as a drop.
  const first = m.weekly.findIndex((w) => w.n > 0);
  const weekly = first < 0 ? [] : m.weekly.slice(first);
  if (weekly.length === 0) return '';
  const max = Math.max(1, ...weekly.map((w) => w.n));
  const last = weekly.length - 1;
  const cell = (pct: number, color: string) => pct <= 0 ? ''
    : `<td width="${pct}%" height="14" style="width:${pct}%;height:14px;line-height:14px;font-size:0;background:${color};" bgcolor="${color}">&nbsp;</td>`;
  const rows = weekly.map((w, i) => {
    const total = Math.max(w.n > 0 ? 2 : 0, Math.round((w.n / max) * 100));
    const cases = Math.min(total, Math.round(((w.useCases ?? 0) / max) * 100));
    const casesPct = w.useCases ? Math.max(1, cases) : 0;
    const now = i === last;
    const bar = total === 0 ? '&nbsp;'
      : `<table role="presentation" width="${total}%" cellpadding="0" cellspacing="0"><tr>`
        + cell(Math.round((casesPct / total) * 100), now ? C.accentInk : C.barDark)
        + cell(100 - Math.round((casesPct / total) * 100), now ? C.accent : C.bar)
        + `</tr></table>`;
    const label = `${esc(weekRange(w.week))}`;
    return `<tr>`
      + `<td width="104" style="width:104px;padding:3px 10px 3px 0;font-family:${FONT};font-size:14px;white-space:nowrap;`
      + `color:${now ? C.text : C.secondary};font-weight:${now ? 700 : 400};">${label}</td>`
      + `<td style="padding:3px 0;">${bar}</td>`
      + `<td width="84" align="right" style="width:84px;padding:3px 0 3px 8px;font-family:${FONT};font-size:14px;white-space:nowrap;color:${C.text};">`
      + `<strong>${w.useCases ?? 0}</strong> of ${w.n}</td>`
      + `</tr>`;
  }).join('');
  const key = (color: string, text: string) =>
    `<td width="12" style="width:12px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>`
    + `<td width="10" height="10" style="width:10px;height:10px;font-size:0;line-height:0;background:${color};" bgcolor="${color}">&nbsp;</td>`
    + `</tr></table></td><td style="padding:0 14px 0 6px;font-family:${FONT};font-size:14px;color:${C.muted};white-space:nowrap;">${text}</td>`;
  return sectionHead('Coverage over the last eight weeks',
    'News articles on AI in banking collected per week, and how many of them were use cases. The week of this issue is in orange.')
    + `<tr><td class="px" style="padding:8px 32px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>`
    + key(C.barDark, 'Use cases (in production, pilot or announced)') + `</tr><tr>`
    + key(C.bar, 'Other articles collected')
    + `</tr></table></td></tr>`
    + `<tr><td class="px" style="padding:10px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
}

function summaryBlock(summary: DigestSummary | null): string {
  if (!summary || summary.sentences.length === 0) return '';
  const items = summary.sentences.map((s) =>
    `<tr><td valign="top" width="16" style="width:16px;padding:8px 0 0;">`
    + `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="7" height="7" style="width:7px;height:7px;font-size:0;line-height:0;background:${C.accent};" bgcolor="${C.accent}">&nbsp;</td></tr></table></td>`
    + `<td style="padding:0 0 8px;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.text};">${esc(s.text)}</td></tr>`).join('');
  return `<tr><td class="px" style="padding:20px 32px 0;">`
    + `<h2 style="margin:0 0 8px;font-family:${FONT};font-size:19px;line-height:1.3;font-weight:700;color:${C.text};">This week in brief</h2>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`
    + `</td></tr>`;
}

export function renderDigest(m: DigestModel, opts: RenderOptions): RenderedDigest {
  const subject = opts.subject?.trim() || subjectFor(m);
  const range = `${shortDate(m.windowStart)} to ${longDate(m.asOf)}`;
  const empty = m.counts.useCases === 0;

  const body = [
    // Masthead. The top rule is the brand mark; the name is in the text colour
    // so it reads in every client, including those that repaint links.
    `<tr><td height="4" style="height:4px;font-size:0;line-height:0;background:${C.accent};" bgcolor="${C.accent}">&nbsp;</td></tr>`,
    `<tr><td class="px" style="padding:22px 32px 0;font-family:${FONT};">`
      + `<p style="margin:0;font-size:15px;line-height:1.3;color:${C.text};"><span style="font-weight:700;color:${C.accentInk};">Synpulse</span>`
      + ` &middot; AI Banking Tracker</p>`
      + `<h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:700;color:${C.text};">${BRIEF_TITLE}</h1>`
      + `<p style="margin:4px 0 0;font-size:15px;line-height:1.4;color:${C.secondary};">${esc(range)}</p>`
      + `<p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:${C.text};">`
      + `${esc(INTRO)}</p>`
      + `</td></tr>`,
    opts.previewNote
      ? `<tr><td class="px" style="padding:14px 32px 0;">${p(`Preview note: ${esc(opts.previewNote)}`,
          `padding:10px 12px;background:${C.accentWeak};color:${C.accentInk};font-size:14px;`)}</td></tr>`
      : '',
    summaryBlock(opts.summary),
    `<tr><td class="px" style="padding:20px 32px 6px;">${p(esc(m.message), 'font-size:18px;font-weight:600;margin:0;')}</td></tr>`,
    kpis(m),
    section('Agentic AI in production',
      'Agents running a process step, described as live or rolled out. Largest institutions first.',
      m.agenticLive, opts.dashboardUrl),
    section('Agentic AI in pilot',
      'Agents on trial or in a proof of concept.', m.agenticPilot, opts.dashboardUrl),
    section('Other AI use cases',
      'Named institutions using AI for a named task, one line each. The quote is in the article.', m.other,
      opts.dashboardUrl, true),
    empty
      ? `<tr><td class="px" style="padding:24px 32px 0;">${p(`No named use cases were reviewed ${windowSpan(m.windowDays)}. The market news below is what was reported.`)}</td></tr>`
      : '',
    // The Tier 1 month right after the use cases, the market news last: the
    // editor's order since 29 Sep 2026.
    tier1MonthBlock(m.tier1Month, opts.dashboardUrl),
    coverage(m),
    newsRows(m.news),
    // The sign-off, then the way in, then the small print.
    `<tr><td class="px" style="padding:28px 32px 0;">`
      + p(`Best regards,<br><strong>${esc(EDITOR.name)}</strong><br>${esc(EDITOR.role)}, Synpulse`, 'margin:0 0 8px;')
      + p('Questions, or a use case I missed? Reply to this email.', `margin:0;color:${C.secondary};font-size:14px;`)
      + `</td></tr>`,
    `<tr><td class="px" style="padding:22px 32px 0;">`
      + `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.text};" bgcolor="${C.text}">`
      + `<a href="${esc(monthLensUrl(opts.dashboardUrl, m.asOf))}" style="display:inline-block;padding:10px 18px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Open this month\u2019s use cases</a>`
      + `</td></tr></table>`
      + passwordLine(opts.contact)
      + `</td></tr>`,
    `<tr><td class="px" style="padding:24px 32px 28px;">`
      + `<p style="margin:0 0 8px;padding-top:14px;border-top:1px solid ${C.rule};font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">${esc(COVERAGE_CAVEAT_TEXT)}</p>`
      + `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">`
      // Said plainly: the grading is AI-assisted and a person checks it. The
      // first version said "written by a reviewer who read the article", which
      // a colleague would take to mean a person read every one.
      + `Institutions, tasks and quotes are taken from the articles in an AI-assisted review `
      + `and checked by ${esc(EDITOR.name)} before sending. Every quote is the article's own words. `
      + `Tier 1 is the Financial Stability Board's list of global systemically important banks. `
      + `Tier 2 is a bank its home regulator names as systemically important, or a national leader.</p>`
      + `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">`
      + `You receive this because you are on the AI Banking Tracker list. Reply to this email to leave it.</p>`
      + `</td></tr>`,
  ].join('\n');

  const preheader = m.message;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
/* Phones only, and an enhancement: a client that strips this block still
   gets a working layout, just a wider one. Outlook desktop never reads it. */
@media only screen and (max-width: 520px) {
  .px { padding-left: 18px !important; padding-right: 18px !important; }
  .tiercol, .maincol { display: block !important; width: auto !important; }
  .tiercol { padding: 10px 0 4px !important; }
  .maincol { padding-top: 0 !important; }
  .kpi { display: inline-block !important; width: 50% !important; box-sizing: border-box; }
}
</style></head>
<body style="margin:0;padding:0;background:${C.page};" bgcolor="${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};" bgcolor="${C.page}">
<tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${C.card};border:1px solid ${C.rule};" bgcolor="${C.card}">
${body}
</table>
</td></tr></table>
</body></html>
`;

  return { subject, html, text: renderText(m, opts, range) };
}

/* ------------------------------------------------------------ plain text */

function renderText(m: DigestModel, opts: RenderOptions, range: string): string {
  const out: string[] = [
    'Synpulse · AI Banking Tracker',
    BRIEF_TITLE,
    range,
    '',
    INTRO,
    '',
  ];
  if (opts.previewNote) out.push(`Preview note: ${opts.previewNote}`, '');
  if (opts.summary?.sentences.length) {
    out.push('This week in brief');
    for (const s of opts.summary.sentences) out.push(`- ${s.text}`);
    out.push('');
  }
  const c = m.counts;
  out.push(m.message,
    `${c.useCases} named use cases, ${c.agenticLive} agentic in production, `
    + `${c.agenticPilot} agentic in pilot, ${c.articles} news articles screened.`, '');

  const list = (title: string, entries: DigestEntry[]) => {
    if (entries.length === 0) return;
    out.push(title);
    for (const e of entries) {
      out.push(`- ${e.tierText}: ${e.actor}${e.isNew ? ' (new)' : ''}, ${e.task}`);
      if (e.evidence) out.push(`  "${e.evidence}"`);
      out.push(`  ${e.source}, ${shortDate(e.date)}: ${e.url}`);
    }
    out.push('');
  };
  list('Agentic AI in production', m.agenticLive);
  list('Agentic AI in pilot', m.agenticPilot);
  list('Other AI use cases', m.other);
  if (m.tier1Month) {
    out.push(`Tier 1 banks, ${m.tier1Month.label}`);
    if (m.tier1Month.items.length === 0) out.push('No Tier 1 bank news on AI was reviewed yet this month.');
    for (const i of m.tier1Month.items) {
      out.push(`- ${i.institution}: ${i.text}${i.stage ? ` (${i.stage})` : ''}`,
        `  ${i.source}, ${shortDate(i.date)}: ${i.url}`);
    }
    out.push('');
  }
  if (m.news.length) {
    out.push('AI around the market');
    for (const n of m.news) out.push(`- ${n.headline} (${n.source}, ${shortDate(n.date)}): ${n.url}`);
    out.push('');
  }
  out.push('Best regards,', EDITOR.name, `${EDITOR.role}, Synpulse`,
    'Questions, or a use case I missed? Reply to this email.', '',
    `This month's use cases on the dashboard: ${monthLensUrl(opts.dashboardUrl, m.asOf)}`,
    `Forgotten your password for the dashboard? Email ${opts.contact ?? CONTACT_TOKEN}.`, '', COVERAGE_CAVEAT_TEXT,
    'Reply to this email to leave the list.');
  return `${out.join('\n')}\n`;
}
