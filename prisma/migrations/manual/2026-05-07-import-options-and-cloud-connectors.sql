-- Import Options pop-up + Cloud Audit Connector registry + Extraction
-- Proposals scratchpad. All operations idempotent so it's safe to
-- re-run against Supabase after partial application.

-- 1) AuditEngagement.import_options — selections from the
--    multi-select pop-up shown when the engagement is first opened.
ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS import_options jsonb;

-- 2) Cloud audit-software connector registry, firm-scoped. Stores the
--    connection RECIPE (base URL, auth scheme, endpoint paths) but
--    NEVER the user's credentials.
CREATE TABLE IF NOT EXISTS cloud_audit_connectors (
  id              text PRIMARY KEY,
  firm_id         text NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  vendor_key      text NOT NULL,
  label           text NOT NULL,
  config          jsonb NOT NULL,
  is_built_in     boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_by_id   text NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cloud_audit_connectors_firm_vendor_uniq
  ON cloud_audit_connectors(firm_id, vendor_key);
CREATE INDEX IF NOT EXISTS cloud_audit_connectors_firm_idx
  ON cloud_audit_connectors(firm_id);

-- 3) Per-engagement scratchpad of an AI-extracted "proposed mapping".
--    Lifecycle: pending → applied | cancelled. Kept after apply as
--    audit trail; new extractions create a new row.
CREATE TABLE IF NOT EXISTS import_extraction_proposals (
  id                          text PRIMARY KEY,
  engagement_id               text NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  source_type                 text NOT NULL,
  source_label                text,
  source_archive_document_id  text,
  proposals                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model                    text,
  raw_ai_response             text,
  status                      text NOT NULL DEFAULT 'pending',
  created_by_id               text NOT NULL REFERENCES users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  applied_at                  timestamptz,
  applied_by_id               text REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS import_extraction_proposals_engagement_idx
  ON import_extraction_proposals(engagement_id);
CREATE INDEX IF NOT EXISTS import_extraction_proposals_status_idx
  ON import_extraction_proposals(status);
