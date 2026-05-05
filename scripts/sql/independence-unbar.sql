-- Independence: per-User unbar audit trail.
-- Adds two columns to audit_member_independence_history so admin
-- "unbar" actions are recorded with both the kind of event and who
-- performed it. Idempotent; safe to re-run in Supabase SQL Editor.

ALTER TABLE audit_member_independence_history
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'submission';

ALTER TABLE audit_member_independence_history
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT NULL;
