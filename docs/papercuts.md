# Papercuts

Anything that slowed development down, so the next session does not lose the
same hour. **Check this file first when tooling fails mysteriously.**

Format: `date · symptom · fix · project`.

Append when you lose time to one — while it is fresh, not at the end of the
session. An entry nobody writes down is an hour somebody pays for twice.

> **Why this lives in the repo and not in `~/code/`.**
> The original recipe puts it in the home directory so every session shares
> one global log. That works on a laptop. These sessions run in a container
> that is reclaimed after a period of inactivity, so a file under `$HOME`
> would be empty every time and the log would never accumulate — which is the
> one thing it exists to do. Committed to the repo it survives; the cost is
> that it is per-repo rather than global.

---

## 2026-09-18 · A workflow reported success while writing nothing

**Symptom.** `review-apply` refused an invalid batch, printed "Nothing was
written", and set exit code 1. The GitHub Actions step was green. 43 gradings
were believed applied for a day; it surfaced only because the next export
handed the same articles back.

**Cause.** The step is `npm run review:apply ... | tee apply.log`. A bash
pipeline returns the exit status of its **last** command — `tee`, which always
succeeds. Demonstrate it: `false | tee /dev/null; echo $?` prints `0`.

**Fix.** `defaults: run: shell: bash` at workflow level. That is GitHub's
shorthand for `bash --noprofile --norc -eo pipefail`, which makes the pipe
report the real status. Eight workflows here had the same pattern.

**Wider lesson.** Any `cmd | tee` in CI is a silent-failure generator. Grep for
it before trusting a green run.

*Project: ai-banking-market-news*

---

## 2026-09-18 · `ui.shadcn.com` is blocked by the egress proxy

**Symptom.** `npx shadcn@latest add button` fails with
`Request to https://ui.shadcn.com/r/styles/new-york/button.json failed`.

**Cause.** Organisation network policy. `curl` confirms it:
`CONNECT tunnel failed, response 403`, and
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` lists it under
`recentRelayFailures` as `connect_rejected`. This is a **policy denial, not a
transient error** — do not retry it, and do not look for a way around it.

**Fix.** None available from inside the sandbox. npm itself is reachable
(it is in the proxy's `noProxy` list), so dependencies install fine; only the
shadcn *registry* is out of reach. The component files have to be fetched on a
machine with ordinary internet and committed. The shadcn CLI package does not
bundle component source — it is purely a fetcher — so there is no npm-side
workaround.

*Project: ai-banking-market-news*

---

## 2026-09-18 · The deployed app cannot be reached from the sandbox either

**Symptom.** `curl https://<worker>.workers.dev/api/health` returns nothing;
exit 56.

**Cause.** Same proxy policy as above — `*.workers.dev` is blocked.

**Fix.** Verify deployments through side effects instead: query D1 directly
with the Cloudflare MCP tools, or read the workflow logs. **Watch out for a
trap here:** `curl -D-` still prints headers *from the proxy's own 403 page*.
Seeing `X-Content-Type-Options: nosniff` come back does not mean the app sent
it. A failed check must be read as failed, not as a pass.

*Project: ai-banking-market-news*

---

## 2026-09-18 · Tailwind's `--radius-sm` collides with an app token of the same name

**Symptom.** Nothing. That is what makes it worth recording — the generated CSS
contained `--radius-sm: var(--radius-sm)`, a declaration referring to itself,
and the page looked correct anyway because the app's own `--radius-sm: 4px`
happened to resolve it.

**Cause.** `@theme inline { --radius-sm: var(--radius-sm); }`. Tailwind's theme
key for a small radius is spelled exactly like the token this app already had.

**Fix.** Derive it instead: `--radius-sm: calc(var(--radius) - 4px)`. Check the
built CSS with `grep -o "\-\-radius[a-z-]*:[^;]*;" packages/web/dist/assets/*.css`
after any `@theme` change — a self-reference is invisible in the source.

*Project: ai-banking-market-news*

---

## 2026-09-18 · `components.json` rejected with no explanation

**Symptom.** `Invalid configuration found in components.json` and nothing else.

**Cause.** A guessed `base` key. It is an `init` **flag**, not a config field.

**Fix.** Read the real schema rather than guessing:
`npm pack shadcn@latest`, unpack, and look at `package/dist/schema/index.d.ts`
for `rawConfigSchema`. Faster than three rounds of trial and error, and it is
the current version rather than a remembered one.

*Project: ai-banking-market-news*

---

## 2026-09-19 · deployed site was a black page, every check green

**Symptom.** `ai-banking-market-news.verimajdini.workers.dev` rendered as an
empty dark rectangle. CI green, deploy green, 551 tests passing, typecheck
clean, `npm run build:web` without a warning.

**Cause.** Dependabot PR #8 raised `react` to 19.3.0 and left `react-dom` at
18.3.1. The two packages communicate through
`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`, which React 19 reshaped,
so `createRoot` threw `Cannot read properties of undefined (reading
'ReactCurrentBatchConfig')` before rendering anything. The page looked *black*
rather than blank because `index.html` carries `data-theme="dark"` — the empty
body was painted with the app's own dark background.

