# End-to-end smoke test

Drives the real Worker against a real local D1 — no mocks — so it exercises
auth, scoping, filtering and export the way a browser will in production.

## Prepare a local database

```bash
npm run db:local                      # schema + roles/permissions
npm run create-admin -- --email admin@example.com --password 'smoke-test-password-1' --apply
npx wrangler d1 execute portal --local --file=e2e/fixtures.sql --yes
```

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
