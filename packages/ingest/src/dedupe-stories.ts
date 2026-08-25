import { classifyStored, type StoredArticle } from './rescore.ts';
import { credentialsFromEnv, executeAll, queryRows, type D1Credentials } from './load-d1.ts';
import { storyKeys } from './normalize.ts';
import { matchTerms, NAMED_INSTITUTIONS } from '@portal/shared';
import { sqlLiteral as L } from './sql.ts';

/**
 * Find stories already in the archive that are the same story.
 *
 * Ingest-time deduplication only sees one run. Eight rows for one DBS rollout
 * were already stored before story keys existed, and they will not re-arrive to
 * be caught. This clusters what is there.
 *
 * Marks rather than deletes. The clustering is a heuristic and a wrong call
 * must be recoverable by looking — an over-merge that deleted rows would not be.
 */

export interface Candidate {
  id: string;
  title: string;
  published_at: string | null;
  fetched_at: string;
  excerpt: string | null;
  summary: string | null;
  publisher_kind: string;
  region_hint: string | null;
  url_original: string;
}

export interface Cluster {
  key: string;
  keep: Candidate;
  duplicates: Candidate[];
}

/** The strongest L1 process the rules find, or null. */
export function processOf(row: Candidate): string | null {
  const c = classifyStored(row as unknown as StoredArticle);
  const tags = c.tags.filter((t) => t.dimension === 'l1_process');
  return tags.length > 0 ? tags[0]!.value : null;
}

/**
 * Group articles by story key.
 *
 * The kept row is the one with a readable body, then the earliest — a copy that
 * can be read is worth more than a copy that arrived first, and the drill-down
 * is empty without one.
 */
export function cluster(rows: Candidate[]): Cluster[] {
  // A row can carry two keys — the figure and the process — and two rows are
  // the same story if they share EITHER. Grouping on the first key alone put
  // "DBS rolls out agentic AI for corporate credit assessments", which has no
  // figure, in a bucket of its own beside the five that quote "1,500".
  const clusterOf = new Map<string, number>();   // key -> cluster index
  const groups: { keys: Set<string>; rows: Candidate[] }[] = [];

  for (const row of rows) {
    const keys = storyKeys(
      row.title, row.published_at ?? row.fetched_at,
      matchTerms(row.title, NAMED_INSTITUTIONS), processOf(row));
    if (keys.length === 0) continue;

    const existing = keys.map((k) => clusterOf.get(k)).find((i) => i !== undefined);
    const index = existing ?? groups.push({ keys: new Set(), rows: [] }) - 1;
    const group = groups[index]!;
    group.rows.push(row);
    for (const k of keys) {
      group.keys.add(k);
      clusterOf.set(k, index);
    }
  }

  const byKey = new Map<string, Candidate[]>(
    groups.map((g) => [[...g.keys].sort()[0]!, g.rows]));

  const out: Cluster[] = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => {
      const bodyA = (a.excerpt ?? '').length > 200 ? 0 : 1;
      const bodyB = (b.excerpt ?? '').length > 200 ? 0 : 1;
      if (bodyA !== bodyB) return bodyA - bodyB;
      return (a.published_at ?? a.fetched_at).localeCompare(b.published_at ?? b.fetched_at);
    });
    out.push({ key, keep: ranked[0]!, duplicates: ranked.slice(1) });
  }
  return out.sort((a, b) => b.duplicates.length - a.duplicates.length);
}

export function markStatements(clusters: Cluster[]): string[] {
  return clusters.flatMap((c) =>
    c.duplicates.map((d) =>
      `UPDATE articles SET duplicate_of = ${L(c.keep.id)} WHERE id = ${L(d.id)};`));
}

export async function loadCandidates(creds: D1Credentials): Promise<Candidate[]> {
  return queryRows<Candidate>(creds, `
SELECT id, title, published_at, fetched_at, excerpt, summary,
       publisher_kind, NULL AS region_hint, url_original
FROM articles
WHERE duplicate_of IS NULL
ORDER BY COALESCE(published_at, fetched_at) DESC
LIMIT 5000`.trim());
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const creds = credentialsFromEnv();
  if (!creds) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN.');
    process.exitCode = 1;
    return;
  }

  const rows = await loadCandidates(creds);
  const clusters = cluster(rows);
  const duplicates = clusters.reduce((n, c) => n + c.duplicates.length, 0);

  console.log(`\n${rows.length} articles scanned.`);
  console.log(`${clusters.length} story cluster(s), ${duplicates} duplicate row(s).\n`);

  // Every cluster is printed, because a heuristic that merges silently cannot
  // be argued with.
  for (const c of clusters.slice(0, 25)) {
    console.log(`  ${c.key}  (${c.duplicates.length + 1} rows)`);
    console.log(`    keep: ${c.keep.title.slice(0, 92)}`);
    for (const d of c.duplicates) console.log(`     dup: ${d.title.slice(0, 92)}`);
  }
  if (clusters.length > 25) console.log(`  …and ${clusters.length - 25} more clusters`);

  if (dryRun) {
    console.log('\nDry run: nothing written.');
    return;
  }

  await executeAll(creds, markStatements(clusters));
  console.log(`\nMarked ${duplicates} row(s) as duplicates. None deleted.`);
}

if (import.meta.filename === process.argv[1]) await main();
