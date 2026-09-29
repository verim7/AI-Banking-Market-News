import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoWeek, validateDigest, type DigestSummary } from '@portal/shared';
import { credentialsFromEnv, executeAll, queryRows, type D1Credentials } from './load-d1.ts';
import { sqlLiteral as L } from './sql.ts';
import { loadDigestInput } from './digest/data.ts';
import {
  addDays, applyExclusions, buildModel, DEFAULT_RULES, factsFor, type DigestInput, type DigestModel, type DigestRules,
} from './digest/model.ts';
import { renderDigest, withContact, type RenderedDigest } from './digest/render.ts';
import { weeklyInvites } from './digest/calendar.ts';
import { addressList, chunks, sendMail } from './digest/send.ts';

/**
 * The weekly digest, from the command line and from `.github/workflows/digest.yml`.
 *
 *   --mode=preview   build it and write it to --out; mail nobody
 *   --mode=facts     print this issue's use cases, ids and counts as one JSON line
 *   --mode=check     validate this week's written summary; exit 1 if refused
 *   --mode=draft     build it, store it in D1 for the editor's review, mail them a preview
 *   --mode=send      mail the issue the editor approved, once
 *   --mode=test-send mail the approved issue to the editor only; it still goes out on Wednesday
 *   --mode=calendar  mail the editor a calendar file with the weekly review and send times
 *
 * The weekly rhythm (docs/weekly-digest.md): the Tuesday Routine writes the
 * summary and runs `draft`. The editor reviews the draft in the tracker's
 * Review Queue, leaves out what should not go and approves; the tracker then
 * renders the email once and stores it. Wednesday's schedule runs `send`,
 * which mails that stored email byte for byte and refuses one whose hash
 * does not match.
 *
 * What the brief contains is set by `data/digest/rules.json`, which the editor
 * may change; `data/digest/RULES.md` explains each rule.
 *
 * No address is ever written to a file here. The repository is public.
 */

export const DIGEST_DIR = 'data/digest';
export const RULES_PATH = join(DIGEST_DIR, 'rules.json');
const DEFAULT_DASHBOARD = 'https://tracker.ai-banking-brief.com';
/**
 * The sender, on the editor's own domain, verified in Resend on 29 Sep 2026.
 * Before that it was Resend's shared onboarding address, which delivers only
 * to the account's own inbox. A DIGEST_FROM secret still overrides it.
 */
const DEFAULT_FROM = '"Verim Ajdini, AI Banking Brief" <brief@mail.ai-banking-brief.com>';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
/**
 * The address a colleague writes to for a forgotten password: DIGEST_CONTACT,
 * or else the editor's own (DIGEST_TEST_TO). Both are GitHub secrets, so the
 * address is filled in only in the email itself.
 */
const contactAddress = (): string | undefined =>
  addressList(process.env.DIGEST_CONTACT)[0] ?? addressList(process.env.DIGEST_TEST_TO)[0];