A second copy of the same trap was waiting: after bumping `react-dom`, a plain
`npm install` left react 18.3.1 hoisted at the root for radix and lucide while
the app resolved 19.3.0, which is two Reacts in one bundle. `npm dedupe`
collapses it; check the lockfile, not `packages/web/package.json`.

**Fix.** `react-dom` and `@types/react-dom` to 19, then `npm dedupe`. Two
guards so it cannot come back quietly: `npm run smoke:web` loads the built
bundle in a real browser and fails if `#root` stays empty (wired into `ci` and
`deploy`), and `packages/web/tests/react-pair.test.ts` fails if the two
packages' majors ever diverge in `package.json` or in the lockfile.

**The general lesson.** Every check this repo had read the source. None of them
ran it. A bundle that throws on its first line passes all of them.

*Project: ai-banking-market-news*

---

## 2026-09-19 · sleep does not pass the time in this container

**Symptom.** A GitHub Actions step looked stuck for seven minutes. It had in
fact taken twenty seconds; the run was already finished and deployed while the
API response still showed the step running.

**Cause.** Backgrounded `sleep` in this sandbox returns without the wall clock
advancing to match. Six waits totalling fourteen minutes moved `date -u` by
three seconds. The workflow data was current the whole time — the sense of
elapsed time was not.

**Fix.** Never infer a duration from how long the waiting felt. Read the clock
(`date -u`) before and after, or compare the step's own `started_at` and
`completed_at`, which are the runner's timestamps and are trustworthy. A step
that is genuinely hanging shows up as a `started_at` far behind a freshly read
`date -u`, not as impatience.

Cost here: one commit pushed to `main` whose message stated the seven minutes
as fact, corrected by the commit after it.

*Project: ai-banking-market-news*

---

## 2026-09-20 · the e2e suite had been red for a day and nothing said so

**Symptom.** First full local run of `npx playwright test` in a while: two
failures, neither related to what was being worked on.

**Cause.** One was real. Hardening `/api/health` to answer anonymous callers
with `{ok:true}` and nothing else — the right change — broke the test that
asserted `missingTables` and `missingColumns` on an unauthenticated call. It
had been failing since that commit landed, because **`ci.yml` does not run the
e2e suite**: it needs a database, a built SPA and a live Worker. Every other
check was green the whole time.

**Fix.** The test now asserts both halves: anonymous gets exactly `{ok:true}`,
and a signed-in caller still gets the full diagnosis. The second half has to be
made from inside the page — see below.

**The trap underneath it.** The session cookie is `Secure`. Chromium sends it
to `http://localhost` because localhost is a trustworthy origin; Playwright's
`APIRequestContext` does **not**, and neither `request.post(...)` + `request.get`
nor `page.request.get` will carry it. An authenticated API assertion against
the dev server has to go through `page.evaluate(() => fetch(...))`. Nothing in
the failure says "cookie" — it reads as the endpoint ignoring your session.

*Project: ai-banking-market-news*

---

## 2026-09-20 · every e2e test failed at the sign-in screen

**Symptom.** `e2e/README.md` followed exactly, and every test failed on
`getByRole('navigation', { name: 'Sections' })`. `POST /api/auth/login` was
returning 503.

**Cause.** No `SESSION_SECRET`. `wrangler dev` does not read production
secrets, and the README's setup section never mentioned it — so the documented
happy path could not produce a working login.

**Fix.** `printf 'SESSION_SECRET=%s\n' "$(head -c 32 /dev/urandom | base64)" > .dev.vars`
(gitignored), now in `e2e/README.md`.

Worth saying that the app diagnosed itself perfectly here: the response body
was *"SESSION_SECRET is not set (setup step 10). Open /api/health for details."*
The time went on assuming a test-harness problem instead of reading the 503.

*Project: ai-banking-market-news*

---

## 2026-09-21 · two days of "e2e flakiness" was the rate limiter

**Symptom.** Full Playwright runs failed a different handful of tests each
time — two, then one, then four, then seven — and every one of them passed when
run alone with `-g`. It looked exactly like timing on a slow machine, and was
written up as such in `e2e/README.md`.

**Cause.** The rate limiter added during the security work. `LOGIN_RULE` allows
**five sign-ins per address per fifteen minutes** and every test signs in;
`API_RULE` allows three hundred requests a minute and a forty-seven-test run
from `127.0.0.1` goes well past both. The worker answered 429, Playwright sat
out its ten-second timeout waiting for a response that was never going to be
the one it wanted, and which tests fell over depended only on where in the run
the budget ran out.

The limiter was working perfectly. The client was not an attacker.

**Fix.** `rulesFor(env)` lets `RATE_LIMIT_LOGIN` and `RATE_LIMIT_API` raise the
ceiling from `.dev.vars`, which is gitignored. Production sets neither and gets
the strict defaults. The override can only ever *raise* a limit and ignores
anything malformed, so a typo in a local file cannot weaken a production
control. Turning the limiter off for tests was the alternative and would have
meant the one environment that exercises every route never exercising the
middleware.

