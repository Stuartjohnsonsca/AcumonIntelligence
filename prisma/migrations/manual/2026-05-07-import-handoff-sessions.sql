-- Import Options: handoff sessions for the Acumon MCP server.
-- An external AI assistant (Claude Cowork, etc.) calls /api/mcp using
-- the session id as the bearer token; on submit_archive() the row is
-- flipped to status='submitted' and the modal polling
-- /handoff/status advances to the Review screen.
CREATE TABLE IF NOT EXISTS import_handoff_sessions (
  id                       text PRIMARY KEY,
  engagement_id            text NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  firm_id                  text NOT NULL,
  created_by_id            text NOT NULL,
  vendor_label             text NOT NULL,
  status                   text NOT NULL DEFAULT 'pending',
  expires_at               timestamptz NOT NULL,
  submitted_document_id    text,
  submitted_extraction_id  text,
  submitted_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_handoff_sessions_engagement_idx
  ON import_handoff_sessions(engagement_id);
CREATE INDEX IF NOT EXISTS import_handoff_sessions_status_idx
  ON import_handoff_sessions(status);
