# Swiss coverage

What makes an article Swiss, why the region tag cannot answer that, how much
Swiss content the pipeline actually finds today, and what a daily crawl of the
banks' own newsrooms would have to look like.

Measured 2026-09-10 against the 812 hand-graded articles in
`data/review/graded/`. Every number here is reproducible from that corpus.

---

## 1. The schema

### Why not the region filter

The Market Lens already has a `region` tag with a `switzerland` value. The
Agentic Swiss Banks deliberately does not use it, and the reason is not stylistic.

`region` is inferred from the article's words and from the source's own region
hint, so it answers **"does this article smell Swiss"**. The Agentic Swiss Banks tab asks
**"is a Swiss institution doing something"**. Those come apart in both
directions, and both failures are common:

| | region says | should the Agentic Swiss Banks tab show it |
|---|---|---|
| Handelszeitung on JPMorgan's AI rollout | switzerland | no |
| Reuters on UBS's AI assistant | often nothing | yes |
| A FINMA circular on model risk | switzerland | yes |
| "Swiss investors pile into AI stocks" | switzerland | no |

A page whose whole claim is *these are the peers down the road* cannot be built
on a signal that is wrong in both directions and carries no evidence.

### What replaces it: a registry and three grades

`packages/shared/src/swiss.ts` names the institutions. A registry is more work
than a heuristic, and it is exactly the work that makes the answer checkable:
every row on the Agentic Swiss Banks tab can say which institution put it there.

**75 institutions**, by kind:

| kind | n | what it holds |
|---|--:|---|
| `big_bank` | 2 | UBS, and Credit Suisse for the historical record |
| `cantonal` | 24 | all of them — the reason this page was asked for |
| `private` | 13 | Julius Bär, Pictet, Lombard Odier, Vontobel, UBP, … |
| `retail` | 9 | Raiffeisen, PostFinance, Migros Bank, Valiant, Cler, … |
| `digital` | 9 | Swissquote, Yuh, neon, Alpian, radicant, True Wealth, … |
| `crypto` | 6 | Sygnum, AMINA, Incore, Bitcoin Suisse, Taurus, Relai |
| `infrastructure` | 7 | SIX, Avaloq, Temenos, Finnova, Inventx, Swisscom |
| `authority` | 5 | FINMA, SNB, SIF, the Bankers Association, SFTI |

Each entry carries every form the press uses, in four languages — "Banca dello
Stato del Cantone Ticino" and "BancaStato" are the same bank, and a list
holding one of them silently drops half its coverage. That is the same failure
the Incore fold had, one layer down.

Each entry also carries its **newsroom URL and feed**, because the filter and
the crawl must be one list or they drift apart.

**Three grades**, ordered by what the reader can do with the row, not by
confidence:

| grade | rule | what it is |
|---|---|---|
| `institution` | a registry institution is named **in the headline** | a peer doing something |
| `mention` | named in the body but not the headline | a supplier win, a survey, a regulator's view |
| `press` | no institution anywhere — only a place name, or a Swiss publisher | the tier `region` conflates with the other two |

The headline/body split is the evidence rule `tagsFor` already applies: an
editor putting the name in the headline is asserting the article is about that
institution, and in a corpus that is 96% headline no other signal is as cheap
or as reliable.

Stored on `article_scores` as `ch_nexus` and `ch_nexus_evidence` — a claim and
the evidence for it, exactly like `maturity` and `maturity_evidence`. Written
by the rules at ingest, rebuilt by `rescore`, never edited by hand.

**The Agentic Swiss Banks tab opens on `institution` + `mention`.** `press` is one click
away and off by default, because it is the tier that makes "Swiss AI banking
news" mean nothing.

### Two rules the measurement produced

- **A foreign bank with a Swiss branch is not a Swiss institution.** Bank of
  Singapore was on the registry for exactly one measurement. It has a Zurich
  branch, and it put two grade-A rows about an OCBC wealth programme run out of
  Singapore onto the page. Removed, and the rule now keeps every other branch
  office off.
- **The institution shown is the one the text names first, not the one the
  registry lists first.** "Avaloq will supply the platform to Raiffeisen" is a
  supplier story or a bank story depending on nothing but list order otherwise,
  and list order is not evidence.

---

## 2. The yield today

Running the nexus reader over all 812 hand-graded articles:

| grade | articles | share |
|---|--:|--:|
| `institution` | 15 | 1.8% |
| `mention` | 2 | 0.2% |
| `press` | 4 | 0.5% |
| none | 791 | 97.4% |
| **Agentic Swiss Banks default** | **17** | **2.1%** |

And of the 77 grade-A use cases — the ones a reader confirmed as a named bank
doing a named task:

| grade | use cases |
|---|--:|
| `institution` | 4 |
| `mention` | 0 |
| `press` | 0 |

