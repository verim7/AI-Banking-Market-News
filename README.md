# AI Banking Market News

Tracks AI use cases in banking and financial services worldwide, so the Market
Lens is fed by a pipeline rather than by manual searching.

A daily job reads consultancy studies, regulator publications, bank newsrooms
and GDELT; classifies each article by **region**, **banking area**, **bank
category** and **AI use case**; and publishes it to a portal where a small team
can browse, favourite, triage and export.

```
GitHub Actions (daily, free)
   │  fetch RSS + GDELT → dedupe → classify → [optional Claude enrichment]
   ├──────────────► Cloudflare D1  ◄──── Hono API on a Worker ◄─── React SPA
   │                                          │                   (static assets)
   └──────────────► data/snapshots/*.json     └──► CSV / Excel export
                    git-versioned archive
```

## What it costs

**Nothing.** The whole stack sits inside free tiers, with room to spare for a
team of five or six.

| Service | Free allowance | What this uses |
|---|---|---|
| Workers requests | 100,000 / day | ~3,000 / day at six users |
| Worker size | 3 MiB | **125 KiB** — checked in CI |
| Worker CPU | 10 ms / request | D1 time is I/O, not CPU |
| Static assets | 20,000 files | ~30 |
| D1 storage | 5 GB | years of articles |
| D1 rows read | 5,000,000 / day | thousands |
| D1 rows written | 100,000 / day | ~300 / day |
| GitHub Actions (private repo) | 2,000 min / month | ~90 |
| GDELT API | free, no key | — |

Two things would cost money, and neither is required:

- **Claude enrichment** — better summaries and tagging. Claude Haiku 4.5 is
  $1.00 per million input tokens and $5.00 per million output, so roughly
  **$6–9/month** at a few hundred articles a day. It is off unless
  `ANTHROPIC_API_KEY` is set; without it the rules classifier runs alone.
- **A custom domain** (~$10/yr) if `*.workers.dev` is not good enough.

### Why not Next.js

Next.js on Workers needs the $5/month paid plan — it exceeds both the 3 MiB
Worker size cap and the 10 ms CPU budget of the free plan. A React SPA served as
static assets plus a Hono API costs nothing and does the same job here, because
this is an internal tool that needs no server-side rendering.

### Why ingestion runs in GitHub Actions

The free-plan Cron Trigger is capped at **10 ms CPU**, which is nowhere near
enough to parse fifty RSS feeds. Actions has no such limit, and it lets each run
commit a JSON snapshot to `data/`, giving a git-versioned archive alongside the
database.

## Setup

Prerequisites: Node 22+, a Cloudflare account, and this repository cloned.

### 1. Create the database

```bash
npm install
npx wrangler login
npx wrangler d1 create portal
```

Copy the `database_id` it prints into `wrangler.toml`, then create the schema:

```bash
npm run db:remote      # schema + roles and permissions
```

### 2. Set the session secret

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

### 3. Create the first administrator

No user is seeded — a default password in a git repository is a backdoor, not a
convenience. The password is hashed on your machine; only the hash reaches the
database.

```bash
npm run create-admin -- --email you@example.com --remote --apply
```

### 4. Deploy

```bash
npm run deploy
```

The portal is then at `https://ai-banking-market-news.<your-subdomain>.workers.dev`.
Add your colleagues from the **Admin** tab.

### 5. Turn on the daily ingest

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Required | What for |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | yes | deploy and ingest |
| `CLOUDFLARE_API_TOKEN` | yes | needs *D1 Edit* and *Workers Scripts Edit* |
| `D1_DATABASE_ID` | yes | the id from step 1 |
| `ANTHROPIC_API_KEY` | no | omit to stay free |

`.github/workflows/ingest.yml` then runs daily at 04:20 UTC. Trigger it once by
hand from the Actions tab to confirm it works.

> Scheduled workflows only run on the default branch, and GitHub disables a
> schedule after 60 days without repository activity. The daily snapshot commits
> keep it alive, but a long quiet spell is worth checking on.

## The tabs

