-- Where a tag came from.
--
-- article_tags was written only by the rules — ingest and rescore — while a
-- reviewer's judgement went to article_reviews and stayed there. Every consumer
-- reads article_tags, so 175 hand-assigned L1 processes were stored and
-- unreachable: the "By L1 process" chart could see 16 of the 121 reviewed use
-- cases, and a reviewer had classified 120 of them.
--
-- Maturity already resolves this correctly in queries.ts, as
-- COALESCE(rv.maturity, sc.maturity, 'unknown') — a review overrides the rules
-- where it has an opinion. This column lets the tag dimensions do the same
-- without every consumer learning a second table: a review writes its tags
-- here with source='review', and rescore leaves those alone.
--
-- Defaulting to 'rules' is what makes this safe on a populated table: every
-- existing row is rule output and is correctly labelled as such.
ALTER TABLE article_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'rules';

CREATE INDEX IF NOT EXISTS idx_tags_source ON article_tags(article_id, dimension, source);
