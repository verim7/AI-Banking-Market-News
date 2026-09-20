# End-to-end smoke test

Drives the real Worker against a real local D1 — no mocks — so it exercises
auth, scoping, filtering and export the way a browser will in production.

## Prepare a local database

```bash
npm run db:local                      # schema + roles/permissions
npm run create-admin -- --email admin@example.com --password 'smoke-test-password-1' --apply
npx wrangler d1 execute portal --local --file=e2e/fixtures.sql --yes

# Login needs a signing key, and `wrangler dev` does not read production
# secrets. Without this every test fails at the sign-in screen with
# "SESSION_SECRET is not set (setup step 10)" — which is the app diagnosing
# itself correctly, and looks like a broken test suite.
printf 'SESSION_SECRET=%s\n' "$(head -c 32 /dev/urandom | base64)" > .dev.vars
```

`.dev.vars` is gitignored. It is a local development key and has nothing to do
with the deployed one.

`fixtures.sql` also creates a `ch@example.com` analyst restricted to
Switzerland, which is what the scope test asserts against.

## Run

```bash
npm run build:web
npx wrangler dev --port 8787 &
npx playwright test
```

If the machine already has a Chromium that Playwright did not install, point at
it rather than downloading another copy:

```bash
CHROMIUM_PATH=/path/to/chrome npx playwright test
```

The tests share one database and therefore run single-file (`workers: 1`). They
are written to be re-runnable: anything that mutates state resets it first.

Two things worth knowing before you trust a red run:

- **Re-runnable is not the same as clean.** `hil_decisions` and `favorites`
  accumulate across runs, and enough of it will fail tests that have nothing to
  do with what you changed. Reset with
  `npx wrangler d1 execute portal --local --yes --command "DELETE FROM hil_decisions; DELETE FROM favorites;"`
  then re-apply `fixtures.sql`.
- **Roughly one test per full run fails on timing** on a slow machine, and it is
  a different test each time. A single failure that passes when run alone with
  `-g` is that; a failure that reproduces alone is real.

**This suite does not run in CI.** It needs a database, a built SPA and a live
Worker, so `ci.yml` does not attempt it — which means a test can stay red for
days without anyone finding out. That is not hypothetical: hardening
`/api/health` to withhold its diagnosis from anonymous callers broke the
SPA-fallback test, and nothing said so until someone ran this by hand.
