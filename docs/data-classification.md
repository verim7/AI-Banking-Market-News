# What data may live where

Written after an audit of what this repository publishes. It answers one
question — *if company or client data entered this system, what would have to
change?* — and it answers it before that happens rather than after.

The repository is **public**. Everything below follows from that one fact.

---

## What is published today, measured

Not estimated. These are the numbers from the working tree.

| Path | Size | Written by | Contents |
|---|---|---|---|
| `data/snapshots/` | 4.1 MB | the `ingest` workflow, **daily at 04:20 UTC** | every article kept in a run: id, url, title, extracted summary, source, dates, scores, tags |
| `data/review/graded/` | part of 1.9 MB | `review-apply`, on demand | hand-graded articles **including body excerpts** |
| `data/review/decisions/` | part of 1.9 MB | a person, on demand | grades and the reasoning for them |
| `data/backfill-state.json` | 8 KB | `backfill` | how far the historical crawl got |

**Today this is safe.** All of it derives from public news feeds and public
LLM benchmarks. No credential is in the repository; `.gitignore` covers `.env`
and `.dev.vars`; the D1 `database_id` in `wrangler.toml` is an identifier, not
a key — it grants nothing without a Cloudflare API token.

### The finding that matters

> **`ingest` commits `data/snapshots/` to a public repository every day,
> automatically, with no human in the loop.**

That is not a leak now, because what it commits is public already. It is the
shape of the problem: an automated, scheduled, unreviewed path from the
database to the open internet. The day a private source is added, the leak is
daily, silent, and in git history — which is to say, permanent, because
deleting the file does not delete the commit.

### A second finding, smaller and already true

`data/review/graded/2026-08-25-2.jsonl` contains a journalist's byline email
address, scraped from an article page along with the body text. It was
published by the outlet, so nothing was disclosed that was not already public.
It is still personal data of a third party sitting in a public repository,
arrived at by accident. **Body capture takes whatever is on the page** — author
contact details, commenter names, anything the template renders. Assume every
body excerpt carries more than the sentence you wanted.

---

## The tiers

| Tier | Examples | May live in the public repo? | May live in the shared D1? |
|---|---|---|---|
| **Public** | news articles, published benchmarks, vendor press releases | yes | yes |
| **Internal** | which processes your firm is interested in, which sources it watches, the taxonomy weights | **no** | yes |
| **Confidential** | client names, deal data, internal documents, anything under NDA | **no** | **no — separate database** |
| **Personal** | names, emails, anything identifying a living person | **no** | only with a lawful basis and a retention limit |

The middle row is the one people get wrong. *Which* questions a bank is asking
is itself information about that bank. A filter list committed to a public
repository tells a competitor what the firm is working on, even though every
individual article in it is public.

---

## If company data enters: separate, do not mask

Masking is the weaker answer and it is worth saying why. Pseudonymisation
survives exactly as long as nobody can re-identify the rows — and with a corpus
this small and this specific, a masked institution is usually identifiable from
the process, the date and the region together. Masking also has to be perfect
every time; separation has to be right once.

In order:

1. **Make the repository private.** One action, removes the whole class. Do
   this before the first private source is added, not after.
2. **Stop the snapshot commit**, or reduce it to aggregates — counts per
   source, per process, per month, with no row-level records. The snapshot
   exists so a run is reproducible; counts serve that and carry nothing.
3. **Two databases.** Public corpus in one, company data in another, with
   separate bindings. Cloudflare D1 has **no row-level security** — see
   `docs/disaster-recovery.md` and `packages/worker/src/rbac.ts` — so the only
   boundary is application code. A separate database is a boundary that does
   not depend on a `WHERE` clause being remembered.
4. **Store derived, not raw.** The app needs scores, tags and a quoted
   sentence. It does not need the source document. What is never stored cannot
   leak.
5. **Pseudonymise only what survives all four.** Stable salted hash for the
   identifier, salt in a Worker secret and never in the repository, and a
   documented rule for who may reverse it.

---

## Checks before adding any new source

1. Is the source public? If not, stop and apply the list above first.
2. Will it be committed under `data/`? If yes, it is public — treat it as
   published the moment the workflow runs.
3. Does it carry body text? Then it carries personal data you did not ask for.
4. Would the *list of sources* tell a competitor something? That list is
   internal, even when every source on it is public.
