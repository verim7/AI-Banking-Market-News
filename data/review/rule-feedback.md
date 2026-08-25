# Rule feedback — pass 1 (2026-08-25, 80 articles)

What reading 80 articles showed about the automatic classifier. Each item is a
change to make, not an observation: the point of the loop is that the rules get
better, otherwise the same backlog is re-read forever.

## 1. Deduplication is the biggest single defect

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

## 2. Vendor launches score exactly like bank deployments

"Launches", "unveils", "debuts", "deploys" fire ADOPTION_TERMS regardless of
**who** is doing it. Datalign, Zeplyn, RightCapital, MirrorWeb, Addepar,
Broadridge, Goodfin, Trust3 and Anthropic all scored 71–89 and read as adoption.
They are the single largest category in the corpus (C, 32 of 80).

**Proposed fix:** an actor test in the rules. When the subject of the adoption
verb is not in INSTITUTION_TERMS and not a known bank, cap AI intensity and set
maturity to `announced` rather than `in_production`. A vendor shipping a feature
is not a bank running one.

## 3. Over-tagging: one word, five processes

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

## 4. Corporate news reads as deployment

Appointments, reskilling programmes, training MOUs and headcount stories scored
90–100 with maturity `in_production`. Nine of the twenty-five D grades are this
genre.

**Proposed fix:** a `CORPORATE_NEWS_TERMS` gate alongside the existing
commentary gate — appoints, names as, joins as, reskill, upskill, memorandum of
understanding, headcount, job cuts. Present without an AI task verb, these
should not reach production maturity.

## 5. Body extraction leaves navigation in place

Several excerpts begin "Skip to content YOU ARE AT: Home »" or "Facebook
Twitter LinkedIn", and one carried a raw `onclick=` attribute. The classifier
reads that as article text.

**Proposed fix:** extend the strip list in `fetch-article.ts` and drop leading
lines before the first sentence containing a verb.

## Effect on this batch

| Grade | Count | |
|---|--:|---|
| A — deployed | 15 | of which 8 are the same DBS story |
| B — announced | 8 | |
| C — generic | 32 | mostly vendor launches and consultancy reports |
| D — not a use case | 25 | commentary, appointments, forecasts, workforce |

**Distinct deployed use cases in this batch: 8**, not 15 — DBS, Starling,
CIBC, Experian, Bank of Singapore, Santander/Mastercard, ruya, and DBS again
under seven other bylines.