| Tab | What it does |
|---|---|
| **Market Lens** | The global view — coverage over time plus breakdowns by region, banking area, bank category and use case |
| **News** | The last seven days |
| **Archive** | Everything ever ingested, searchable, including low-scoring items |
| **Favorites** | Per-user starred articles |
| **HIL Checker** | Triage queue: relevant / not relevant / undecided, bulk actions, and CSV + Excel export |
| **Admin** | Users, roles, permissions, visibility scopes and source health |

## Roles and visibility

Permissions decide what someone may **do**; scopes decide what they may **see**.
Both are enforced in SQL, in the `WHERE` clause — never by hiding things in the
UI.

- A role with **no scopes** sees everything.
- Within a dimension, values are OR-ed — `region ∈ {Switzerland, Germany}`.
- Across dimensions they are AND-ed — `region = Switzerland AND area = Retail`.
- Across a user's roles the results are UNION-ed, so adding a role can only ever
  widen access.

Three roles ship by default: Administrator, Analyst and Viewer. Create more in
the Admin tab — that is what *"adding new roles within the website"* means here.

## How relevance is scored

An article scores zero unless it mentions **both** AI and banking. "AI" alone
pulls in the whole tech press; "banking" alone pulls in the whole financial
press. The intersection is the product.

Beyond that gate, points come from term matches, both topics appearing in the
headline, study signals, a named use case, publisher credibility (a consultancy
study outranks a news blurb) and recency. **Every point awarded is recorded**,
so hovering a score in the HIL Checker shows exactly why the article surfaced. A
score nobody can argue with is a score nobody can improve.

Tune it in `packages/shared/src/classify.ts`; the taxonomy and its keywords live
in `packages/shared/src/taxonomy.ts`.

## Sources

`packages/ingest/src/sources.yaml` — consultancies first (McKinsey, BCG,
Deloitte, Accenture, EY, KPMG, PwC, Capgemini, Oliver Wyman), then regulators
and central banks (MAS, FINMA, SNB, BaFin, Bundesbank, ECB, EBA, Fed, OCC, FCA,
BIS), bank newsrooms, industry media, and GDELT for worldwide coverage.

**Check them before you trust them.** RSS endpoints go stale, and this list has
not been validated against the live web:

```bash
npm run ingest -- --check
```

That fetches every source and reports which ones actually returned parseable
items, writing nothing. Prune or fix whatever fails. A failing source never
fails the run — each is fetched independently and its outcome recorded in
`ingest_runs`, visible in the Admin tab.

## Working on it

```bash
npm test                         # 84 unit tests, offline
npm run typecheck                # all four packages plus the tests
npm run ingest -- --check        # validate every source, write nothing
npm run ingest -- --dry-run      # full pipeline, no writes

npm run db:local                 # local database
npm run dev                      # SPA + Worker at http://localhost:8787
```

End-to-end browser tests are in `e2e/` — see `e2e/README.md`.

## Layout

| Path | What it is |
|---|---|
| `packages/shared/` | taxonomy, types and the classifier — shared by ingest and Worker |
| `packages/ingest/` | RSS + GDELT fetchers, normaliser, D1 loader, CLI |
| `packages/worker/` | Hono API: auth, RBAC, articles, favourites, HIL, admin |
| `packages/web/` | React SPA |
| `db/` | schema migration and the roles/permissions seed |
| `data/snapshots/` | one JSON snapshot per ingest run |
| `e2e/` | Playwright smoke test and its fixtures |

## Notes on the security model

- Passwords are PBKDF2-SHA256 at 210,000 iterations via WebCrypto (Argon2id has
  no WebCrypto implementation, and a WASM build is the wrong trade inside a
  3 MiB Worker budget).
- Sessions are HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Strict`.
- Login answers identically for an unknown email and a wrong password, so it
  cannot be used to enumerate accounts.
- A password reset ends that user's existing sessions.
- The last administrator cannot remove their own admin role.
- CSV export quotes any field starting with `=`, `+`, `-` or `@`, so a news
  headline cannot become a formula when Excel opens it.
- Export is built from the same scoped query as the list: a user cannot export
  by id something their scope hides.
