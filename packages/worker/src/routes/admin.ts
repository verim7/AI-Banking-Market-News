import { Hono } from 'hono';
import { DIMENSIONS, TAXONOMY, type Dimension } from '@portal/shared';
import { hashPassword, randomHex } from '../auth.ts';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

export const adminRoutes = new Hono<AppEnv>();

const VALID_DIMENSION = new Set<string>(DIMENSIONS);
const validValue = (dimension: Dimension, value: string) =>
  TAXONOMY[dimension].some((e) => e.value === value);

/* ------------------------------------------------------------------- roles */

adminRoutes.get('/roles', requirePermission('admin.roles'), async (c) => {
  const [roles, perms, scopes, allPerms] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, description, built_in FROM roles ORDER BY name`).all(),
    c.env.DB.prepare(`SELECT role_id, permission_key FROM role_permissions`).all(),
    c.env.DB.prepare(`SELECT role_id, dimension, value FROM role_scopes`).all(),
    c.env.DB.prepare(`SELECT key, description FROM permissions ORDER BY key`).all(),
  ]);

  return c.json({
    roles: (roles.results ?? []).map((r) => ({
      id: r['id'], name: r['name'], description: r['description'],
      builtIn: r['built_in'] === 1,
      permissions: (perms.results ?? [])
        .filter((p) => p['role_id'] === r['id']).map((p) => p['permission_key']),
      scopes: (scopes.results ?? [])
        .filter((s) => s['role_id'] === r['id'])
        .map((s) => ({ dimension: s['dimension'], value: s['value'] })),
    })),
    availablePermissions: allPerms.results ?? [],
  });
});

adminRoutes.post('/roles', requirePermission('admin.roles'), async (c) => {
  const { name, description } = await c.req.json<{ name?: string; description?: string }>();
  if (!name?.trim()) return c.json({ error: 'name required' }, 400);

  const id = `role_${randomHex(8)}`;
  try {
    await c.env.DB
      .prepare(`INSERT INTO roles (id, name, description, built_in) VALUES (?, ?, ?, 0)`)
      .bind(id, name.trim(), description ?? '')
      .run();
  } catch {
    return c.json({ error: 'a role with that name already exists' }, 409);
  }
  return c.json({ id, name: name.trim(), description: description ?? '' }, 201);
});

adminRoutes.delete('/roles/:roleId', requirePermission('admin.roles'), async (c) => {
  const roleId = c.req.param('roleId');
  const role = await c.env.DB
    .prepare(`SELECT built_in FROM roles WHERE id = ?`).bind(roleId)
    .first<{ built_in: number }>();

  if (!role) return c.json({ error: 'no such role' }, 404);
  // Deleting Administrator would be an unrecoverable lockout.
  if (role.built_in === 1) return c.json({ error: 'built-in roles cannot be deleted' }, 400);

  await c.env.DB.prepare(`DELETE FROM roles WHERE id = ?`).bind(roleId).run();
  return c.json({ ok: true });
});

adminRoutes.put('/roles/:roleId/permissions', requirePermission('admin.roles'), async (c) => {
  const roleId = c.req.param('roleId');
  const { permissions } = await c.req.json<{ permissions?: string[] }>();
  if (!Array.isArray(permissions)) return c.json({ error: 'permissions array required' }, 400);

  const known = await c.env.DB.prepare(`SELECT key FROM permissions`).all<{ key: string }>();
  const validKeys = new Set((known.results ?? []).map((p) => p.key));
  const unknown = permissions.filter((p) => !validKeys.has(p));
  if (unknown.length > 0) return c.json({ error: `unknown permissions: ${unknown.join(', ')}` }, 400);

  const statements = [
    c.env.DB.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).bind(roleId),
    ...permissions.map((p) => c.env.DB
      .prepare(`INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)`)
      .bind(roleId, p)),
  ];
  await c.env.DB.batch(statements);
  return c.json({ ok: true, permissions });
});

/**
 * Replace a role's data scopes. An empty array means unrestricted — which is a
 * widening, so it is deliberate rather than a side effect of clearing a form.
 */
adminRoutes.put('/roles/:roleId/scopes', requirePermission('admin.roles'), async (c) => {
  const roleId = c.req.param('roleId');
  const { scopes } = await c.req.json<{ scopes?: { dimension: string; value: string }[] }>();
  if (!Array.isArray(scopes)) return c.json({ error: 'scopes array required' }, 400);

  for (const s of scopes) {
    if (!VALID_DIMENSION.has(s.dimension)) {
      return c.json({ error: `unknown dimension: ${s.dimension}` }, 400);
    }
    if (!validValue(s.dimension as Dimension, s.value)) {
      return c.json({ error: `unknown ${s.dimension} value: ${s.value}` }, 400);
    }
  }

  const statements = [
    c.env.DB.prepare(`DELETE FROM role_scopes WHERE role_id = ?`).bind(roleId),
    ...scopes.map((s) => c.env.DB
      .prepare(`INSERT OR IGNORE INTO role_scopes (role_id, dimension, value) VALUES (?, ?, ?)`)
      .bind(roleId, s.dimension, s.value)),
  ];
  await c.env.DB.batch(statements);
  return c.json({ ok: true, scopes });
});

/* ------------------------------------------------------------------- users */

adminRoutes.get('/users', requirePermission('admin.users'), async (c) => {
  const [users, roles] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, email, display_name, active, created_at FROM users ORDER BY email`).all(),
    c.env.DB.prepare(
      `SELECT ur.user_id, r.id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id`).all(),
  ]);

  return c.json({
    users: (users.results ?? []).map((u) => ({
      id: u['id'], email: u['email'], displayName: u['display_name'],
      active: u['active'] === 1, createdAt: u['created_at'],
      roles: (roles.results ?? [])
        .filter((r) => r['user_id'] === u['id'])
        .map((r) => ({ id: r['id'], name: r['name'] })),
    })),
  });
});

