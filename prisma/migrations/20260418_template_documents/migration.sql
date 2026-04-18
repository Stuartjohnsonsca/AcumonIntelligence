-- Template Documents feature — firm-branded Word skeletons + document
-- template kind + sample context on DocumentTemplate.
--
-- 1. New firm_document_skeletons table.
-- 2. document_templates gains kind, skeleton_id, sample_context.

-- ─── 1. firm_document_skeletons ───────────────────────────────────────────
CREATE TABLE "firm_document_skeletons" (
  "id"                  TEXT NOT NULL,
  "firm_id"             TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "audit_type"          TEXT NOT NULL DEFAULT 'ALL',
  "storage_path"        TEXT NOT NULL,
  "container_name"      TEXT NOT NULL DEFAULT 'firm-skeletons',
  "original_file_name"  TEXT NOT NULL,
  "mime_type"           TEXT,
  "file_size"           INTEGER,
  "is_default"          BOOLEAN NOT NULL DEFAULT false,
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "uploaded_by_id"      TEXT,
  "uploaded_by_name"    TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "firm_document_skeletons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "firm_document_skeletons_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "firm_document_skeletons_firm_id_idx"
  ON "firm_document_skeletons" ("firm_id");

CREATE INDEX "firm_document_skeletons_firm_id_audit_type_is_default_idx"
  ON "firm_document_skeletons" ("firm_id", "audit_type", "is_default");

-- ─── 2. document_templates — new columns ──────────────────────────────────
ALTER TABLE "document_templates"
  ADD COLUMN "kind"           TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN "skeleton_id"    TEXT,
  ADD COLUMN "sample_context" JSONB;

-- Existing rows are email templates — the default 'email' keeps them
-- behaving as before. New document-kind rows set kind = 'document'.

ALTER TABLE "document_templates"
  ADD CONSTRAINT "document_templates_skeleton_id_fkey"
    FOREIGN KEY ("skeleton_id") REFERENCES "firm_document_skeletons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "document_templates_kind_idx"
  ON "document_templates" ("kind");

CREATE INDEX "document_templates_skeleton_id_idx"
  ON "document_templates" ("skeleton_id");
