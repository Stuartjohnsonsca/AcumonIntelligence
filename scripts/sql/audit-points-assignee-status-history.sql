-- Audit points — assignee + status workflow + status history.
-- Idempotent; safe to re-run on any Supabase database.
-- Run in Supabase SQL Editor on production before deploying.
--
-- Adds:
--   • assigned_to_user_id / _name / _role — team member responsible
--     for actioning the point. Role is cached at assignment time so
--     the status-change authority gate can compare ranks without a
--     second DB hop.
--   • status_history (jsonb) — append-only audit trail of every
--     status change. Each entry is { status, byId, byName, byRole,
--     at } and the UI surfaces it as a per-point timeline. The gate
--     that prevents juniors from overriding a senior's status uses
--     the most-senior-role-that-set-the-current-status from this log.

ALTER TABLE audit_points
  ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_name    TEXT NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_role    TEXT NULL,
  ADD COLUMN IF NOT EXISTS status_history      JSONB NULL;

CREATE INDEX IF NOT EXISTS audit_points_engagement_assignee_idx
  ON audit_points (engagement_id, assigned_to_user_id);
