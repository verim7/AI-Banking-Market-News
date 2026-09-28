-- Grades the weekly Routine proposes, waiting for the editor.
--
-- The Routine reads the week's articles and writes a grade for each, as the
-- chat review passes do. Until 2026-09-28 those went straight to
-- article_reviews, and so straight onto the dashboard. Now they land here
-- first, and nothing in this table is read by the dashboard, the filters, the
-- export or the weekly email. The editor accepts, changes or discards each one
-- in the Review Queue, then publishes; publishing copies the accepted rows
-- into article_reviews exactly as review-apply would have.
--
-- The columns mirror article_reviews so a published row is a straight copy.
-- `status`:
--   pending    written by the Routine, not yet looked at
--   accepted   the editor agreed, possibly after changing a field (`edited`)
--   discarded  the editor rejected the proposal; the article stays ungraded
--   published  copied into article_reviews
CREATE TABLE IF NOT EXISTS review_proposals (
  article_id  TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  grade       TEXT NOT NULL CHECK (grade IN ('A','B','C','D')),
  headline    TEXT NOT NULL,
  actor       TEXT,
  task        TEXT,
  technique   TEXT,
  outcome     TEXT,
  ai_type     TEXT,
  l1_process  TEXT,
  use_case    TEXT,
  maturity    TEXT CHECK (maturity IS NULL OR
                          maturity IN ('in_production','pilot','announced','research','unknown')),
  evidence    TEXT,
  confidence  TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  notes       TEXT,
  proposed_at TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','discarded','published')),
  edited      INTEGER NOT NULL DEFAULT 0,
  decided_at  TEXT,
  decided_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_proposals_status ON review_proposals(status);
