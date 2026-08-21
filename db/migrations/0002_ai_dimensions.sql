-- AI type, L1 process, AI intensity and deployment maturity.
--
-- Both tables are rebuilt rather than altered, and deliberately so:
--   * article_tags carries a CHECK listing the allowed dimensions, and SQLite
--     cannot ALTER a CHECK constraint.
--   * article_scores could take ADD COLUMN, but SQLite has no
--     "ADD COLUMN IF NOT EXISTS", so a second run would fail on a duplicate
--     column.
--
-- NOT SAFE TO RE-RUN, contrary to what this header used to claim. The copy
-- below lists the columns that exist *before* this migration, so running it
-- against an already-migrated database rebuilds article_scores and resets
-- ai_intensity, maturity and maturity_evidence to their defaults for every
-- row. That happened in production and zeroed every AI focus score in the
-- product, silently.
--
-- It cannot be written any other way: the columns it must preserve are the
-- ones it is adding. So the guarantee lives outside the file — scripts/migrate.ts
-- records each applied migration in schema_migrations and never runs one twice.

PRAGMA foreign_keys = OFF;

-- ---- article_tags: widen the allowed dimensions

CREATE TABLE IF NOT EXISTS article_tags_new (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  dimension  TEXT NOT NULL CHECK (dimension IN (
    'region', 'banking_area', 'bank_category', 'use_case', 'ai_type', 'l1_process')),
  value      TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (article_id, dimension, value)
);

INSERT OR IGNORE INTO article_tags_new (article_id, dimension, value, confidence)
  SELECT article_id, dimension, value, confidence FROM article_tags;

DROP TABLE article_tags;
ALTER TABLE article_tags_new RENAME TO article_tags;
CREATE INDEX IF NOT EXISTS idx_tags_lookup ON article_tags(dimension, value, article_id);

-- ---- article_scores: AI intensity and deployment maturity
--
-- ai_intensity is separate from relevance_score because they answer different
-- questions. Relevance weighs who published it and how recent it is; intensity
-- asks only how central AI is to the piece. Keeping AI-adjacent noise out of
-- the Lens needs the second number, not the first.

CREATE TABLE IF NOT EXISTS article_scores_new (
  article_id        TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  relevance_score   REAL NOT NULL,
  rule_hits         TEXT NOT NULL DEFAULT '[]',
  ai_intensity      REAL NOT NULL DEFAULT 0,
  maturity          TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (maturity IN ('in_production','pilot','announced','research','unknown')),
  -- The phrase the maturity was read from, so a reader can judge the claim
  -- rather than take the label on trust.
  maturity_evidence TEXT
);

INSERT OR IGNORE INTO article_scores_new (article_id, relevance_score, rule_hits)
  SELECT article_id, relevance_score, rule_hits FROM article_scores;

DROP TABLE article_scores;
ALTER TABLE article_scores_new RENAME TO article_scores;

CREATE INDEX IF NOT EXISTS idx_scores_relevance ON article_scores(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_ai_intensity ON article_scores(ai_intensity DESC);
CREATE INDEX IF NOT EXISTS idx_scores_maturity ON article_scores(maturity);

PRAGMA foreign_keys = ON;
