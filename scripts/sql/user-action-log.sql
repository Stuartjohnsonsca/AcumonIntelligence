-- User Action Log + retention-oriented indexes on engagement action log.
-- Idempotent; safe to re-run.
--
-- The audit trail needs to capture every user's actions (firm-side
-- and client-portal) and survive for years. Two changes:
--
--   1. New table user_action_logs for engagement-agnostic user
--      actions (login, password reset, 2FA, profile edits, etc.).
--      No FK on userId — actions stay visible if a user is hard-
--      deleted. No retention cron — rows persist indefinitely.
--
--   2. Two extra indexes on engagement_action_logs so queries that
--      span years stay fast:
--        - occurred_at alone, for cross-firm time-range scans.
--        - (actor_user_id, occurred_at), for per-user history.

CREATE TABLE IF NOT EXISTS user_action_logs (
  id           TEXT PRIMARY KEY,
  user_kind    TEXT NOT NULL,
  user_id      TEXT NULL,
  user_name    TEXT NOT NULL,
  firm_id      TEXT NULL,
  client_id    TEXT NULL,
  action       TEXT NOT NULL,
  summary      TEXT NOT NULL,
  ip_address   TEXT NULL,
  user_agent   TEXT NULL,
  metadata     JSONB NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_action_logs_user_kind_user_id_occurred_at_idx
  ON user_action_logs (user_kind, user_id, occurred_at);
CREATE INDEX IF NOT EXISTS user_action_logs_firm_id_occurred_at_idx
  ON user_action_logs (firm_id, occurred_at);
CREATE INDEX IF NOT EXISTS user_action_logs_client_id_occurred_at_idx
  ON user_action_logs (client_id, occurred_at);
CREATE INDEX IF NOT EXISTS user_action_logs_action_idx
  ON user_action_logs (action);
CREATE INDEX IF NOT EXISTS user_action_logs_occurred_at_idx
  ON user_action_logs (occurred_at);

-- Long-retention indexes on the existing engagement action log.
CREATE INDEX IF NOT EXISTS engagement_action_logs_occurred_at_idx
  ON engagement_action_logs (occurred_at);
CREATE INDEX IF NOT EXISTS engagement_action_logs_actor_user_id_occurred_at_idx
  ON engagement_action_logs (actor_user_id, occurred_at);
