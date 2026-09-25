import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoWeek, validateDigest, type DigestSummary } from '@portal/shared';
import { credentialsFromEnv, executeAll } from './load-d1.ts';
import { sqlLiteral as L } from './sql.ts';
import { loadDigestInput } from './digest/data.ts';
import { buildModel, factsFor, type DigestInput, type DigestModel } from './digest/model.ts';
import { renderDigest, type RenderedDigest } from './digest/render.ts';
import { addressList, chunks, sendMail } from './digest/send.ts';

/**
 * The weekly digest, from the command line and from `.github/workflows/digest.yml`.
 *
 *   --mode=preview   build it and write it to --out; mail nobody
 *   --mode=facts     print this issue's use cases, ids and counts as one JSON line
 *   --mode=check     validate this week's written summary; exit 1 if refused
 *   --mode=test      build it, freeze it as this week's issue, mail the editor
 *   --mode=approve   mark the frozen issue approved and publish it to the dashboard
 *   --mode=send      mail the approved issue to the list, once
 *
 * The weekly rhythm (docs/weekly-digest.md): the Routine reviews and writes the
 * summary on Monday morning and runs `test`; the editor reads the preview and
 * runs `approve`; Tuesday's schedule runs `send`. What goes to colleagues is
 * the frozen file the editor read, byte for byte — `send` refuses an issue
 * whose hash differs from the one that was approved.
 *
 * No address is ever written to a file here. The repository is public.
 */

export const DIGEST_DIR = 'data/digest';
const DEFAULT_DASHBOARD = 'https://ai-banking-market-news.verimajdini.workers.dev';
/** Resend's shared sender, which works before a domain is verified — to the account's own address only. */
const DEFAULT_FROM = 'AI Banking Tracker <onboarding@resend.dev>';

interface Frozen extends RenderedDigest {
  week: string;
  asOf: string;
  message: string;
  summary: DigestSummary | null;
  sha256: string;
  builtAt: string;
}

const paths = (week: string) => ({
  summary: join(DIGEST_DIR, `${week}.json`),
  issue: join(DIGEST_DIR, `${week}.issue.json`),
  approved: join(DIGEST_DIR, `${week}.approved.json`),
  sent: join(DIGEST_DIR, `${week}.sent.json`),
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
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

async function build(asOf: string) {
  // --input reads the rows from a file instead of D1: for a preview built
  // where the database is not reachable, and for anyone checking a layout
  // change against a week they already have.
  const input = arg('input');
  let data: DigestInput;
  if (input) {
    data = { ...readJson<DigestInput>(input), asOf };
  } else {
    const creds = credentialsFromEnv();
    if (!creds) throw new Error('CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN are required.');
    data = await loadDigestInput(creds, asOf);
  }
  const model = buildModel(data, isoWeek(asOf));
  const s = summaryFor(model);
  const dashboardUrl = process.env.DASHBOARD_URL || DEFAULT_DASHBOARD;
  const clean = renderDigest(model, { dashboardUrl, summary: s.summary });

  const note = s.missing
    ? `no summary was written for ${model.week}, so this issue has none.`
    : s.problems.length
      ? `the summary for ${model.week} was left out because it did not pass: ${s.problems.join('; ')}.`
      : null;
  const preview = renderDigest(model, { dashboardUrl, summary: s.summary, previewNote: note });
  return { model, summary: s, clean, preview };
}

function freeze(model: DigestModel, summary: DigestSummary | null, clean: RenderedDigest): Frozen {
  const frozen: Frozen = {
    ...clean,
    week: model.week,
    asOf: model.asOf,
    message: model.message,
    summary,
    sha256: sha(clean.html),
    builtAt: new Date().toISOString(),
  };
  mkdirSync(DIGEST_DIR, { recursive: true });
  writeFileSync(paths(model.week).issue, `${JSON.stringify(frozen, null, 2)}\n`);
  return frozen;
}

function writeOut(out: string | undefined, r: RenderedDigest) {
  if (!out) return;
  writeFileSync(out, r.html);
  writeFileSync(out.replace(/\.html?$/, '') + '.txt', r.text);
  console.log(`Wrote ${out}`);
}

/** The newest approved, unsent issue that is still current. */
export function sendable(dir = DIGEST_DIR, now = today()): string | null {
  if (!existsSync(dir)) return null;
  const weeks = readdirSync(dir)
    .filter((f) => f.endsWith('.approved.json'))
    .map((f) => f.replace('.approved.json', ''))
    .filter((w) => !existsSync(join(dir, `${w}.sent.json`)))
    .sort();
  const week = weeks.at(-1);
  if (!week) return null;
  // An issue approved and then forgotten must not go out a fortnight late.
  const issue = readJson<Frozen>(join(dir, `${week}.issue.json`));
  const age = (Date.parse(now) - Date.parse(issue.asOf)) / 86_400_000;
  return age <= 6 ? week : null;
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
    })}`);
    return;
  }

  if (mode === 'preview' || mode === 'check') {
    const { model, summary, preview } = await build(asOf);
    writeOut(arg('out'), preview);
    console.log(`${model.week}: ${preview.subject}`);
    if (mode === 'check') {
      if (summary.missing) { console.error(`No summary at ${paths(model.week).summary}.`); process.exit(1); }
      if (summary.problems.length) {
        console.error('The summary was refused:');
        for (const p of summary.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log('The summary passes.');
    }
    return;
  }

  if (mode === 'test') {
    // The Monday fallback: the Routine normally builds this week's issue at
    // 06:52. If it did, the schedule leaves it alone rather than rebuilding
    // the issue the editor may already be reading.
    if (process.argv.includes('--if-missing') && existsSync(paths(isoWeek(asOf)).issue)) {
      console.log(`${isoWeek(asOf)} is already built; the fallback has nothing to do.`);
      return;
    }
    const { model, summary, clean, preview } = await build(asOf);
    const frozen = freeze(model, summary.summary, clean);
    writeOut(arg('out'), preview);
    const to = addressList(process.env.DIGEST_TEST_TO)[0];
    if (!apiKey || !to) throw new Error('RESEND_API_KEY and DIGEST_TEST_TO are required to send the test.');
    const id = await sendMail(apiKey, {
      from, to,
      subject: `Preview: ${preview.subject}`,
      html: preview.html,
      text: preview.text,
      // A rebuild changes the hash, and a changed issue deserves a new preview.
      idempotencyKey: `digest-${model.week}-test-${frozen.sha256.slice(0, 12)}`,
    });
    console.log(`Preview of ${model.week} sent to the editor (Resend id ${id}).`);
    return;
  }

  if (mode === 'approve') {
    const week = arg('week') || isoWeek(asOf);
    const p = paths(week);
    if (!existsSync(p.issue)) throw new Error(`No frozen issue for ${week}. Run the test mode first.`);
    const issue = readJson<Frozen>(p.issue);
    const approvedAt = new Date().toISOString();
    writeFileSync(p.approved, `${JSON.stringify({ week, sha256: issue.sha256, approvedAt }, null, 2)}\n`);

    // The dashboard's copy. Written on approval, not on build, so the Trends
    // page can only ever show an issue someone read.
    const creds = credentialsFromEnv();
    if (creds) {
      await executeAll(creds, [`INSERT INTO digest_issues (week, as_of, subject, message, summary, approved_at)
