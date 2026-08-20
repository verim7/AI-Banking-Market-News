import type { MiddlewareHandler } from 'hono';
import { can } from './rbac.ts';
import { loadUserContext } from './context.ts';
import type { AppEnv } from './types.ts';

/** Reject anonymous requests before any handler runs. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUserContext(c.req.raw, c.env);
  if (!user) return c.json({ error: 'not authenticated' }, 401);
  c.set('user', user);
  await next();
};

/** Reject authenticated requests that lack a specific permission. */
export const requirePermission = (permission: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const user = c.get('user');
    if (!can(user, permission)) {
      return c.json({ error: `missing permission: ${permission}` }, 403);
    }
    await next();
  };
