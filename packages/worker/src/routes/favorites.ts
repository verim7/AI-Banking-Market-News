import { Hono } from 'hono';
import { requirePermission } from '../middleware.ts';
import { isVisible } from '../queries.ts';
import type { AppEnv } from '../types.ts';

export const favoriteRoutes = new Hono<AppEnv>();

favoriteRoutes.put('/:articleId', requirePermission('favorites.write'), async (c) => {
  const user = c.get('user');
  // 404 rather than 403: to someone who cannot see this article, it does not
  // exist, and saying "forbidden" would confirm that it does.
  if (!await isVisible(c.env.DB, user, c.req.param('articleId'))) {
    return c.json({ error: 'not found' }, 404);
  }
  await c.env.DB
    .prepare(`INSERT OR IGNORE INTO favorites (user_id, article_id) VALUES (?, ?)`)
    .bind(user.userId, c.req.param('articleId'))
    .run();
  return c.json({ ok: true, isFavorite: true });
});

favoriteRoutes.delete('/:articleId', requirePermission('favorites.write'), async (c) => {
  const user = c.get('user');
  await c.env.DB
    .prepare(`DELETE FROM favorites WHERE user_id = ? AND article_id = ?`)
    .bind(user.userId, c.req.param('articleId'))
    .run();
  return c.json({ ok: true, isFavorite: false });
});
