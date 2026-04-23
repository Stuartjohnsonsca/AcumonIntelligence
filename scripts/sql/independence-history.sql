-- Independence history + audit-type refresh cadence.
-- Append-only log of every questionnaire submission so firms can audit
-- when a team member was / was not independent. Idempotent; safe to
-- re-run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS audit_member_independence_history (
  id                      TEXT         NOT NULL,
  member_independence_id  TEXT         NOT NULL,
  engagement_id           TEXT         NOT NULL,
  user_id                 TEXT         NOT NULL,
  status                  TEXT         NOT NULL, -- confirmed | declined
  is_independent          BOOLEAN      NULL,
  answers                 JSONB        NULL,
  notes                   TEXT         NULL,
  notified_at             TIMESTAMPTZ  NULL,
  recorded_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_member_independence_history_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS audit_member_independence_history_member_idx
  ON audit_member_independence_history (member_independence_id);
CREATE INDEX IF NOT EXISTS audit_member_independence_history_engagement_idx
  ON audit_member_independence_history (engagement_id);
CREATE INDEX IF NOT EXISTS audit_member_independence_history_user_idx
  ON audit_member_independence_history (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_member_independence_history_member_fkey'
  ) THEN
    ALTER TABLE audit_member_independence_history
      ADD CONSTRAINT audit_member_independence_history_member_fkey
      FOREIGN KEY (member_independence_id)
      REFERENCES audit_member_independence(id)
      ON DELETE CASCADE;
  END IF;
END $$;
