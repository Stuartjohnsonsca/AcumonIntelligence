-- Self-healing error system: ErrorAutoFix table.
-- Idempotent — safe to re-run. Apply via Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "error_auto_fixes" (
  "id"                       TEXT PRIMARY KEY,
  "error_log_id"             TEXT UNIQUE,
  "source"                   TEXT NOT NULL,
  "reporter_id"              TEXT,
  "firm_id"                  TEXT,
  "user_description"         TEXT,
  "super_admin_message"      TEXT,
  "url"                      TEXT,
  "user_agent"               TEXT,
  "http_status"              INTEGER,
  "error_message"            TEXT,
  "error_stack"              TEXT,
  "network_trace"            JSONB,
  "console_errors"           JSONB,
  "status"                   TEXT NOT NULL DEFAULT 'pending',
  "claude_analysis"          TEXT,
  "claude_proposed_changes"  JSONB,
  "branch_name"              TEXT,
  "commit_sha"               TEXT,
  "pr_url"                   TEXT,
  "auto_merged"              BOOLEAN NOT NULL DEFAULT FALSE,
  "merged_at"                TIMESTAMPTZ,
  "reverted_at"              TIMESTAMPTZ,
  "reverted_by_id"           TEXT,
  "revert_commit_sha"        TEXT,
  "processing_error"         TEXT,
  "notified_at"              TIMESTAMPTZ,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "error_auto_fixes_source_idx"      ON "error_auto_fixes" ("source");
CREATE INDEX IF NOT EXISTS "error_auto_fixes_status_idx"      ON "error_auto_fixes" ("status");
CREATE INDEX IF NOT EXISTS "error_auto_fixes_url_idx"         ON "error_auto_fixes" ("url");
CREATE INDEX IF NOT EXISTS "error_auto_fixes_created_at_idx"  ON "error_auto_fixes" ("created_at");

-- FKs are added if not present. error_logs/users may have rows already.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_auto_fixes_error_log_id_fkey'
  ) THEN
    ALTER TABLE "error_auto_fixes"
      ADD CONSTRAINT "error_auto_fixes_error_log_id_fkey"
      FOREIGN KEY ("error_log_id") REFERENCES "error_logs"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_auto_fixes_reporter_id_fkey'
  ) THEN
    ALTER TABLE "error_auto_fixes"
      ADD CONSTRAINT "error_auto_fixes_reporter_id_fkey"
      FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_auto_fixes_reverted_by_id_fkey'
  ) THEN
    ALTER TABLE "error_auto_fixes"
      ADD CONSTRAINT "error_auto_fixes_reverted_by_id_fkey"
      FOREIGN KEY ("reverted_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END
$$;