Result: 47 of 47, twice, with zero 429s — from a suite that had not had a clean
run in two days.

**The general lesson.** "Different tests fail each run, all pass alone" is the
signature of a **shared budget**, not of timing. Rate limits, connection pools,
disk quotas, API quotas. Before blaming the machine, count the 4xx:
`grep -c 429 /tmp/wrangler.log`.

*Project: ai-banking-market-news*

---

## 2026-09-21 · a hidden element makes `getByRole` assertions pass either way

**Symptom.** Putting the Market Lens's filter dropdowns behind a native
`<details>` broke one assertion and silently disarmed three others.

Playwright's `getByLabel('From')` kept working with the disclosure closed, so
the move looked free. `getByRole('button', { name: /^Use case grade:/ })` did
not: it resolved to nothing, and a `toContainText` against it failed.

The failing one was the lucky case. Three assertions in the suite read

```ts
await expect(page.getByRole('button', { name: /^Region:/ })).toHaveCount(0);
```

and they are the *point* of two tests — "a control that can only ever say one
thing is not a control", the reason the Swiss page drops Region and Type of AI.
With the dropdowns merely hidden rather than removed, all three went on passing
and could no longer fail. The change would have shipped green while deleting
the evidence for its own invariant.

**Why.** Role queries read the accessibility tree, which excludes anything
hidden by CSS. Text, label and CSS locators read the DOM, which does not. So
hiding a subtree flips `getByRole(...)` assertions from *false* to *vacuous*,
and `toHaveCount(0)` cannot tell "gone" from "not exposed".

**Fix.** An `openMoreFilters(page)` helper in front of every role assertion
about a filter, including the negative ones, with a comment at each `count(0)`
saying why it is there. It is a no-op where there is no disclosure, since the
Archive and the Review Queue still draw the bar plainly.

**The general lesson.** When a change hides UI rather than removing it, the
assertions to re-check are the ones asserting *absence*. A test that says
`toHaveCount(0)` is only as good as the guarantee that the element would have
been found had it been there — so make it fail on purpose once, before
believing it.

### The same trap, twice, in the same change-set

Having written the paragraph above, the very next test added in this work —
the masthead one — went straight back into it:

```ts
const transforms = await mast.locator('span').evaluateAll((els) =>
  els.map((el) => getComputedStyle(el).textTransform));
expect(transforms.every((t) => t === 'none')).toBe(true);   // [].every() === true

const sizes = /* … */;
expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);      // Math.min() === Infinity
```

Both pass on an **empty** match. Rename `.wordmark` and the two guarantees the
test exists for quietly disappear while it stays green. A code review found it;
the fix is one line each, asserting the count before the aggregate.

`every`, `some`, `Math.min`, `Math.max`, `reduce` with a seed — every one of
them has an answer for the empty list, and every one of those answers is the
one that looks like success. **An assertion over a collection needs an
assertion about the collection's size next to it.**

*Project: ai-banking-market-news*

---

## 2026-09-23 · the Actions API said "in_progress" for seven minutes after the job had finished

**Symptom.** `review-apply` normally takes about 35 seconds. This run sat at
`status: in_progress` with its `Apply` step unfinished through five polls over
seven minutes, while D1 still showed the old row counts. It looked like a hung
write against the D1 API.

**Cause.** It had finished in 54 seconds. The job's own step timestamps, once
they finally appeared, read `completed_at: 08:02:21` — three minutes before the
first poll that still said it was running. Both the run endpoint and the jobs
endpoint served a stale snapshot, and `updated_at` was frozen at `08:01:31`
the whole time, which is the tell: a job that is genuinely working updates
that field.

`get_job_logs` returns **HTTP 404** for a job the API believes is still in
progress, so the one call that would have settled it was the one call that
could not answer.

**Fix.** There is nothing to fix in the repo. The habit is what changes: when a
workflow that writes to D1 looks stuck, **ask D1**, not the Actions API. One
`SELECT COUNT(*), MAX(reviewed_at)` is authoritative, costs nothing, and
answers the only question that matters — did the rows land. The workflow status
is a proxy for that and a laggy one.

The general shape is the same as the first entry in this file: a green tick is
not proof the work happened, and — as this run adds — *no* tick is not proof it
did not.

*Project: ai-banking-market-news*

---

## Already captured in code comments

These were found in earlier sessions and are documented where they bite, which
is better than here. Listed so a search of this file finds them:

- **Cloudflare caps PBKDF2 at 100,000 iterations** — enforced in production,
  *not* by `workerd` locally, so it passes every local test and throws on the
  deployed Worker. See `packages/worker/src/auth.ts`.
- **Static assets are served before the Worker runs**, which silently swallowed
  every `GET /api/*` while POSTs still worked. `run_worker_first` in
  `wrangler.toml`.
- **`node:sqlite` must be loaded via `createRequire`**, or Vite tries to
  pre-bundle it. See the top of `packages/worker/tests/queries.test.ts`.