const needContact = (): string => {
  const c = contactAddress();
  if (!c) throw new Error('DIGEST_CONTACT or DIGEST_TEST_TO is required: the email names who to write to about a password.');
  return c;
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** The editor's rules, over the defaults, so a key left out of the file keeps its default. */
export function loadRules(path = RULES_PATH): DigestRules {
  if (!existsSync(path)) return DEFAULT_RULES;
  const file = readJson<Partial<DigestRules>>(path);
  return {
    ...DEFAULT_RULES,
    ...file,
    tier1Month: { ...DEFAULT_RULES.tier1Month, ...(file.tier1Month ?? {}) },
  };
}

/** This week's summary, if one was written and it passes. Otherwise why not. */
export function summaryFor(model: DigestModel, dir = DIGEST_DIR):
  { summary: DigestSummary | null; problems: string[]; missing: boolean } {
  const path = join(dir, `${model.week}.json`);
  if (!existsSync(path)) return { summary: null, problems: [], missing: true };
  const summary = readJson<DigestSummary>(path);
  const problems = validateDigest(summary, factsFor(model));
  return { summary: problems.length ? null : summary, problems, missing: false };
}

const needCreds = (): D1Credentials => {
  const creds = credentialsFromEnv();
  if (!creds) throw new Error('CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN are required.');
  return creds;
};

async function build(asOf: string) {
  // --input reads the rows from a file instead of D1: for a preview built
  // where the database is not reachable, and for anyone checking a layout
  // change against a week they already have.
  const rules = loadRules();
  const input = arg('input');
  const data: DigestInput = input
    ? { ...readJson<DigestInput>(input), asOf }
    : await loadDigestInput(needCreds(), asOf, rules);
  const model = buildModel(data, isoWeek(asOf), rules);
  const s = summaryFor(model);
  const dashboardUrl = process.env.DASHBOARD_URL || DEFAULT_DASHBOARD;

  const note = s.missing
    ? `no summary was written for ${model.week}, so this issue has none.`
    : s.problems.length
      ? `the summary for ${model.week} was left out because it did not pass: ${s.problems.join('; ')}.`
      : null;
  const preview = renderDigest(model, { dashboardUrl, summary: s.summary, previewNote: note });
  return { model, summary: s, note, preview, dashboardUrl };
}

function writeOut(out: string | undefined, r: RenderedDigest) {
  if (!out) return;
  writeFileSync(out, r.html);
  writeFileSync(out.replace(/\.html?$/, '') + '.txt', r.text);
  console.log(`Wrote ${out}`);
}

export interface ApprovedDraft {
  week: string; as_of: string; subject: string; html: string; text: string;
  sha256: string; approved_at: string; sent_at: string | null;
}

/**
 * Who the list send goes to. Until colleagues are added to DIGEST_TO, the list
 * is the editor alone: a pilot of one, so an approved issue is sent rather
 * than failing the Wednesday run.
 */
export function recipients(list: string | undefined, editor: string | undefined):
  { to: string[]; pilot: boolean } {
  const all = addressList(list);
  if (all.length) return { to: all, pilot: false };
  const self = addressList(editor);
  return { to: self, pilot: true };
}

/** The Tuesday on or after `date`, and the Wednesday after it. */
export function nextReviewAndSend(date: string): { review: string; send: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const toTuesday = (2 - d.getUTCDay() + 7) % 7;
  const review = addDays(date, toTuesday);
  return { review, send: addDays(review, 1) };
}

/**
 * The newest approved, unsent issue that is still current, or null.
 *
 * An issue approved and then forgotten must not go out a fortnight late, and
 * one that went out must never go twice.
 */
export function sendableDraft(drafts: readonly ApprovedDraft[], now = today()): ApprovedDraft | null {
  const candidates = drafts
    .filter((d) => d.approved_at && !d.sent_at && d.as_of >= addDays(now, -6))
    .sort((a, b) => b.week.localeCompare(a.week));
  return candidates[0] ?? null;
}

async function main() {
  const mode = arg('mode') ?? 'preview';
  const asOf = arg('as-of') || today();
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const from = process.env.DIGEST_FROM || DEFAULT_FROM;

  if (mode === 'facts') {
    // What the summary may be written from, printed to the log: every use case
    // and headline in this issue, with the ids a sentence must cite and the
    // counts it may repeat. The weekly Routine drafts from this, because its
    // session has no database access of its own.
    const { model } = await build(asOf);
    const entry = (e: DigestModel['other'][number]) => ({
      ids: e.ids, actor: e.actor, tier: e.tierText, stage: e.maturity,
      task: e.task, evidence: e.evidence, reports: e.reports, isNew: e.isNew,
    });
    console.log(`DIGEST_FACTS ${JSON.stringify({
      week: model.week,
      asOf: model.asOf,
      counts: model.counts,
      message: model.message,
      agenticLive: model.agenticLive.map(entry),
      agenticPilot: model.agenticPilot.map(entry),
      other: model.other.map(entry),
      news: model.news.map((n) => ({ id: n.id, actor: n.actor, headline: n.headline, isNew: n.isNew })),
      tier1Month: model.tier1Month,
    })}`);
    return;
  }

  if (mode === 'preview' || mode === 'check') {
    const { model, summary, preview } = await build(asOf);
    writeOut(arg('out'), preview);
    console.log(`${model.week}: ${preview.subject}`);
    if (mode === 'check') {
      if (summary.missing) { console.error(`No summary at ${join(DIGEST_DIR, `${model.week}.json`)}.`); process.exit(1); }
      if (summary.problems.length) {
        console.error('The summary was refused:');
        for (const p of summary.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log('The summary passes.');
    }
    return;
  }

  if (mode === 'draft') {
    const week = isoWeek(asOf);
    const creds = needCreds();
    const [existing] = await queryRows<{ approved_at: string | null; sent_at: string | null; excluded: string | null }>(creds,
      `SELECT approved_at, sent_at, excluded FROM digest_drafts WHERE week = ${L(week)}`);
    // The Tuesday fallback: if the Routine already drafted this week, leave the
    // draft the editor may already be reviewing alone.
    if (existing && process.argv.includes('--if-missing')) {
      console.log(`${week} is already drafted; the fallback has nothing to do.`);
      return;
    }
    if (existing?.sent_at) throw new Error(`${week} was already sent. Nothing was changed.`);

    const { model, summary, note, preview, dashboardUrl } = await build(asOf);
    // A rebuild replaces the snapshot and so withdraws any approval: what was
    // approved is no longer what would be sent. The editor's exclusions are
    // kept, since they name articles and those are still the same articles.
    await executeAll(creds, [`INSERT INTO digest_drafts (week, as_of, built_at, model, summary, summary_note)
VALUES (${L(week)}, ${L(model.asOf)}, ${L(new Date().toISOString())}, ${L(JSON.stringify(model))},
        ${L(summary.summary ? JSON.stringify(summary.summary) : null)}, ${L(note)})
ON CONFLICT(week) DO UPDATE SET as_of = excluded.as_of, built_at = excluded.built_at,
  model = excluded.model, summary = excluded.summary, summary_note = excluded.summary_note,
  subject = NULL, html = NULL, text = NULL, sha256 = NULL, approved_at = NULL, approved_by = NULL;`]);
    if (existing?.approved_at) console.log(`${week} was rebuilt, so its approval was withdrawn. Approve it again.`);
    console.log(`${week} drafted: ${preview.subject}`);
    writeOut(arg('out'), preview);

    const to = addressList(process.env.DIGEST_TEST_TO)[0];
    if (!apiKey || !to) {
      console.log('No RESEND_API_KEY or DIGEST_TEST_TO: the draft is in the tracker, and no preview was mailed.');
      return;
    }
    const review = `This is the draft for your review. Leave out anything that should not go, then approve it `
      + `in the tracker: ${dashboardUrl}, Review Queue. Nothing reaches colleagues until you do.`;
    // The mailed copy leaves out what the editor already left out in the
    // tracker, so a redraft mails the email as it stands in the Review Queue.
    let excluded: string[] = [];
    try { excluded = JSON.parse(existing?.excluded ?? '[]') as string[]; } catch { excluded = []; }
    const kept = applyExclusions(model, summary.summary ?? null, excluded);
    const mailed = renderDigest(kept.model, { dashboardUrl, summary: kept.summary, contact: needContact(),
      previewNote: note ? `${review} Also: ${note}` : review });
    if (excluded.length) console.log(`${excluded.length} lines the editor left out are left out of the mailed draft too.`);
    const id = await sendMail(apiKey, {
      from, to,
      subject: `Draft for review: ${mailed.subject}`,
      html: mailed.html,
      text: mailed.text,
      idempotencyKey: `digest-${week}-draft-${sha(mailed.html).slice(0, 12)}`,
    });
    console.log(`Preview of ${week} sent to the editor (Resend id ${id}).`);
    return;
  }

  if (mode === 'test-send') {
    // The approved email, byte for byte, to the editor alone. Nothing is
    // marked sent: Wednesday's send still goes out as approved.
    const creds = needCreds();
    const drafts = await queryRows<ApprovedDraft>(creds, `SELECT week, as_of, subject, html, text, sha256,
       approved_at, sent_at FROM digest_drafts WHERE approved_at IS NOT NULL ORDER BY week DESC LIMIT 1`);
    const issue = drafts[0];
    if (!issue) throw new Error('Nothing is approved yet. Approve the draft in the tracker (Review Queue), then run this again.');
    if (sha(issue.html) !== issue.sha256) throw new Error(`${issue.week} changed after it was approved. Approve it again.`);
    const editor = addressList(process.env.DIGEST_TEST_TO)[0];
    if (!apiKey || !editor) throw new Error('RESEND_API_KEY and DIGEST_TEST_TO are required.');
    const filled = withContact(issue, needContact());
    const id = await sendMail(apiKey, {
      from, to: editor, replyTo: editor,
      subject: `Test of the approved email: ${issue.subject}`,
      html: filled.html, text: filled.text,
      idempotencyKey: `digest-${issue.week}-testsend-${issue.sha256.slice(0, 12)}-${Date.now()}`,
    });
    console.log(`Approved ${issue.week} sent to the editor as a test (Resend id ${id}). `
      + `It is not marked sent: ${issue.sent_at ? 'it already went out' : 'Wednesday\'s send still mails it to the list'}.`);
    return;
  }

  if (mode === 'calendar') {
    const editor = addressList(process.env.DIGEST_TEST_TO)[0];
    if (!apiKey || !editor) throw new Error('RESEND_API_KEY and DIGEST_TEST_TO are required.');
    const dashboardUrl = process.env.DASHBOARD_URL || DEFAULT_DASHBOARD;
    const { review, send } = nextReviewAndSend(arg('from') || today());
    const invites = weeklyInvites({ dashboardUrl, firstReview: review, firstSend: send,
      stamp: new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') });
    const text = 'Two weekly entries for your calendar, one file each. In Outlook for Windows, '
      + 'double-click each attachment, then press Save & Close. Both go into your own calendar.\n\n'
      + '- Review the AI Banking Weekly Brief: every Tuesday, 09:00 to 09:30 Zurich time. The draft is ready at 08:37.\n'
      + '- AI Banking Weekly Brief goes out: every Wednesday at 07:47 Zurich time in summer, 06:47 in winter.\n\n'
      + 'If you added the earlier single file, which may have opened as a separate calendar called '
      + '"AI Banking Weekly Brief", remove that calendar first so the entries do not appear twice.\n\n'
      + `Review and approve in the tracker: ${dashboardUrl}, Review Queue.\n`;
    const id = await sendMail(apiKey, {
      from, to: editor,
      subject: 'Calendar for Outlook: AI Banking Weekly Brief, review Tuesday, sent Wednesday',
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#394253;">${
        text.split('\n').map((l) => l || '<br>').join('<br>')}</div>`,
      text,
      attachments: invites.map((i) => ({ filename: i.filename, content: i.ics, contentType: 'text/calendar' })),
      // Per content: a resend with a new link or a new stamp is a new message,
      // and a key fixed per day made Resend refuse it for 24 hours.
      idempotencyKey: `digest-calendar-${review}-${sha(invites.map((i) => i.ics).join('')).slice(0, 12)}`,
    });
    for (const i of invites) writeFileSync(i.filename, i.ics);
    console.log(`Calendar sent to the editor (Resend id ${id}): reviews from ${review}, sends from ${send}.`);
    return;
  }

  if (mode === 'send') {
    const creds = needCreds();
    const drafts = await queryRows<ApprovedDraft>(creds, `SELECT week, as_of, subject, html, text, sha256,
       approved_at, sent_at FROM digest_drafts WHERE approved_at IS NOT NULL AND sent_at IS NULL`);
    const issue = sendableDraft(drafts);
    if (!issue) {
      // Sent early, by hand, earlier this week: the Wednesday run has nothing
      // to do and nothing to report.
      const [recent] = await queryRows<{ week: string; sent_at: string }>(creds,
        `SELECT week, sent_at FROM digest_drafts WHERE sent_at >= ${L(addDays(today(), -6))}
         ORDER BY sent_at DESC LIMIT 1`);
      if (recent) {
        console.log(`Nothing to send: ${recent.week} already went out at ${recent.sent_at}.`);
        return;
      }
      const why = 'no issue from the last six days was approved, or it has already gone out.';
      console.log(`Nothing to send: ${why}`);
      // Tell the editor, so a missed approval is a note on the send morning and
      // not a silence colleagues notice first.
      const editor = addressList(process.env.DIGEST_TEST_TO)[0];
      if (apiKey && editor) {
        const text = `The weekly AI banking brief was not sent this morning: ${why}\n\n`
          + 'To send it now, approve it in the tracker (Review Queue), then run the Weekly digest workflow in mode send.\n';
        await sendMail(apiKey, {
          from, to: editor,
          subject: 'The weekly brief was not sent',
          html: `<p style="font-family:Arial,sans-serif;font-size:15px;color:#394253;">${text.replace(/\n/g, '<br>')}</p>`,
          text,
          idempotencyKey: `digest-not-sent-${today()}`,
        });
      }
      return;
    }
    if (sha(issue.html) !== issue.sha256) {
      throw new Error(`${issue.week} changed after it was approved. Approve it again before sending.`);
    }
    const editor = addressList(process.env.DIGEST_TEST_TO)[0];
    const { to: list, pilot } = recipients(process.env.DIGEST_TO, process.env.DIGEST_TEST_TO);
    if (!apiKey || !editor || list.length === 0) {
      throw new Error('RESEND_API_KEY and DIGEST_TEST_TO are required to send.');
    }
    if (pilot) console.log('DIGEST_TO is not set, so the list is the editor alone.');
    // Checked against the hash above first, then the address filled in.
    const filled = withContact(issue, needContact());
    const parts = chunks(list);
    for (const [i, bcc] of parts.entries()) {
      await sendMail(apiKey, {
        from, to: editor, bcc, replyTo: editor,
        subject: issue.subject, html: filled.html, text: filled.text,
        idempotencyKey: `digest-${issue.week}-list-${issue.sha256.slice(0, 12)}-${i}`,
      });
    }
    const sentAt = new Date().toISOString();
    // A count, never the addresses.
    await executeAll(creds, [
      `UPDATE digest_drafts SET sent_at = ${L(sentAt)}, recipients = ${list.length} WHERE week = ${L(issue.week)};`,
      `UPDATE digest_issues SET sent_at = ${L(sentAt)} WHERE week = ${L(issue.week)};`,
    ]);
    console.log(`${issue.week} sent to ${list.length} recipients in ${parts.length} message(s).`);
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

if (import.meta.filename === process.argv[1]) await main();
