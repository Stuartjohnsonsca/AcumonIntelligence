-- Portal Principal feature — Phase 1 schema.
-- Idempotent; safe to re-run on any Supabase database.
-- Run in Supabase SQL Editor on production before deploying.

-- ─── Firm: firm-wide escalation-day defaults ──────────────────────────────
ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS default_portal_escalation_days_1 INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS default_portal_escalation_days_2 INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS default_portal_escalation_days_3 INTEGER NOT NULL DEFAULT 3;

-- ─── AuditEngagement: Portal Principal FK + per-engagement overrides ──────
ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS portal_principal_id       TEXT NULL,
  ADD COLUMN IF NOT EXISTS portal_escalation_days_1  INTEGER NULL,
  ADD COLUMN IF NOT EXISTS portal_escalation_days_2  INTEGER NULL,
  ADD COLUMN IF NOT EXISTS portal_escalation_days_3  INTEGER NULL,
  ADD COLUMN IF NOT EXISTS portal_setup_completed_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_engagements_portal_principal_id_fkey') THEN
    ALTER TABLE audit_engagements
      ADD CONSTRAINT audit_engagements_portal_principal_id_fkey
      FOREIGN KEY (portal_principal_id) REFERENCES client_portal_users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── PortalRequest: routing + assignment + escalation tracking ────────────
ALTER TABLE portal_requests
  ADD COLUMN IF NOT EXISTS routing_fs_line_id       TEXT NULL,
  ADD COLUMN IF NOT EXISTS routing_tb_account_code  TEXT NULL,
  ADD COLUMN IF NOT EXISTS assigned_portal_user_id  TEXT NULL,
  ADD COLUMN IF NOT EXISTS assigned_at              TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS escalation_level         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_log           JSONB NULL;

CREATE INDEX IF NOT EXISTS portal_requests_assigned_portal_user_id_idx
  ON portal_requests (assigned_portal_user_id);
CREATE INDEX IF NOT EXISTS portal_requests_engagement_id_status_escalation_level_idx
  ON portal_requests (engagement_id, status, escalation_level);

-- ─── ClientPortalStaffMember: the Portal Principal's curated staff list ──
CREATE TABLE IF NOT EXISTS client_portal_staff_members (
  id                          TEXT NOT NULL,
  client_id                   TEXT NOT NULL,
  engagement_id               TEXT NOT NULL,
  portal_user_id              TEXT NULL,
  name                        TEXT NOT NULL,
  email                       TEXT NOT NULL,
  role                        TEXT NULL,
  access_confirmed            BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  inherited_from_engagement_id TEXT NULL,
  added_by_portal_user_id     TEXT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_portal_staff_members_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_portal_staff_members_engagement_id_email_key
  ON client_portal_staff_members (engagement_id, email);
CREATE INDEX IF NOT EXISTS client_portal_staff_members_engagement_id_idx
  ON client_portal_staff_members (engagement_id);
CREATE INDEX IF NOT EXISTS client_portal_staff_members_portal_user_id_idx
  ON client_portal_staff_members (portal_user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_staff_members_engagement_id_fkey') THEN
    ALTER TABLE client_portal_staff_members
      ADD CONSTRAINT client_portal_staff_members_engagement_id_fkey
      FOREIGN KEY (engagement_id) REFERENCES audit_engagements(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_staff_members_portal_user_id_fkey') THEN
    ALTER TABLE client_portal_staff_members
      ADD CONSTRAINT client_portal_staff_members_portal_user_id_fkey
      FOREIGN KEY (portal_user_id) REFERENCES client_portal_users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── ClientPortalWorkAllocation: FS Line / TB code → 3 staff slots ───────
CREATE TABLE IF NOT EXISTS client_portal_work_allocations (
  id              TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  engagement_id   TEXT NOT NULL,
  fs_line_id      TEXT NULL,
  tb_account_code TEXT NULL,
  staff1_user_id  TEXT NULL,
  staff2_user_id  TEXT NULL,
  staff3_user_id  TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_portal_work_allocations_pkey PRIMARY KEY (id)
);

-- A (fs_line_id, tb_account_code) pair of (NULL, NULL) is legal (catch-all
-- row) — Postgres treats NULLs as distinct in unique constraints so we
-- don't collide, and we rely on application code to keep the catch-all
-- singleton per engagement.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_work_allocations_engagement_fs_tb_key
  ON client_portal_work_allocations (engagement_id, COALESCE(fs_line_id, ''), COALESCE(tb_account_code, ''));

CREATE INDEX IF NOT EXISTS client_portal_work_allocations_engagement_id_idx
  ON client_portal_work_allocations (engagement_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_work_allocations_engagement_id_fkey') THEN
    ALTER TABLE client_portal_work_allocations
      ADD CONSTRAINT client_portal_work_allocations_engagement_id_fkey
      FOREIGN KEY (engagement_id) REFERENCES audit_engagements(id) ON DELETE CASCADE;
  END IF;
END $$;
