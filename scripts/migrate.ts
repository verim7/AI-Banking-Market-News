import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Apply each migration exactly once.
 *
 * The previous scheme piped every migration file at wrangler on every run and
 * called that idempotent, because each file was written to be re-runnable.
 * Two of them were not, and the failure was silent and destructive.
 *
 * 0002 and 0003 rebuild `article_scores` — SQLite cannot ALTER a CHECK
 * constraint, so create-copy-drop-rename is the only route. Their copy step
 * lists the columns that existed *before* they ran:
 *
 *   INSERT INTO article_scores_new (article_id, relevance_score, rule_hits)
 *     SELECT article_id, relevance_score, rule_hits FROM article_scores;
 *
 * On a database that has already been migrated, that is not a no-op. It is a
 * rebuild that drops ai_intensity, maturity, maturity_evidence and
 * use_case_evidence back to their defaults for every row — every AI focus
 * score in the product reset to zero, with no error anywhere.
 *
 * A migration cannot be trusted to know whether it has run. A ledger can, so
 * one is kept here: `schema_migrations` records each applied filename and the
 * runner skips what it finds. Migrations no longer need to be re-runnable, and
 * the ones that quietly are not can no longer do harm.
 */

const MIGRATIONS_DIR = 'db/migrations';
const SEED = 'db/seed.sql';

/**
 * Migrations that existed before this ledger did.
 *
 * A database created earlier carries no record of what it has applied, and
 * these three are exactly the ones that must never run a second time. When the
 * ledger is created on a database that already holds articles, they are marked
 * applied rather than executed. A fresh database has no `articles` table, so it
 * runs them normally and records them the same way.
 */
const PRE_LEDGER = [
  '0001_init.sql',
  '0002_ai_dimensions.sql',
  '0003_use_case_evidence.sql',
];

export type Remote = '--local' | '--remote';

function d1(sql: string, remote: Remote): string {
  return execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'portal', remote, '--json', '--command', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function d1File(path: string, remote: Remote): void {
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'portal', remote, '--file', path, '--yes',
  ], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
}

/** Rows out of wrangler's --json envelope, which varies by version. */
export function rowsFrom(json: string): Record<string, unknown>[] {
  const start = json.indexOf('[');
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(json.slice(start)) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const results = (first as { results?: unknown })?.results;
    return Array.isArray(results) ? results as Record<string, unknown>[] : [];
  } catch {
    return [];
  }
}

export function migrationFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

/** Files still to run, given what the ledger already holds. */
export function pending(all: string[], applied: Set<string>): string[] {
  return all.filter((f) => !applied.has(f));
}

async function main(): Promise<void> {
  const remote: Remote = process.argv.includes('--remote') ? '--remote' : '--local';
  const label = remote === '--remote' ? 'remote' : 'local';

  console.log(`Migrating the ${label} database.\n`);

  d1(`CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`, remote);

  const applied = new Set(
    rowsFrom(d1('SELECT filename FROM schema_migrations;', remote))
      .map((r) => String(r['filename'])),
  );

  // Adopting an existing database: it predates the ledger, so the migrations
  // that shipped before the ledger are recorded rather than run. Detected by
  // the presence of `articles` — a fresh database has none and takes the
  // ordinary path below.
  if (applied.size === 0) {
    const existing = rowsFrom(d1(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='articles';`, remote));

    if (existing.length > 0) {
      console.log('This database predates the migration ledger.');
      console.log(`Recording as already applied, without running: ${PRE_LEDGER.join(', ')}\n`);
      const values = PRE_LEDGER.map((f) => `('${f}')`).join(', ');
      d1(`INSERT OR IGNORE INTO schema_migrations (filename) VALUES ${values};`, remote);
      for (const f of PRE_LEDGER) applied.add(f);
    }
  }

  const all = migrationFiles(MIGRATIONS_DIR);
  const todo = pending(all, applied);

  if (todo.length === 0) {
    console.log(`Nothing to apply. ${all.length} migration(s) already recorded.`);
  }

  for (const file of todo) {
    console.log(`Applying ${file} …`);
    d1File(join(MIGRATIONS_DIR, file), remote);
    d1(`INSERT OR IGNORE INTO schema_migrations (filename) VALUES ('${basename(file)}');`, remote);
    console.log(`  recorded.\n`);
  }

  // The seed is genuinely re-runnable — it is INSERT OR IGNORE of roles and
  // permissions — and must run every time so a new permission reaches an
  // existing database.
  console.log('Applying the seed …');
  d1File(SEED, remote);

  console.log(`\nDone. ${todo.length} migration(s) applied, ${applied.size + todo.length} recorded in total.`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
