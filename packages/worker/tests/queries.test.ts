import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, test } from 'vitest';
import {
  DIMENSIONS, FILTER_DIMENSIONS, TAXONOMY, UNCLASSIFIED,
} from '@portal/shared';
import {
  buildArticleQuery, buildColumnFacetQuery, buildFacetQueryFor, buildGradeFacetQuery,
  buildMeasuresQuery, buildTrendQuery, buildUnclassifiedFacetQuery, buildUseCaseKeysQuery,
} from '../src/queries.ts';
import { scopePredicate, type UserContext } from '../src/rbac.ts';
import { countUseCases, shapeArticle } from '../src/routes/articles.ts';

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

/** A migrated, seeded, empty database with one user in it. */
function freshDb() {
  const target = new DatabaseSync(':memory:');
  // Every migration, in order — not just the first. Pinning this to 0001 meant
  // a schema change could pass its own tests while the query builder referenced
  // a column the test database did not have.
  for (const file of readdirSync(resolve(ROOT, 'db/migrations')).sort()) {
    if (!file.endsWith('.sql')) continue;
    target.exec(readFileSync(resolve(ROOT, 'db/migrations', file), 'utf8'));
  }
  target.exec(readFileSync(resolve(ROOT, 'db/seed.sql'), 'utf8'));
  target.prepare(`INSERT INTO users (id, email, display_name, password_hash, password_salt)
                  VALUES ('u1', 'a@example.com', 'A', 'h', 's')`).run();
  return target;
}

const insertArticle = (
  target: InstanceType<typeof DatabaseSync>,
  id: string, title: string, score: number, tags: [string, string][],
  publishedAt = '2026-08-18T00:00:00Z', publisherKind = 'media',
  extra: { useCaseEvidence?: string } = {},
) => {
  target.prepare(
    `INSERT INTO articles (id, url_canonical, url_original, title, search_text,
      source_name, publisher_kind, published_at)
     VALUES (?, ?, ?, ?, ?, 'Test Source', ?, ?)`,
  ).run(id, `https://example.com/${id}`, `https://example.com/${id}`, title,
        title.toLowerCase(), publisherKind, publishedAt);
  target.prepare(`INSERT INTO article_scores (article_id, relevance_score, rule_hits,
                                              use_case_evidence)
              VALUES (?, ?, '[]', ?)`).run(id, score, extra.useCaseEvidence ?? null);
  for (const [dimension, value] of tags) {
    target.prepare(`INSERT INTO article_tags (article_id, dimension, value, confidence)
                VALUES (?, ?, ?, 1.0)`).run(id, dimension, value);
  }
};

const article = (
  id: string, title: string, score: number, tags: [string, string][],
  publishedAt = '2026-08-18T00:00:00Z', publisherKind = 'media',
) => insertArticle(db, id, title, score, tags, publishedAt, publisherKind);

beforeAll(() => {
  db = freshDb();

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
    const rows = run(buildFacetQueryFor(u, {}, 'region'));
    expect(rows.map((r) => r['value'])).toEqual(['switzerland']);
  });
});

