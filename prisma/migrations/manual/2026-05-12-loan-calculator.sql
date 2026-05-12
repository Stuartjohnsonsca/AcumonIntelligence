-- Loan Calculator — per-engagement JSON blob.
-- Holds every loan, lead summary, tests, disclosure answers, covenants,
-- impairment and FMV-revaluation state for both receivables and liabilities.
-- Idempotent so safe to re-run.

CREATE TABLE IF NOT EXISTS audit_loan_calculators (
  id            text PRIMARY KEY,
  engagement_id text NOT NULL UNIQUE REFERENCES audit_engagements(id) ON DELETE CASCADE,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_loan_calculators_engagement_idx
  ON audit_loan_calculators(engagement_id);
