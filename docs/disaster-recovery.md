# Disaster recovery

## What exists

Cloudflare D1 keeps a continuous change log and can restore the database to any
moment in the last **30 days** — "Time Travel". It is on by default and costs
nothing extra. There is no backup job to configure and none in this repository.

## What did not exist until this was written

**A restore that has never been performed is not a backup.** It is a belief
about a backup. Until someone runs the commands below against this database and
sees real rows come back, the honest status is "probably recoverable".

This page is short on purpose: the only thing that makes it worth anything is
that somebody actually does it.

## Restoring

Find the point to return to. Bookmarks are timestamps or change-log ids:

```bash
npx wrangler d1 time-travel info portal --remote
```

Look at what a moment in the past contains **before** committing to it:

```bash
npx wrangler d1 time-travel restore portal --timestamp=2026-09-17T09:00:00Z --dry-run
```

Then restore:

```bash
npx wrangler d1 time-travel restore portal --timestamp=2026-09-17T09:00:00Z
```

A restore **replaces** the database. Everything after that timestamp is gone,
including sessions — so everyone is signed out, which is expected and fine.

## After a restore, check these three things

1. `GET /api/health` reports `ok: true`. If it names missing tables or columns,
   the restore landed before a migration: run the **Migrate database** action.
2. Sign in. If it fails, `SESSION_SECRET` is unaffected by a restore, so the
   cause is the database — check `/api/health` again with a session or the
   setup token.
3. Article count is roughly what the last snapshot in `data/snapshots/` says.
   Those files are committed to git, which makes them an independent record of
   what the database should contain — the one cross-check that does not rely on
   Cloudflare being right about its own state.

## What a restore does not cover

- **Cloudflare account loss.** Time Travel lives inside the account. The
  independent copies are `data/snapshots/*.json` and `data/review/` in git:
  enough to rebuild the corpus and every human grading decision, not enough to
  rebuild users or roles. Those are recreated with `npm run create-admin`.
- **A bad migration.** Restoring to before it also discards everything since.
  The migration ledger (`schema_migrations`) is what makes a forward fix
  possible instead.
- **Anything older than 30 days.**

## The drill

Worth doing once, and worth writing the date here afterwards:

1. Note the current article count from `/api/health`.
2. `time-travel info`, pick a timestamp from an hour ago.
3. `restore --dry-run`, read the output.
4. Decide whether to run it for real against production, or to create a throwaway
   D1 database and practise there. **Practising on a copy is the right answer**
   unless the data is genuinely disposable.

_Last performed: never._
