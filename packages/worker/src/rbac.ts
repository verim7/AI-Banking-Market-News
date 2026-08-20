import type { Dimension } from '@portal/shared';

/**
 * Role-based access with data scopes.
 *
 * Permissions say what a user may *do*. Scopes say which articles they may
 * *see*. Both are enforced in SQL, in the WHERE clause — never by filtering in
 * the UI, because a UI filter is a suggestion and a WHERE clause is a rule.
 *
 * Scope semantics, chosen to make the common case safe:
 *  - A role with no scope rows is unrestricted.
 *  - Within a dimension, values are OR-ed  (region ∈ {CH, DE}).
 *  - Across dimensions they are AND-ed     (region ∈ {CH} AND area ∈ {retail}).
 *  - Across a user's roles, the results are UNION-ed, so adding a role can only
 *    ever widen what someone sees. A user holding any unrestricted role is
 *    unrestricted.
 */

export interface RoleScope {
  roleId: string;
  dimension: Dimension;
  value: string;
}

export interface UserContext {
  userId: string;
  email: string;
  displayName: string;
  roleIds: string[];
  permissions: Set<string>;
  scopes: RoleScope[];
}

export function can(user: UserContext, permission: string): boolean {
  return user.permissions.has(permission);
}

export interface ScopeSql {
  /** SQL fragment referencing the articles alias, or null when unrestricted. */
  where: string | null;
  params: string[];
}

/**
 * Build the visibility predicate for a user. `alias` is the articles table
 * alias in the caller's query.
 */
export function scopePredicate(user: UserContext, alias = 'a'): ScopeSql {
  const restricted = new Map<string, Map<Dimension, string[]>>();

  for (const s of user.scopes) {
    let byDim = restricted.get(s.roleId);
    if (!byDim) {
      byDim = new Map();
      restricted.set(s.roleId, byDim);
    }
    const list = byDim.get(s.dimension) ?? [];
    list.push(s.value);
    byDim.set(s.dimension, list);
  }

  // A role the user holds that carries no scope rows grants full visibility.
  const hasUnrestrictedRole = user.roleIds.some((id) => !restricted.has(id));
  if (hasUnrestrictedRole || restricted.size === 0) return { where: null, params: [] };

  const params: string[] = [];
  const roleClauses: string[] = [];

  for (const [, byDim] of restricted) {
    const dimClauses: string[] = [];
    for (const [dimension, values] of byDim) {
      const placeholders = values.map(() => '?').join(', ');
      params.push(dimension, ...values);
      dimClauses.push(
        `EXISTS (SELECT 1 FROM article_tags st WHERE st.article_id = ${alias}.id `
        + `AND st.dimension = ? AND st.value IN (${placeholders}))`);
    }
    roleClauses.push(`(${dimClauses.join(' AND ')})`);
  }

  return { where: `(${roleClauses.join(' OR ')})`, params };
}
