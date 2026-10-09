-- Every re-grade, so the app can show which grades changed and why (10 Oct
-- 2026).
--
-- article_reviews holds only the current grade; the history lives in the
-- decision files, which review-apply replays in order on every run. It now
-- also rebuilds this table from them: one row for each pass after an
-- article's first, with the grade before it. The Review Queue's "Grades
-- re-checked with article text" section reads it, joined to where the text
-- came from (articles.excerpt_source).
CREATE TABLE IF NOT EXISTS grade_history (
  article_id     TEXT NOT NULL,
  -- The date of the decision file that holds this pass (YYYY-MM-DD).
  pass_on        TEXT NOT NULL,
  grade          TEXT NOT NULL,
  previous_grade TEXT NOT NULL,
  file           TEXT NOT NULL,
  PRIMARY KEY (article_id, file)
);
CREATE INDEX IF NOT EXISTS idx_grade_history_pass_on ON grade_history(pass_on);
