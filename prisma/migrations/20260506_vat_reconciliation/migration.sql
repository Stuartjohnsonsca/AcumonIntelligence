-- VAT Reconciliation calculator: per-engagement persistence.
-- Idempotent so it's safe to re-run against Supabase.
CREATE TABLE IF NOT EXISTS audit_vat_reconciliations (
  id            text PRIMARY KEY,
  engagement_id text UNIQUE NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_vat_reconciliations_engagement_id_idx
  ON audit_vat_reconciliations(engagement_id);
