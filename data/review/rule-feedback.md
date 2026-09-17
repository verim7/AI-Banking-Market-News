# Rule feedback

One section per review pass, plus the product decisions the passes produced.

---

## Standing decision — how the Market Lens is ordered

**The Lens opens filtered to grades A and B, sorted by AI focus, highest first.**
The grade filter answers "is this a use case"; the sort then answers "which is
most about AI". Both are defaults, not constraints — every other grade is one
click away in the filter, and any column header replaces the sort.

Grade ordering is still available as a sort key and still governs the Archive;
it is asserted in `queries.test.ts` rather than through the page, since the Lens
no longer opens on it and no column header drives it.

The order is:

| | | |
|---|---|---|
| 1 | **A** | reviewed — a named institution running a concrete task, live |
| 2 | **B** | reviewed — announced, not yet evidenced as running |
| 3 | **C** | reviewed — a use case, but nobody named as deploying it |
| 4 | *unreviewed* | nobody has read it yet |
| 5 | **D** | reviewed — read, and there is no use case here |

Unreviewed sits above D deliberately, which is the one place this departs from a
plain A-B-C-D. The grades are not one quality scale: A, B and C say a reader
found a use case of some strength, D says a reader looked and found none. D is
the only bucket that is *known* to be worthless, so it belongs last; an article
nobody has opened is unknown, and unknown outranks known-worthless. Sorting
otherwise would bury everything ingested since the last pass — currently ~1,000
of ~1,180 rows — beneath 47 articles already ruled out.

Rows below it are **folded by use case**: same bank, same L1 process, one row
with a "*N more reports*" control. The key is `useCaseKey` in `classify.ts` and
it is a display key, not a dedupe key — every folded row stays one click away,
which is what makes a coarse key acceptable here in a way it would never be for
deleting rows. It reaches the two things ingest dedupe cannot: a launch split
across a week boundary, and one system re-reported months apart.

Inside a grade the tie falls back to **promise** (completeness, then readability,
then AI focus, then maturity), which is what the table sorted by before grades
existed. Four ranks across a thousand rows leaves very large ties, and date alone
would sink a deployment under a week of unreviewed noise.

Reversing the sort asks for the weakest *grade* first; within a grade the best
article still leads, so the promise tiebreak stays descending in both directions.

Implemented in `SORT_COLUMNS.grade` in `packages/worker/src/queries.ts`; the
Lens's default lives in `packages/web/src/pages/MarketLens.tsx`.

---

## Standing decision — a use case is a task, not a deployment

**A = an AI use case. B = AI market news. D = not worth reading.** C is retired.

The letter answers one question: *is there a named institution and a named
banking task the AI performs, both in the sentence quoted for it.* How far along
it is lives in **Stage**, where it always did.

The old rubric asked A to mean "deployed" and B "announced", so the grade
answered a question maturity already answered — and it ranked
`ruya — agentic AI at a UAE digital bank` (live, no task named) above
`Santander and Mastercard — live payment executed by an AI agent` (a pilot, a
completely concrete task).

### The defect underneath it

`validateReview` required `actor`, `task` and `evidence` for an A, and **a
required field always gets filled**. Nothing checked that the task came from the
article. ruya's own record:

```json
"task": "runs customer-facing banking operations on agentic AI",
"notes": "Headline only; the specific task is not described."
```

Measured across the 121 A/B decisions of passes 1–5:

| | |
|---|--:|
| `evidence` that is just the headline repeated | 115 (95%) |
| `task` less than half-attested by the article | 86 (71%) |
| A records sharing **no word** with their own evidence | 21 of 80 |

The task was the only composed field that decided a grade. `taskAttested()` in
`review.ts` makes it extractive again: content-word overlap with the quoted
sentence, crude stemming, threshold 0.5, and a grade A that fails it **cannot be
imported**. Genuine records cluster at 0.5 and above — Bank of Singapore 4/4,
DBS 5/5, Santander 3/5 — and the invented ones sit at zero.

### Two rules that follow

- **Grade the article, not the story.** A report that does not name the task is
  a B even when its sisters are A's. Three of the re-graded rows moved for
  exactly this reason: `Singapore's DBS deploys specialist AI agents for 1,500
  employees` never says what they do. The use case survives through the reports
  that state it, and the fold still gathers them.
- **The actor must be the institution running it, not the vendor selling it.**
  `Ant International Signs-Up Major Banks for FX AI Tool` names no bank and is a
  B; the three reports naming Citi, HSBC and StanChart are A's.

### What it cost

| | before | after |
|---|--:|--:|
| Effective reviews | 510 | **559** |
| A | 80 | **48** |
| B | 41 | **239** |
| C | 132 | **0** |
| D | 257 | **272** |
| Distinct use cases, 12 months | 87 | **29** |

The 73 that left A were staff tooling (Klarna, Barclays' Copilot licences,
CIBC's workspace), vendor launches (Talkdesk ×4, Feathery, Ant's own benchmark),
strategy and organisation pieces (Standard Bank ×2, Absa, Stripe, SBI ×3), award
write-ups, and reports that name a bank but no task.

`review-apply` now validates the **effective** record per article rather than
every line of every file. The files are a replayed ledger; a record a later pass
overwrites cannot reach the database, and blocking a batch on one is checking
something that will never exist.

Implemented in `packages/shared/src/review.ts` (`taskAttested`, `validateReview`,
`GRADE_LABELS`), `packages/ingest/src/review-apply.ts`, and the grade legend in
`FilterBar.tsx`, `AnalysisTable.tsx` and `MarketLens.tsx`, which opens on A only.

---

## Standing decision — a use case is not a report

**"AI use cases identified" counts use cases. "AI articles in view" counts the
reports of them. The first number is expected to be smaller, and the gap is the
re-reporting.**

The tile used to count articles. With A and B preselected it read *85 AI
articles in view* beside *85 AI use cases identified* — the same number wearing
two labels, and no way to tell from the page that it was the same number. It is
not: four outlets covered Starling's corporate assistant, three covered HSBC's
fraud rollout, and Morgan Stanley's adviser tool was re-reported across nine
months. Across the 121 hand-graded A/B articles there are **87 distinct use
cases**.

The key is the same `useCaseKey` the table folds rows with — institution plus
L1 process — so the tile and the table cannot drift, and the table's footer now
states the same figure the tile does. Two rules follow from the key being a
display key rather than a dedupe key:

- **A row with no key is its own use case, always.** No institution in the
  headline, or no process, means the row can never be shown to be the same use
  case as another. Collapsing those together would merge every unattributable
  article into one, which is a wrong answer rather than an untidy one.
- **A and B are folded separately as well as together.** "12 deployed" is twelve
  deployed use cases. The two need not sum to the total: one bank's process
  announced and later shipped is one key in both buckets, and one use case.

Counted in the worker rather than in SQL, because matching an institution
against `NAMED_INSTITUTIONS` is a term list and not something a `WHERE` clause
can express. Materialising the key into a column was the alternative and was
rejected for the reason already written on `shapeArticle`: a review changes the
key, and a stored key would be stale until the next rescore.

Implemented as `buildUseCaseKeysQuery` in `packages/worker/src/queries.ts` and
`countUseCases` in `packages/worker/src/routes/articles.ts`.

---

## Standing decision — the fold keys on the reviewer's actor, not a term list

**Who did it comes from the review. A term list can only name institutions
somebody thought to add, and the ones it misses are exactly the ones a term list
was supposed to help with.**

