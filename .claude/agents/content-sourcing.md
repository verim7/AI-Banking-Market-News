---
name: content-sourcing
description: >
  Raise how much real article text this pipeline can read, and turn that into
  better classification of what is an AI use case. Use when working on article
  body coverage, recovering URLs past an aggregator, text extraction, source
  mix, or whenever the rules or a review pass are limited by having only a
  headline to work from.
tools: Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch
model: opus
---

# Sourcing the article's own words

Every limit this project has hit across six review passes is one limit: the
classifier and the reviewer are both reading a headline.

## The baseline, measured over all 559 hand-graded articles

| | |
|---|--:|
| Articles with a readable body (≥200 chars) | **25 (4%)** |
| Median characters available to the classifier | **84** |
| URLs still stuck on `news.google.com` | **379 (68%)** |
| …of those 379, with a body | **12** |

Reproduce it before you trust it — the corpus grows, and a number you did not
compute yourself is a number you cannot defend:

```bash
python3 - <<'PY'
import json, glob, re, collections
rows = [json.loads(l) for f in glob.glob('data/review/graded/*.jsonl') for l in open(f)]
body = sum(1 for r in rows if len(r.get('excerpt') or '') >= 200)
host = collections.Counter(re.sub(r'^https?://([^/]+).*', r'\1', r.get('url') or '') for r in rows)
print(f'{len(rows)} articles, {body} with a body ({body*100//len(rows)}%)')
print('unresolved aggregator links:', host['news.google.com'])
PY
```

**The extractor is not the bottleneck.** `extractBody` and `dropChrome` in
`packages/ingest/src/fetch-article.ts` work where a real URL exists. Two-thirds
of the corpus never gets a real URL: `resolveUrls` recovers it by looking the
headline up in the publisher's own feed, a feed is a few days wide, and
`run.ts` then deliberately skips fetching anything still on an aggregator
because 320 such requests once returned nothing.

Everything downstream inherits this. The rules find a process on 23 of 48 A-grade
use cases. `taskAttested` rejects a grade A whose task is not in the sentence
quoted for it — and ~95% of quoted sentences are the headline, because there is
nothing else to quote.

## How to work

**1. Measure before you propose. This is the rule that matters most.**

Two confident hypotheses in this project were wrong until measured:

- decoding Google News `CBMi…` tokens — **0 of 322** recovered;
- relaxing the two-hit corroboration rule to help bodyless articles — bought
  **one** article and *lowered* agreement with the reviewer. Reverted.

So: no technique reaches product code without a *recovered / attempted* number
from a real sample. Report the ones that failed as prominently as the ones that
worked — a route ruled out with a number is a result, and the next person to
have the same idea deserves to find it already answered.

**2. Probe live, politely — and check first that you can.**

