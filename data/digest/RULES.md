# Rules for the weekly email brief

The Tuesday Routine reads this file before it drafts each issue. What the email
contains is set in `rules.json` next to it, so a change there reaches the next
issue without touching code. The tests check that the file still has every
setting the code expects.

## The settings in `rules.json`

| Setting | Now | What it does |
|---|---|---|
| `windowDays` | 7 | How many days an issue covers, ending on its date, by the day an article was collected. 7 is last week only. 14 brings back the two-week issue and its "New" marks. |
| `newsLimit` | 5 | How many market headlines (grade B) "Around the market" carries. |
| `tier1Month.enabled` | true | Whether the email ends with the Tier 1 section. |
| `tier1Month.maxItems` | 6 | How many lines that section carries at most. |
| `tier1Month.previousMonthBeforeDay` | 8 | Before the 8th of a month the section shows the previous month in full ("September"). From the 8th it shows the month so far ("October so far"). Early in a month, "so far" would only repeat the week above it. |

## What goes in, and in what order

1. **This week in brief.** The AI-written summary, 3 to 5 sentences (see below).
2. **The key line and four numbers.** Named use cases, agentic AI in
   production, agentic AI in pilot, news articles screened. These are counted,
   not written.
3. **Agentic AI in production**, then **agentic AI in pilot**, then **other
   AI use cases**. Only A grades. Each use case is one line however many outlets
   reported it. Largest institutions first: Tier 1 banks, Tier 2, Tier 3,
   digital banks, providers, regulators. Within a tier, the most reported
   first.
4. **AI around the market.** B headlines. Headlines naming an institution come
   first, largest first, then the ones most about AI. No subtitle.
5. **Coverage over the last eight weeks.** One bar per week, labelled with its
   dates on one line (`15–21 Sep`). Each bar shows the articles collected,
   and in a darker shade how many of them were use cases (grade A: in
   production, pilot or announced), written as "24 of 189". The week of the
   issue is in orange.
6. **Tier 1 banks, this month.** A reminder of the largest banks' AI news over
   the month:
   - A Tier 1 bank is on the Financial Stability Board's list of global
     systemically important banks (`packages/web/src/lib/tiers.ts`).
   - Use cases come before news. Among use cases, agentic AI in production comes
     first, then agentic pilots, then in production, pilot and announced. Ties
     go to the most reported.
   - News is a B headline that names a Tier 1 bank, ranked by how much it is
     about AI.
   - Items from the week above may appear again. That is the point of a monthly
     view.

## Subject, title and the button

- The title is **Synpulse AI in Banking Weekly Brief**.
- The subject is the title and the date, then a headline that starts with a
  capital and names the biggest story rather than counting:
  - "Agentic AI live at Deutsche Bank", adding ", pilots at Danske Bank and
    Rogers Bank" when one institution is live
  - otherwise "Agentic AI pilots at …", then "New AI use cases at …", then
    "The market news"
- The four numbers under the key line carry no footnote.
- The button at the foot, **Open this month's use cases**, opens the Market
  Lens on the month's A grades, from the 1st to the last day of the month.

## The summary

The Routine hands the `facts` line to a subagent, which writes
`data/digest/<ISO week>.json`. `digest.yml` mode `check` must pass it. It reads
like a consultant's briefing, not a tally:

- 3 to 5 sentences, 700 characters at most.
- Every sentence cites the article ids it rests on. It names only institutions
  those articles are about, and states only numbers the email prints or the
  articles say.
- Lead with what moved and why it matters for banks. Tier 1 banks first, and
  agentic AI in production before pilots.
- At most one number in a sentence, and only where it adds meaning. No lists of
  counts.
- Sentence case, no marketing adjectives, no exclamation marks.
- The Tier 1 month may be mentioned in one sentence at most, and only when
  something in it matters more than this week.

If the summary is refused twice, the issue goes without one. It is never sent
with a summary that failed the check.

## The editor's review

Nothing in the draft reaches colleagues until the editor approves it in the
tracker, under Review Queue → This week's email. There the editor can:

- leave out any use case, headline or Tier 1 line, which removes it from every
  section it appears in and recounts the numbers
- leave out any summary sentence (a sentence whose every cited article was left
  out goes with it)
- approve, which renders the email once and stores it. Wednesday's send mails
  exactly that.

When the editor leaves the same kind of item out week after week, add the
lesson here, so the next draft does not carry it.