Incore Bank showed four times on the Lens as four use cases. It is one proof of
concept, told by Finextra, Kyndryl, a Swiss trade title and a German-language
outlet. The cause was not the languages, which was the first guess and was
wrong. `useCaseKey` looked its institution up in `NAMED_INSTITUTIONS`; "Incore"
is not on that list; the key came back null; and **a null key means every report
counts on its own**. Every institution absent from the list — Warba, C6, KIWI
Finance, Concryt, PicPay — had the same silent failure, and nothing on the page
distinguished "these are four separate use cases" from "the key gave up".

The list cannot be finished. There is no version of it that holds every bank on
earth, and each new one is discovered only by someone noticing a repeat on the
Lens, which is the thing the key exists to prevent.

But the reviewer already wrote down who did it. `actor` is a person naming the
institution after reading the article — better evidence than a lookup, and it
needs no maintenance. `actorKey` in `packages/shared/src/classify.ts` reduces it
to something two reports can meet on:

- **the first named party.** "Revolut and Visa" and "IndusInd Bank and Razorpay"
  name a partnership; the bank leads it, and the partner named differs by
  report. Splitting on *and*, *&*, *with*, *und*, a comma or a slash and keeping
  the head makes two reports of one partnership meet.
- **a trailing corporate suffix dropped,** so "Incore Bank" and "Incore" are one
  institution. Only trailing: "Bank of England" keeps its leading word, which is
  its name and not a suffix.
- **null when nothing distinctive is left.** "the bank", "a fintech lender" name
  a different institution in every article that uses them; grouping on them
  would merge unrelated work, which is worse than not grouping at all.

Precedence in `useCaseKey` is: a known institution named in the actor, then the
reviewer's own wording, then a known institution in the headline. The list goes
first so that a reviewed row and an unreviewed one land on the same key —
"Bank of America Merrill" and a headline saying "Bank of America" are one use
case — and the reviewer's wording carries the rest.

### The second half of the same defect

Once the four Incore rows shared a key they still split in two, because one of
them was graded `p04_client_onboarding_activation` and the other three
`p23_financial_crime_aml_kyc`. Same proof of concept, same sentence: agentic AI
reading onboarding documents for the KYC background check. Onboarding is where
the work is felt; KYC is the work.

**A use case's process is the work being automated, not the journey it sits in.**
Corrected in `data/review/decisions/2026-09-09-12.jsonl` rather than by editing
pass 9 — a later record supersedes an earlier one and the earlier one stays
readable, which is how a review pass is meant to be corrected.

---

## Standing decision — "live" in a headline is not "in production"

**A transaction that really happened, in a run that was not open to clients, is
a pilot. The stage is what the bank has put into service, not what the
demonstration touched.**

Sygnum announced the *"first live AI-agent driven digital asset transactions by
a regulated Swiss bank"* on 2026-05-18. Every outlet carried "live". The
transactions were real, multi-step and on a blockchain mainnet: the agent
planned each step, reviewed the smart contracts and flagged risks before the
client approved and signed.

And it is a **pilot**. The same sources say the agent *"is not yet available for
general client use"*, that production rollout is *"subject to all required
regulatory, compliance and security reviews and approvals"*, and that *"no
Sygnum client CID, wallets or infrastructure were used"*. Nobody's money moved
who had not agreed to be part of a test.

`MATURITY_SIGNALS` would read the word "live" and score this `in_production`.
That is the same failure as `'productive'`, `'at scale'` and `'trial'` — a word
that means one thing in a press release and another in a stage taxonomy — and
it is worse than those three, because this one is on the strongest article the
Swiss corpus has.

### The rule

Three questions, and a "no" to any of them caps the stage at `pilot`:

- **Can a customer who was not in the test use it today?**
- **Is it running without a named approval still outstanding?**
- **Did it touch real client accounts, or a sandbox that looks like one?**

A demonstration on a production system is still a demonstration. "First live",
"went live", "executed on mainnet" and "completed real transactions" all
describe the demonstration, not the service.

### Why this is not fixed in the rules

It could be — a cap when a caveat sentence is present — and it should not be
yet. The evidence is one sentence, usually the last one, and 96% of this corpus
is a headline with no body at all. A rule keyed on a sentence the pipeline
cannot see would fire on the few articles that do have bodies and quietly
demote them below the ones that do not, which is a worse ordering than the one
it replaces. It is written here as a reading rule for the review pass, and it
becomes a rule in code when body coverage makes it measurable — see
docs/content-sourcing.md for what that depends on.

### The verdict on the record

Sygnum Bank, AI agent executing multi-step on-chain transactions — stablecoin
transfers, asset swaps, on-chain lending, token wrapping, liquidity
provisioning — built on an in-house MCP server. **Grade A, maturity `pilot`.**
Not yet in the corpus; it reached this project through a hand search rather
than through any source the pipeline reads, which is itself the finding in
docs/swiss-coverage.md restated.

---

## Pass 1 — 2026-08-25, 80 articles

What reading 80 articles showed about the automatic classifier. Each item is a
change to make, not an observation: the point of the loop is that the rules get
better, otherwise the same backlog is re-read forever.

### 1. Deduplication is the biggest single defect

One deployment produced **eight rows**. DBS rolling out agentic AI for credit
memos appeared as:

| Outlet | Headline |
|---|---|
| Citywire | DBS rolls out agentic AI for 1,500 bankers to draft credit memos |
| Finextra | Singapore's DBS deploys specialist AI agents for 1,500 employees |
| Finextra Research | (same headline again) |
| FF News | DBS Deploys Agentic AI to Automate Credit Assessments for 1,500 Corporate Bankers |
| IBS Intelligence | DBS rolls out agentic AI for corporate credit assessments |
| Asian Banking & Finance | DBS rolls out agentic AI credit tool to 1,500 staff globally |
| Singapore Business Review | (same headline again) |
| finews.asia | DBS Rolls Out Agentic AI to 1'500 Bankers |

Also duplicated: Starling (×2), Goldman apprenticeship (×2), Der Bank Blog (×2),
the Analytics Insight listicle (×2), finews.ch Schatten-KI (×2). **Seventeen of
eighty rows were re-reports of six stories.**

`titleKey()` cannot catch these: the headlines genuinely differ. This distorts
every count in the product — eight A grades for one deployment — and it wastes
review passes.

**Proposed fix:** a second dedupe key of `named institution + date window`.
Extract the institution from the headline (the INSTITUTION_TERMS list already
exists), bucket by ISO week, and collapse. Keep the earliest, or the one with a
readable body. This needs its own design pass; it is the highest-value item here.

### 2. Vendor launches score exactly like bank deployments

"Launches", "unveils", "debuts", "deploys" fire ADOPTION_TERMS regardless of
**who** is doing it. Datalign, Zeplyn, RightCapital, MirrorWeb, Addepar,
Broadridge, Goodfin, Trust3 and Anthropic all scored 71–89 and read as adoption.
They are the single largest category in the corpus (C, 32 of 80).

**Proposed fix:** an actor test in the rules. When the subject of the adoption
verb is not in INSTITUTION_TERMS and not a known bank, cap AI intensity and set
maturity to `announced` rather than `in_production`. A vendor shipping a feature
is not a bank running one.

### 3. Over-tagging: one word, five processes

Examples from this batch:

- *DBS career advisory for staff* → tagged `p18_settlement_custody` and
  `use_case:customer_service`. Neither is in the article.
- *Goldman Sachs apprenticeship culture* → tagged `credit_underwriting`,
  `customer_service`, `research_analytics`.
- *ADIB appoints a Chief AI Officer* → **AI intensity 100**, maturity
  `in_production`, four processes.

