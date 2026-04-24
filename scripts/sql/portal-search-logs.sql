-- Portal AI Search Log — idempotent, safe to re-run.
-- Stores every free-text search the portal user runs so the
-- Methodology Admin can see what people look for and promote popular
-- queries to "featured" quick-filter chips on the Principal dashboard.

CREATE TABLE IF NOT EXISTS portal_search_logs (
  id               TEXT NOT NULL,
  firm_id          TEXT NOT NULL,
  engagement_id    TEXT NULL,
  client_id        TEXT NULL,
  portal_user_id   TEXT NULL,
  firm_user_id     TEXT NULL,
  query            TEXT NOT NULL,
  query_normalised TEXT NULL,
  result_count     INTEGER NOT NULL DEFAULT 0,
  featured         BOOLEAN NOT NULL DEFAULT FALSE,
  featured_label   TEXT NULL,
  featured_by_id   TEXT NULL,
  featured_at      TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portal_search_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS portal_search_logs_firm_id_idx
  ON portal_search_logs (firm_id);
CREATE INDEX IF NOT EXISTS portal_search_logs_firm_featured_idx
  ON portal_search_logs (firm_id, featured);
CREATE INDEX IF NOT EXISTS portal_search_logs_firm_query_idx
  ON portal_search_logs (firm_id, query_normalised);
CREATE INDEX IF NOT EXISTS portal_search_logs_engagement_id_idx
  ON portal_search_logs (engagement_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_search_logs_firm_id_fkey') THEN
    ALTER TABLE portal_search_logs
      ADD CONSTRAINT portal_search_logs_firm_id_fkey
      FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Post-launch extensions: cached AI interpretation + per-user saved
-- searches. Both idempotent via ADD COLUMN IF NOT EXISTS.
ALTER TABLE portal_search_logs
  ADD COLUMN IF NOT EXISTS interpreted_filters JSONB NULL,
  ADD COLUMN IF NOT EXISTS saved_by_portal_user_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS saved_label TEXT NULL,
  ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS portal_search_logs_saved_by_portal_user_id_idx
  ON portal_search_logs (saved_by_portal_user_id);
