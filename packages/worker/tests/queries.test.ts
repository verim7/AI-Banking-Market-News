import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildArticleQuery, buildFacetQuery, buildTrendQuery } from '../src/queries.ts';
import { scopePredicate, type UserContext } from '../src/rbac.ts';

/**
 * These run against a real SQLite database built from the real migration, not
 * against expected SQL strings. A scope test that only asserts on generated SQL
 * proves the string is what we wrote, not that it filters anything.
 */

// Loaded through createRequire so Vite does not try to pre-bundle it:
// node:sqlite is newer than Vite's list of Node builtins.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

const ROOT = resolve(import.meta.dirname, '../../..');
let db: InstanceType<typeof DatabaseSync>;

const article = (
  id: string, title: string, score: number, tags: [string, string][],
  publishedAt = '2026-08-18T00:00:00Z', publisherKind = 'media',
) => {
  db.prepare(
    `INSERT INTO articles (id, url_canonical, url_original, title, search_text,
      source_name, publisher_kind, published_at)
     VALUES (?, ?, ?, ?, ?, 'Test Source', ?, ?)`,
  ).run(id, `https://example.com/${id}`, `https://example.com/${id}`, title,
        title.toLowerCase(), publisherKind, publishedAt);
  db.prepare(`INSERT INTO article_scores (article_id, relevance_score, rule_hits)
              VALUES (?, ?, '[]')`).run(id, score);
  for (const [dimension, value] of tags) {
    db.prepare(`INSERT INTO article_tags (article_id, dimension, value, confidence)
                VALUES (?, ?, ?, 1.0)`).run(id, dimension, value);
  }
};

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(ROOT, 'db/migrations/0001_init.sql'), 'utf8'));
  db.exec(readFileSync(resolve(ROOT, 'db/seed.sql'), 'utf8'));

  db.prepare(`INSERT INTO users (id, email, display_name, password_hash, password_salt)
              VALUES ('u1', 'a@example.com', 'A', 'h', 's')`).run();

  article('a1', 'AI copilots at Swiss private banks', 80,
    [['region', 'switzerland'], ['banking_area', 'private_wealth'], ['use_case', 'advisory_copilot']]);
  article('a2', 'AI fraud detection at German retail banks', 70,
    [['region', 'germany_dach'], ['banking_area', 'retail_banking'], ['use_case', 'fraud_aml']]);
  article('a3', 'Singapore MAS guidance on AI', 60,
    [['region', 'singapore_apac'], ['banking_area', 'risk_compliance'], ['use_case', 'regtech']]);
  article('a4', 'US bank rolls out chatbot', 30,
    [['region', 'usa_north_america'], ['banking_area', 'retail_banking'], ['use_case', 'customer_service']]);
});

const user = (roleIds: string[], scopes: UserContext['scopes'] = []): UserContext => ({
  userId: 'u1', email: 'a@example.com', displayName: 'A',
  roleIds, permissions: new Set(['articles.read']), scopes,
});

const run = (q: { sql: string; params: (string | number)[] }) =>
  db.prepare(q.sql).all(...q.params) as Record<string, unknown>[];

const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r['id']).sort();