A single term match anywhere in a long body is enough to attach a process.

**Proposed fix:** require either two distinct term hits for a process, or one
hit in the headline/summary rather than deep in the body. Cap process tags per
article at three, keeping the highest-scoring.

### 4. Corporate news reads as deployment

Appointments, reskilling programmes, training MOUs and headcount stories scored
90–100 with maturity `in_production`. Nine of the twenty-five D grades are this
genre.

**Proposed fix:** a `CORPORATE_NEWS_TERMS` gate alongside the existing
commentary gate — appoints, names as, joins as, reskill, upskill, memorandum of
understanding, headcount, job cuts. Present without an AI task verb, these
should not reach production maturity.

### 5. Body extraction leaves navigation in place

Several excerpts begin "Skip to content YOU ARE AT: Home »" or "Facebook
Twitter LinkedIn", and one carried a raw `onclick=` attribute. The classifier
reads that as article text.

**Proposed fix:** extend the strip list in `fetch-article.ts` and drop leading
lines before the first sentence containing a verb.

### Effect on this batch

| Grade | Count | |
|---|--:|---|
| A — deployed | 15 | of which 8 are the same DBS story |
| B — announced | 8 | |
| C — generic | 32 | mostly vendor launches and consultancy reports |
| D — not a use case | 25 | commentary, appointments, forecasts, workforce |

**Distinct deployed use cases in this batch: 8**, not 15 — DBS, Starling,
CIBC, Experian, Bank of Singapore, Santander/Mastercard, ruya, and DBS again
under seven other bylines.

---

## Pass 2 — 2026-08-25, 80 articles

Read after pass 1's five fixes shipped and after `dedupe-stories` marked 12 rows
on the archive. Zero overlap with pass 1's batch.

| Grade | Count | |
|---|--:|---|
| A — deployed | 20 | of which 7 are one Starling launch and 4 one Morgan Stanley rollout |
| B — announced | 10 | |
| C — generic | 28 | vendor launches, sandbox entries, consultancy findings |
| D — not a use case | 22 | commentary, hiring, governance signings, forecasts |

Confidence: 73 low, 4 medium, 3 high. That distribution is itself the finding —
see item 2.

**Distinct deployed use cases in this batch: 12**, not 20.

### 1. The story key does not survive a week boundary

Pass 1's fix works — but only inside one ISO week, and re-reports of a launch
routinely straddle Sunday.

| Story | Dates | ISO weeks |
|---|---|---|
| Starling Smart Tools (7 rows) | 20–21 Aug (5 rows), 24 Aug (2 rows) | W34 / **W35** |
| Lloyds 1,000 AI roles (2 rows) | 27 Jun, 29 Jun | W26 / **W27** |

Both split on a Saturday→Monday pair. The Starling rows carry no distinctive
number, so they fall back to institution + week + process — correct within the
week, useless across it.

**Proposed fix:** emit a second bucket per article, for `publishedAt − 3 days`,
alongside the current one. `cluster()` already unions on *any* shared key, so a
Monday row would then carry both W34 and W35 and collide with the Thursday rows
without widening the window for anything else. Cost is one extra key per row.

The Morgan Stanley cluster (4 rows, Sep 2023 → Jun 2024) is a different animal:
the same adviser assistant re-reported across nine months. No date-bucket key
reaches that, and it should not — those are legitimately separate news events
about one system. Deduplication is the wrong tool; the right answer is that the
product counts *use cases*, not articles, which is what the review grades give
it.

### 2. Bodies are the binding constraint, not the rules

**3 of 80 articles had a readable body.** 39 had a summary; 41 were GDELT rows
with a headline and nothing else. That is why 73 of 80 grades are `low`
confidence: on a bare headline, "Bank X launches AI assistant" cannot be
separated from "Bank X announces plan for AI assistant", and the rubric's own
evidence fields (technique, outcome) are unfillable.

This now outranks every remaining rule defect. Rules read text; there is no
text. **The highest-value next change is body coverage** — chasing the real URL
behind GDELT rows and retrying failed fetches — not further tuning of
`classify.ts`.

### 3. The batch skews old

49 of 80 published in 2026, but 30 in 2023–2025. The export orders by rules
score, so the oldest high-scoring rows keep resurfacing. Not wrong, but a
reviewer's time is better spent on the current quarter.

**Proposed fix:** a `--since` flag on `review:export`, and prefer unreviewed
recent rows when scores tie.

### 4. Rubric correction applied during this pass

Grade A required a technique to be named. Two genuine deployments — Wells Fargo
running AI in payments operations, Bank of Singapore in source-of-wealth
verification — state plainly that the system is live but never say *how* it
works, and the rule forced them down to B.

That inverted the rubric's purpose: A means *a named institution running a
concrete task, with evidence it is live*. How it is built is useful when the
article says so and is not part of the claim. `validateReview` no longer
requires it; the technique is recorded when stated.

### 5. The regression corpus was reading a working file

Found while verifying this pass. `regression-graded.test.ts` read its inputs
from `data/review/pending.jsonl` — the file `review:export` rewrites on every
run. Exporting pass 2's batch therefore deleted pass 1's ground-truth inputs,
and the test began failing on articles it could no longer see.

Fixed: graded inputs are now snapshotted to `data/review/graded/<batch>.jsonl`,
paired by filename with the decisions, and the test reads every batch in that
directory. Adding a pass is two files and no code change. Pass 1's inputs were
recovered from the commit that first added them.

### What pass 1's fixes did

No article in this batch showed the pass 1 defects: no vendor launch reached
production maturity, no appointment or reskilling story read as a deployment,
no excerpt carried navigation chrome, and the DBS-style intra-week pile-up
appeared only across the week boundary described above.

---

## Pass 3 — 2026-08-25, 80 articles

First batch exported with the two fixes from pass 2's feedback: marked duplicates
excluded, and `--since=2025-09-01` so nothing older than the Lens's own twelve-
month window is reviewed. Both worked — every article is from 2026, and 69 of 80
came from named trade titles rather than GDELT (pass 2: 39).

| Grade | Count | |
|---|--:|---|
| A — deployed | 10 | of which 4 are one Ant International story |
| B — announced | 5 | |
| C — generic | 14 | vendor launches and sector roundups |
| D — not a use case | **51** | |

**Distinct deployed use cases: 7.** Confidence: 80 low.

### 1. The corpus below AI intensity 50 is mostly not use cases

Every article in this batch scored **exactly 48**. Passes 1 and 2 took everything
above that, and what is left is 64% not-a-use-case — against 31% in pass 1 and
28% in pass 2. The genres are consistent and mechanical:

| Genre | Rows |
|---|--:|
| Regulator speeches (RBI governor ×5, Fed, RBI framework ×2) | 8 |
| World Bank / macro AI reports | 7 |
| McKinsey pieces about other industries entirely (Reckitt, Bayer, distribution) | 4 |
| Funding rounds (Feathery, Arca, Wealth.com, Performativ) | 4 |
| Opinion and survey columns in the wealth trades | ~20 |

None of these is a classifier bug in the pass 1 sense — the rules score them 48,
which is *correctly* low. They are here because the export takes the top N by
intensity and the queue has run dry above the threshold.

**This is the signal to stop doing full passes.** Sampling below 50 is no longer
worth 80 reads. The remaining work is worth doing only where a new filter can
find the signal: articles from institution-named sources, or after body coverage
improves.

### 2. `use_case_evidence` is quoting the headline back at the reader — worst defect found so far

