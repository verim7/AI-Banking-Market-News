# Security checklist

Ten checks from "Securitymaxxing knowledge (vibecode edition) pt. 3" (@millee.md,
July 2026), plus six for a tracker that shows outside news and uses AI. The rule
of thumb from the reel: fewer than 7 passes, fix before shipping.

It sits beside the other security documents:

- `docs/data-classification.md`: what may live in this public repository
- `docs/disaster-recovery.md`: restoring the database
- README, "Notes on the security model": how login and sessions are built

**Last checked: 29 Sep 2026.** Every status was tested, not assumed:

- the code, and all 147 commits of its history, scanned for keys
- the built website scanned for secrets
- a local copy of the site attacked the way an outsider would
- the live site could not be reached from the checking machine, so nothing here was tested against it

✅ pass · ⚠️ needs an action by the owner · ❌ fail · ➖ not applicable

## The ten checks

| # | Check | Status | What was found |
|---|---|---|---|
| 1 | **HTTPS is enforced** | ⚠️ one switch | Cloudflare serves the site over HTTPS only with its own certificate. Since 29 Sep, every response, static files included, carries `Strict-Transport-Security` for a year (`packages/web/public/_headers`, `packages/worker/src/index.ts`). The CSP allows only the site's own files, so there is no mixed content. **Owner:** turn on Cloudflare → ai-banking-brief.com → SSL/TLS → Edge Certificates → **Always Use HTTPS**, so a typed `http://` address is redirected. The Worker cannot do it itself: locally, Wrangler presents requests under the production host name. |
| 2 | **Passwords are stored as hashes** | ✅ | PBKDF2-SHA256, 100,000 iterations (the Workers ceiling), a random salt per user, constant-time comparison. Stored as `password_hash` and `password_salt`, never the password. Argon2id has no WebCrypto implementation (see `packages/worker/src/auth.ts`). |
| 3 | **Bot protection on sign-up and public forms** | ✅ | There is no sign-up and no public form: an administrator creates each account. Sign-in is throttled per address and email. Tested: after 5 wrong passwords the account is locked for 15 minutes, even with the right password, while a colleague's account on the same network still signs in. Every other API call is capped at 300 a minute per address. No CAPTCHA: with no public sign-up, it would add friction and stop nothing the lock does not. |
| 4 | **Login sessions expire** | ✅ | Sessions live in the database and end after 14 days. They end at once on sign-out, a password change or a deactivated account (checked on every request). The cookie is `HttpOnly`, `Secure`, `SameSite=Strict` and signed. 14 days is longer than the reel's one hour, deliberately: colleagues open the tracker once a week from the email. `SESSION_TTL_DAYS` in `auth.ts` shortens it. |
| 5 | **CSRF protection** | ✅ | The cookie is `SameSite=Strict`, so a browser never attaches it to a request another site starts. Since 29 Sep, a second lock: any POST, PUT, PATCH or DELETE that the browser marks as cross-site, or whose Origin names another host, is refused before it reaches the app, sign-in included (`isCrossSite` in `packages/worker/src/canonical.ts`). Tested: a cross-site change request answered 403 and the app's own requests 200. |
| 6 | **Password-reset links expire and work once** | ➖ | There are no reset links, so there is nothing to steal from an inbox. An administrator sets a new password in Admin, which also signs that user out everywhere. The email tells colleagues who to write to. |
| 7 | **The app's database key is limited** | ⚠️ check | The website reaches the database only through Cloudflare's binding, which opens this one database and nothing else, and the browser never sees a key. Two keys live in GitHub secrets. **Owner:** confirm both are narrow. `CLOUDFLARE_API_TOKEN` should be a custom token for this account with only *D1: Edit* and *Workers Scripts: Edit*, not the Global API Key. `RESEND_API_KEY` should be a *Sending access* key limited to `mail.ai-banking-brief.com`, not *Full access*. |
| 8 | **Logs hold no passwords, tokens or card numbers** | ✅ | The Worker logs only an error reference. GitHub masks secrets in Actions logs, and those logs are **public** for a public repository. One gap was found and closed on 29 Sep: an email refusal could quote a recipient's address, and GitHub masks a secret only as a whole, not one address out of a list. Addresses are now masked before anything is printed (`redactAddresses`, `packages/ingest/src/digest/send.ts`). The digest logs a count of recipients, never who they are. |
| 9 | **Billing alerts are on** | ⚠️ owner | Nothing in the code can do this. **Owner:** (1) Cloudflare → Billing → confirm the plan is Free, whose limits stop the service rather than charge; if it is Paid, add a usage notification. (2) Resend → Usage: the free tier stops at its daily and monthly caps, so check you are on it. (3) Turn on auto-renew for `ai-banking-brief.com`, so the domain, and with it the sender and the tracker's address, cannot lapse. (4) The Routines run on your Claude plan, with no API key and so nothing to overspend. |
| 10 | **Automated backups** | ⚠️ test restore | D1 Time Travel keeps a restorable history of the database automatically, and the articles are also committed to this repository every day. But **a restore has never been tried**, and one that has never run doesn't count (`docs/disaster-recovery.md`). **Owner, once:** run the `--dry-run` restore there and see real rows come back. |

