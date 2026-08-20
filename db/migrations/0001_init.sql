-- AI Banking Market News - initial schema (Cloudflare D1 / SQLite)
--
-- Design notes that matter later:
--  * articles.url_canonical is the dedupe key. The ingest job canonicalises URLs
--    (strip tracking params, lowercase host) before insert, so the same story
--    arriving from two feeds lands once.
--  * Every classification is stored as a row in article_tags rather than as
--    columns, because an article is genuinely multi-region and multi-area. A
--    column-per-dimension model forces a false single choice.
--  * article_scores keeps rule_hits so a relevance score is always explainable.
--    The HIL tab shows *why* something surfaced; an opaque score is untriageable.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- sources

CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('rss', 'gdelt')),
  publisher_kind TEXT NOT NULL CHECK (publisher_kind IN ('consultancy','regulator','bank','media')),
  region_hint    TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- articles

CREATE TABLE IF NOT EXISTS articles (
  id             TEXT PRIMARY KEY,
  url_canonical  TEXT NOT NULL UNIQUE,
  url_original   TEXT NOT NULL,
  title          TEXT NOT NULL,
  summary        TEXT,
  excerpt        TEXT,
  -- lowercased "title + summary + excerpt", used for LIKE search in the Archive
  search_text    TEXT NOT NULL DEFAULT '',
  source_id      TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_name    TEXT NOT NULL,
  publisher_kind TEXT NOT NULL,
  language       TEXT,
  published_at   TEXT,
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  enriched_by    TEXT NOT NULL DEFAULT 'rules' CHECK (enriched_by IN ('rules','claude'))
);

CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source    ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched   ON articles(fetched_at DESC);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  dimension  TEXT NOT NULL CHECK (dimension IN ('region','banking_area','bank_category','use_case')),
  value      TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (article_id, dimension, value)
);

CREATE INDEX IF NOT EXISTS idx_tags_lookup ON article_tags(dimension, value, article_id);

CREATE TABLE IF NOT EXISTS article_scores (
  article_id      TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  relevance_score REAL NOT NULL,
  rule_hits       TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_scores_relevance ON article_scores(relevance_score DESC);

-- ---------------------------------------------------------------- identity

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  built_in    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS permissions (
  key         TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- A role with NO scope rows sees everything. A role with scope rows sees only
-- articles matching them: within a dimension the values are OR-ed, across
-- dimensions they are AND-ed. Enforced in SQL in rbac.ts, never in the UI.
CREATE TABLE IF NOT EXISTS role_scopes (
  role_id   TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('region','banking_area','bank_category','use_case')),
  value     TEXT NOT NULL,
  PRIMARY KEY (role_id, dimension, value)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------- user data

CREATE TABLE IF NOT EXISTS favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE IF NOT EXISTS hil_decisions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('relevant','not_relevant','undecided')),
  note       TEXT NOT NULL DEFAULT '',
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_hil_decision ON hil_decisions(user_id, decision);

-- ---------------------------------------------------------------- run health

CREATE TABLE IF NOT EXISTS ingest_runs (
  id             TEXT PRIMARY KEY,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('running','ok','partial','failed')),
  items_fetched  INTEGER NOT NULL DEFAULT 0,
  items_new      INTEGER NOT NULL DEFAULT 0,
  sources_ok     INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  detail         TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON ingest_runs(started_at DESC);