The Lens column headed *"AI use case in this article"* promises a sentence
**quoted from the article**. In this batch it is the article's own title, verbatim
and often with the outlet's name appended:

> **Title:** How Banks Are Rethinking Credit Risk in an AI-Driven Economy
> **use_case_evidence:** `How Banks Are Rethinking Credit Risk in an AI-Driven Economy Global Banking & Finance Review`

Measured across all three graded batches:

| Batch | Rows with evidence | Evidence that echoes the title |
|---|--:|--:|
| Pass 1 | 56 | 33 |
| Pass 2 | 53 | 46 |
| Pass 3 | 80 | 75 |
| **Total** | **189** | **154 (81%)** |

Two causes, both upstream of the classifier:

1. Most RSS and GDELT items carry a `description` that is the headline again.
   `summary` is populated from it — 64 of this batch's 69 summaries are the title
   plus the source name.
2. With no body and a title-shaped summary, the extractor has only one sentence
   available and quotes it.

The effect is that the product's founding promise — *extractive, never
generated* — is technically kept while being substantively broken. A reader sees
a quotation mark around the headline they just read and reasonably concludes the
article supports a use case.

**Proposed fix, in order:**
- Refuse to store `use_case_evidence` that is a near-copy of the title, and
  refuse a `summary` that is the title plus the source name. An empty cell is
  honest; the headline in quotation marks is not. This alone is small and can
  ship on its own.
- Then the real repair: body coverage. Still 0 of 80 readable bodies here, after
  3 of 80 in pass 2.

### 3. Duplicates now split across outlets, not weeks

The duplicate filter worked on rows already marked, but this batch still carried
four rows of the Ant International FX story (Reuters, East & Partners, Global
Banking & Finance, GDELT), two of GTJAI, two of Astraeus, and three of one World
Bank report. All are same-week and none carries a distinctive number, so they
fall to institution + week + process — and the World Bank rows have no
institution at all.

The pass 2 proposal (a second `publishedAt − 3 days` bucket) would not have
caught these either. What would: allowing the story key to fall back to a
**title n-gram** when there is no institution and no number.

### 4. Two numbers from the regression set, now 240 articles

```
D graded read as deployment:  1/98
A graded read as deployment: 25/45
above MIN_AI_INTENSITY:     240/240
```

Precision is holding: one false deployment in ninety-eight articles a reader
ruled out. Recall is where this pass lands badly — **the rules recognised 0 of
pass 3's 10 real deployments.** Every one of them is a headline with a weak verb
and no body: "ConnectOne Bank uses AI to save time on admin work", "Citi, HSBC,
StanChart adopt Ant International's forex AI tool". There is nothing in the text
for a maturity rule to find, which is the same wall as items 1 and 2 — the text
is not there.

The third line is its own small finding: **every one of the 240 graded articles
clears `MIN_AI_INTENSITY`, including all 98 graded D.** The threshold is doing no
filtering work on this corpus and should not be trusted as one.

### What pass 3 changed

Reported first, then repaired: item 2 is now fixed. `echoesTitle` in
`classify.ts` decides whether a text says anything the headline did not, by
comparing words rather than characters (GDELT re-spaces titles) and allowing at
most five residual words before the text counts as new. It is applied in three
places:

- **`useCaseEvidence`** rejects any candidate sentence that echoes the title,
  and the fallback that returned the title itself is gone. Re-running the
  classifier over the 240 graded articles: **evidence rows 189 → 35, echoes 154
  → 0**, and every one of the 35 survivors is a real sentence from a body.
- **`normalize`** stops storing a feed description that is the title again,
  alongside the existing link-list rule, so the classifier stops counting the
  same words twice.
- **`shapeArticle`** suppresses an echoing summary for rows already in the
  archive, where the News list rendered it directly beneath the headline.

Stored summaries are not rewritten. What the feed sent is the record, and the
review export still reads it — only the presentation and the derived evidence
change. Applying it to the archive is a `rescore` run.

The other two fixes this pass tested (duplicate exclusion, `--since`) were
pass 2's, and both worked.

---

## Pass 4 — 2026-08-25, 200 articles

The whole unreviewed backlog inside the Lens's twelve-month window, cleared in
one pass so the "not reviewed yet" bucket goes to zero.

| Grade | Count | |
|---|--:|---|
| A — deployed | 23 | |
| B — announced | 13 | |
| C — generic | 43 | |
| D — not a use case | **121** | of which 24 are one wire story |

**Distinct deployed use cases: 17.** Confidence: 200 low. 1 of 200 had a
readable body.

### 1. The queue had silently shrunk to nothing

The first export of this backlog returned **9 articles, not 188**. The gate was
"the rules found an AI type, or extracted a use-case sentence" — and the
evidence guard from pass 3 had just emptied `use_case_evidence` for 1,134 of
1,177 rows. A change aimed at the display had cut the review queue by 95%, and
nothing failed, because no test tied the queue to the view.

Fixed: the gate is now the product's own admission threshold, so the queue and
the view are the same set. That is the version that stays true as derived
columns change underneath it — which they now have, twice.

### 2. A syndication network, 24 rows for one story

Twenty-four rows of this batch are the identical headline:

> US GDP growth slows to 1.5% in Q2; consumer spending and AI investments keep
> outlook positive : ICICI Bank

on `afghanistannews.net`, `sandiegosun.com`, `shanghainews.net`,
`nigeriasun.com` and twenty more — every one carrying the same numeric article
id, `279218480`, in its path. A content mill republishing one wire story across
its whole domain portfolio.

`titleKey` should have caught this on the first character. It did not, because
**both the URL and the title checks were per-run**: each day's ingest starts
with an empty `seenTitle`, so a story trickling across mirrors over several days
is new every time. `knownStoryKeys` existed as a parameter but nothing ever
passed it.

Two fixes:
- `dedupe()` now takes `knownTitleKeys`, and the run fills it from the last 30
  days of stored titles. Normalised at read time rather than stored as a column,
  because `titleKey`'s rules change and a stored key would then key nothing.
- `dedupe-stories` clusters on the identical title as well, so the 24 already in
  the archive collapse. No institution or figure is needed to prove that two
  identical headlines are one story.

### 3. Regression set, now 440 articles

```
D graded read as deployment:   1/219
A graded read as deployment:  31/68
above MIN_AI_INTENSITY:      440/440
```

Precision unchanged and now measured over 219 D-graded articles: **one**
false deployment. Recall improved from 25/45 to 31/68 in absolute terms while
falling in ratio — the new A grades are the same headline-only shape pass 3
described, and the rules cannot see a deployment that the text never states.

Every one of the 440, including all 219 D, still clears `MIN_AI_INTENSITY`.

---

## Pass 5 — 2026-08-26, 70 articles

The rest of the backlog. The queue is now empty against the Lens's own view.

| Grade | Count | |
|---|--:|---|
| A — deployed | 12 | of which 6 are one Deutsche Bank story |
| B — announced | 5 | of which 4 are one Revolut story |
| C — generic | 15 | |
| D — not a use case | 38 | |

**Distinct deployed use cases: 6** — Starling's corporate agent, Scalable
Capital opening its platform to ChatGPT and Claude, Deutsche Bank on Google's
agentic research service, WazirX's trading co-pilot, Growhill's adviser
workforce, and CIBC's adviser tool. 2 of 70 had a readable body.

### 1. The queue was still not the view

