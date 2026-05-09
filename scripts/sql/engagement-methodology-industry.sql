-- AuditEngagement.methodology_industry_id
-- Adds the per-engagement industry FK that ab4865c (8 May 2026)
-- introduced in the Prisma schema but never carried into a SQL
-- migration. Without this column every Prisma findUnique on
-- audit_engagements throws because the implicit SELECT *
-- references methodology_industry_id — surfaces in the UI as
-- "Submit failed" / "Could not load" on Independence, the
-- engagement loader, etc.
--
-- Idempotent; safe to re-run in Supabase SQL Editor.

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS methodology_industry_id TEXT NULL;

CREATE INDEX IF NOT EXISTS audit_engagements_methodology_industry_id_idx
  ON audit_engagements (methodology_industry_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_engagements_methodology_industry_id_fkey'
  ) THEN
    ALTER TABLE audit_engagements
      ADD CONSTRAINT audit_engagements_methodology_industry_id_fkey
      FOREIGN KEY (methodology_industry_id)
      REFERENCES methodology_industries(id)
      ON DELETE SET NULL;
  END IF;
END $$;
