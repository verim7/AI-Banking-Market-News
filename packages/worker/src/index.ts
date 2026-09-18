import { Hono } from 'hono';
import { requireAuth } from './middleware.ts';
import { API_RULE, clientKey, consume, sweep } from './rate-limit.ts';
import { loadUserContext } from './context.ts';
import { authRoutes } from './routes/auth.ts';
import { articleRoutes } from './routes/articles.ts';
import { favoriteRoutes } from './routes/favorites.ts';
import { hilRoutes } from './routes/hil.ts';
import { adminRoutes } from './routes/admin.ts';
import type { AppEnv } from './types.ts';

const app = new Hono<AppEnv>();

/**
 * Security headers. The CSP is deliberately strict: this app loads no third
 * party scripts, fonts or images, so anything trying to is a bug or an attack.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
});

/**
 * A ceiling on every API request, not a policy.
 *
 * This is not meant to shape normal use — clicking through filters easily makes
 * thirty requests a minute — only to stop a runaway client or a scraper from
 * spending the whole CPU budget. The strict limit that actually matters is on
 * the login route, where a single request is expensive by design.
 *
 * Static assets are served before the Worker runs, so they never reach this and
 * a page load does not spend the allowance.
 */
app.use('/api/*', async (c, next) => {
  const ip = clientKey(c.req.raw);
  const limited = await consume(c.env, `api:${ip}`, API_RULE);

  // Swept here rather than on a schedule: a Cron trigger to tidy a table this
  // small is more machinery than the problem is worth. One request in roughly
  // two hundred pays for it.
  if (Math.random() < 0.005) {
    c.executionCtx.waitUntil(
      sweep(c.env, new Date(Date.now() - 24 * 3600 * 1000)).catch(() => {}));
  }

  if (!limited.allowed) {
    c.header('Retry-After', String(limited.retryAfter));
    return c.json({ error: 'Too many requests. Slow down and try again shortly.' }, 429);
  }
  return next();
});

/**
 * Readiness, not liveness.
 *
 * A page that renders but cannot log anyone in is the confusing failure mode
 * here: static assets are served before the Worker runs, so the site looks
 * healthy while the database or the session key is missing.
 *
 * Every table is checked, not just one. `users` is the fifth of fourteen the
 * migration creates, so a run that stopped partway leaves `users` present and
 * `sessions` absent — which reported "ok" here while login died inserting a
 * session. Asking sqlite_master for the whole set is the only answer worth
 * trusting.
 *
 * Names and counts only: no secret value, and no row content.
 */
export const REQUIRED_TABLES = [
  'sources', 'articles', 'article_tags', 'article_scores',
  'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  'role_scopes', 'sessions', 'favorites', 'hil_decisions', 'ingest_runs',
  'article_reviews',
];

/**
 * Columns added by a later migration than the one that created the table.
 *
 * A table check alone cannot see a half-migrated database, and that is the
 * failure this deployment actually hit: `article_scores` existed, so health
 * reported "ok", while every article query selected `use_case_evidence` from a
 * table that had never been migrated to have it. The site answered 500 on its
 * main view and said nothing about why.
 *
 * Anything a query selects but an earlier migration did not create belongs
 * here, so a forgotten migration is named on this endpoint instead of
 * discovered by a user.
 */
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  article_scores: ['ai_intensity', 'maturity', 'maturity_evidence',
                   'use_case_evidence', 'summary_extract',
                   'ch_nexus', 'ch_nexus_evidence'],
  article_reviews: ['grade', 'headline', 'evidence'],
};

