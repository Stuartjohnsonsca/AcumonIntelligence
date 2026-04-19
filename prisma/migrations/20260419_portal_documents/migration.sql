-- ─── Portal documents (firm-to-client) ──────────────────────────────────
-- Stores documents the firm pushes TO the client via the Client Portal
-- (e.g. Planning Letter). Distinct from EvidenceUpload, which carries
-- files in the OTHER direction (client → firm).
--
-- Each row is one PDF/docx generated from a DocumentTemplate and
-- uploaded to Azure blob storage. The portal "Documents" list reads
-- these rows filtered by clientId.
--
-- `category` mirrors the template category (e.g. 'audit_planning_letter')
-- so the portal can group / filter. `templateId` is optional — we
-- persist it so re-renders are possible, but deleting a template
-- doesn't cascade-delete the already-sent letters.

CREATE TABLE IF NOT EXISTS "PortalDocument" (
  "id"             TEXT NOT NULL,
  "firmId"         TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "engagementId"   TEXT,
  "templateId"     TEXT,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "category"       TEXT NOT NULL DEFAULT 'general',
  "fileName"       TEXT NOT NULL,
  "contentType"    TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  "fileSize"       INTEGER,
  "blobPath"       TEXT NOT NULL,
  "containerName"  TEXT NOT NULL DEFAULT 'portal-documents',
  "uploadedById"   TEXT,
  "uploadedByName" TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PortalDocument_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────
-- Client scope — the portal list query filters by clientId.
CREATE INDEX IF NOT EXISTS "PortalDocument_clientId_idx" ON "PortalDocument"("clientId");
-- Engagement scope — optional, used by the Communication tab listing.
CREATE INDEX IF NOT EXISTS "PortalDocument_engagementId_idx" ON "PortalDocument"("engagementId");
-- Firm scope — tenant safety filter.
CREATE INDEX IF NOT EXISTS "PortalDocument_firmId_idx" ON "PortalDocument"("firmId");
-- Recent-first listing.
CREATE INDEX IF NOT EXISTS "PortalDocument_createdAt_idx" ON "PortalDocument"("createdAt" DESC);

-- ─── Foreign keys ────────────────────────────────────────────────────────
-- These mirror the style of existing models (Cascade on firm/client
-- deletion, SetNull on optional engagement/template refs so history
-- survives template deletions).
DO $$ BEGIN
  ALTER TABLE "PortalDocument" ADD CONSTRAINT "PortalDocument_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalDocument" ADD CONSTRAINT "PortalDocument_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalDocument" ADD CONSTRAINT "PortalDocument_engagementId_fkey"
    FOREIGN KEY ("engagementId") REFERENCES "AuditEngagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalDocument" ADD CONSTRAINT "PortalDocument_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
