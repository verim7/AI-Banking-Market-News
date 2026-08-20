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
app.get('/api/health', async (c) => {
  const sessionSecret = typeof c.env.SESSION_SECRET === 'string' && c.env.SESSION_SECRET.length > 0;

  let database: 'ok' | 'missing-tables' | 'unreachable' = 'ok';
  let users: number | null = null;
  try {
    const row = await c.env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>();
    users = row?.n ?? 0;
  } catch (err) {
    database = /no such table/i.test(String(err)) ? 'missing-tables' : 'unreachable';
  }

  const ok = sessionSecret && database === 'ok' && (users ?? 0) > 0;

  const hint = ok ? null
    : !sessionSecret ? 'SESSION_SECRET is not set. Setup step 10.'
    : database === 'missing-tables' ? 'The database has no tables. Run: npm run db:remote (setup step 9).'
    : database === 'unreachable' ? 'The database could not be reached. Check database_id in wrangler.toml.'
    : 'No users exist yet. Run: npm run create-admin (setup step 11).';

  return c.json({ ok, sessionSecret, database, users, hint });
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

app.onError((err, c) => {
  // Log the detail, return a generic message: stack traces are a gift to an
  // attacker and useless to a user.
  console.error('Unhandled error:', err);
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
