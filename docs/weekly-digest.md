# The weekly email brief

A short email for Synpulse colleagues, every Tuesday morning. It covers the
AI-in-banking news of this week and last:

- which institutions are running agentic AI in production
- which are piloting it
- what other named use cases were reported
- the market news around them

Institutions are ranked by tier, so Tier 1 banks come first. The brief is built
straight from the database. It combines Market Lens page one with the Trends &
Summary tab. Nothing goes out until the editor has read it.

## What is in it

| Section | What it shows | Where it comes from |
|---|---|---|
| This week in brief | 3–5 sentences on what the fortnight meant | Written with AI by the weekly Routine, checked by `validateDigest`, read by the editor. Labelled as AI-written in the email. |
| Key line and four numbers | e.g. "12 of 28 named use cases are already running", with use cases, agentic live, agentic pilots, articles collected | Counted from D1 |
| Agentic AI in production | Tier label, institution, task, a one-line quote, source, "New" if it arrived this week | Reviewed A grades, `agent_stage = running` |
| Agentic AI in pilot | Same layout | `agent_stage = pilot` |
| Other AI use cases | One line each | Every other reviewed A |
| Around the market | Five B headlines, named institutions first | Reviewed B grades |
| Coverage by week | One bar per seven days, this week in orange | Articles collected |
| Footer | The coverage caveat, how the tiers are defined, how to leave the list | Fixed text |

**Rules the content follows:**

- **Window.** The last 14 days, by the date an article was **collected**, not
  the date it says it was published. Publication date hid 21 late-crawled
  articles from four review passes (`docs/papercuts.md`). An article collected
  in the last seven days is marked **New**, so the two-week window never reads
  as a repeat.
- **Ordering.** Same as the dashboard: `lib/tiers.ts` puts Tier 1 banks
  first, then Tier 2 and Tier 3 banks, digital banks, providers and
  regulators. Several outlets reporting one use case are folded into one line
  by `groupArticles`, exactly as the Market Lens does.
- **Outlook.** Colleagues read it in Outlook on Windows, which renders email
  with Word. So the layout is tables with inline styles only: no flexbox,
  grid, SVG, images or script. Unit tests check this.
- **House style.** The house colours (`#394253` text, `#F7682C` accent used
  once), nothing under 14px, no capital-letter words.

## The weekly rhythm

| When | What happens | Who |
|---|---|---|
| Monday 06:52 Zurich | The **weekly Routine** starts a Claude Code session. It runs the review pass (export, grade, apply, check D1). A subagent then drafts `data/digest/<ISO-week>.json`, and `npm run digest -- --mode=check` validates it, with at most two redrafts. Then it commits, pushes, and runs the workflow in mode `test`. | Automatic |
| About 07:30 | A **preview** reaches the editor's inbox. If the summary was refused, the preview says why at the top. | Automatic |
| Monday 10:47 UTC | **Fallback.** If the Routine built nothing, the workflow builds the issue without a summary and sends the preview anyway. | Automatic |
| Monday, any time | The editor reads the preview. If it is right, they approve it: **Actions → Weekly digest → Run workflow → mode `approve`**, then **Approve** in the `digest-approval` environment. This also puts the brief on the Trends page. | Editor |
| Tuesday 05:47 UTC (07:47 Zurich in summer) | Mode `send` mails the **approved issue, byte for byte**, to the list. If nothing was approved, nothing is sent and the editor gets a note saying so. | Automatic |

**Running it by hand.** Each mode is a button: **Actions → Weekly digest →
Run workflow**.

| Mode | What it does |
|---|---|
| `preview` | Builds the email and attaches it to the run (`digest-preview`). Mails nobody. |
| `test` | Freezes this week's issue and mails the preview to the editor. |
| `approve` | Approves the frozen issue, waiting for the editor in the environment. |
| `send` | Mails the approved issue to the list, once. |

The Routine can also be fired off-cycle with **Run now** in the Claude app's
Routines list.

**Why the frozen file matters.** `test` writes
`data/digest/<week>.issue.json` with a sha256 of the HTML. `approve` records
that hash, and `send` refuses to send anything whose hash differs. What
colleagues receive is exactly what the editor read.

## The AI-written summary

This is one named exception to the rule "no scheduled AI". The Routine is a
Claude Code session owned by the editor. It is not a workflow, and no model API
key exists in the repository or in Actions.

`validateDigest` (`packages/shared/src/digest.ts`) refuses a summary that:

- cites an article that is not in this issue
- names an institution that none of its cited articles is about
- states a number that is neither a count the email prints nor a figure in a
  cited article
- is longer than 5 sentences or 700 characters
- writes words in capitals the sources do not use, or uses an exclamation mark

A refused summary is left out of the issue; the issue is never blocked by it.
The file format is:

