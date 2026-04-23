-- Independence gate — per team-member sign-off before they can view/interact
-- with an engagement. Idempotent; safe to re-run.
--
-- Run in Supabase SQL Editor on production.

CREATE TABLE IF NOT EXISTS audit_member_independence (
  id              TEXT         NOT NULL,
  engagement_id   TEXT         NOT NULL,
  user_id         TEXT         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'outstanding', -- outstanding | confirmed | declined
  is_independent  BOOLEAN      NULL,
  answers         JSONB        NULL,
  notes           TEXT         NULL,
  confirmed_at    TIMESTAMPTZ  NULL,
  notified_at     TIMESTAMPTZ  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_member_independence_pkey PRIMARY KEY (id)
);

-- Unique: one row per (engagement, user)
CREATE UNIQUE INDEX IF NOT EXISTS audit_member_independence_engagement_id_user_id_key
  ON audit_member_independence (engagement_id, user_id);

CREATE INDEX IF NOT EXISTS audit_member_independence_engagement_id_idx
  ON audit_member_independence (engagement_id);

CREATE INDEX IF NOT EXISTS audit_member_independence_user_id_idx
  ON audit_member_independence (user_id);

-- FKs (skip if already present — the DO block makes this idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_member_independence_engagement_id_fkey'
  ) THEN
    ALTER TABLE audit_member_independence
      ADD CONSTRAINT audit_member_independence_engagement_id_fkey
      FOREIGN KEY (engagement_id) REFERENCES audit_engagements(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_member_independence_user_id_fkey'
  ) THEN
    ALTER TABLE audit_member_independence
      ADD CONSTRAINT audit_member_independence_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
