-- Tax on Profits / Corporation Tax tool: per-engagement persistence.
-- Mirrors audit_vat_reconciliations — single JSON blob per engagement
-- containing the jurisdiction split, tax adjustments grid, audit-test
-- flags, AI verification result, and conclusion / sign-offs.
-- Idempotent so it's safe to re-run against Supabase.
CREATE TABLE IF NOT EXISTS audit_tax_on_profits (
  id            text PRIMARY KEY,
  engagement_id text UNIQUE NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_tax_on_profits_engagement_id_idx
  ON audit_tax_on_profits(engagement_id);
