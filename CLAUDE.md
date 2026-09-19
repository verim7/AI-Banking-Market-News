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
  from the article. The one composed string in the product is the review
  `headline`. An `A` grade without `evidence` is refused by `review-apply`, and
  `npm test` now catches it before that.
- **No model in the pipeline.** No API key, no scheduled AI. Classification is
  rules only; the review judgement happens in chat when asked for, never
  automatically.
- **`data/review/graded/*.jsonl` is evidence.** Read it; never rewrite it. A
  correction is a new decision file, not an edit to an old one.
- **Ratchets in `regression-graded.test.ts`** may be raised as the corpus
  grows. They may be loosened *only* when the corpus grew and the classifier
  did not — never to let a rules change through — and the reason goes in the
  test as a comment naming the articles involved.

## Verifying

```bash
npm run typecheck && npm test        # must stay green
npm run build:web
npx wrangler deploy --dry-run --outdir /tmp/w   # 3 MiB Worker limit
```

A green workflow is not proof that something happened. Check the effect —
query D1, read the row counts — before reporting that it did. See the first
entry in `docs/papercuts.md` for what that habit is worth.