describe('facet options never lead to an empty result', () => {
  const admin = () => user(['role_admin']);
  const values = (rows: Record<string, unknown>[]) => rows.map((r) => r['value']);

  it('leaves a dimension unfiltered by its own selection, so more can be added', () => {
    // The bug this replaces: selecting Switzerland made the region facet return
    // only Switzerland, so Germany could never be added to the selection.
    const rows = run(buildFacetQueryFor(admin(), { regions: ['switzerland'] }, 'region'));
    expect(values(rows).length).toBeGreaterThan(1);
    expect(values(rows)).toContain('switzerland');
  });

  it('still narrows a dimension by the other filters', () => {
    const all = values(run(buildFacetQueryFor(admin(), {}, 'region')));
    const narrowed = values(run(buildFacetQueryFor(
      admin(), { bankingAreas: ['private_wealth'] }, 'region')));
    expect(narrowed.length).toBeLessThan(all.length);
    for (const v of narrowed) expect(all).toContain(v);
  });

  it('omits options that would return nothing', () => {
    // Every option offered must have a count, so no choice can produce an
    // empty table.
    const rows = run(buildFacetQueryFor(admin(), { regions: ['singapore_apac'] }, 'use_case'));
    for (const r of rows) expect(Number(r['n'])).toBeGreaterThan(0);
  });

  it('counts column-backed filters the same way', () => {
    const rows = run(buildColumnFacetQuery(admin(), {}, 'publisher_kind'));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Number(r['n'])).toBeGreaterThan(0);
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

describe('promise ordering', () => {
  /** An article with the three things that decide promise. */
  const promising = (
    id: string, aiIntensity: number,
    opts: { aiType?: string; useCase?: string; maturity?: string } = {},
  ) => {
    db.prepare(
      `INSERT INTO articles (id, url_canonical, url_original, title, search_text,
        source_name, publisher_kind, published_at)
       VALUES (?, ?, ?, ?, ?, 'Promise Source', 'media', '2026-08-19T00:00:00Z')`,
    ).run(id, `https://promise.example/${id}`, `https://promise.example/${id}`,
          `Promise ${id}`, `promise ${id}`);
    db.prepare(
      `INSERT INTO article_scores
        (article_id, relevance_score, rule_hits, ai_intensity, maturity, use_case_evidence)
       VALUES (?, 50, '[]', ?, ?, ?)`,
    ).run(id, aiIntensity, opts.maturity ?? 'unknown', opts.useCase ?? null);
    if (opts.aiType) {
      db.prepare(`INSERT INTO article_tags (article_id, dimension, value, confidence)
                  VALUES (?, 'ai_type', ?, 1.0)`).run(id, opts.aiType);
    }
  };

  const order = () => run(buildArticleQuery(
    user(['admin']),
    { search: 'promise', sort: 'promise', sortDir: 'desc', limit: 50 },
  )).map((r) => (r as { id: string }).id);

  beforeAll(() => {
    // The case the user described: a perfect AI score with nothing to act on.
    promising('p_bare', 100);
    promising('p_typeonly', 92, { aiType: 'generative_ai' });
    promising('p_complete_low', 55,
      { aiType: 'machine_learning', useCase: 'detects fraud', maturity: 'pilot' });
    promising('p_complete_high', 78,
      { aiType: 'generative_ai', useCase: 'deploys agents', maturity: 'in_production' });
    // Same AI focus as p_complete_low, but only announced rather than piloting.
    promising('p_complete_tie', 55,
      { aiType: 'agentic_ai', useCase: 'plans a rollout', maturity: 'announced' });
  });

  test('an article with no category and no use case never tops the list, at any score', () => {
    const ids = order();
    expect(ids[0]).toBe('p_complete_high');
    expect(ids.indexOf('p_bare')).toBeGreaterThan(ids.indexOf('p_complete_low'));
  });

  test('complete articles rank above partial ones, which rank above bare ones', () => {
    const ids = order();
    const at = (id: string) => ids.indexOf(id);
    expect(at('p_complete_high')).toBeLessThan(at('p_typeonly'));
    expect(at('p_complete_low')).toBeLessThan(at('p_typeonly'));
    expect(at('p_typeonly')).toBeLessThan(at('p_bare'));
  });

  test('within a tier, AI focus leads', () => {
    const ids = order();
    expect(ids.indexOf('p_complete_high')).toBeLessThan(ids.indexOf('p_complete_low'));
  });

  // Deliberately weak: it separates two articles of the same strength, it does
  // not carry a weak article over a strong one.
  test('maturity breaks a tie at equal AI focus', () => {
    const ids = order();
    expect(ids.indexOf('p_complete_low')).toBeLessThan(ids.indexOf('p_complete_tie'));
  });

  test('maturity cannot outrank a clearly better score', () => {
    const ids = order();
    // p_complete_high is in production AND higher; p_complete_low is a pilot.
    // Swap the maturity advantage and the score must still decide.
    expect(ids.indexOf('p_complete_high')).toBeLessThan(ids.indexOf('p_complete_tie'));
  });

  test('promise is the default when no sort is given', () => {
    const ids = run(buildArticleQuery(user(['admin']), { search: 'promise', limit: 50 }))
      .map((r) => (r as { id: string }).id);
    expect(ids[0]).toBe('p_complete_high');
  });
});

describe('the article body', () => {
  // The point is that the body is not *returned*, not that the column is never
  // named: promise ordering tests it in the ORDER BY to rank readable articles
  // higher, which costs nothing per row. So assert on the SELECT list, which is
  // what actually determines the response size.
  const selectList = (sql: string) => sql.slice(0, sql.indexOf('FROM articles'));

  test('is left out of what list queries return', () => {
    expect(selectList(buildArticleQuery(user(['admin']), {}).sql))
      .not.toContain('a.excerpt');
  });

  test('is still consulted for ordering, where it costs nothing', () => {
    expect(buildArticleQuery(user(['admin']), { sort: 'promise' }).sql)
      .toContain('a.excerpt');
  });

  test('is returned only when asked for', () => {
    expect(selectList(
      buildArticleQuery(user(['admin']), { articleIds: ['a1'] }, { includeBody: true }).sql))
      .toContain('a.excerpt');
  });

  test('a scope still applies when fetching one article by id', () => {
    const scoped = user(['analyst'], [{ roleId: 'analyst', dimension: 'region', value: 'switzerland' }]);
    const rows = run(buildArticleQuery(scoped, { articleIds: ['a2'] }, { includeBody: true }));
    // a2 is German; a Swiss-scoped user must not reach it by knowing its id.
    expect(rows).toHaveLength(0);
  });
});

describe('readability in the promise ordering', () => {
  const readable = (id: string, ai: number, body: string | null, complete = true) => {
    db.prepare(
      `INSERT INTO articles (id, url_canonical, url_original, title, search_text,
        source_name, publisher_kind, published_at, excerpt)
       VALUES (?, ?, ?, ?, ?, 'Read Source', 'media', '2026-08-19T00:00:00Z', ?)`,
    ).run(id, `https://read.example/${id}`, `https://read.example/${id}`,
          `Readable ${id}`, `readable ${id}`, body);
    db.prepare(
      `INSERT INTO article_scores
        (article_id, relevance_score, rule_hits, ai_intensity, maturity, use_case_evidence)
       VALUES (?, 50, '[]', ?, 'unknown', ?)`,
    ).run(id, ai, complete ? 'does a thing' : null);
    if (complete) {
      db.prepare(`INSERT INTO article_tags (article_id, dimension, value, confidence)
                  VALUES (?, 'ai_type', 'generative_ai', 1.0)`).run(id);
    }
  };

  const order = () => run(buildArticleQuery(
    user(['admin']), { search: 'readable', sort: 'promise', sortDir: 'desc', limit: 50 },
  )).map((r) => (r as { id: string }).id);

  beforeAll(() => {
    readable('r_complete_read', 60, 'The bank deployed an assistant across operations.');
    readable('r_complete_blind', 60, null);
    readable('r_partial_read', 95, 'A long and readable article about AI.', false);
  });

  test('a readable article outranks an unreadable one of equal completeness', () => {
    const ids = order();
    expect(ids.indexOf('r_complete_read')).toBeLessThan(ids.indexOf('r_complete_blind'));
  });

  // The rule the user set: completeness first, and readability must not
  // overturn it however much better the article reads.
  test('readability never lifts a less complete article above a more complete one', () => {
    const ids = order();
    expect(ids.indexOf('r_complete_blind')).toBeLessThan(ids.indexOf('r_partial_read'));
  });
});

/**
 * The unclassified bucket, on a database of its own.
 *
 * A separate database rather than more rows in the shared one: several tests
 * above assert the complete id list, so a fixture added there would have to be
 * paid for by editing assertions that have nothing to do with this change.
 */
describe('every article is reachable from every filter', () => {
  let scratch: InstanceType<typeof DatabaseSync>;
  const admin = () => user(['role_admin']);
  const run2 = (q: { sql: string; params: (string | number)[] }) =>
    scratch.prepare(q.sql).all(...q.params) as Record<string, unknown>[];

  beforeAll(() => {
    scratch = freshDb();
    // c1: region and an AI type, and the article describes the use case.
    insertArticle(scratch, 'c1', 'Bank deploys a generative assistant', 80,
      [['region', 'switzerland'], ['ai_type', 'generative_ai']],
      '2026-08-18T00:00:00Z', 'media',
      { useCaseEvidence: 'The assistant drafts client meeting notes for advisers.' });
    // c2: a region, nothing else.
    insertArticle(scratch, 'c2', 'Swiss banking roundup', 50,
      [['region', 'switzerland']]);
    // c3: an AI type but no region.
    insertArticle(scratch, 'c3', 'Machine learning in credit decisions', 60,
      [['ai_type', 'machine_learning']]);
    // c4: a described use case but no region and no AI type.
    insertArticle(scratch, 'c4', 'Lender automates document checks', 40, [],
      '2026-08-18T00:00:00Z', 'media',
      { useCaseEvidence: 'Documents are checked automatically before underwriting.' });
  });

  it('returns exactly the articles with no tag in that dimension', () => {
    const rows = run2(buildArticleQuery(admin(), { regions: [UNCLASSIFIED] }));
    expect(ids(rows)).toEqual(['c3', 'c4']);
  });

  it('unions with a real value rather than intersecting it', () => {
    // Picking "Switzerland" and "Not classified" asks for both sets, exactly as
    // picking two regions does. An AND here would return nothing at all.
    const rows = run2(buildArticleQuery(
      admin(), { regions: ['switzerland', UNCLASSIFIED] }));
    expect(ids(rows)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('counts the option with the same query the option runs', () => {
    // The invariant worth protecting: an option that advertises 2 articles and
    // then returns 3 is a bug nobody can diagnose from the screen.
    const count = run2(buildUnclassifiedFacetQuery(admin(), {}, 'region'));
    const rows = run2(buildArticleQuery(admin(), { regions: [UNCLASSIFIED] }));
    expect(Number(count[0]!['total'])).toBe(rows.length);
  });

  it('narrows the unclassified count by the other filters', () => {
    const all = run2(buildUnclassifiedFacetQuery(admin(), {}, 'region'));
    const narrowed = run2(buildUnclassifiedFacetQuery(
      admin(), { aiTypes: ['machine_learning'] }, 'region'));
    expect(Number(all[0]!['total'])).toBe(2);
    expect(Number(narrowed[0]!['total'])).toBe(1);   // c3 only
  });

  it('keeps its count once chosen, so it can be unchosen', () => {
    // Same rule as every other option: applying a dimension's own selection to
    // its own count is what made options vanish the moment they were picked.
    const rows = run2(buildUnclassifiedFacetQuery(
      admin(), { regions: ['switzerland'] }, 'region'));
    expect(Number(rows[0]!['total'])).toBe(2);
  });

  it('reports confirmed and possible use cases over the whole view', () => {
    // Counted by hand from the fixtures above, not read back from the query:
    // c1 has both an AI type and a described use case; c3 and c4 have one each.
    const rows = run2(buildMeasuresQuery(admin(), {}));
    expect(Number(rows[0]!['total'])).toBe(4);
    expect(Number(rows[0]!['confirmed_use_cases'])).toBe(1);
    expect(Number(rows[0]!['possible_use_cases'])).toBe(2);
  });

  it('measures obey the filters, so the tiles match the table', () => {
    const rows = run2(buildMeasuresQuery(admin(), { regions: ['switzerland'] }));
    expect(Number(rows[0]!['total'])).toBe(2);
    expect(Number(rows[0]!['confirmed_use_cases'])).toBe(1);
    expect(Number(rows[0]!['possible_use_cases'])).toBe(0);
  });

  it('measures survive an empty view', () => {
    // SUM over no rows is NULL in SQLite, not 0 — the route coalesces it, and
    // a tile reading "null confirmed" would be the visible symptom.
    const rows = run2(buildMeasuresQuery(admin(), { regions: ['germany_dach'] }));
    expect(Number(rows[0]!['total'])).toBe(0);
    expect(rows[0]!['confirmed_use_cases']).toBeNull();
  });
});

describe('reviewed use cases', () => {
  let scratch: InstanceType<typeof DatabaseSync>;
  const admin = () => user(['role_admin']);
  const run2 = (q: { sql: string; params: (string | number)[] }) =>
    scratch.prepare(q.sql).all(...q.params) as Record<string, unknown>[];

  const review = (id: string, grade: string, over: Record<string, unknown> = {}) => {
    const cols = { article_id: id, grade, headline: `${grade} case`, maturity: null, ...over };
    const keys = Object.keys(cols);
    scratch.prepare(
      `INSERT INTO article_reviews (${keys.join(',')}, reviewed_at)
       VALUES (${keys.map(() => '?').join(',')}, '2026-08-24T00:00:00Z')`,
    ).run(...keys.map((k) => cols[k as keyof typeof cols] as never));
  };

  beforeAll(() => {
    scratch = freshDb();
    insertArticle(scratch, 'r1', 'Deployed', 80, [['ai_type', 'generative_ai']]);
    insertArticle(scratch, 'r2', 'Announced', 70, []);
    insertArticle(scratch, 'r3', 'Commentary', 60, []);
    insertArticle(scratch, 'r4', 'Never reviewed', 50, []);
    review('r1', 'A', { maturity: 'in_production' });
    review('r2', 'B');
    review('r3', 'D');
  });

  it('filters by grade', () => {
    expect(ids(run2(buildArticleQuery(admin(), { grades: ['A'] })))).toEqual(['r1']);
    expect(ids(run2(buildArticleQuery(admin(), { grades: ['A', 'B'] })))).toEqual(['r1', 'r2']);
  });

  it('offers "not reviewed" as an option, so nothing is unreachable', () => {
    expect(ids(run2(buildArticleQuery(admin(), { grades: ['unreviewed'] })))).toEqual(['r4']);
    expect(ids(run2(buildArticleQuery(admin(), { grades: ['A', 'unreviewed'] }))))
      .toEqual(['r1', 'r4']);
  });

  it('lets a review override the maturity the rules inferred', () => {
    // The rules left r1 unknown; the reviewer read the article and said it is
    // live. The column, the filter and the sort must all agree on the override.
    const rows = run2(buildArticleQuery(admin(), { articleIds: ['r1'] }));
    expect(rows[0]!['maturity']).toBe('in_production');
    expect(ids(run2(buildArticleQuery(admin(), { maturities: ['in_production'] }))))
      .toEqual(['r1']);
  });

  it('counts reviewed grades separately from the rule heuristic', () => {
    const m = run2(buildMeasuresQuery(admin(), {}))[0]!;
    expect(Number(m['reviewed_total'])).toBe(3);
    // A only. B is AI market news, not a use case, so counting it here was
    // counting the coverage of the market as part of the market.
    expect(Number(m['reviewed_use_cases'])).toBe(1);
    // And deployed reads the Stage column: r1 is an A the reviewer marked
    // in_production. An A with no stage is still a use case and not deployed.
    expect(Number(m['deployed_use_cases'])).toBe(1);
    // The rule heuristic now speaks only for articles nobody has read, so a
    // reviewed D can never also be counted as a rules "confirmed".
    expect(Number(m['confirmed_use_cases'])).toBe(0);
  });

  it('counts the unreviewed bucket in the grade facet', () => {
    const rows = run2(buildGradeFacetQuery(admin(), {}));
    const byValue = Object.fromEntries(rows.map((r) => [r['value'], Number(r['n'])]));
    expect(byValue).toMatchObject({ A: 1, B: 1, D: 1, unreviewed: 1 });
  });

  it('keeps its own counts when a grade is already selected', () => {
    const rows = run2(buildGradeFacetQuery(admin(), { grades: ['A'] }));
    expect(rows.length).toBeGreaterThan(1);
  });
});

describe('the coverage chart buckets time three ways', () => {
  // Its own database: tests above insert into the shared one, so the dates
  // present there depend on execution order and could not be asserted exactly.
  let scratch: InstanceType<typeof DatabaseSync>;
  const admin = () => user(['role_admin']);
  const days = (bucket: 'day' | 'week' | 'month', u = admin()) => {
    const q = buildTrendQuery(u, {}, bucket);
    return (scratch.prepare(q.sql).all(...q.params) as Record<string, unknown>[])
      .map((r) => String(r['day']));
  };
  const counts = (bucket: 'day' | 'week' | 'month') => {
    const q = buildTrendQuery(admin(), {}, bucket);
    return (scratch.prepare(q.sql).all(...q.params) as Record<string, unknown>[])
      .reduce((sum, r) => sum + Number(r['n']), 0);
  };

  beforeAll(() => {
    scratch = freshDb();
    // Tue 18th, Wed 19th, and the Sunday of the same week (23rd), plus one in
    // the next month — enough that the three buckets must collapse differently.
    insertArticle(scratch, 't1', 'Tuesday', 50, [['region', 'switzerland']], '2026-08-18T09:00:00Z');
    insertArticle(scratch, 't2', 'Wednesday', 50, [], '2026-08-19T09:00:00Z');
    insertArticle(scratch, 't3', 'Sunday', 50, [], '2026-08-23T09:00:00Z');
    insertArticle(scratch, 't4', 'Next month', 50, [], '2026-09-02T09:00:00Z');
  });

  it('collapses the same rows differently at each bucket', () => {
    expect(days('day')).toEqual(['2026-08-18', '2026-08-19', '2026-08-23', '2026-09-02']);
    expect(days('month')).toEqual(['2026-08', '2026-09']);
  });

  it('labels a week by the Monday it starts on, and keeps Sunday in it', () => {
    // 2026-08-18 is a Tuesday, so its week began Monday the 17th. The 23rd is
    // the Sunday of that same week — the off-by-one ISO weeks exist for, and
    // the one SQLite's weekday 0 would get wrong.
    expect(days('week')).toEqual(['2026-08-17', '2026-08-31']);
  });

  it('never invents or loses an article between buckets', () => {
    expect(counts('day')).toBe(4);
    expect(counts('week')).toBe(4);
    expect(counts('month')).toBe(4);
  });

  it('still obeys filters and scopes', () => {
    const u = user(['role_ch'], [{ roleId: 'role_ch', dimension: 'region', value: 'switzerland' }]);
    expect(days('day', u)).toEqual(['2026-08-18']);
  });
});

describe('narrowing the filter bar does not narrow anything else', () => {
  const admin = () => user(['role_admin']);

  it('drops the two dimensions from the filters but not from the taxonomy', () => {
    expect(FILTER_DIMENSIONS).not.toContain('banking_area');
    expect(FILTER_DIMENSIONS).not.toContain('bank_category');
    // Still full members: the analysis table shows them and the export carries
    // them, both of which read DIMENSIONS.
    expect(DIMENSIONS).toContain('banking_area');
    expect(DIMENSIONS).toContain('bank_category');
  });

  it('still enforces a scope on a dimension nobody can filter on', () => {
    // The rule that matters: removing a control must never widen what someone
    // is allowed to see.
    const u = user(['role_wealth'], [
      { roleId: 'role_wealth', dimension: 'banking_area', value: 'private_wealth' },
    ]);
    expect(ids(run(buildArticleQuery(u, {})))).toEqual(['a1']);
  });

  it('still filters by a dimension the UI no longer offers', () => {
    expect(ids(run(buildArticleQuery(admin(), { bankingAreas: ['retail_banking'] }))))
      .toEqual(['a2', 'a4']);
  });

  it('reserves a sentinel no taxonomy value can collide with', () => {
    for (const d of DIMENSIONS) {
      for (const entry of TAXONOMY[d]) expect(entry.value).not.toBe(UNCLASSIFIED);
    }
  });
});

/**
 * Grade ordering, which is what the Market Lens opens on.
 *
 * The reader's ask was "A first, then B, and so on". The interesting part is
 * where the two things that are not grades go: an article nobody has reviewed,
 * and an article a reviewer read and ruled out.
 */
describe('sorting by review grade', () => {
  let scratch: InstanceType<typeof DatabaseSync>;
  const admin = () => user(['role_admin']);
  const run3 = (q: { sql: string; params: (string | number)[] }) =>
    scratch.prepare(q.sql).all(...q.params) as Record<string, unknown>[];

  const grade = (id: string, g: string) => {
    scratch.prepare(
      `INSERT INTO article_reviews (article_id, grade, headline, reviewed_at)
       VALUES (?, ?, ?, '2026-08-24T00:00:00Z')`,
    ).run(id, g, `${g} case`);
  };

  beforeAll(() => {
    scratch = freshDb();
    // Seeded worst-first, so a passing order cannot be the insertion order.
    insertArticle(scratch, 'g_d', 'Ruled out', 90, [['ai_type', 'generative_ai']],
                  '2026-08-18T00:00:00Z', 'media', { useCaseEvidence: 'A sentence.' });
    insertArticle(scratch, 'g_none', 'Not yet read', 80, []);
    insertArticle(scratch, 'g_c_1weak', 'Generic, thin', 10, []);
    insertArticle(scratch, 'g_c_2strong', 'Generic, complete', 10,
                  [['ai_type', 'generative_ai']], '2026-08-18T00:00:00Z', 'media',
                  { useCaseEvidence: 'A sentence.' });
    insertArticle(scratch, 'g_b', 'Announced', 20, []);
    insertArticle(scratch, 'g_a', 'Deployed', 30, []);
    grade('g_a', 'A'); grade('g_b', 'B');
    grade('g_c_1weak', 'C'); grade('g_c_2strong', 'C');
    grade('g_d', 'D');
  });

  const order = () =>
    run3(buildArticleQuery(admin(), { sort: 'grade', sortDir: 'desc', limit: 50 }))
      .map((r) => r['id'] as string);

  it('leads with A and descends through the grades', () => {
    const seen = order();
    expect(seen.slice(0, 2)).toEqual(['g_a', 'g_b']);
    expect(seen.indexOf('g_c_2strong')).toBeLessThan(seen.indexOf('g_none'));
  });

  it('puts an unread article above one a reviewer ruled out', () => {
    // D is the only grade that means "a person looked and there is nothing
    // here". Unknown outranks known-worthless, however well the rules scored
    // it — g_d carries the highest relevance and a full completeness tier.
    const seen = order();
    expect(seen.indexOf('g_none')).toBeLessThan(seen.indexOf('g_d'));
    expect(seen.at(-1)).toBe('g_d');
  });

  it('falls back to promise inside a grade, not to the date', () => {
    // Both C rows share a grade, a date and a relevance score. Completeness is
    // the only thing separating them, and it has to still decide. The ids are
    // named so that the weaker one sorts first alphabetically: without the
    // promise tiebreak the ORDER BY falls through to `a.id ASC` and this test
    // passes on the id, which is exactly what it did on the first attempt.

    const seen = order();
    expect(seen.indexOf('g_c_2strong')).toBeLessThan(seen.indexOf('g_c_1weak'));
  });

  it('reverses to weakest-first without disturbing promise inside a grade', () => {
    const seen = run3(buildArticleQuery(admin(), { sort: 'grade', sortDir: 'asc', limit: 50 }))
      .map((r) => r['id'] as string);
    expect(seen[0]).toBe('g_d');
    expect(seen.at(-1)).toBe('g_a');
    // Ascending asks for the weakest *grade* first; within one grade the best
    // article still leads, which is why the tiebreak is pinned to DESC.
    expect(seen.indexOf('g_c_2strong')).toBeLessThan(seen.indexOf('g_c_1weak'));
  });
});

describe('shaping an article for the client', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'x1', url: 'https://example.com/x1',
    title: 'Citi, HSBC, StanChart adopt Ant International’s forex AI tool',
    summary: null, tags: null, rule_hits: '[]', ...over,
  });

  it('drops a summary that is the headline with the outlet name on the end', () => {
    expect(shapeArticle(row({
      summary: 'Citi, HSBC, StanChart adopt Ant International’s forex AI tool Reuters',
    })).summary).toBeNull();
  });

  it('keeps a summary that says something the headline did not', () => {
    const text = 'The three banks will use the Falcon model to forecast currency '
      + 'exposure for corporate clients.';
    expect(shapeArticle(row({ summary: text })).summary).toBe(text);
  });
});


/**
 * Counting use cases rather than the articles that reported them.
 *
 * The tile said "85 AI articles in view" and "85 AI use cases identified", and
 * those were the same count twice. Four outlets on one Starling launch is one
 * use case, and the analysis table had folded it that way for three passes
 * while the tile above it had not.
 */
describe('counting distinct use cases in a view', () => {
  let scratch: InstanceType<typeof DatabaseSync>;
  const admin = () => user(['role_admin']);

  const review = (
    id: string, g: string, actor: string | null, process: string | null,
    maturity: string | null = null,
  ) => {
    scratch.prepare(
      `INSERT INTO article_reviews (article_id, grade, headline, actor, l1_process, maturity,
                                    reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-08-24T00:00:00Z')`,
    ).run(id, g, `${g} case`, actor, process, maturity);
    // Exactly what review:apply writes: the judgement in its own table and the
    // same process as a review-sourced tag, so the filters can see it.
    if (process) {
      scratch.prepare(`INSERT INTO article_tags (article_id, dimension, value, confidence, source)
                       VALUES (?, 'l1_process', ?, 1.0, 'review')`).run(id, process);
    }
  };

  beforeAll(() => {
    scratch = freshDb();

    // One launch, three outlets, three different headlines.
    for (const [i, title] of [
      'Starling launches AI agent assistant for corporate clients',
      "Starling's new AI assistant lands for business customers",
      'Starling Bank rolls out agentic assistant to SME clients',
    ].entries()) {
      insertArticle(scratch, `u_star${i}`, title, 80, []);
      review(`u_star${i}`, 'A', 'Starling', 'p05_relationship_servicing_engagement',
             'in_production');
    }

    // Same bank, a different programme. Separate use case, deliberately: DBS
    // screening payments and DBS drafting credit memos are not one story.
    insertArticle(scratch, 'u_dbs_credit', 'DBS deploys agentic AI for credit memos', 80, []);
    review('u_dbs_credit', 'A', 'DBS', 'p13_lending_credit_solutions', 'pilot');
    insertArticle(scratch, 'u_dbs_fraud', 'DBS screens payments for fraud with ML', 80, []);
    review('u_dbs_fraud', 'A', 'DBS', 'p24_fraud_identity_security', 'in_production');

    // An A whose actor is nobody the term list knows, so it has no key. It can
    // never be shown to be the same use case as another and is always its own.
    insertArticle(scratch, 'u_anon1', 'Bunq puts an AI agent on SBA lending', 80, []);
    review('u_anon1', 'A', 'Bunq', 'p13_lending_credit_solutions', 'in_production');
    insertArticle(scratch, 'u_anon2', 'Aurora Bank automates lending decisions', 80, []);
    review('u_anon2', 'A', 'Aurora Bank', 'p13_lending_credit_solutions', 'pilot');

    // AI market news about the same bank and the same process as the Starling
    // trio. It shares their key exactly and must still never reach the count.
    insertArticle(scratch, 'u_news', 'Starling sets out its AI strategy for 2027', 80, []);
    review('u_news', 'B', 'Starling', 'p05_relationship_servicing_engagement', 'announced');

    // Read and ruled out. Never a use case, whatever it groups with.
    insertArticle(scratch, 'u_out', 'Starling comment on the AI hype cycle', 80, []);
    review('u_out', 'D', 'Starling', 'p05_relationship_servicing_engagement');

    // Nobody has read these two. The rules gave both an AI type and a quoted
    // use case, which is what the tile counts when a view holds no review, and
    // both land on the same bank and process.
    for (const [i, title] of [
      'HSBC puts a generative AI assistant in front of relationship managers',
      'HSBC extends its AI assistant to more relationship managers',
    ].entries()) {
      insertArticle(scratch, `u_hsbc${i}`, title, 80,
                    [['ai_type', 'generative_ai'],
                     ['l1_process', 'p05_relationship_servicing_engagement']],
                    '2026-08-18T00:00:00Z', 'media',
                    { useCaseEvidence: 'The assistant drafts client updates.' });
    }
  });

  const count = (filters: Parameters<typeof buildUseCaseKeysQuery>[1]) => {
    const q = buildUseCaseKeysQuery(admin(), filters);
    return countUseCases(scratch.prepare(q.sql).all(...q.params) as Record<string, unknown>[]);
  };

  it('folds one launch reported by three outlets into one use case', () => {
    // Seven A articles in the view. The article count is what the tile used to
    // show, and it is still reported beside the folded one — the point is that
    // the two figures differ, and by the two duplicate Starling reports.
    const m = buildMeasuresQuery(admin(), {});
    const measured = scratch.prepare(m.sql).all(...m.params) as Record<string, unknown>[];
    expect(measured[0]!['reviewed_use_cases']).toBe(7);

    // starling|p05, dbs|p13, dbs|p24, and the two keyless ones.
    expect(count({}).reviewed).toBe(5);
  });

  it('leaves AI market news out of the use-case count', () => {
    // u_news is a B on the same bank and the same process as the Starling
    // trio, so it folds onto their key and would be invisible in the total if
    // the bucket were wrong. B is the coverage of the market, not a use case
    // in it — counting it here was counting the news as the thing.
    expect(count({ grades: ['B'] }).reviewed).toBe(0);
    expect(count({}).reviewed).toBe(count({ grades: ['A'] }).reviewed);
  });

  it('folds the rules\' own confirmed use cases the same way', () => {
    // The tile falls back to these when nothing in the view has been reviewed,
    // and a fallback that counted articles would reintroduce the bug there.
    const m = buildMeasuresQuery(admin(), { grades: ['unreviewed'] });
    const measured = scratch.prepare(m.sql).all(...m.params) as Record<string, unknown>[];
    expect(measured[0]!['confirmed_use_cases']).toBe(2);

    const c = count({ grades: ['unreviewed'] });
    expect(c.confirmed).toBe(1);
    expect(c.reviewed).toBe(0);
  });

  it('keeps one bank\'s separate programmes separate', () => {
    // DBS twice, under two processes. Folding on the bank alone would lose one.
    expect(count({ l1Processes: ['p24_fraud_identity_security'] }).reviewed).toBe(1);
    // dbs|p13 plus the two keyless ones, which never merge with it or with
    // each other.
    expect(count({ l1Processes: ['p13_lending_credit_solutions'] }).reviewed).toBe(3);
  });

  it('never folds two use cases whose actor the term list does not know', () => {
    // Both are A, both are lending, and neither actor resolves to a known
    // institution — so neither can be shown to be the other, and each stays
    // its own use case.
    const c = count({ l1Processes: ['p13_lending_credit_solutions'] });
    expect(c.reviewed).toBe(3);
  });

  it('reads deployed off the Stage column, not off the letter', () => {
    // Five use cases, three of them live: Starling (folded from three reports),
    // DBS fraud, and Bunq. DBS credit memos and Aurora are pilots — still use
    // cases, still A, not deployed. Under the old rule all five counted,
    // because A *was* "deployed".
    const c = count({});
    expect(c.reviewed).toBe(5);
    expect(c.deployed).toBe(3);
  });

  it('leaves out what a reviewer ruled out, even where it would have folded', () => {
    // u_out shares Starling's key exactly and must not reach either count.
    expect(count({}).reviewed).toBe(5);
  });

  it('respects the view, so a filter narrows the use cases with it', () => {
    expect(count({ grades: ['A', 'B'], search: 'starling' }).reviewed).toBe(1);
  });
});

describe('grouping one use case across outlets', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'g1', url: 'https://example.com/g1', title: 'DBS deploys agentic AI for credit memos',
    summary: null, tags: 'l1_process:p13_lending_credit_solutions', rule_hits: '[]', ...over,
  });

  it('keys on the bank and the process', () => {
    expect(shapeArticle(row()).groupKey).toBe('dbs|p13_lending_credit_solutions');
  });

  it('gives a differently worded report of the same story the same key', () => {
    expect(shapeArticle(row({
      id: 'g2', title: "Singapore's DBS rolls out AI agents to 1,500 bankers",
    })).groupKey).toBe(shapeArticle(row()).groupKey);
  });

  it('prefers the process a reviewer chose over the one the rules tagged', () => {
    expect(shapeArticle(row({
      review_l1_process: 'p38_workforce_skills_talent',
    })).groupKey).toBe('dbs|p38_workforce_skills_talent');
  });

  it('is null when no institution is named, so the row never groups', () => {
    expect(shapeArticle(row({
      title: 'How AI is overhauling one segment of SBA lending',
    })).groupKey).toBeNull();
  });

  it('is null when nothing tagged a process', () => {
    expect(shapeArticle(row({ tags: 'region:singapore_apac' })).groupKey).toBeNull();
  });
});