Pass 4 said the gate had been fixed to "the product's own admission threshold".
It had been fixed to *half* of it: `MIN_AI_INTENSITY` went in,
`DEFAULT_RELEVANCE_THRESHOLD` did not, and the Lens applies both. So the export
offered **200** articles where the reader saw **70** unreviewed — everything
between the two thresholds being an article a reviewer would read and grade and
nobody would ever see graded.

Fixed, and the next export returned exactly 70. This is the third time a change
somewhere else has quietly moved what the review queue contains; the lesson is
that "the queue is the view" has to be *one* expression, not two lists that
happen to agree.

### 2. Quality is up, and the reason is dates

This batch is the best material since pass 1: the top twelve are all from the
last two days and score 58–100 rather than the flat 48 of passes 3 and 4. That
is not a rule improvement — it is the daily ingest having run. The backlog is
exhausted; from here every pass reads recent news, which is the state the loop
was designed for.

Duplication is still the dominant cost inside a single batch: 6 rows for the
Deutsche Bank/Google launch, 4 for Revolut's Pragma, 3 more ADIB appointment
copies that have now appeared in three separate passes. All are same-week and
differently worded, so only the display fold catches them.

### 3. One source-quality finding

> US Man Sentenced to 10 Years After Using ChatGPT to Plan Armed Bank Robbery

Graded D, but it should never have reached a reviewer: it clears both gates
because it names an AI tool and a bank in the same sentence. The co-occurrence
gate cannot tell a crime report from a deployment, and no term list will.

### 4. Regression set, now 510 articles

```
D graded read as deployment:   1/257
A graded read as deployment:  34/80
above MIN_AI_INTENSITY:      510/510
```

One false deployment in 257 D-graded articles, across five passes and five
months of corpus. Ratchet raised to 34.

---

## The classification gap — 2026-08-26

Why the "By L1 process" chart looked empty, and what it took to fill it.

### The symptom was not the cause

Of the 121 A/B use cases the Lens shows, a reviewer had assigned an L1 process to
**120**. The chart could see **16**.

`review-apply` wrote `article_reviews.l1_process`. Every consumer — the facet
query, the process filter, the table column, the export — reads `article_tags`,
which only ingest and rescore ever wrote. 175 hand-assigned processes were stored
and unreachable.

Maturity had solved this correctly all along, as
`COALESCE(rv.maturity, sc.maturity, 'unknown')` in `queries.ts` — *a review
overrides the rules where it has an opinion*. The tag dimensions never got the
same treatment, and nothing failed, because a missing tag looks exactly like an
article the rules could not classify.

**Fixed** with `article_tags.source` (`0007_tag_source.sql`): a review writes its
tags there with `source='review'` and replaces the rules for the dimensions it
speaks to; ingest and rescore delete and re-insert only `source='rules'`, and
skip any dimension a review owns. Consumers are unchanged.

### The wrong hypothesis, and the measurement that killed it

The rules classified only 15% of the corpus, and the obvious suspect was the
corroboration rule from pass 1 — two term hits, or one in the title. With almost
no article bodies, "two hits" is unreachable, so it was relaxed for articles
without a body.

**It bought one article and slightly lowered agreement with the reviewer.** It
was reverted. The real cause was elsewhere and much larger:

> **84% of the reviewed use cases contained no P1-P38 term at all.**

The term lists were written in process-taxonomy language while headlines are
written in product language. "Starling launches AI assistant for business
customers" is P05 relationship servicing, and P05's list held *client service*,
*contact centre*, *chatbot* — nothing that phrase could match. "DBS rolls out
agentic AI credit tool" is P13, whose list had *credit memo* and *credit
assessment* but not *credit tool*.

### What fixed it: the graded corpus as vocabulary

The 227 hand-classified articles are 227 (headline -> correct process) pairs.
Mining the ones the lists could not reach gave the missing vocabulary for the
eight largest processes — P05, P07, P13, P20, P29, P35, P36, P37.

| | before | after |
|---|--:|--:|
| Rules classify a process | 15% | **35%** |
| …of the A/B use cases | 13% | **47%** |
| Agreement where both chose one | 77% | **83%** |
| D-graded read as a deployment | 1/257 | **1/257** |

Agreement rose while coverage more than tripled, which is the shape a real
improvement has: the new terms match the right articles rather than merely more
of them. Coverage and agreement are now ratcheted in
`regression-graded.test.ts`, so a term added to widen coverage that drags
agreement down fails the build.

### What "the same logic" can and cannot mean

The rules and a reader will never agree completely, and should not: one is a
cheap pass over 1,180 articles, the other a considered pass over what matters.
What is now guaranteed is **one taxonomy, one precedence rule — review wins,
rules fill in — applied in one place, and a measured gap between them.**

The remaining 53% of use cases the rules cannot classify are headlines whose
vocabulary no term list would reach without also matching things it should not.
That gap closes with article bodies, not with more terms.

---

## Pass 13 — 2026-09-11, 80 articles

**3 A, 68 B, 9 D.** The lowest A rate of any pass, and the batch says why.

| what the batch was | n |
|---|--:|
| One person's commentary, repeated by five outlets (SBI's chairman) | 7 |
| Vendor launches, funding rounds and patents | 19 |
| Explainers, surveys, playbooks and awards | 17 |
| Equity research about AI as a trade | 5 |
| Not banking at all — a data-centre REIT, a medtech, an HR infographic | 4 |
| **A named institution running a named banking task** | **3** |

The three: Incore Bank's KYC proof of concept for the fifth time, Trust Bank's
conversational query assistant, Indian Bank's AI-TARA voice banking. Two of the
three are announcements at a conference.

### What this pass is really a measurement of

Every A in it is graded on **its headline alone** — none of the three articles
had a recoverable body, so the evidence field quotes the title. That is allowed
and it is the honest thing to write down, but it puts a ceiling on the grade:
`technique` is blank on two of them because no headline states a model, and the
stage is whatever verb the sub-editor chose.

The same batch contained five separate reports of one SBI chairman interview
and four of one Arva AI launch. Nine of eighty articles were one story told
again. The fold handles them on the page; they still cost a reading pass.

### One thing worth naming

`konsulteer.com` supplied both Incore rows and the BNP Paribas Fortis row as
bare Google News redirects with no body. It aggregates — it is a re-publisher
of other outlets' headlines — so every article it contributes arrives as a
title and can never be graded above what a title supports. Worth checking in
`rank-sources.ts` whether it is earning its requests.

---

## Pass 14 — 2026-09-14, 60 articles

**11 A, 38 B, 11 D.** Six distinct use cases behind the eleven A rows — the
best pass since the corpus started carrying bodies, and the reason is bodies:
six of the eleven quote a real sentence rather than a headline.

| use case | stage |
|---|---|
| Sony Bank — generative AI in core banking system development, 30% faster, 40% less work | in production |
| Paysera — clients hand a payment access token to an AI assistant | in production |
| MAS — cross-bank AI models to flag scam accounts | pilot |
| Bank of Baroda — bob World 2.0, AI-powered mobile banking | announced |
| Bank of Thailand — AI to audit 3,600 lenders | announced |
| Raiffeisen Bank Romania — ERIC, an AI business coach | announced |

Four reports of the Bank of Baroda launch, two of the MAS test, two of the Sony
Bank result. Eight of eleven A rows are three stories.

### Two supervisors graded A, on purpose

MAS and the Bank of Thailand are regulators, not peers — and both are named
institutions running a named banking process with AI: scam-account detection
across banks, and an audit of 3,600 lenders. The grade answers "is there a
named institution doing a named task", and a supervisor doing supervision with
AI is an answer to that. Their L1 process says what they are, so a reader
filtering on `p24` or `p29` finds them where they belong.

