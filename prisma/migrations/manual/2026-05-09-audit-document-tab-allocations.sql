-- Safety-net for the AuditDocumentTabAllocation join table + the
-- document_type_ai_suggested column on audit_documents. Both were
-- added to schema.prisma in commits 1469f9d and ca3fc09 respectively;
-- if `prisma db push` failed to apply them on the most recent Vercel
-- build (lock timeout, schema validation error, etc.) every per-tab
-- documents fetch under /api/engagements/:id/tab-documents will 500.
--
-- Symptom in the UI: each tab's footer shows "Failed to load (500)"
-- and uploads silently fail to persist (the blob lands in storage
-- but the AuditDocument row insert errors out).
--
-- Idempotent — safe to re-run against any database.

-- 1. Join table for multi-tab document allocation. Composite PK on
--    (document_id, tab) makes "allocate to tab X" idempotent so the
--    same document can sit on the same tab only once.
CREATE TABLE IF NOT EXISTS audit_document_tab_allocations (
  document_id      text        NOT NULL REFERENCES audit_documents(id) ON DELETE CASCADE,
  tab              text        NOT NULL,
  allocated_at     timestamptz NOT NULL DEFAULT now(),
  allocated_by_id  text        REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (document_id, tab)
);

CREATE INDEX IF NOT EXISTS audit_document_tab_allocations_tab_idx
  ON audit_document_tab_allocations(tab);

CREATE INDEX IF NOT EXISTS audit_document_tab_allocations_allocated_by_idx
  ON audit_document_tab_allocations(allocated_by_id);

-- 2. Column added in commit ca3fc09 — needed by the per-tab upload
--    flow (route writes documentTypeAiSuggested on every create).
--    Defaults to false so existing rows pick up a sensible value.
ALTER TABLE audit_documents
  ADD COLUMN IF NOT EXISTS document_type_ai_suggested boolean NOT NULL DEFAULT false;
