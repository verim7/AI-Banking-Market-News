# CLAUDE.md

## Papercuts

Maintain `docs/papercuts.md`, a log shared by every session in this repository
of anything that slowed development down. When you lose time to one
mid-session, append `date · symptom · fix · project` — while it is fresh,
not at the end. **Check this file first when tooling fails mysteriously.**

It is in the repository rather than `~/code/` on purpose: these sessions run in
a container that is reclaimed after a period of inactivity, so a log under
`$HOME` would start empty every time and never accumulate, which is the one
thing it exists to do. Committed to the repo it survives. The cost is that it
is per-repo rather than global.

## What this project is

A daily pipeline that collects AI-in-banking news, classifies it with a rules
engine, and presents it as a reviewed use-case list. Cloudflare Workers + D1 +
a React SPA. GitHub Actions is the only control surface: ingest, rescore,
migrate, deploy, and the three review steps all run as workflows.

## The rules that are not negotiable

- **Extractive, never generative.** A use-case description is a sentence quoted
  from the article. There are two composed strings in the product: the review
  `headline`, and the weekly digest's summary. That summary is sent only if
  `validateDigest` (`packages/shared/src/digest.ts`) passes it, and it is
  labelled as AI-written wherever it appears. An `A` grade without `evidence` is refused by `review-apply`, and
  `npm test` now catches it before that.
- **No model in the pipeline.** No API key, no scheduled AI. Classification is
  rules only; the review judgement happens in chat when asked for, never
  automatically. **One named exception**, at the owner's request: the weekly
  Claude Code Routine (Monday 06:52 Zurich) may run the review pass and draft
  the digest summary. It is a Claude session, not a workflow. No model key
  enters the repo or Actions. Nothing it writes reaches colleagues until the
  editor approves the issue (`docs/weekly-digest.md`). Graphify (`docs/graphify.md`) is a local tool on the
  same terms: its code pass is deterministic and may run anywhere, its semantic
  pass over docs calls a model and so never goes into a workflow.
- **`data/review/graded/*.jsonl` is evidence.** Read it; never rewrite it. A
  correction is a new decision file, not an edit to an old one.
- **Ratchets in `regression-graded.test.ts`** may be raised as the corpus
  grows. They may be loosened *only* when the corpus grew and the classifier
  did not — never to let a rules change through — and the reason goes in the
  test as a comment naming the articles involved.
- **Every institution graded A has a tier.** The Trends board ranks by
  `packages/web/src/lib/tiers.ts`: Tier 1 is the FSB G-SIB list exactly, Tier 2
  a domestic systemically important bank or a national leader, then Tier 3,
  digital banks, providers and authorities, each with its `basis` written
  down. A review pass that names a new `actor` adds it there in the same
  commit; `tests/tiers.test.ts` reads the decision files and fails otherwise.
  Recheck `G_SIBS` when the FSB publishes its list each November.

## Verifying

```bash
npm run typecheck && npm test        # must stay green
npm run build:web
npx wrangler deploy --dry-run --outdir /tmp/w   # 3 MiB Worker limit
```

A green workflow is not proof that something happened. Check the effect —
query D1, read the row counts — before reporting that it did. See the first
entry in `docs/papercuts.md` for what that habit is worth.

## Design

Every website, app or page built here follows the house style in
`docs/design-guidelines.md` — colours, Source Sans Pro, square orange
bullets, sharp corners unless something is being highlighted, and no uppercase
words anywhere. **Read that file before writing any markup or CSS.**

The four that are broken most often, so they are repeated here: never
`text-transform: uppercase`; never `#000` (use the main colour); corners are
square by default and rounding is a deliberate highlight; nothing below 14px.