**Four.** All four are the same Incore Bank KYC proof of concept, which the
2026-09-09 fold now shows as one use case. So the Agentic Swiss Banks tab, on everything
this pipeline has ever graded, opens on **one Swiss AI use case**.

Which institutions appear at all:

| institution | articles |
|---|--:|
| UBS | 8 |
| Incore Bank | 4 |
| FINMA | 3 |
| Temenos | 1 |
| Swissquote | 1 |

**5 of 75.** Zero cantonal banks. Zero private banks. Zero neobanks.

### What that number is and is not

It is not a classifier failure. The registry is 75 institutions deep and the
corpus contains 5 of them — there is nothing for a better matcher to find. Two
things cause it, and only one of them is fixable here:

1. **The sources are wrong for this question.** Google News, the international
   trade titles and GDELT cover global banking. A Thurgauer Kantonalbank
   release does not reach any of them, in any language.
2. **`mention` is undercounted by construction.** It needs a body, and body
   coverage across this corpus is 4% (`docs/content-sourcing.md`). Two mentions
   out of 812 is a measurement of the body coverage, not of Swiss activity. The
   grade will be worth reading only after that number moves.

---

## 3. The daily crawl of Swiss bank newsrooms

### Why the primary source, and not more aggregators

Everything this pipeline reads today is somebody writing *about* a release that
already exists on a bank's own newsroom — days later, a headline long, and for
most of this registry not at all. The newsroom is where the text is: full
sentences, a date, the bank's own words about what it deployed. It is also the
only route that reaches a cantonal bank at all.

It is a small, well-behaved crawl by construction: 75 pages once a day is
fewer requests than one Google News query already makes, every URL is a public
newsroom that exists to be read, and nothing here touches an access control.

### The shape

1. **Feed first.** Any institution with an RSS or Atom feed needs no crawling —
   it becomes an ordinary entry in `packages/ingest/sources.yaml` and the
   existing pipeline handles it. FINMA already has one.
2. **Listing second.** For the rest, fetch the newsroom, take the links that
   look like dated releases, and treat each as an article URL. `readArticle`
   and `extractBody` in `fetch-article.ts` already do the rest, and they work
   well on a bank's own page — the 4% body coverage is a Google News redirect
   problem, not an extractor problem.
3. **Politeness, unchanged.** One request per URL, six at a time, failure is a
   null and never a retry storm — the same limits `fetchBodies` already uses.
4. **The relevance gate is unchanged.** A newsroom publishes results, board
   appointments and sponsorships. They arrive as articles and the existing
   rules reject them, which is the correct amount of work.
5. **Dead sources fail loudly.** A newsroom that changes its markup silently
   yields zero. `deadIntegrations()` in `run.ts` already turns a source that
   stopped producing into a non-zero exit, and these must be registered the
   same way or the crawl rots invisibly.

### What must be measured before any of it is built

The registry lists a newsroom URL for 29 of the 75 institutions; the rest need
one found. **`npm run probe-swiss-press`**, or the **"Probe Swiss press
pages"** workflow, reports for each one: reachable or not, blocked or not,
whether a feed can be discovered, and how many links on the page look like
dated releases.

That has not been run yet, and the number is not guessable. This sandbox has no
egress — `www.finma.ch:443` and `www.ubs.com:443` are both refused by the proxy
at the CONNECT — so it has to run on an Actions runner, which is where this
project's article bodies came from in the first place.

The probe answers the only question that matters before writing a crawler:
**how many of the 75 have a listing a crawler could walk today**. Three
outcomes and what each means:

| outcome | what to build |
|---|---|
| a feed exists | add it to `sources.yaml`; nothing else to write |
| reachable, ≥3 release-shaped links | a listing crawler, worth writing |
| reachable but thin | the listing is JavaScript — out of scope, and the honest answer is to leave it out rather than run a browser |

### The expectation, stated so it can be wrong

Two hypotheses in this project were confidently wrong until measured — Google
News token decoding recovered 0 of 322, and relaxing the corroboration rule
bought one article while *lowering* agreement. So this is written down before
the probe runs, to be scored against:

- the big banks, SIX and FINMA will have feeds or clean listings;
- most of the 24 cantonal banks will be reachable with a walkable listing,
  because they run modest CMSs rather than JavaScript applications;
- the private banks will be the worst — heavy corporate sites, several of them
  behind a CDN that will answer 403 to anything that is not a browser.

If the probe returns fewer than ~20 walkable listings, the crawl is not worth
building and the honest alternative is a hand-maintained list of the ten
institutions that publish anything about technology at all.

---

## 4. Reproducing the numbers

```bash
npm test -- swiss                 # the registry's own rules
npm run probe-swiss-press         # newsroom reachability — needs egress
```

The corpus yield in section 2 is asserted in
`packages/shared/tests/regression-graded.test.ts`, so it becomes a ratchet
rather than a number in a document that quietly goes stale. Raise it as
coverage grows; lower it only when the corpus grew and the registry did not.