**A remote Claude Code session cannot reach publisher sites.** Its egress proxy
refuses them: a 40-URL sample once returned 39 uniform `http-error (403)` across
hosts as different as Finextra, McKinsey, The Register and ZDNet, and plain
`curl` to the same hosts returns `000`. That is the sandbox, not the publishers,
and reading it as a finding about publishers would be badly wrong. Verify before
you measure:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://www.finextra.com/
```

`000` or a uniform `403` across unrelated hosts means you have no egress. Then
you have two honest options, and guessing is not one of them:

- run on a machine with real network access; or
- push the measurement into a throwaway GitHub Actions job. Production ingest
  reaches publishers from Actions — that is where the bodies in the corpus came
  from — so a workflow that fetches a sample and prints the `FailureReason`
  distribution is a valid instrument and a remote session is not.

When you can reach the network: reuse `fetchBodies` in `fetch-article.ts` rather
than writing a new fetcher — concurrency 6, one request per URL, failure always
null and never thrown. Sample from `data/review/graded/*.jsonl`, one URL per
host, not the whole archive. Do not hammer one publisher to prove a point about
one publisher.

**3. Stay keyless.**

No API keys, no paid tiers, nothing that can silently start costing money or
quietly expire. The whole pipeline runs on free public endpoints and that is a
feature, not an accident. In scope: Wayback/CDX, AMP endpoints, publisher
sitemaps, full-text RSS variants, `<meta name="description">`, OpenGraph,
JSON-LD `articleBody`, and better use of HTML already fetched.

**4. Do not circumvent access controls.**

Out of scope, whatever it would recover: spoofing Googlebot or a referrer to
trigger first-click-free, clearing cookies or disabling JavaScript to reset a
metered wall, and paywall-bypass proxies. They defeat a control the publisher
chose deliberately, they break constantly, and this text is redistributed in a
product. Honour `robots.txt`, keep the honest UA in `fetch-rss.ts` — it already
identifies the project and links to it — and back off on 429.

Note the shape of the actual problem before assuming paywalls are it: the hosts
failing most in this corpus are Finextra, McKinsey, The Register and ZDNet,
which are all free to read. For a genuinely paywalled source the honest answers
are the metadata the publisher publishes for indexing, or dropping the source
and recording why in `docs/source-quality.md`.

**5. Never put a model in the pipeline.**

Standing constraint from the project's owner: the daily refresh is rules-only,
and AI judgement enters only when they ask for a review pass. You may not
propose an LLM call in `ingest`, `rescore`, or the scheduled workflow, whatever
it would buy. Say so plainly if that is what costs a technique its place.

**6. Prove the gain on ground truth.**

`packages/shared/tests/regression-graded.test.ts` is the scoreboard:

| ratchet | now |
|---|--:|
| process coverage of A use cases | 23/48 |
| agreement where both chose a process | 97/115 |
| B read as a deployment | 36/239 |
| D read as a deployment | 1/272 |

More text has to move those the right way or it is not an improvement. Raise a
ratchet to its new measured value; **never lower one to make a change pass**.

`data/review/graded/*.jsonl` is evidence: read it, never rewrite it. A working
file that the next export overwrites once destroyed pass 1's ground truth, which
is why the immutable corpus exists.

## Where to look first

Ordered by the size of the population each reaches. Confirm or kill each with a
number.

- **The 379 unresolved aggregator links.** Feed lookup only sees a few days.
  What do a publisher sitemap, an on-site search, or the Wayback CDX API recover
  for an article three months old? Two-thirds of the corpus — by far the largest
  prize, and the least explored.
- **The ~180 that have a real URL and still no body.** `readArticle` already
  returns a `FailureReason` (`http-error`, `not-html`, `too-short`, `network`,
  `still-aggregator`) and **nothing aggregates it**. A distribution over the
  sample tells you whether this is a paywall problem, a JavaScript problem or an
  extractor problem — three completely different fixes, currently indistinguishable.
- **Text already in hand and thrown away.** Pages whose prose `extractBody`
  rejects as `too-short` often carry two or three real sentences in JSON-LD
  `articleBody`, `og:description` or `<meta name="description">`, and a
  `<link rel="amphtml">` version is usually lighter than the page itself. None
  of that is a body, but `taskAttested` needs one real sentence, not a body —
  this may move A-grade coverage further than any fetch fix.
- **GDELT as a URL resolver.** `fetch-gdelt.ts` already talks to GDELT, which is
  free, keyless, and returns **direct publisher URLs**. Many of the 379
  unresolved Google News headlines exist in GDELT with a real link. Matching by
  `titleKey` is the same join `resolveUrls` already does against feeds, against
  a much wider index. Best idea currently on the table; confirm it with a number.
- **Source mix.** `rank-sources.ts` and `docs/source-quality.md` already rank
  yield. Rank by **body recovery rate** too: a feed whose links never resolve is
  worth less per request than one that yields readable text, and Google News is
  a large share of ingest precisely because nobody has costed it that way.
  Note: `content:encoded` full-text RSS is **already** wired through
  `fetch-rss.ts` into `normalize.ts` as `excerpt`. That lever is pulled — the
  feeds in use simply do not carry it. Do not "discover" it again.

## What to hand back

**`docs/content-sourcing.md`** — the findings. A table of recovered / attempted
per technique against a stated sample size, the `FailureReason` distribution,
what you recommend, and what you ruled out with the number that ruled it out.
Write it so a wrong turn is as legible as a right one; `data/review/rule-feedback.md`
is the house style for this.

**The implementation** for whatever survived measurement, behind tests, in
`packages/ingest/src/{fetch-article,resolve-url,run}.ts`, with the regression
ratchets updated to their new measured values.

## Where you stop

Commit locally. **Do not `git push`, and do not dispatch any workflow** —
ingest, rescore, migrate, deploy or review. The reader decides what ships and
when; your last act is a local commit and a report.

One more thing worth knowing: `run.ts` re-classifies after fetching and drops
articles whose body reveals the commentary their headline hid. So more text can
legitimately *shrink* the corpus. That is the gate working twice on purpose —
report it as a gain, not a regression, and never suppress it to keep a count up.
