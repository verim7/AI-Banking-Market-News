# Sourcing article text

Findings on how much of an article this pipeline can actually read, and what
would change that. One section per attempt, including the ones that produced
nothing — a route ruled out with a number is a result, and the point of writing
it down is that the next person to have the idea finds it already answered.

---

## Baseline — 2026-08-28

Measured over the 559 hand-graded articles in `data/review/graded/`.

| | |
|---|--:|
| Articles with a readable body (≥200 chars) | **25 (4%)** |
| Median characters available to the classifier | **84** |
| URLs still on `news.google.com`, never fetched | **379 (68%)** |
| Real URL, fetched, still no body | **167 (30%)** |

## The bottleneck, measured in production — 2026-08-28

Not estimated. Two consecutive `ingest` runs on a GitHub Actions runner, which
is where the pipeline really runs:

| | 07:34 UTC | 13:58 UTC |
|---|--:|--:|
| Aggregated articles needing a real URL | 218 | 218 |
| **Recovered by publisher-feed lookup** | **5 (2%)** | **6 (3%)** |
| Publishers with a usable feed | 48 / 98 | 55 / 105 |
| Pages read, of those with a real URL | 7 / 18 (39%) | 6 / 16 (38%) |
| Average body when read | 3,931 chars | 3,920 chars |

**The fetcher is not the problem.** Given a real URL it returns ~3,900
characters of prose about 38% of the time. The problem is that 212 of 218
articles never get a real URL: `resolveUrls` matches a headline against the
publisher's own feed, a feed is a few days wide, and half the publishers have no
usable feed at all.

So the ranking is settled. **URL resolution at 2–3% is the ceiling**, and
extraction, paywalls and blocking are all downstream of it.

### A caution about measuring this from a sandbox

A 40-URL probe run from a remote Claude Code session returned 39 uniform
`http-error (403)` across hosts as unrelated as Finextra, McKinsey, The Register
and ZDNet. That was **the sandbox's egress proxy, not the publishers** — plain
`curl` to the same hosts returns `000`, and production reads 38% of them fine.
Read as a finding about publishers it would have sent a whole pass in the wrong
direction. Check egress before believing any probe:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://www.finextra.com/
```

---

## GDELT as a URL resolver — inconclusive, and it found a live defect

**The idea.** GDELT indexes roughly three months, is free and keyless, is
already a dependency, and returns **direct publisher URLs**. 321 of the 379
stuck articles fall inside that window. Joining a stuck headline to GDELT by
`titleKey` is the same join `resolveUrls` already does against a feed, against a
far wider index.

**The result: no result.** 60 articles probed from an Actions runner,
**0 recovered, 60 errors**, every one `TypeError: fetch failed` — including the
very first. That is not GDELT declining to match. It is never reaching GDELT.

**What it did establish.** The same failure is in production. Two independent
`ingest` runs the same day:

```
FAIL  GDELT — AI in banking — fetch failed
FAIL  GDELT — AI regulation in finance — fetch failed
```

**Both GDELT sources are dead, and the run reports success.** `29/37 sources
returned data` is printed and the workflow exits zero, so eight failing sources
— two of them GDELT — are invisible unless someone reads the log.

**What is still unknown.** Whether GDELT is down globally or refusing GitHub
Actions IP ranges. It cannot be told apart from inside either environment
available here: a remote session's proxy blocks `api.gdeltproject.org` outright.
Deciding it needs one request from an ordinary machine:

```bash
curl -sS -m 30 -o /dev/null -w '%{http_code}\n' \
  'https://api.gdeltproject.org/api/v2/doc/doc?query=bank&mode=artlist&format=json&maxrecords=1'
```

The resolver idea is **not disproved** — it is untested, and stays on the list
until GDELT can be reached.

### What the attempt cost, and one thing it fixed

Sixty identical `TypeError: fetch failed` lines said nothing about whether GDELT
was down, blocking the runner, or being sent a malformed query — three different
answers needing three different fixes. `measure-resolution.ts` now prints
`err.cause`, which is where undici puts the one that tells them apart. The
`FailureReason` type in `fetch-article.ts` exists for exactly this reason and the
lesson had to be learnt twice.

## Still on the list

- **`FailureReason` is computed and discarded.** `readArticle` returns it;
  nothing aggregates it. One counter over a production run says whether the 62%
  of resolvable pages that fail are blocked, JavaScript-only or badly extracted.
- **Publisher news-sitemaps** — wider than an RSS window, and half the
  publishers in the corpus have no usable feed.
- **Text already fetched and thrown away** — JSON-LD `articleBody`,
  `og:description`, `<link rel="amphtml">`. Not a body, but `taskAttested` needs
  one real sentence, not a body.
- **Rank sources by body recovery, not just yield.** A feed whose links never
  resolve is worth less per request than one that yields readable text.
- **Make a dead source loud.** Eight of 37 sources failed today and the run was
  green.

## Ruled out

- **Full-text RSS via `content:encoded`** — already wired through
  `fetch-rss.ts` into `normalize.ts` as `excerpt`. The feeds in use do not carry
  it. Nothing to build.
- **Circumventing access controls** — Googlebot or referrer spoofing, cookie and
  JavaScript tricks against metered walls, bypass proxies. Out of scope: they
  defeat a control the publisher set, they break constantly, and this text is
  redistributed in a product. Note the hosts failing most here — Finextra,
  McKinsey, The Register, ZDNet — are all free to read, so paywalls are not the
  shape of this problem.