describe('visibility scopes', () => {
  it('shows everything to a role with no scopes', () => {
    const rows = run(buildArticleQuery(user(['role_admin']), {}));
    expect(ids(rows)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('restricts a single-region role to that region', () => {
    const u = user(['role_ch'], [{ roleId: 'role_ch', dimension: 'region', value: 'switzerland' }]);
    expect(ids(run(buildArticleQuery(u, {})))).toEqual(['a1']);
  });

  it('ORs values within a dimension', () => {
    const u = user(['role_dach_ch'], [
      { roleId: 'role_dach_ch', dimension: 'region', value: 'switzerland' },
      { roleId: 'role_dach_ch', dimension: 'region', value: 'germany_dach' },
    ]);
    expect(ids(run(buildArticleQuery(u, {})))).toEqual(['a1', 'a2']);
  });

  it('ANDs across dimensions', () => {
    const u = user(['role_ch_retail'], [
      { roleId: 'role_ch_retail', dimension: 'region', value: 'switzerland' },
      { roleId: 'role_ch_retail', dimension: 'banking_area', value: 'retail_banking' },
    ]);
    // a1 is Switzerland but private_wealth, so it must not match.
    expect(ids(run(buildArticleQuery(u, {})))).toEqual([]);
  });

  it('unions across roles, so a second role can only widen access', () => {
    const u = user(['role_ch', 'role_sg'], [
      { roleId: 'role_ch', dimension: 'region', value: 'switzerland' },
      { roleId: 'role_sg', dimension: 'region', value: 'singapore_apac' },
    ]);
    expect(ids(run(buildArticleQuery(u, {})))).toEqual(['a1', 'a3']);
  });

  it('grants everything when any held role is unrestricted', () => {
    const u = user(['role_ch', 'role_admin'], [
      { roleId: 'role_ch', dimension: 'region', value: 'switzerland' },
    ]);
    expect(scopePredicate(u).where).toBeNull();
    expect(ids(run(buildArticleQuery(u, {})))).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('applies scopes to facet counts as well as the list', () => {
    const u = user(['role_ch'], [{ roleId: 'role_ch', dimension: 'region', value: 'switzerland' }]);
    const rows = run(buildFacetQuery(u, {}));
    const regions = rows.filter((r) => r['dimension'] === 'region').map((r) => r['value']);
    expect(regions).toEqual(['switzerland']);
  });
});

describe('filters', () => {
  const admin = () => user(['role_admin']);

  it('filters by region', () => {
    expect(ids(run(buildArticleQuery(admin(), { regions: ['germany_dach'] })))).toEqual(['a2']);
  });

  it('filters by use case', () => {
    expect(ids(run(buildArticleQuery(admin(), { useCases: ['regtech'] })))).toEqual(['a3']);
  });

  it('filters by minimum relevance', () => {
    expect(ids(run(buildArticleQuery(admin(), { minRelevance: 65 })))).toEqual(['a1', 'a2']);
  });

  it('searches case-insensitively', () => {
    expect(ids(run(buildArticleQuery(admin(), { search: 'FRAUD' })))).toEqual(['a2']);
  });

  it('filters by date range', () => {
    expect(run(buildArticleQuery(admin(), { from: '2026-09-01T00:00:00Z' }))).toHaveLength(0);
    expect(run(buildArticleQuery(admin(), { from: '2026-01-01T00:00:00Z' }))).toHaveLength(4);
  });

  it('orders by relevance then recency', () => {
    const rows = run(buildArticleQuery(admin(), {}));
    expect(rows.map((r) => r['id'])).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('caps the page size no matter what the client asks for', () => {
    const q = buildArticleQuery(admin(), { limit: 100_000 });
    expect(q.params[q.params.length - 2]).toBe(200);
  });

  it('returns tags and favourite state with each row', () => {
    const rows = run(buildArticleQuery(admin(), { regions: ['switzerland'] }));
    expect(rows[0]!['tags']).toContain('region:switzerland');
    expect(rows[0]!['is_favorite']).toBe(0);
  });
});

describe('favourites and HIL state', () => {
  it('filters to favourites only', () => {
    db.prepare(`INSERT OR IGNORE INTO favorites (user_id, article_id) VALUES ('u1','a3')`).run();
    expect(ids(run(buildArticleQuery(user(['role_admin']), { favoritesOnly: true })))).toEqual(['a3']);
  });

  it('treats an article with no decision row as undecided', () => {
    db.prepare(`INSERT OR REPLACE INTO hil_decisions (user_id, article_id, decision)
                VALUES ('u1','a1','relevant')`).run();
    const u = user(['role_admin']);
    expect(ids(run(buildArticleQuery(u, { hilDecision: 'relevant' })))).toEqual(['a1']);
    expect(ids(run(buildArticleQuery(u, { hilDecision: 'undecided' })))).toEqual(['a2', 'a3', 'a4']);
  });
});

describe('trend query', () => {
  it('groups by day', () => {
    const rows = run(buildTrendQuery(user(['role_admin']), {}));
    expect(rows[0]!['day']).toBe('2026-08-18');
    expect(rows[0]!['n']).toBe(4);
  });
});
