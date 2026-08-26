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