app.get('/api/health', async (c) => {
  const sessionSecret = typeof c.env.SESSION_SECRET === 'string' && c.env.SESSION_SECRET.length > 0;

  let database: 'ok' | 'missing-tables' | 'missing-columns' | 'unreachable' = 'ok';
  let missingTables: string[] = [];
  let missingColumns: string[] = [];
  let users: number | null = null;
  let roles: number | null = null;

  try {
    const { results } = await c.env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all<{ name: string }>();
    const present = new Set((results ?? []).map((r) => r.name));
    missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));

    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      if (!present.has(table)) continue;
      const info = await c.env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const have = new Set((info.results ?? []).map((r) => r.name));
      for (const column of columns) {
        if (!have.has(column)) missingColumns.push(`${table}.${column}`);
      }
    }

    if (missingTables.length > 0) {
      database = 'missing-tables';
    } else if (missingColumns.length > 0) {
      database = 'missing-columns';
    } else {
      users = (await c.env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
      roles = (await c.env.DB.prepare('SELECT count(*) AS n FROM roles').first<{ n: number }>())?.n ?? 0;
    }
  } catch {
    database = 'unreachable';
  }

  const ok = sessionSecret && database === 'ok' && (users ?? 0) > 0 && (roles ?? 0) > 0;

  const hint = ok ? null
    : !sessionSecret ? 'SESSION_SECRET is not set. Setup step 10.'
    : database === 'unreachable' ? 'The database could not be reached. Check database_id in wrangler.toml.'
    : missingTables.length > 0
      ? `The database is missing ${missingTables.length} table(s): ${missingTables.join(', ')}. `
        + 'Re-run: npm run db:remote (setup step 9), and check it finishes without errors.'
    : missingColumns.length > 0
      ? `The database is behind the code: ${missingColumns.join(', ')} missing. `
        + 'A migration has not been applied. Run the "Migrate database" action, then reload.'
    : (roles ?? 0) === 0
      ? 'Tables exist but the roles were never seeded. Re-run: npm run db:remote (setup step 9).'
    : 'No users exist yet. Run: npm run create-admin (setup step 11).';

  /*
   * Detail for the people who own the deployment; a yes or no for everyone
   * else.
   *
   * This endpoint cannot require a session, because the failure it exists to
   * diagnose is "nobody can log in". But the full answer names every table,
   * every missing column, whether the session key is set, and how many users
   * exist — reconnaissance for anyone who asks, and the cost of asking is
   * sixteen database queries at the other end.
   *
   * So: the diagnosis goes to someone with a valid session, or to a caller who
   * knows SETUP_TOKEN — which is what an operator has during the setup that has
   * not finished yet. An anonymous caller gets the one bit that is genuinely
   * public, since anyone can already tell a broken site is broken.
   */
  const token = c.req.header('x-setup-token');
  const operator = Boolean(token && c.env.SETUP_TOKEN && token === c.env.SETUP_TOKEN)
    || Boolean(await loadUserContext(c.req.raw, c.env));

  if (!operator) return c.json({ ok });

  return c.json({ ok, sessionSecret, database, missingTables, missingColumns, users, roles, hint });
});

app.route('/api/auth', authRoutes);

// Everything below requires a session. Mounting the guard on the prefix rather
// than per-route means a new endpoint is protected by default.
app.use('/api/articles/*', requireAuth);
app.use('/api/favorites/*', requireAuth);
app.use('/api/hil/*', requireAuth);
app.use('/api/admin/*', requireAuth);

app.route('/api/articles', articleRoutes);
app.route('/api/favorites', favoriteRoutes);
app.route('/api/hil', hilRoutes);
app.route('/api/admin', adminRoutes);

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

/**
 * Configuration faults name themselves; everything else stays opaque.
 *
 * A blanket "internal error" is right for a bug in request handling — a stack
 * trace helps an attacker and not a user. It is wrong for a half-finished
 * setup, where the message *is* the fix and the person reading it owns the
 * deployment. So the setup-shaped errors are passed through: a missing table
 * or column names schema, not data, and anyone who can reach this endpoint can
 * already tell the app is broken.
 */
const SETUP_ERROR = /no such table|no such column|D1_ERROR|not authorized|Database .* not found/i;

app.onError(async (err, c) => {
  // Logged in full either way, so the detail is never actually lost — it moves
  // from the response body to the place that is already access-controlled.
  const ref = crypto.randomUUID().slice(0, 8);
  console.error(`Unhandled error [${ref}]:`, err);

  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';

  if (SETUP_ERROR.test(message)) {
    return c.json({
      error: `Setup problem: ${message.slice(0, 200)}`,
      hint: 'Open /api/health, then re-run the setup step it names.',
    }, 503);
  }

  /*
   * The message, never the stack — and only for someone who has signed in.
   *
   * The original reasoning still holds and is worth keeping: "internal error"
   * cost several rounds of guessing at a fault the exception names outright,
   * and telling the owner of a private tool to go read Cloudflare's live tail
   * is a worse experience for the person who most needs the answer.
   *
   * What that argument missed is that this handler also answers people who are
   * *not* signed in. So the detail now follows the session, and everyone else
   * gets a reference that appears verbatim in the logs — which keeps the
   * debugging path short for whoever owns the deployment without narrating
   * internals to anyone who can reach the URL.
   */
  const known = await loadUserContext(c.req.raw, c.env).catch(() => null);
  if (known) return c.json({ error: `${name}: ${message.slice(0, 300)}`, ref }, 500);

  return c.json({
    error: 'Internal error.',
    ref,
    hint: `Sign in, or quote reference ${ref} to whoever runs this deployment.`,
  }, 500);
});

/**
 * Everything else is the single-page app. Unknown paths fall back to
 * index.html so client-side routes survive a refresh.
 */
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), c.req.raw));
});

export default app;
