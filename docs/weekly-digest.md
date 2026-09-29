# The weekly email brief

A short email for Synpulse colleagues, every Wednesday morning. It covers **the
last seven days** of AI-in-banking news:

- which institutions are running agentic AI in production
- which are piloting it
- what other named use cases were reported
- the market news around them

It ends with a monthly reminder of the **Tier 1 banks'** AI news. Institutions
are ranked by tier throughout, so Tier 1 banks come first. The brief is built
straight from the database, and nothing goes out until the editor has reviewed
and approved it in the tracker.

## Two Routines, two jobs

| Routine | When | What it does | Who checks it |
|---|---|---|---|
| **Daily grading** | Every morning at 06:52 Zurich, after the 06:20 news ingest | Grades every new article A, B or D by `data/review/RUBRIC.md` and **publishes** the grades straight to the Market Lens and Trends. It repeats until nothing is left, then checks in D1 that no article is unread. | Nobody, per grade. The editor's check is on the email. |
| **Weekly brief** | Tuesday at 08:37 Zurich | Drafts the email by `data/digest/RULES.md`: an AI-written summary, then the issue itself, stored for review. | The editor, in the tracker, before anything is sent. |

**Both Routines run inside the Claude chat session that built this.** A fresh
scheduled session starts without GitHub access. The first Monday run, on
28 September, proved it: the session could neither trigger a workflow nor push.
So both Routines wake that chat session, which already holds the repo and the
GitHub and Cloudflare tools, instead of starting a new one. To run either off
cycle, say so in that chat ("grade new articles", "draft the brief"), or press
**Run now** in the Claude app's Routines list.

## The weekly rhythm

| When | What happens | Who |
|---|---|---|
| Tuesday 08:37 Zurich | **Brief Routine.** Claude reads `RULES.md`, drafts the summary (`facts`, a subagent, then `check`), and runs mode `draft`. The issue is stored in D1 as a snapshot, and a **preview** titled "Draft for review" reaches your inbox. | Automatic |
| Tuesday 16:47 UTC | **Fallback.** If nothing was drafted for the week, the workflow drafts the issue without a summary. | Automatic |
| Tuesday, any time | **You review it** in the tracker (see below) and press **Approve for Wednesday**. | Editor |
| Wednesday 05:47 UTC (07:47 Zurich in summer) | Mode `send` mails the **approved email, byte for byte**, to the list. If nothing was approved, nothing is sent and you get a note saying so. | Automatic |

## Reviewing the email in the tracker

Open the tracker and go to **Review Queue**. The section **This week's email**
is at the top, for administrators only.

- **On the left**, every line of the email, grouped as the email is: the
  summary sentences, agentic AI in production, in pilot, other use cases,
  around the market, and the Tier 1 month. Each has a tick box and a **Read**
  link to its article.
- **On the right**, the email itself, rendered by the same code that sends it.
  On a phone it is under **Show the email**.
- **Untick a line** and it leaves the email at once:
  - It leaves every section it appears in, the Tier 1 month included.
  - The counts and the key line are recounted.
  - A summary sentence goes with it if every article that sentence cites was
    left out.
  - Tick it again to put it back.
- **Approve for Wednesday** renders the email once and stores it with its
  hash. That stored email is what Wednesday sends, and the approved summary
  appears on Trends & Summary.
- **Any change after approving withdraws the approval.** The screen says so,
  and you approve again. **Withdraw approval** does the same by hand.

When you leave the same kind of item out week after week, tell Claude in the
chat, or add it to `data/digest/RULES.md` or `data/review/RUBRIC.md`. The next
draft or the next grading pass then does not carry it.

## What is in it

| Section | What it shows | Where it comes from |
|---|---|---|
| This week in brief | 3 to 5 sentences on what the week meant | Written with AI by the brief Routine, checked by `validateDigest`, reviewed by the editor. Labelled as AI-written in the email. |
| Key line and four numbers | e.g. "2 of 3 named use cases this week are already running": use cases, agentic live, agentic pilots, news articles screened | Counted from D1 |
| Agentic AI in production | Tier label, institution, task, a one-line quote, source | A grades with `agent_stage = running` |
| Agentic AI in pilot | Same layout | `agent_stage = pilot` |
| Other AI use cases | One line each | Every other A grade |
| Around the market | Five B headlines, named institutions first | B grades |
| Coverage over the last eight weeks | One bar per seven days, this week in orange | Articles collected |
| **Tier 1 banks, this month** | Up to six lines: Tier 1 use cases first (agentic in production, then pilots, then the rest), then B headlines naming a Tier 1 bank. Before the 8th of a month it shows the previous month in full. | A and B grades of the month |
| Footer | The coverage caveat, how the tiers are defined, how to leave the list | Fixed text |

