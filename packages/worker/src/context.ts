import type { Dimension } from '@portal/shared';
import type { UserContext } from './rbac.ts';
import { readSessionCookieValue, SESSION_COOKIE } from './auth.ts';
import type { Env } from './types.ts';

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/**
 * Build a user context from a user id: roles, the union of their permissions,
 * and every scope row. Three small queries, all indexed — well inside the free
 * plan's 10 ms CPU budget, since D1 time is I/O rather than CPU.
 *
 * Separate from the cookie lookup so the login handler can build a context for
 * the session it has just created, before that cookie has reached the client.
 */
export async function loadUserById(userId: string, env: Env): Promise<UserContext | null> {
  const user = await env.DB
    .prepare(`SELECT id, email, display_name, active FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; email: string; display_name: string; active: number }>();

  if (!user || user.active !== 1) return null;

  const session = { user_id: user.id, email: user.email, display_name: user.display_name };

  const roles = await env.DB
    .prepare(`SELECT role_id FROM user_roles WHERE user_id = ?`)
    .bind(session.user_id)
    .all<{ role_id: string }>();
  const roleIds = (roles.results ?? []).map((r) => r.role_id);

  if (roleIds.length === 0) {
    return {
      userId: session.user_id, email: session.email,
      displayName: session.display_name, roleIds: [],
      permissions: new Set(), scopes: [],
    };
  }

  const placeholders = roleIds.map(() => '?').join(', ');

  const perms = await env.DB
    .prepare(`SELECT DISTINCT permission_key FROM role_permissions WHERE role_id IN (${placeholders})`)
    .bind(...roleIds)
    .all<{ permission_key: string }>();

  const scopes = await env.DB
    .prepare(`SELECT role_id, dimension, value FROM role_scopes WHERE role_id IN (${placeholders})`)
    .bind(...roleIds)
    .all<{ role_id: string; dimension: Dimension; value: string }>();

  return {
    userId: session.user_id,
    email: session.email,
    displayName: session.display_name,
    roleIds,
    permissions: new Set((perms.results ?? []).map((p) => p.permission_key)),
    scopes: (scopes.results ?? []).map((s) => ({
      roleId: s.role_id, dimension: s.dimension, value: s.value,
    })),
  };
}

/** Resolve a signed session cookie to the user it belongs to. */
export async function loadUserContext(
  req: Request, env: Env,
): Promise<UserContext | null> {
  const raw = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  if (!raw) return null;

  const sessionId = await readSessionCookieValue(raw, env.SESSION_SECRET);
  if (!sessionId) return null;

  const session = await env.DB
    .prepare(`SELECT user_id FROM sessions
              WHERE id = ? AND expires_at > datetime('now')`)
    .bind(sessionId)
    .first<{ user_id: string }>();

  if (!session) return null;
  return loadUserById(session.user_id, env);
}
