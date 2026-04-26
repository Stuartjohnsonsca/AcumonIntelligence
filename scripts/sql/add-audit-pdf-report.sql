-- Methodology-admin "Generate PDF Report" feature.
--
-- Stores one row per generated report. Reports are produced on demand
-- (no auto-generation) and live in Azure blob storage; this row holds
-- the metadata + blob path so the viewer / download endpoints can find
-- and stream the binary back.
--
-- Permissions are enforced at the route layer:
--   • Generate: methodology admins / super admins only
--   • View:     anyone with engagement read access (incl. Regulatory
--               Reviewers — they need to see the snapshot)
--   • Download: methodology admins / super admins only
--
-- A regulator looking at a file should see "View Report" only; the
-- download button is hidden / 403d for them.
--
-- Idempotent. Re-running this migration is a no-op.

CREATE TABLE IF NOT EXISTS audit_pdf_reports (
  id                  TEXT PRIMARY KEY,
  engagement_id       TEXT NOT NULL,
  generated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  generated_by_id     TEXT NOT NULL,
  generated_by_name   TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  blob_path           TEXT NOT NULL,
  container_name      TEXT NOT NULL DEFAULT 'audit-pdf-reports',
  file_size           INTEGER NOT NULL,
  CONSTRAINT fk_audit_pdf_reports_engagement
    FOREIGN KEY (engagement_id) REFERENCES audit_engagements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS audit_pdf_reports_engagement_id_idx
  ON audit_pdf_reports(engagement_id);

-- Sanity check
SELECT COUNT(*) AS existing_rows FROM audit_pdf_reports;
