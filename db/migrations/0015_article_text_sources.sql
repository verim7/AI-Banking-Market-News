-- Where an article's text came from, and the two browser layers that fill it
-- in for articles whose page the crawler could not read (7 Oct 2026).
--
-- Most articles arrive through Google News, whose links do not name the
-- publisher, so the crawler stores the headline alone. Two layers now try
-- again, each once per article:
--
--   chromium       a headless Chromium on GitHub's runners, in the daily
--                  ingest. Not logged in anywhere: it reads what anyone could.
--   local-browser  the editor's own Chrome, driven by a Claude routine on their
--                  computer, through the Review Queue's "Article text" list.
--                  It may be logged in to subscriptions, so this text is kept
--                  private: never shown in the app, never written to the
--                  public repository. It is used to grade, and one quoted
--                  sentence may appear as a use case's evidence.
--
-- NULL excerpt_source on an article with an excerpt means the crawler read it.
-- excerpt_at says when text arrived, so a grade written from the headline can
-- be offered again once the text exists.
--
-- A plain ALTER, which the migration ledger makes safe: scripts/migrate.ts runs
-- each file exactly once.
ALTER TABLE articles ADD COLUMN excerpt_source TEXT;
ALTER TABLE articles ADD COLUMN excerpt_at TEXT;
-- The publisher's own address, where the headless browser followed a Google
-- News link to it.
ALTER TABLE articles ADD COLUMN resolved_url TEXT;
-- One attempt each: a page that failed once is not retried every day.
ALTER TABLE articles ADD COLUMN chromium_tried_at TEXT;
ALTER TABLE articles ADD COLUMN browser_tried_at TEXT;
-- Why the editor's browser could not read it ("paywall", "not found", ...).
ALTER TABLE articles ADD COLUMN browser_note TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_excerpt_at ON articles(excerpt_at);
