import type { ClassifiedArticle } from '@portal/shared';
import { sqlLiteral as L } from './sql.ts';
import type { SourceConfig } from './sources.ts';

export interface D1Credentials {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export function credentialsFromEnv(env = process.env): D1Credentials | null {
  const accountId = env['CLOUDFLARE_ACCOUNT_ID'];
  const databaseId = env['D1_DATABASE_ID'];
  const apiToken = env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
}

/** One HTTP round-trip per batch, so keep batches large but under D1's limits. */
const STATEMENTS_PER_REQUEST = 40;

async function execute(creds: D1Credentials, sql: string): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}`
            + `/d1/database/${creds.databaseId}/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${creds.apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  const payload = (await res.json()) as {
    success?: boolean;
    errors?: { code: number; message: string }[];
  };

  if (!res.ok || payload.success === false) {
    const detail = (payload.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`D1 query failed (HTTP ${res.status}) ${detail}`);
  }
}

export async function executeAll(creds: D1Credentials, statements: string[]): Promise<void> {
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_REQUEST) {
    const chunk = statements.slice(i, i + STATEMENTS_PER_REQUEST);
    await execute(creds, chunk.join('\n'));
  }
}

export function sourceStatements(sources: SourceConfig[]): string[] {
  return sources.map((s) =>
    `INSERT INTO sources (id, name, url, kind, publisher_kind, region_hint, enabled) VALUES `
    + `(${L(s.id)}, ${L(s.name)}, ${L(s.url)}, ${L(s.kind)}, ${L(s.publisher_kind)}, `
    + `${L(s.region_hint ?? null)}, 1) `
    + `ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, `
    + `kind=excluded.kind, publisher_kind=excluded.publisher_kind, `
    + `region_hint=excluded.region_hint;`);
}

/**
 * Statements for one article. Existing rows are updated rather than skipped so
 * a re-run with an improved classifier refreshes tags and scores in place —
 * but fetched_at is preserved, because that is when we first saw the story.
 */
export function articleStatements(a: ClassifiedArticle): string[] {
  const searchText = [a.title, a.summary ?? '', a.excerpt ?? ''].join(' ').toLowerCase().slice(0, 8000);
  const enrichedBy = a.classification.ruleHits.some((h) => h.rule === 'claude') ? 'claude' : 'rules';

  const out: string[] = [
    `INSERT INTO articles (id, url_canonical, url_original, title, summary, excerpt, `
    + `search_text, source_id, source_name, publisher_kind, language, published_at, enriched_by) `
    + `VALUES (${L(a.id)}, ${L(a.urlCanonical)}, ${L(a.urlOriginal)}, ${L(a.title)}, `
    + `${L(a.summary)}, ${L(a.excerpt)}, ${L(searchText)}, ${L(a.sourceId)}, ${L(a.sourceName)}, `
    + `${L(a.publisherKind)}, ${L(a.language)}, ${L(a.publishedAt)}, ${L(enrichedBy)}) `
    + `ON CONFLICT(url_canonical) DO UPDATE SET title=excluded.title, summary=excluded.summary, `
    + `excerpt=excluded.excerpt, search_text=excluded.search_text, `
    + `published_at=COALESCE(excluded.published_at, articles.published_at), `
    + `enriched_by=excluded.enriched_by;`,

    // Replace tags wholesale: a re-classification may *remove* a tag, and
    // leaving stale tags behind would silently widen every filter.
    `DELETE FROM article_tags WHERE article_id = ${L(a.id)};`,
  ];

  for (const t of a.classification.tags) {
    out.push(
      `INSERT OR REPLACE INTO article_tags (article_id, dimension, value, confidence) `
      + `VALUES (${L(a.id)}, ${L(t.dimension)}, ${L(t.value)}, ${L(t.confidence)});`);
  }

  out.push(
    `INSERT INTO article_scores (article_id, relevance_score, rule_hits, ai_intensity, `
    + `maturity, maturity_evidence, use_case_evidence, summary_extract) `
    + `VALUES (${L(a.id)}, ${L(a.classification.relevanceScore)}, `
    + `${L(JSON.stringify(a.classification.ruleHits))}, ${L(a.classification.aiIntensity)}, `
    + `${L(a.classification.maturity)}, ${L(a.classification.maturityEvidence)}, `
    + `${L(a.classification.useCaseEvidence)}, `
    + `${L(a.classification.summaryExtract)}) `
    + `ON CONFLICT(article_id) DO UPDATE SET relevance_score=excluded.relevance_score, `
    + `rule_hits=excluded.rule_hits, ai_intensity=excluded.ai_intensity, `
    + `maturity=excluded.maturity, maturity_evidence=excluded.maturity_evidence, `
    + `use_case_evidence=excluded.use_case_evidence, `
    + `summary_extract=excluded.summary_extract;`);

  return out;
}

export interface RunSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'failed';
  itemsFetched: number;
  itemsNew: number;
  sourcesOk: number;
  sourcesFailed: number;
  detail: unknown;
}

export function runStatement(run: RunSummary): string {
  return `INSERT INTO ingest_runs (id, started_at, finished_at, status, items_fetched, `
       + `items_new, sources_ok, sources_failed, detail) VALUES (${L(run.id)}, `
       + `${L(run.startedAt)}, ${L(run.finishedAt)}, ${L(run.status)}, ${L(run.itemsFetched)}, `
       + `${L(run.itemsNew)}, ${L(run.sourcesOk)}, ${L(run.sourcesFailed)}, `
       + `${L(JSON.stringify(run.detail))});`;
}

/**
 * Run a read query and return its rows.
 *
 * Generic because the ingest is no longer the only thing that reads: rescoring
 * reads every stored article back out to re-classify it, and duplicating this
 * fetch-and-unwrap for each caller is how the two drift apart.
 */
export async function queryRows<T>(creds: D1Credentials, sql: string): Promise<T[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}`
            + `/d1/database/${creds.databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${creds.apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const payload = (await res.json()) as {
    success?: boolean;
    result?: { results?: T[] }[];
    errors?: { code: number; message: string }[];
  };
  if (!res.ok || payload.success === false) {
    const detail = (payload.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`D1 select failed (HTTP ${res.status}) ${detail}`);
  }
  return payload.result?.[0]?.results ?? [];
}

/** Canonical URLs already in the database, so the run can report what is new. */
export async function existingUrls(
  creds: D1Credentials, urls: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < urls.length; i += 200) {
    const chunk = urls.slice(i, i + 200);
    const sql = `SELECT url_canonical FROM articles WHERE url_canonical IN `
              + `(${chunk.map(L).join(',')});`;
    const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}`
              + `/d1/database/${creds.databaseId}/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const payload = (await res.json()) as {
      success?: boolean;
      result?: { results?: { url_canonical: string }[] }[];
      errors?: { code: number; message: string }[];
    };
    if (!res.ok || payload.success === false) {
      const detail = (payload.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
      throw new Error(`D1 select failed (HTTP ${res.status}) ${detail}`);
    }
    for (const row of payload.result?.[0]?.results ?? []) found.add(row.url_canonical);
  }
  return found;
}

export async function load(
  creds: D1Credentials,
  sources: SourceConfig[],
  articles: ClassifiedArticle[],
  run: RunSummary,
): Promise<void> {
  await executeAll(creds, sourceStatements(sources));
  await executeAll(creds, articles.flatMap(articleStatements));
  await executeAll(creds, [runStatement(run)]);
}
