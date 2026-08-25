# Rule feedback

One section per review pass.

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
