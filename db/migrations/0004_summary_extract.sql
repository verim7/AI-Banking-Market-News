-- A short abstract, assembled from the article's own sentences.
--
-- A plain ALTER, and the first migration in this project that can be one.
--
-- 0002 and 0003 had to create-copy-drop-rename because they were re-run on
-- every deploy and SQLite has no "ADD COLUMN IF NOT EXISTS". That pattern is
-- what reset every AI focus score in production to zero, because the copy step
-- can only name the columns that existed before the migration ran.
--
-- scripts/migrate.ts now records each applied migration in schema_migrations
-- and never runs one twice, so this file does not have to survive re-running
-- and can say what it means.

ALTER TABLE article_scores ADD COLUMN summary_extract TEXT;
