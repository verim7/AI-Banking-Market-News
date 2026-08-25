-- The same story, told by a different outlet.
--
-- One DBS rollout arrived as eight rows because eight newsrooms wrote eight
-- genuinely different headlines, so neither the URL key nor the title key saw
-- them as related. Story keys catch them now; this column records the finding.
--
-- Marked, never deleted. A wrong call has to stay visible and reversible: the
-- Lens hides duplicates, the Archive still shows them, and clearing the column
-- undoes it. Deleting would make the mistake unrecoverable and the clustering
-- is a heuristic.
--
-- A plain ALTER, which the migration ledger makes safe: scripts/migrate.ts runs
-- each file exactly once.
ALTER TABLE articles ADD COLUMN duplicate_of TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_duplicate_of ON articles(duplicate_of);
