-- Whether an article belongs on the Swiss Lens, and what put it there.
--
-- Two columns rather than one, for the same reason maturity has
-- maturity_evidence beside it: a claim this tool makes about an article has to
-- be checkable against the article. "Swiss" with no evidence is an assertion.
--
-- Not a tag in article_tags, and not the existing region tag. Region answers
-- "does this article smell Swiss" — inferred from the text and from the
-- source's own region hint, one bit, no evidence — and the Swiss Lens asks a
-- different question: is a Swiss institution doing something. A Handelszeitung
-- piece about JPMorgan is tagged switzerland and does not belong on that page;
-- a Reuters piece about UBS is often not tagged switzerland and does.
--
-- Written by the rules at ingest and rebuilt by rescore, exactly like maturity,
-- so both columns are derived and nothing here is a place a person edits.
ALTER TABLE article_scores ADD COLUMN ch_nexus TEXT;
ALTER TABLE article_scores ADD COLUMN ch_nexus_evidence TEXT;

CREATE INDEX IF NOT EXISTS idx_scores_ch_nexus ON article_scores(ch_nexus);
