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
{
  printf 'SESSION_SECRET=%s\n' "$(head -c 32 /dev/urandom | base64)"
  # Every test signs in, and the login limiter allows five attempts per IP per
  # fifteen minutes. Without these the worker answers 429 part-way through the
  # run and a different handful of tests fails each time — see below.
  printf 'RATE_LIMIT_LOGIN=500\n'
  printf 'RATE_LIMIT_API=20000\n'
} > .dev.vars
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
- **A scatter of failures that pass when run alone is almost always the rate
  limiter, not timing.** This was misread as flakiness for two days. Every test
  signs in; `LOGIN_RULE` allows five sign-ins per address per fifteen minutes
  and `API_RULE` three hundred requests a minute, and a forty-seven-test run
  from one address exceeds both. The worker answers 429, Playwright waits ten
  seconds for a response that will never be what it wants, and which tests fall
  over depends on where in the run the budget ran out.

  `RATE_LIMIT_LOGIN` and `RATE_LIMIT_API` above are the fix. To confirm the
  diagnosis on any future scatter, count them:
  `grep -c 429 /tmp/wrangler.log` — it should be zero.

**This suite does not run in CI.** It needs a database, a built SPA and a live
Worker, so `ci.yml` does not attempt it — which means a test can stay red for
days without anyone finding out. That is not hypothetical: hardening
`/api/health` to withhold its diagnosis from anonymous callers broke the
SPA-fallback test, and nothing said so until someone ran this by hand.
