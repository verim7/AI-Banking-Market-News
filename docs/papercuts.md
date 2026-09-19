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