### A fold that would have been wrong

Raiffeisen Bank Romania is recorded with the country in the actor field. Bare
"Raiffeisen Bank" reduces to the fold key `raiffeisen`, which would eventually
merge a Romanian business-coaching chatbot with Raiffeisen Schweiz on the
Agentic Swiss Banks page. Two banks, one cooperative name, different countries.

**The rule: when a name is shared across countries, the actor carries the
country.** The fold key is deliberately cheap, and this is the case where cheap
is wrong.

### What stayed out

Eleven D. Five of them are markets stories that clear the AI-and-banking gate on
vocabulary alone — a hedge fund losing 67% and JPMorgan cutting its credit, told
three times; Adobe's quarter; the Bank of Korea on Samsung derivatives. Two are
development economics about the World Bank. One is Brazil's "AI solutions bank"
for public administration, which is a repository. And one is a FASTag launch
whose own headline says agentic payments were *skipped*.

---

## Pass 15 — 2026-09-15, 30 articles

**6 A, 18 B, 6 D.** A small batch and the most consequential one so far, because
of where the A rows came from: **eight of the thirty were seeded by URL**, and
they are the first articles in this project's history graded on what the
article actually says.

### What a body changes, measured on one use case

Incore Bank's KYC proof of concept has now been reported seven times. The first
five were graded like this:

> evidence: "Incore Bank Trials Agentic AI With Kyndryl, Google Cloud For KYC"

That is the headline. It was the only text there was. The sixth and seventh
were graded like this:

> evidence: "Incore Bank has completed a proof-of-concept project that explores
> how agentic artificial intelligence can speed digital customer onboarding
> while automating large parts of the risk-assessment process."

Same use case, same grade, same fold. The difference is that a reader can now
check the claim, and `technique` says *Google Gemini with Kyndryl's agentic AI
framework* instead of being blank.

### Sygnum, and the standing decision surviving contact

Sygnum Bank is in the corpus for the first time. It was found by hand in May,
was unreachable for four months because its announcement lived on its own
newsroom and no feed pointed there, and arrived through `seed-urls`.

The stage decision written before the text was available — *"live" in a headline
is not "in production"* — is confirmed by the articles themselves. Markets Media
calls it *"The pilot"* outright. Crowdfund Insider carries the sentence the
whole judgement rests on:

> "While the MCP AI agent is not yet available for general client use."

A rule written from search summaries, then checked against the source and found
right. Worth recording, because the same rule was one sentence away from being
wrong.

### The number that had not moved

The Swiss measure has been pinned at 18 for three passes because nothing Swiss
arrived through any feed. This pass took it to **24 articles and 7 institutions**
— Sygnum, and PostFinance, which appears because it *banned* AI. Graded B: a
named Swiss bank whose news is that it is not using AI is the opposite of a use
case, and still worth keeping.

### One boundary drawn

Nationwide deploying Microsoft 365 Copilot is a **B**. A named bank and a named
tool, but the work is office work — drafting and summarising for staff — not a
banking process running on AI. The line is whether the AI does banking work or
desk work, and it is the same line that made Bank of Baroda's mobile banking app
an A: a customer channel is a banking process, an email assistant is not.

---

## Pass 16 — 2026-09-16, 27 articles

**2 A, 22 B, 3 D.** The corpus crosses a thousand graded articles and this pass
contributed two use cases: Bank of Baroda's mobile app for the sixth time, and
Sokin letting a customer's own AI line up payments.

### The pass started with an empty queue

The first export returned **0 articles — already reviewed: 982**. Everything
collected had been graded. That is not the same as "there is nothing", and the
difference is worth writing down, because an empty queue and a broken collector
look identical from here.

The check: the scheduled ingest was running and succeeding daily, but the last
run that *wrote* anything was 2026-09-15 09:29 UTC. The three runs after it were
push-triggered, and push-triggered ingest runs report without writing — which is
the split `ingest.yml` was designed with, and which was doing exactly its job.
Today's collection simply had not happened yet: the cron says 04:20 UTC and
GitHub has been landing it between 08:41 and 09:58.

So the collector was dispatched by hand and the export re-run. **The habit worth
keeping: when the review queue is empty, confirm the collector wrote something
recently before reporting "all caught up".**

### Two judgements, both by consistency rather than fresh reasoning

- **KIWI Finance's "closed agentic AI ecosystem" is a B.** A named institution
  and genuinely agentic, but *ecosystem* names a platform, not a process. Same
  line that made Bank Jago's AI budget a B in pass 14.
- **Sokin's MCP connector is an A.** A payments institution letting a client's
  own AI initiate payments is the same shape as Paysera in pass 14, so it is
  graded the same way — `announced` rather than live, because "Launches" is a
  weaker claim than Paysera's "clients can now".

Three Personetics rows and two "Be the Bank That Scales" rows, the latter
carried over from pass 15. Syndication remains the largest single category of
work in every batch.

### Ratchets mostly did not move, on purpose

The corpus grew by 27 and gained two A rows, so only the fold moved — 36 to 37
reports absorbed. Process coverage, agreement, A-as-deployment and the Swiss
count are all unchanged, because nothing in this batch changed them. A ratchet
raised on a pass that did not earn it is a ratchet that fails the next build for
no reason.

---

## Standing decision — the vocabulary has to know the brands

**A headline can be entirely about AI and never use the word. When the
journalist decides the product name is more informative than the category, the
product name is the AI term.**

A reader passed over a Finextra article — *"Anthropic launches Claude for
Financial Advisors"* — and asked why the tool had not found it. It came down
the **Finextra AI feed, a source this project already polls**, and was dropped
at ingest with a relevance score of zero. It failed both gates at once:

```
gate.no_ai_term           AI terms matched: []
gate.no_banking_evidence  banking terms matched: []
```

`AI_TERMS` knew `chatgpt` and `copilot` and none of the other model names.
`BANKING_TERMS` had no word for an adviser, in a tool whose L1 process P07 is
*investment advisory proposal* and half of whose audience is wealth management.

That is why "OpenAI launches ChatGPT for Financial Services" is in the corpus
and this one is not: the first happened to use two words the lists knew.

### What went in, and what deliberately did not

Added to `AI_TERMS`: `anthropic`, `claude`, `openai`, `gemini`, `gpt`.
Added to `BANKING_TERMS`: `financial advisor`, `financial adviser`,
`wealth advisor`, `wealth adviser`, `investment advisor`, `investment adviser`.

Kept out, each for a measured reason:

| term | why not |
|---|---|
| `llama`, `mistral`, `bedrock`, `perplexity` | ordinary English words or common metaphors. Each appears in the corpus only in headlines that already say AI, so admitting them buys nothing and risks "the bedrock of banking" |
| bare `advisory` | nine occurrences, one of which is "DBS rolls out career advisory service to help employees navigate AI-driven change" — that is HR |

`gemini` carries a known collision: Gemini Trust Company is a crypto exchange
and this tool covers crypto banks. All five occurrences in the 1,009-article
corpus are Google's model, so it is in — and an exchange story arriving as
noise is the signal to narrow it to `google gemini`.

### The measurement, and its limit stated plainly

Every ground-truth number is **identical** before and after: agreement 121/144,
D-read-as-deployment 1/364, process coverage 337/1009, A-as-deployment 39/99.

That is the right result and it is not evidence of a gain. **The regression
cannot measure this fix.** It scores the classifier against articles that were
stored and graded, and the articles this change rescues are ones that were never
stored — they have no row to grade. What the suite proves is that widening the
vocabulary cost nothing; the gain is invisible to it by construction.

