-- The editor's own subject line for the weekly email (7 Oct 2026).
--
-- The subject is built from the issue (title, date, who moved). The editor can
-- now replace it in the Review Queue. NULL means "use the built one". Kept
-- apart from `subject`, which is set on approval to what was actually
-- approved, so clearing the override always falls back to the built subject.
--
-- A plain ALTER, which the migration ledger makes safe: scripts/migrate.ts runs
-- each file exactly once.
ALTER TABLE digest_drafts ADD COLUMN subject_override TEXT;
