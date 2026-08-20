import { Hono } from 'hono';
import { requirePermission } from '../middleware.ts';
import type { AppEnv } from '../types.ts';

export const favoriteRoutes = new Hono<AppEnv>();

favoriteRoutes.put('/:articleId', requirePermission('favorites.write'), async (c) => {
  const user = c.get('user');
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
