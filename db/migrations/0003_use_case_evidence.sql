-- The quoted sentence describing the use case.
--
-- Rebuilt rather than ALTERed, for the same reason as 0002: SQLite has no
-- "ADD COLUMN IF NOT EXISTS".
--
-- NOT SAFE TO RE-RUN. The copy below omits use_case_evidence — the column this
-- migration adds — so a second run against an already-migrated database drops
-- every extracted use-case quote. scripts/migrate.ts is what guarantees it
-- runs once; the file cannot guarantee it itself.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS article_scores_v3 (
  article_id        TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  relevance_score   REAL NOT NULL,
  rule_hits         TEXT NOT NULL DEFAULT '[]',
  ai_intensity      REAL NOT NULL DEFAULT 0,
  maturity          TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (maturity IN ('in_production','pilot','announced','research','unknown')),
  maturity_evidence TEXT,
  -- Quoted from the article, never generated. NULL when the text describes no
  -- use case: an invented description reads exactly like a real one, which in
  -- a market-intelligence tool is worse than an empty cell.
  use_case_evidence TEXT
);

INSERT OR IGNORE INTO article_scores_v3
  (article_id, relevance_score, rule_hits, ai_intensity, maturity, maturity_evidence)
  SELECT article_id, relevance_score, rule_hits, ai_intensity, maturity, maturity_evidence
  FROM article_scores;

DROP TABLE article_scores;
ALTER TABLE article_scores_v3 RENAME TO article_scores;

CREATE INDEX IF NOT EXISTS idx_scores_relevance ON article_scores(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_ai_intensity ON article_scores(ai_intensity DESC);
CREATE INDEX IF NOT EXISTS idx_scores_maturity ON article_scores(maturity);

PRAGMA foreign_keys = ON;