```json
{
  "week": "2026-W40",
  "sentences": [
    { "text": "Deutsche Bank now runs agents on source-of-wealth checks.", "cites": ["<articleId>"] }
  ]
}
```

## One-time setup

Everything secret lives in **GitHub → Settings → Secrets and variables →
Actions**. The repository is public, so **no email address is ever committed,
written in these docs, or typed as a workflow input**: inputs and logs are
public.

**1. Resend (about 10 minutes).**

1. Sign up at resend.com with **your work email address**. Until a domain is
   verified, Resend delivers only to the address the account was registered
   with. That is exactly what the test needs.
2. Go to **API Keys**, create a key with "Sending access", and copy it.
3. Add these repository secrets:

   | Secret | Value |
   |---|---|
   | `RESEND_API_KEY` | The key |
   | `DIGEST_TEST_TO` | Your work address. The editor gets previews here, and it is the reply-to. |

4. Run **Weekly digest** in mode `test`. The preview arrives within a minute.
   Check it in Outlook desktop, Outlook on the web and on your phone.

**2. The approval gate.** Go to **Settings → Environments → New
environment**, name it `digest-approval`, tick **Required reviewers**, and add
yourself. Without this the `approve` button approves straight away.

**3. The database table.** Run the **migrate** workflow once. It creates
`digest_issues`, which the Trends page reads.

**4. Colleagues: your own domain.**

- **Buy the domain.** In the Cloudflare dashboard go to **Domain
  Registration → Register**. Cloudflare sells at cost with no markup, and a
  `.com` is about $10–11 a year. The dashboard shows the exact price before
  checkout. **Registration is non-refundable**, and it is the owner's to buy:
  Claude never registers one. Choose a neutral name. Avoid "synpulse": it is
  the company's trademark, and using it is a policy question for Synpulse.
- **Verify it in Resend.** Go to **Domains → Add domain**, e.g.
  `mail.<your-domain>`. The Cloudflare integration writes the SPF and DKIM
  records, and verification takes minutes. Add a DMARC record with `p=none`
  to start.
- **Add two more secrets:**

  | Secret | Value |
  |---|---|
  | `DIGEST_FROM` | e.g. `AI Banking Tracker <brief@mail.<your-domain>>` |
  | `DIGEST_TO` | Colleagues' addresses, separated by commas or new lines. They are sent in BCC, 45 per message, so nobody sees the list. |

- **Pilot first.** Send to 2–3 colleagues for one week. If Synpulse's
  Microsoft 365 filter puts the brief in Junk, ask IT to allow-list the
  sending domain.

**5. The tracker on the same domain (optional).** Add this to `wrangler.toml`
and deploy:

```toml
routes = [{ pattern = "tracker.<your-domain>", custom_domain = true }]
```

Cloudflare creates the DNS record and the certificate. Everyone logs in once
more, because the session cookie belongs to a host. Keep workers.dev running
for a week, then turn it off with `workers_dev = false`. Set the repository
**variable** `DASHBOARD_URL` to the new address so the email links there.

## Adding or removing a colleague

Edit the `DIGEST_TO` secret. Replies ("please take me off") go to the
editor's address, because every send sets it as reply-to.

## Troubleshooting

| Symptom | Cause, and what to do |
|---|---|
| "You can only send testing emails to your own email address" | No domain is verified yet, and `DIGEST_TEST_TO` is not the Resend account's own address. Use the account address, or verify a domain. |
| The preview says the summary was left out | The note lists what `validateDigest` refused. Fire the Routine again, or send without a summary. |
| "Nothing to send" on Tuesday | Nothing was approved in the last six days. Approve, then run mode `send`. |
| "changed after it was approved" | The issue was rebuilt after approval. Approve it again. |
| It lands in Junk | Normal for a new domain. Mark it "Not junk", or ask IT to allow-list the domain. |
| An empty week | The issue still goes out, saying no named use cases were reviewed, with the market news. |

## Files

| Path | What it holds |
|---|---|
| `packages/ingest/src/digest.ts` | The command: modes `preview`, `check`, `test`, `approve`, `send` |
| `packages/ingest/src/digest/{data,model,render,send}.ts` | D1 queries, sections and order, the HTML and text, the Resend call |
| `packages/shared/src/digest.ts` | The summary format and `validateDigest` |
| `packages/shared/src/sql.ts` | The agent-stage SQL, shared with the Market Lens |
| `.github/workflows/digest.yml` | The buttons and the two schedules |
| `db/migrations/0010_digest_issues.sql` | The approved issues the Trends page shows |
| `data/digest/<week>.json` | The summary |
| `data/digest/<week>.issue.json` | The frozen issue |
| `data/digest/<week>.approved.json` | The approval |
| `data/digest/<week>.sent.json` | The send record: a count, never addresses |
