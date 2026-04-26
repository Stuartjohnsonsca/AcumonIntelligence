-- Adds a free-text `role_label` column to audit_team_members so admins
-- can override the friendly UI label (Preparer / Reviewer / Partner / EQR)
-- with the exact text they want to appear on client-facing documents
-- (e.g. "Manager" instead of "Reviewer", "Audit Senior" instead of
-- "Preparer").
--
-- Resolution rules in template-context.ts:
--   1. If audit_team_members.role_label is non-empty → use it verbatim.
--   2. Otherwise fall back to the system map keyed off `role`
--      (Junior → Preparer, Manager → Reviewer, RI → Partner, EQR → EQR).
--
-- Nullable — existing rows get NULL and continue rendering the system
-- friendly label, so this migration is non-breaking. Idempotent via
-- IF NOT EXISTS.

ALTER TABLE audit_team_members
  ADD COLUMN IF NOT EXISTS role_label TEXT;

-- Sanity check: column exists, all existing rows have NULL.
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE role_label IS NULL) AS null_role_label,
  COUNT(*) FILTER (WHERE role_label IS NOT NULL) AS set_role_label
FROM audit_team_members;
