import { Hono } from 'hono';
import {
  buildCookie, makeSessionCookieValue, randomHex, readSessionCookieValue,
  SESSION_COOKIE, SESSION_MAX_AGE, sessionExpiry, verifyPassword,
} from '../auth.ts';
import { loadUserById, loadUserContext } from '../context.ts';
import type { AppEnv } from '../types.ts';

export const authRoutes = new Hono<AppEnv>();

/**
 * A misconfigured server is not a failed login, and saying "internal error" for
 * both sends someone hunting for a bad password when the real problem is an
 * unset secret. These two checks name the missing piece and the setup step that
 * provides it. They cannot leak anything: both conditions are visible to anyone
 * who can reach the site, since neither login nor anything else works without
 * them.
 */
authRoutes.post('/login', async (c) => {
  // A body the client got wrong is a 400, not a 500. Unwrapped, a malformed
  // body reached the error handler and was reported as a server fault.
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json<{ email?: string; password?: string }>();
  } catch {
    return c.json({ error: 'expected a JSON body with email and password' }, 400);
  }

  const { email, password } = body;
  if (!email || !password) return c.json({ error: 'email and password required' }, 400);

  if (!c.env.SESSION_SECRET) {
    return c.json({
      error: 'Server is not configured: SESSION_SECRET is not set (setup step 10). '
           + 'Open /api/health for details.',
    }, 503);
  }

  let row: { id: string; password_hash: string; password_salt: string; active: number } | null;
  try {
    row = await c.env.DB
      .prepare(`SELECT id, password_hash, password_salt, active FROM users WHERE email = ?`)
      .bind(email.trim().toLowerCase())
      .first<{ id: string; password_hash: string; password_salt: string; active: number }>();
  } catch (err) {
    if (/no such table/i.test(String(err))) {
      return c.json({
        error: 'The database has no tables yet — run: npm run db:remote (setup step 9). '
             + 'Open /api/health for details.',
      }, 503);
    }
    throw err;
  }

  // The same message and roughly the same work for "no such user" and "wrong
  // password", so the response cannot be used to enumerate accounts.
  const ok = row
    ? await verifyPassword(password, row.password_hash, row.password_salt)
    : await verifyPassword(password, '0'.repeat(64), '0'.repeat(32));

  if (!row || !ok || row.active !== 1) {
    return c.json({ error: 'invalid email or password' }, 401);
  }

  const sessionId = randomHex(32);
  await c.env.DB
    .prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(sessionId, row.id, sessionExpiry())
    .run();

  const value = await makeSessionCookieValue(sessionId, c.env.SESSION_SECRET);
  c.header('Set-Cookie', buildCookie(value, SESSION_MAX_AGE));

  // Built from the user id, not the cookie: the Set-Cookie header above has
  // not reached the client yet, so there is no cookie on this request to read.
  const user = await loadUserById(row.id, c.env);
  return c.json({
    email, displayName: user?.displayName ?? '',
    permissions: [...(user?.permissions ?? [])],
  });
});

authRoutes.post('/logout', async (c) => {
  const cookie = c.req.header('cookie') ?? '';
  const raw = cookie.split(';').map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);

  if (raw) {
    const sessionId = await readSessionCookieValue(raw, c.env.SESSION_SECRET);
    if (sessionId) {
      await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
    }
  }
  c.header('Set-Cookie', buildCookie('', 0));
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = await loadUserContext(c.req.raw, c.env);
  if (!user) return c.json({ error: 'not authenticated' }, 401);

  const roles = await c.env.DB
    .prepare(`SELECT r.id, r.name FROM roles r
              JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`)
    .bind(user.userId)
    .all<{ id: string; name: string }>();

  return c.json({
    email: user.email,
    displayName: user.displayName,
    roles: roles.results ?? [],
    permissions: [...user.permissions],
    scopes: user.scopes,
  });
});
