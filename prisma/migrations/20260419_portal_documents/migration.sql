-- ─── Portal documents (firm-to-client) ──────────────────────────────────
-- Stores documents the firm pushes TO the client via the Client Portal
-- (e.g. Planning Letter). Distinct from EvidenceUpload, which carries
-- files in the OTHER direction (client → firm).
--
-- Each row is one PDF/docx generated from a DocumentTemplate and
-- uploaded to Azure blob storage. The portal "Documents" list reads
-- these rows filtered by client_id.
--
-- Table + column names are snake_case to match the rest of the DB
-- (Firm → firms, Client → clients, etc.). The Prisma model maps the
-- camelCase field names to these columns via @map / @@map.
--
-- `category` mirrors the template category (e.g. 'audit_planning_letter')
-- so the portal can group / filter. `template_id` is optional — we
-- persist it so re-renders are possible, but deleting a template
-- doesn't cascade-delete the already-sent letters.

CREATE TABLE IF NOT EXISTS "portal_documents" (
  "id"               TEXT NOT NULL,
  "firm_id"          TEXT NOT NULL,
  "client_id"        TEXT NOT NULL,
  "engagement_id"    TEXT,
  "template_id"      TEXT,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "category"         TEXT NOT NULL DEFAULT 'general',
  "file_name"        TEXT NOT NULL,
  "content_type"     TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  "file_size"        INTEGER,
  "blob_path"        TEXT NOT NULL,
  "container_name"   TEXT NOT NULL DEFAULT 'portal-documents',
  "uploaded_by_id"   TEXT,
  "uploaded_by_name" TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_documents_pkey" PRIMARY KEY ("id"),

  -- FKs inlined in CREATE TABLE so the whole thing is atomic (the
  -- naive migration splitter can't parse DO $$ … $$ blocks).
  CONSTRAINT "portal_documents_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "portal_documents_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "portal_documents_engagement_id_fkey"
    FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "portal_documents_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ─── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "portal_documents_client_id_idx"     ON "portal_documents"("client_id");
CREATE INDEX IF NOT EXISTS "portal_documents_engagement_id_idx" ON "portal_documents"("engagement_id");
CREATE INDEX IF NOT EXISTS "portal_documents_firm_id_idx"       ON "portal_documents"("firm_id");
CREATE INDEX IF NOT EXISTS "portal_documents_created_at_idx"    ON "portal_documents"("created_at" DESC);