VALUES (${L(week)}, ${L(issue.asOf)}, ${L(issue.subject)}, ${L(issue.message)},
        ${L(issue.summary ? JSON.stringify(issue.summary) : null)}, ${L(approvedAt)})
ON CONFLICT(week) DO UPDATE SET as_of = excluded.as_of, subject = excluded.subject,
  message = excluded.message, summary = excluded.summary, approved_at = excluded.approved_at;`]);
    }
    console.log(`${week} approved: ${issue.subject}`);
    return;
  }

  if (mode === 'send') {
    const week = arg('week') || sendable();
    if (!week) {
      const why = 'no issue from the last six days was approved, or it has already gone out.';
      console.log(`Nothing to send: ${why}`);
      // Tell the editor, so a missed approval is a note on Tuesday morning and
      // not a silence colleagues notice first.
      const editor = addressList(process.env.DIGEST_TEST_TO)[0];
      if (apiKey && editor) {
        const text = `The weekly AI banking brief was not sent this Tuesday: ${why}\n\n`
          + 'To send it now, approve it in GitHub (Actions, Weekly digest, mode approve), then run mode send.\n';
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
    const p = paths(week);
    const issue = readJson<Frozen>(p.issue);
    const approval = readJson<{ sha256: string }>(p.approved);
    if (approval.sha256 !== issue.sha256 || sha(issue.html) !== issue.sha256) {
      throw new Error(`${week} changed after it was approved. Approve it again before sending.`);
    }
    const list = addressList(process.env.DIGEST_TO);
    const editor = addressList(process.env.DIGEST_TEST_TO)[0];
    if (!apiKey || !editor || list.length === 0) {
      throw new Error('RESEND_API_KEY, DIGEST_TEST_TO and DIGEST_TO are required to send.');
    }
    const parts = chunks(list);
    for (const [i, bcc] of parts.entries()) {
      await sendMail(apiKey, {
        from, to: editor, bcc, replyTo: editor,
        subject: issue.subject, html: issue.html, text: issue.text,
        idempotencyKey: `digest-${week}-list-${issue.sha256.slice(0, 12)}-${i}`,
      });
    }
    const sentAt = new Date().toISOString();
    // A count, never the addresses.
    writeFileSync(p.sent, `${JSON.stringify({ week, sentAt, recipients: list.length }, null, 2)}\n`);
    const creds = credentialsFromEnv();
    if (creds) {
      await executeAll(creds, [`UPDATE digest_issues SET sent_at = ${L(sentAt)} WHERE week = ${L(week)};`]);
    }
    console.log(`${week} sent to ${list.length} recipients in ${parts.length} message(s).`);
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

if (import.meta.filename === process.argv[1]) await main();