The numbers in that table (7 days, 5 headlines, 6 Tier 1 lines, the 8th) live
in `data/digest/rules.json`. Change them there, and the next draft follows.
`RULES.md` beside it explains each one.

**Rules the content follows:**

- **Window.** The last seven days, by the date an article was **collected**,
  not the date it says it was published. Publication date hid 21 late-crawled
  articles from four review passes (`docs/papercuts.md`).
- **Ordering.** Same as the dashboard: `lib/tiers.ts` puts Tier 1 banks
  first, then Tier 2 and Tier 3 banks, digital banks, providers and
  regulators. Several outlets reporting one use case are folded into one line
  by `groupArticles`, exactly as the Market Lens does.
- **Tier 1 in headlines.** Market news has no institution field, so a B
  headline counts as Tier 1 news when it names a Tier 1 bank (`tier1In`, whole
  words and case-sensitive, so "Citi" never matches "Citizens").
- **Outlook.** Colleagues read it in Outlook on Windows, which renders email
  with Word. So the layout is tables with inline styles only: no flexbox,
  grid, SVG, images or script. Unit tests check this.
- **House style.** The house colours (`#394253` text, `#F7682C` accent used
  sparingly), nothing under 14px, no capital-letter words.

## The AI-written parts

This is the one named exception to the rule "no scheduled AI". The Routines are
Claude Code sessions owned by the editor. They are not workflows, and no model
API key exists in the repository or in Actions.

- **Grades** are published without a per-grade check. The Market Lens shows
  them the next morning. The rubric is `data/review/RUBRIC.md`, and an A still
  cannot be imported without a quote that names its task.
- **The summary** is checked by `validateDigest`
  (`packages/shared/src/digest.ts`), which refuses a summary that:
  - cites an article that is not in this issue
  - names an institution that none of its cited articles is about
  - states a number that is neither a count the email prints nor a figure in a
    cited article
  - is longer than 5 sentences or 700 characters
  - writes words in capitals the sources do not use, or uses an exclamation
    mark

A refused summary is left out of the issue; the issue is never blocked by it.
How it should read, and the file format, are in `data/digest/RULES.md`.

**Subject and sign-off.**

- The subject names who moved rather than counting them, e.g. *"AI in Banking
  Weekly Brief, 29 September: agentic AI live at Barclays"*.
- The brief opens and closes with the editor, set once in `EDITOR` in
  `packages/ingest/src/digest/render.ts`: Verim Ajdini, AI Consultant, NGOM
  Team.

## Running it by hand

Each mode is a button: **Actions → Weekly digest → Run workflow**.

| Mode | What it does |
|---|---|
| `preview` | Builds the email and attaches it to the run (`digest-preview`). Mails nobody and stores nothing. |
| `facts` | Prints this issue's use cases, their article ids and the counts, the Tier 1 month included, as one JSON line in the job log. The Routine drafts the summary from it. |
| `check` | Validates this week's summary against the live data. If it is refused, the run fails and its log lists every refusal. |
| `draft` | Stores this week's issue in D1 for review and mails the editor a preview. A rebuild replaces the snapshot and withdraws any approval, but keeps the lines you left out. |
| `send` | Mails the approved issue to the list, once. Until `DIGEST_TO` holds colleagues, the list is you alone, so Wednesday's send reaches you. |
| `test-send` | Mails the approved issue to you only, byte for byte, as "Test of the approved email". It is not marked sent, so Wednesday still sends it. |
| `calendar` | Mails you a calendar file with both weekly dates: **Review the AI Banking Weekly Brief** every Tuesday 09:00 to 09:30 Zurich time, and **AI Banking Weekly Brief goes out** every Wednesday at 05:47 UTC (07:47 in Zurich in summer, 06:47 in winter). One file per entry: in Outlook for Windows, double-click each attachment and press Save & Close. (A single file with both entries opened as a separate calendar in Outlook for Windows.) |