So the closing test is the specific headline, in
`packages/shared/tests/classify.test.ts`: the article that started this must
score above zero, the five model names must read as AI, an adviser must read as
banking, and the four rejected words must still read as nothing.

### The general lesson

**A term list written from a taxonomy will always lag the language of the
trade.** Pass 8 found the same shape — the process lists were written in
process-taxonomy language while headlines are written in product language, and
84% of reviewed use cases contained no P1–P38 term at all. This is that failure
again, one level up: the AI list was written in category language while
headlines are increasingly written in brand language.

The lists are maintained by finding the articles they dropped, and the only way
to find those is for someone to notice one missing.

---

## Pass 17 — 2026-09-16, 15 articles

**1 A, 12 B, 2 D** — and the pass exists only because a reader asked a question.

Thirteen of the fifteen are articles the vocabulary would have dropped an hour
earlier. Nine of them are one story: Anthropic launching Claude for financial
advisers, carried by Reuters, ThinkAdvisor, WealthManagement four times, Profit
by Pakistan Today and others. **The blind spot was not one article. It was a
whole news cycle, and the tool had been silently discarding it.**

All nine are B, correctly — Anthropic is a vendor and BlackRock and Schwab are
named as integrations rather than as institutions running a process. The grade
was never the problem. The absence was.

### Sygnum's own press release, at last

The one A is Sygnum's own announcement, which has been unreachable since May.
`sygnum.com` refused the runner twice with a 403 and the Internet Archive had no
snapshot; on this attempt it had one. Third report of the use case, folding with
the two graded in pass 15, and now the bank's own words are in the corpus:

> "The pilot was built using a Model Context Protocol (MCP) server built
> in-house by the AI@Sygnum team using Anthropic's Claude as the underlying AI
> model."

The primary source confirming `pilot` in its own press release, four months
after the stage was inferred from a search summary.

### The lesson the pass is really about

A term list cannot report what it never saw. The regression suite measured this
change as a perfect no-op — every number identical — because it grades stored
articles and the dropped ones have no row. **The only instrument that found this
was a person reading the trade press and noticing an absence.**

That is worth designing around. `rank-sources.ts` measures yield per source; it
cannot measure what a source offered and the gate refused. A "rejected at the
gate" sample, logged per run and read occasionally, would turn this from a
question someone happens to ask into something the pipeline reports on itself.
Not built here; recorded as the obvious next move.


---

## Standing decision — the gate reports what it refuses

Pass 17 ended by naming the instrument this project did not have: *"A 'rejected
at the gate' sample, logged per run and read occasionally, would turn this from
a question someone happens to ask into something the pipeline reports on
itself."* This is that, built, plus the second round of vocabulary it was meant
to find.

### Why the first round did not settle it

Five terms went in because a reader noticed one absence. That is a fix, not a
method. The question worth asking is the general one — *what else is the
vocabulary blind to?* — and it cannot be answered by waiting for the next
reader, because the evidence for a vocabulary hole is an article that is not
there. Nothing in the repository measured absence. `rank-sources.ts` measures
yield per source, which is a count of what got through.

### The selection rule, so the list stays principled

`matchTerms` treats a hyphen and a space as word boundaries. That single fact
disqualified most of the obvious candidates: bare `ai` already matches
*AI-powered*, *AI-driven*, *AI model*, *Meta AI* and *Mistral AI*, and
`bank`/`banking`/`credit`/`wealth` already cover *private bank*, *core banking*,
*credit union* and *wealth management*. **A term earns its place only if it
contains no word already on a list.**

Two gaps were created by that same boundary rule, and are the clearest
additions in the set:

- `bank` requires a non-letter before it, so it never matched inside **neobank**.
- `asset manager` does not pluralise into **asset management**.

### What went in

| group | terms |
|---|---|
| labs whose names contain no AI word | `deepmind`, `cohere`, `databricks`, `palantir`, `hugging face` |
| techniques the category words miss | `chatbot`, `voicebot`, `model context protocol`, `multi-agent`, `autonomous agent`, `digital worker` |
| the advisory vocabulary P07 is named for | `investment advisory`, `investment advice`, `investment proposal` |
| core banking work | `kyc`, `aml`, `anti-money laundering`, `know your customer`, `mortgage`, `loan`, `underwriting`, `collateral`, `treasury`, `custodian`, `brokerage`, `securities`, `reconciliation`, `neobank`, `asset management` |
| named supervisors | `finma`, `bafin`, `fca`, `ecb`, `federal reserve` |
| German, for the Swiss and DACH sources | `privatbank`, `vermögensverwaltung`, `hypothek`, `zahlungsverkehr`, `anlageberatung`, `kredit` |

The supervisors are there for a specific reason: a headline naming the regulator
often never says "regulator", and *"FINMA sets out expectations for agentic AI"*
had no banking evidence under the old list.

### What stayed out, and the measurement that decided it

Every rejection below was counted against the 1,024-article graded corpus, and
every one is asserted in `classify.test.ts`. **A term someone re-adds because it
looks harmless should fail a test, not a production run.**

| rejected | evidence |
|---|---|
| `sonnet`, `opus`, `haiku` | a poem form, a musical work, a poem form. **Zero** corpus hits — which is the argument *for* excluding them, not against: any hit would be a false one |
| `scale ai` | 3 hits, every one *"Scale AI Wealth Transfer"* or *"Scales AI"* as a verb |
| bare `advisor` | 37 hits, **10 D-graded** — the worst ratio of any candidate measured |
| bare `agent` | 58 hits; insurance agents and estate agents among them |
| `assurance` | 1 hit: *"Finzly debuts AI assurance layer"*. Quality assurance, not insurance |
| `llama`, `mistral`, `grok`, `perplexity`, `bedrock`, `rag`, `transformer`, `inference` | ordinary English or common metaphors |
| `nvidia` | a hardware vendor whose news is equity news |
| `onboarding`, `exchange`, `broker`, `portfolio`, `deposit` | real banking words, commoner in their ordinary sense |

`kredit` and `treasury` are the two thinnest calls — both ordinary words
elsewhere, both admitted because this corpus is banking news. If either turns up
as noise in the rejection report, drop it.

### The report itself

Only the **first** gate an article failed is reported. `classify()` records both
`no_ai_term` and `no_banking_evidence` when neither list matched, and that pair
tells a reader nothing they can act on — a piece about crop yields fails both,
and is meant to. The first failure names the list that would have to change.

The example budget is spent *per reason* rather than over the report as a whole.
`no_ai_term` is always the largest bucket and always the least interesting; a
flat cap would fill the sample with it and hide the commentary rejections, which
are the ones worth arguing about.

Body-pass demotions go into the same tally. An article whose headline passed and
whose body disqualified it is the most informative rejection there is, and it
was previously reported only as a bare count.

### The limit, stated plainly

`rescore.ts:139` reads `FROM articles`. It only ever sees rows that were
**stored**. Articles killed at the gate were never inserted, so no rescore,
migration or backfill recovers them, and GDELT — the only historical source — is
disabled across all ten of its entries.

| route | what it recovers |
|---|---|
| re-ingest | only what is still inside a feed's window — days to weeks |
| rescore | nothing new; it re-scores and re-tags what is already stored |
| `seed-urls` | anything, one URL at a time, by hand |
| backfill | nothing — GDELT is dead |

The rescore is still worth running, for a different reason: P07 already contained
`financial advisor` and `advisors`, so stored rows gain process tags they could
not have had before. **The taxonomy knew the vocabulary; only the gate did not.**

