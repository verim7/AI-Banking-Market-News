-- Reviewed AI use cases: judgements made by reading, not by matching terms.
--
-- A SEPARATE TABLE, deliberately. `rescore` deletes and rewrites every row it
-- owns in article_scores and article_tags, and migration 0002 once reset
-- derived columns across a database full of articles. A reviewed judgement
-- costs real effort to produce and must not live anywhere an automated rebuild
-- can reach it. Nothing in the rescore path touches this table.
--
-- Safe to re-run: a plain CREATE IF NOT EXISTS, no copy-and-rename, so it
-- cannot destroy what it is meant to protect.

CREATE TABLE IF NOT EXISTS article_reviews (
  article_id  TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,

  -- A: deployed (actor + task + technique, live or piloting)
  -- B: announced (actor + task, intent only)
  -- C: generic (no named deployment — vendor launch, survey, market report)
  -- D: not a use case (commentary, funding, regulation, opinion)
  grade       TEXT NOT NULL CHECK (grade IN ('A','B','C','D')),

  -- The written one-line use case. This is the only field in the product that
  -- is composed rather than quoted, which is why `evidence` below is required
  -- to travel with it.
  headline    TEXT NOT NULL,

  actor       TEXT,          -- the named institution, or NULL when there is none
  task        TEXT,          -- verb and object: "drafts credit memos"
  technique   TEXT,          -- free text: "LLM over policy documents"
  outcome     TEXT,          -- measured effect, when the article states one

  -- Overrides for the rule-derived dimensions. NULL means "the rules were
  -- right, leave them alone" rather than "no value".
  ai_type     TEXT,
  l1_process  TEXT,
  use_case    TEXT,
  maturity    TEXT CHECK (maturity IS NULL OR
                          maturity IN ('in_production','pilot','announced','research','unknown')),

  -- The sentence from the article that supports the line above. Required for
  -- grades A and B, enforced by the importer rather than here so the message
  -- can name the record.
  evidence    TEXT,
  confidence  TEXT NOT NULL DEFAULT 'medium'
                CHECK (confidence IN ('high','medium','low')),
  notes       TEXT,

  reviewed_at TEXT NOT NULL,
  -- Which pass wrote this, so a later, better pass can be told apart from an
  -- early one without reading every row.
  reviewer    TEXT NOT NULL DEFAULT 'ai-review'
);

CREATE INDEX IF NOT EXISTS idx_article_reviews_grade ON article_reviews(grade);