adminRoutes.post('/users', requirePermission('admin.users'), async (c) => {
  const { email, displayName, password, roleIds } = await c.req.json<{
    email?: string; displayName?: string; password?: string; roleIds?: string[];
  }>();

  if (!email?.trim() || !password) return c.json({ error: 'email and password required' }, 400);
  if (password.length < 12) {
    return c.json({ error: 'password must be at least 12 characters' }, 400);
  }

  const id = `user_${randomHex(8)}`;
  const { hash, salt } = await hashPassword(password);

  try {
    await c.env.DB
      .prepare(`INSERT INTO users (id, email, display_name, password_hash, password_salt)
                VALUES (?, ?, ?, ?, ?)`)
      .bind(id, email.trim().toLowerCase(), displayName ?? '', hash, salt)
      .run();
  } catch {
    return c.json({ error: 'a user with that email already exists' }, 409);
  }

  if (roleIds?.length) {
    await c.env.DB.batch(roleIds.map((r) => c.env.DB
      .prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`)
      .bind(id, r)));
  }

  return c.json({ id, email: email.trim().toLowerCase() }, 201);
});

adminRoutes.put('/users/:userId/roles', requirePermission('admin.users'), async (c) => {
  const userId = c.req.param('userId');
  const { roleIds } = await c.req.json<{ roleIds?: string[] }>();
  if (!Array.isArray(roleIds)) return c.json({ error: 'roleIds array required' }, 400);

  // Refuse to remove the last administrator: a portal nobody can administer is
  // only recoverable by hand-editing the database.
  const actor = c.get('user');
  if (userId === actor.userId && !roleIds.includes('role_admin')) {
    const others = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM user_roles WHERE role_id = 'role_admin' AND user_id != ?`)
      .bind(userId)
      .first<{ n: number }>();
    if ((others?.n ?? 0) === 0) {
      return c.json({ error: 'cannot remove the last administrator' }, 400);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(userId),
    ...roleIds.map((r) => c.env.DB
      .prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`)
      .bind(userId, r)),
  ]);

  return c.json({ ok: true, roleIds });
});

adminRoutes.put('/users/:userId/active', requirePermission('admin.users'), async (c) => {
  const { active } = await c.req.json<{ active?: boolean }>();
  await c.env.DB
    .prepare(`UPDATE users SET active = ? WHERE id = ?`)
    .bind(active ? 1 : 0, c.req.param('userId'))
    .run();
  return c.json({ ok: true });
});

adminRoutes.put('/users/:userId/password', requirePermission('admin.users'), async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || password.length < 12) {
    return c.json({ error: 'password must be at least 12 characters' }, 400);
  }
  const { hash, salt } = await hashPassword(password);
  const userId = c.req.param('userId');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`)
      .bind(hash, salt, userId),
    // A password change must end every existing session for that user.
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
  ]);

  return c.json({ ok: true });
});

/* ----------------------------------------------------------------- sources */

adminRoutes.get('/sources', requirePermission('sources.manage'), async (c) => {
  const [sources, lastRun] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, url, kind, publisher_kind, region_hint, enabled
       FROM sources ORDER BY publisher_kind, name`).all(),
    c.env.DB.prepare(
      `SELECT id, started_at, finished_at, status, items_fetched, items_new,
              sources_ok, sources_failed, detail
       FROM ingest_runs ORDER BY started_at DESC LIMIT 1`).first(),
  ]);
  return c.json({ sources: sources.results ?? [], lastRun });
});

adminRoutes.put('/sources/:sourceId/enabled', requirePermission('sources.manage'), async (c) => {
  const { enabled } = await c.req.json<{ enabled?: boolean }>();
  await c.env.DB
    .prepare(`UPDATE sources SET enabled = ? WHERE id = ?`)
    .bind(enabled ? 1 : 0, c.req.param('sourceId'))
    .run();
  return c.json({ ok: true });
});

adminRoutes.get('/runs', requirePermission('sources.manage'), async (c) => {
  const runs = await c.env.DB.prepare(
    `SELECT id, started_at, finished_at, status, items_fetched, items_new,
            sources_ok, sources_failed
     FROM ingest_runs ORDER BY started_at DESC LIMIT 30`).all();
  return c.json({ runs: runs.results ?? [] });
});