And the regression suite scores a change like this as a perfect no-op by
construction — it grades stored articles, and the ones this rescues have no row.
That is the expected result, not a disappointing one, and it is exactly why the
rejection report had to exist.

### The first run, and what it found immediately

Ingest 133, 2026-09-17. 1,471 items fetched, 1,259 after dedupe, **264 passed
the gate** and 996 were refused:

| reason | count |
|---|---|
| `no_ai_term` | 726 |
| `no_banking_evidence` | 249 |
| `market_commentary` | 11 |
| `ai_not_central` | 10 |

The two small buckets are the point. Ten and eleven articles are a readable
number, and they are where a judgement call goes wrong. `market_commentary`
refused *"AI boom poses new financial stability risks, BIS head says"* and
*"NVIDIA Emerges as AI Industry's Central Bank"* — both correct, and both
invisible before today.

**One miss, found on the first run.** `ai_not_central` refused *"Zopa rolls out
personal banking agent"* (Finextra — AI) at intensity 8. A neobank putting an
agent into production is exactly what this tool is for. The title carries no AI
term — `agent` is deliberately not one — so the title bonus never fired and an
AI term in the summary alone scored 8.

It is **not** being fixed by adding a term, and the reason is worth recording.
Measured against the corpus: of the 58 graded headlines whose title says
*agent*, **zero** lack an AI term in that title. Every qualified phrase
considered — `banking agent`, `virtual agent`, `digital agent`, `software
agent`, `service agent` — has **zero** corpus hits. The corpus cannot decide
this question, because the gate is what built the corpus: the headlines that
would settle it were refused and never stored. Changing a term list on a sample
of one is the reactive move this whole pass was meant to replace. The report now
runs daily; if `agent`-without-AI-term keeps appearing in `ai_not_central`, that
is evidence, and one headline is not.

### The report's own first bug

Its five `no_ai_term` examples were all Capgemini and McKinsey — while the tally
directly above them said 95 rejections came from allnews.ch and 87 from
Agefi.com. The examples were the first five encountered, and those feeds are
polled first, so the sample showed a reader everything except the bucket it had
just pointed at.

Fixed the same day: examples are now drawn one per source before any source gets
a second, busiest feed first. A sample that cannot show you what it is counting
is not a sample, and this was visible only because the report printed its
evidence next to its arithmetic.

### The rescore recovered nothing, and the plan was wrong about why it would

Rescore 12 re-classified all 1,787 stored articles. Measured before and after:

| | before | after |
|---|---|---|
| articles | 1,780 | 1,787 (+7, from the ingest) |
| with an L1 process | 652 | 654 |
| tagged P07 | 82 | **82** |
| AI focus zero | 299 | **299** |

The +2 in process coverage is the seven newly ingested articles. The
re-classification of the archive changed nothing.

The plan predicted otherwise — *"P07 already contains `financial advisor` and
`advisors`, so stored articles will gain process tags they could not have
before"* — and that reasoning does not hold. **The gate lists and the process
lists are separate.** `AI_TERMS` and `BANKING_TERMS` decide what is *admitted*;
`L1_PROCESSES` decides how an admitted article is *tagged*. Widening the first
pair cannot change the second for a row that was already stored, because that
row was already being tagged against the full process taxonomy.

Which sharpens the recovery table rather than softening it:

| route | what it recovers |
|---|---|
| re-ingest | only what is still inside a feed's window |
| rescore | **nothing at all** from a gate-vocabulary change, not merely "nothing new" |
| `seed-urls` | anything, one URL at a time, by hand |
| backfill | nothing — GDELT is dead |

A wider gate is a forward-looking change only. That is worth knowing before the
next one is proposed on the promise of repairing the archive.

## Pass 18 — 2026-09-17, 43 articles

A: 10 · B: 24 · D: 9. Corpus 1,024 → 1,067.

The first batch collected under the widened gate, which makes it the only honest
test of whether the new terms match the right articles.

### The Zopa "miss" was not a miss

The rejection report flagged *"Zopa rolls out personal banking agent"* (Finextra)
as refused by `ai_not_central`. This batch contains the same story twice —
*"Zopa launches AI-powered 'Ask Zopa' for conversational banking"* (IBS
Intelligence) and *"Zopa Launches 'Ask Zopa' AI"* (FF News) — both graded A, both
admitted, and they fold to one use case.

So the gate dropped one report of a story it captured through two other feeds.
That is the system working: the fold exists precisely so the ninth report of a
story costs nothing, and the corollary is that losing the third report costs
nothing either. It also settles the question the previous entry left open — the
case for adding a bare `agent` term is now weaker still, because the evidence
for it was an article that turned out not to be missing.

### What the new terms actually brought in, graded

Four articles in this batch were admitted by terms added yesterday, and the
grades are the measurement:

| term | article | grade |
|---|---|---|
| `fca` | *FCA boss warns laws can never keep up with AI* | B — correct; AI-in-banking news, not a use case |
| `bafin` | *Bafin sieht Verbesserungsbedarf bei Datennutzung in KI-Systemen* | B — correct, same shape |
| `kredit` | *ByteDance arrangiert einen Kredit … für KI-Ausbaupläne* | **D** |
| `loan` | *US Defense Department weighs $5b loan for AI startup Fluidstack* | **D** |

The supervisors earn their place. `kredit` and `loan` produced the shape the
term list warned about in advance — AI *capital* news, not AI in banking. Two
instances is not yet grounds to drop either, and this is the first evidence
against them; a third of the same shape should be.

`palantir` also produced its first false positive: *"Palantir upgraded to Buy by
UBS on strong AI and data demand"*, graded D. Equity research, admitted because
both `palantir` and `ubs` now match. Worth watching for the same reason.

### Three of my own gradings corrected, and why that is worth writing down

The regression's agreement ratchet failed at 0.827 against a 0.83 floor. Every
one of the three disagreements was from this pass, and reading them, two were
mistakes in my grading rather than in the rules:

- **CUBE and IBM** — graded A while four identical vendor-partnership
  announcements *in the same batch* (FI Works, Impactsure, Personetics, SS&C)
  were graded B. The A was the inconsistency.
- **AXA Hong Kong** — graded A on P26 credit and counterparty risk for
  *insurance* underwriting. This is a bank process landscape; insurance
  underwriting is not one of its processes, and forcing it in made the taxonomy
  claim something it does not mean.
- **Bank of Georgia** — process corrected from P35 technology platform to P5
  servicing. The chief digital officer describes super-apps and customer-facing
  financial agents. The rules read it better than I did.

Corrected, agreement is 125/148 = 0.845 and the suite passes. **These
corrections also happen to fix the ratchet, and that is exactly why each was
checked on its merits first.** A ratchet that can be satisfied by re-grading is
worth nothing unless the re-grading would survive without it. No ratchet was
lowered, and none was raised: process coverage is 56/110 = 0.509 against a 0.50
floor, tighter than the pass before, so nothing here earned a raise.

### The fold, doing its job

110 A-graded reports fold to 65 use cases. KB Kookmin Bank's "KB AI" arrived
three times in one batch — 아시아경제, 디지털투데이 and 헤럴드경제 — and Ask Zopa twice.
Five reports, two use cases.

### One distinction the gate cannot make, and a reader can

Three D grades are a bank, AI, and no process: UOB funding AI lessons for
children, Standard Bank running a hackathon, JPMorgan's private bank targeting
clients who *made their money in* AI. Every one clears all four gates. Every one
is a reminder that the gate decides what is worth reading, not what is true.
