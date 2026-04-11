-- ════════════════════════════════════════════════════════════════════════════
-- Schema changes for the EQR / Schedule-builder / Team Familiarity overhaul
-- ════════════════════════════════════════════════════════════════════════════
-- IDEMPOTENT — safe to re-run. Apply via Supabase SQL Editor.
-- After running, redeploy the app so Prisma client picks up the new types.

-- ── Part A: Client.isListed + AuditEngagement.priorPeriodEngagementId ──

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS prior_period_engagement_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_engagements_prior_period_engagement_id_fkey'
  ) THEN
    ALTER TABLE audit_engagements
      ADD CONSTRAINT audit_engagements_prior_period_engagement_id_fkey
      FOREIGN KEY (prior_period_engagement_id) REFERENCES audit_engagements(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_engagements_prior_period_engagement_id_idx
  ON audit_engagements(prior_period_engagement_id);

-- ── Part H: Client.isPIE + TeamFamiliarityEntry table ──

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_pie BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS team_familiarity_entries (
  id                    TEXT PRIMARY KEY,
  firm_id               TEXT NOT NULL,
  client_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  role                  TEXT NOT NULL,
  engagement_start_date TIMESTAMPTZ,
  role_started_date     TIMESTAMPTZ,
  ceased_acting_date    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_familiarity_entries_client_fk
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT team_familiarity_entries_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS team_familiarity_entries_unique
  ON team_familiarity_entries(firm_id, client_id, user_id, role);

CREATE INDEX IF NOT EXISTS team_familiarity_entries_firm_client_idx
  ON team_familiarity_entries(firm_id, client_id);

CREATE INDEX IF NOT EXISTS team_familiarity_entries_firm_user_idx
  ON team_familiarity_entries(firm_id, user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Optional one-shot backfill of priorPeriodEngagementId.
-- Walks each client's engagements and links each one to its immediately
-- preceding engagement of the same audit_type by period end date.
-- Safe to run multiple times — only sets where currently NULL.
-- ────────────────────────────────────────────────────────────────────────────

WITH ranked AS (
  SELECT
    e.id,
    e.client_id,
    e.audit_type,
    LAG(e.id) OVER (
      PARTITION BY e.client_id, e.audit_type
      ORDER BY p.end_date
    ) AS prior_id
  FROM audit_engagements e
  JOIN client_periods p ON p.id = e.period_id
)
UPDATE audit_engagements e
SET prior_period_engagement_id = r.prior_id
FROM ranked r
WHERE e.id = r.id
  AND r.prior_id IS NOT NULL
  AND e.prior_period_engagement_id IS NULL;
