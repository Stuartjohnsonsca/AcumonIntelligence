-- Engagement-scoped audit trail. Captures every meaningful button-
-- triggered action on an engagement (send-to-RMM, sign-off, specialist
-- review send/decide, template generation, …) so the Outstanding tab
-- can surface a "who did what, when" history — especially useful for
-- actions that bypass the green-dot sign-off flow but still commit a
-- decision.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS engagement_action_logs (
  id               TEXT PRIMARY KEY,
  engagement_id    TEXT NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  firm_id          TEXT NOT NULL,
  actor_user_id    TEXT,
  actor_name       TEXT NOT NULL,
  action           TEXT NOT NULL,
  summary          TEXT NOT NULL,
  target_type      TEXT,
  target_id        TEXT,
  metadata         JSONB,
  occurred_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS engagement_action_logs_engagement_id_occurred_at_idx
  ON engagement_action_logs (engagement_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS engagement_action_logs_firm_id_occurred_at_idx
  ON engagement_action_logs (firm_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS engagement_action_logs_action_idx
  ON engagement_action_logs (action);
