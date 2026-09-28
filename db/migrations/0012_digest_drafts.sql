-- The weekly email, from draft to sent.
--
-- The Tuesday Routine builds the issue and stores it here as a snapshot: the
-- whole model the email is rendered from, and the validated summary. The
-- editor reviews that snapshot in the tracker's Review Queue, leaves out what
-- should not go, and approves. Approval renders the email once and stores the
-- result; Wednesday's send mails exactly that HTML, so what colleagues receive
-- is what the editor saw.
--
-- A snapshot rather than a query at send time: grading runs every morning, and
-- an issue rebuilt on Wednesday would carry lines nobody reviewed.
--
-- digest_issues stays as it is: the approved issue the Trends page shows.
CREATE TABLE IF NOT EXISTS digest_drafts (
  week         TEXT PRIMARY KEY,
  as_of        TEXT NOT NULL,
  built_at     TEXT NOT NULL,
  -- DigestModel as JSON, and DigestSummary as JSON or NULL.
  model        TEXT NOT NULL,
  summary      TEXT,
  -- Why the summary is missing, for the editor only.
  summary_note TEXT,
  -- Article ids and "summary:<n>" keys the editor left out, as a JSON array.
  excluded     TEXT NOT NULL DEFAULT '[]',
  -- Set on approval: the rendered email and its hash.
  subject      TEXT,
  html         TEXT,
  text         TEXT,
  sha256       TEXT,
  approved_at  TEXT,
  approved_by  TEXT,
  sent_at      TEXT,
  recipients   INTEGER
);