**Why the stored email matters.** Approving stores the rendered email and its
sha256. `send` refuses anything whose hash differs, so what colleagues receive
is exactly what you approved. Grading runs every morning, so an email rebuilt
on Wednesday would carry lines nobody reviewed. The snapshot prevents that.

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
   | `DIGEST_TEST_TO` | Your work address. The editor gets drafts here, and it is the reply-to. |

**2. The database tables.** Run the **migrate** workflow once. It creates
`digest_issues`, which the Trends page reads, and `digest_drafts`, which the
review screen reads.

**3. The domain (done on 29 September 2026).**

- `ai-banking-brief.com`, bought through Cloudflare Registrar.
- Resend sends from `mail.ai-banking-brief.com`, verified with SPF and DKIM.
  A DMARC record (`_dmarc.mail`, `p=none`) tells receiving servers the domain
  follows the standard, without asking them to block anything.
- The sender is `Verim Ajdini, AI Banking Brief <brief@mail.ai-banking-brief.com>`,
  set in `packages/ingest/src/digest.ts`. A `DIGEST_FROM` secret overrides it.
- The tracker is also at `https://tracker.ai-banking-brief.com` (`routes` in
  `wrangler.toml`). The email's links and logos point there, whichever address
  the editor approves from. `workers_dev = true` keeps the old address alive
  beside it: Wrangler switches workers.dev off once a route exists unless that
  line says otherwise. A page opened on the old address is sent on to the new
  one with its link intact (`packages/worker/src/canonical.ts`), so emails,
  calendar entries and bookmarks from before the move open the tracker's own
  domain. The API and the logos still answer on workers.dev. Set
  `workers_dev = false` once nobody uses the old address.
- The Archive tab is for administrators only. Viewers and Analysts see the
  Market Lens and Trends & Summary.

**4. Colleagues.**

| Secret | Value |
|---|---|
| `DIGEST_TO` | Colleagues' addresses, separated by commas or new lines. They are sent in BCC, 45 per message, so nobody sees the list. Until it is set, the Wednesday send goes to you alone. |

- Give each a tracker login (**Admin → Add user**), so the email's button opens
  for them.
- **Pilot first.** Send to 2–3 colleagues for one week. If Synpulse's
  Microsoft 365 filter puts the brief in Junk, ask IT to allow-list
  `mail.ai-banking-brief.com`.

## Adding or removing a colleague

Edit the `DIGEST_TO` secret. Replies ("please take me off") go to the
editor's address, because every send sets it as reply-to.

## Troubleshooting

| Symptom | Cause, and what to do |
|---|---|
| "You can only send testing emails to your own email address" | No domain is verified yet, and `DIGEST_TEST_TO` is not the Resend account's own address. Use the account address, or verify a domain. |
| "No email drafted yet" in the Review Queue | The Tuesday Routine has not run, or failed. Say "draft the brief" in the chat, or run mode `draft`. |
| The draft says the summary was left out | The note gives what `validateDigest` refused. Ask the Routine to redraft, then run mode `draft` again. The lines you left out are kept. |
| "Nothing to send" on Wednesday | Nothing was approved in the last six days. Approve it in the tracker, then run mode `send`. |
| "changed after it was approved" | The stored email no longer matches its hash. Approve it again. |
| It lands in Junk | Normal for a new domain. Mark it "Not junk", or ask IT to allow-list the domain. |
| An empty week | The issue still goes out, saying no named use cases were reviewed, with the market news and the Tier 1 month. |

## Files

| Path | What it holds |
|---|---|
| `data/review/RUBRIC.md` | How the daily Routine grades, with the editor's corrections |
| `data/digest/rules.json`, `data/digest/RULES.md` | What the brief contains, and why |
| `packages/ingest/src/digest.ts` | The command: modes `preview`, `facts`, `check`, `draft`, `send` |
| `packages/ingest/src/digest/{data,model,render,send}.ts` | D1 queries, sections and order, the HTML and text, the Resend call |
| `packages/worker/src/routes/digest.ts` | The review screen's API: the draft, leaving lines out, approve, withdraw |
| `packages/web/src/components/BriefReview.tsx` | The review screen |
| `packages/shared/src/digest.ts` | The summary format and `validateDigest` |
| `.github/workflows/digest.yml` | The buttons and the two schedules |
| `db/migrations/0012_digest_drafts.sql` | Drafts, approvals and sends |
| `db/migrations/0010_digest_issues.sql` | The approved issues the Trends page shows |
| `data/digest/<week>.json` | The summary |
