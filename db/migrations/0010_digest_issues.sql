-- The weekly digest, once its editor has approved it.
--
-- One row per ISO week. Written by the digest workflow's approve step and
-- stamped again when the issue is sent; read by the dashboard, which shows the
-- latest approved summary on Trends & Summary. An issue that was never
-- approved never gets a row, so the dashboard cannot show a draft.
--
-- `summary` is the JSON the weekly Routine wrote and `validateDigest` passed:
-- {"week": ..., "sentences": [{"text": ..., "cites": [...]}]}. NULL when the
-- issue went out without one.
CREATE TABLE IF NOT EXISTS digest_issues (
  week        TEXT PRIMARY KEY,
  as_of       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  summary     TEXT,
  approved_at TEXT NOT NULL,
  sent_at     TEXT
);