**Score: 6 ✅, 1 ➖, 3 ⚠️.** Each ⚠️ is a setting in a dashboard, not code. With the
three done, it is 9 of 9 applicable.

## Beyond the reel: a tracker that shows outside news and uses AI

| # | Check | Status | What was found |
|---|---|---|---|
| 11 | **No secrets in the website or the repository** | ✅ | All 147 commits scanned for Resend, OpenAI, Anthropic, GitHub, AWS and Google keys, private keys and bearer tokens: none. The built website contains no secret or secret name. Keys live only in GitHub and Cloudflare secrets. `.env` and `.dev.vars` are ignored by git. No address of the editor or a colleague appears anywhere. One journalist's published byline address sits in a graded excerpt (see `docs/data-classification.md`). |
| 12 | **Outside content is shown as text** (XSS) | ✅ | React writes every title, summary and quote as text. The only raw HTML shown is the email preview, inside an iframe with an empty `sandbox`: no scripts, no forms, nothing. The email escapes every value it prints. A strict Content-Security-Policy is on every response, static files included since 29 Sep. |
| 13 | **Prompt injection** | ✅ | The Routines read scraped articles. Since 29 Sep, `data/review/RUBRIC.md`, which the Routine reads before every pass, says article text is data, never instructions. What could go wrong is checked by code, not trusted to the model. An A grade needs a quote found word for word in the article (`review-apply` refuses otherwise). The summary must pass `validateDigest`: every name and number traced to a cited article. Nothing reaches colleagues until the editor approves it. No client or Synpulse-internal data is sent to any AI service. |
| 14 | **Dependencies kept up to date** | ✅ | Dependabot opens update requests (`.github/dependabot.yml`). `npm audit` shows one high advisory, in `xlsx`, which concerns reading spreadsheets: the app only writes them, and its one parser was replaced for that reason (`packages/web/src/lib/csv-parse.ts`). The three moderate advisories are in test and build tools that never reach the website. |
| 15 | **Access control** | ✅ | Every data endpoint needs a signed-in user with the right permission. Tested as a non-administrator: every admin endpoint answered 403, including an attempt to give oneself the admin role. An article outside the user's region answered 404. A SQL injection attempt in search changed nothing: every value is a bound parameter. Archive, Review Queue and Admin are for administrators only. The logos, fonts and page shell are public files, like on any website. |
| 16 | **Logo and brand usage** | ⚠️ owner | Of the 96 logos in `packages/web/public/logos`, 80 are public domain, 4 are Creative Commons (credited in `docs/logo-sources.json`), and **12 are marked fair use**: ANZ, Bank of Baroda, Bank of Georgia, Barclays, Groupe BPCE, ING, Lloyds, NatWest, Rabobank, RBC, Standard Bank, UBS. They are shown to signed-in colleagues and in an internal email. They are also in this public repository and on the public logo path. **Owner:** keep the tracker internal, or replace those twelve before sharing it wider. |

## Also fixed on 29 Sep

- **Workflow inputs.** Several GitHub workflows pasted typed-in values (dates, limits) straight into shell commands. Someone able to run a workflow could have typed a command instead of a date. Only the owner can run them, but they now read their inputs from environment variables, and the digest also checks the date's format.
- **Token rights.** Eight workflows ran with the repository's default token rights. Each now asks only for what it needs: read, or write for the one that commits grades.

## Owner actions, in one place

1. Cloudflare: **Always Use HTTPS** on for ai-banking-brief.com (item 1).
2. GitHub secrets: check that `CLOUDFLARE_API_TOKEN` and `RESEND_API_KEY` are narrow (item 7).
3. Billing: confirm the Free plans, and turn on domain auto-renew (item 9).
4. Try one dry-run restore (item 10).
5. GitHub → Settings → Code security: turn on **Secret scanning** and **Push protection**, free for public repositories, so a key pasted by mistake is blocked before it is published.
6. Decide on the twelve fair-use logos before any wider sharing (item 16).
