-- Audit File Monitoring Reports — schema for scheduled InterrogateBot
-- runs. Idempotent; safe to re-run on any Supabase database.
-- Run in Supabase SQL Editor on production before deploying.
--
-- A monitoring report is a saved list of questions the firm wants to
-- run regularly against an engagement (e.g. "How fast is the client
-- responding?", "Which tests have no executions yet?"). The cron at
-- /api/cron/audit-file-monitoring scans for due reports each hour and
-- POSTs every question through the /interrogate endpoint, storing
-- the answers as an audit_file_monitoring_runs row.

-- ─── audit_file_monitoring_reports ───────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_file_monitoring_reports (
  id                TEXT PRIMARY KEY,
  engagement_id     TEXT NOT NULL,
  firm_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  questions         JSONB NOT NULL DEFAULT '[]'::jsonb,
  frequency         TEXT NOT NULL DEFAULT 'weekly', -- manual | daily | weekly | monthly
  next_run_at       TIMESTAMPTZ NULL,
  last_run_at       TIMESTAMPTZ NULL,
  email_recipients  JSONB NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id     TEXT NOT NULL,
  created_by_name   TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_file_monitoring_reports_engagement_id_fkey') THEN
    ALTER TABLE audit_file_monitoring_reports
      ADD CONSTRAINT audit_file_monitoring_reports_engagement_id_fkey
      FOREIGN KEY (engagement_id) REFERENCES audit_engagements(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_file_monitoring_reports_engagement_id_idx
  ON audit_file_monitoring_reports (engagement_id);
CREATE INDEX IF NOT EXISTS audit_file_monitoring_reports_firm_active_next_idx
  ON audit_file_monitoring_reports (firm_id, is_active, next_run_at);

-- ─── audit_file_monitoring_runs ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_file_monitoring_runs (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  trigger       TEXT NOT NULL DEFAULT 'scheduled', -- manual | scheduled
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answers       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'ok', -- ok | partial | failed
  error_message TEXT NULL,
  emailed_to    JSONB NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_file_monitoring_runs_report_id_fkey') THEN
    ALTER TABLE audit_file_monitoring_runs
      ADD CONSTRAINT audit_file_monitoring_runs_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES audit_file_monitoring_reports(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_file_monitoring_runs_engagement_id_fkey') THEN
    ALTER TABLE audit_file_monitoring_runs
      ADD CONSTRAINT audit_file_monitoring_runs_engagement_id_fkey
      FOREIGN KEY (engagement_id) REFERENCES audit_engagements(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_file_monitoring_runs_report_run_idx
  ON audit_file_monitoring_runs (report_id, run_at);
CREATE INDEX IF NOT EXISTS audit_file_monitoring_runs_engagement_run_idx
  ON audit_file_monitoring_runs (engagement_id, run_at);
