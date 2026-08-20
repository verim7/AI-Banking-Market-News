import { Hono } from 'hono';
import { requireAuth } from './middleware.ts';
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
 * Readiness, not liveness.
 *
 * A page that renders but cannot log anyone in is the confusing failure mode
 * here, because the static assets are served before the Worker runs — so the
 * site looks fine while the database or the session key is missing. This
 * reports which, and is the first thing to open when login misbehaves.
 *
 * Booleans and counts only: it never returns a secret's value, and the
 * deployment is a private internal tool.
 */
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
const REQUIRED_TABLES = [
  'sources', 'articles', 'article_tags', 'article_scores',
  'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  'role_scopes', 'sessions', 'favorites', 'hil_decisions', 'ingest_runs',
];

app.get('/api/health', async (c) => {
  const sessionSecret = typeof c.env.SESSION_SECRET === 'string' && c.env.SESSION_SECRET.length > 0;

  let database: 'ok' | 'missing-tables' | 'unreachable' = 'ok';
  let missingTables: string[] = [];
  let users: number | null = null;
  let roles: number | null = null;

  try {
    const { results } = await c.env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all<{ name: string }>();
    const present = new Set((results ?? []).map((r) => r.name));
    missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));

    if (missingTables.length > 0) {
      database = 'missing-tables';
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
    : (roles ?? 0) === 0
      ? 'Tables exist but the roles were never seeded. Re-run: npm run db:remote (setup step 9).'
    : 'No users exist yet. Run: npm run create-admin (setup step 11).';

  return c.json({ ok, sessionSecret, database, missingTables, users, roles, hint });
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

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  const message = err instanceof Error ? err.message : String(err);

  if (SETUP_ERROR.test(message)) {
    return c.json({
      error: `Setup problem: ${message.slice(0, 200)}`,
      hint: 'Open /api/health, then re-run the setup step it names.',
    }, 503);
  }
  return c.json({ error: 'internal error' }, 500);
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
