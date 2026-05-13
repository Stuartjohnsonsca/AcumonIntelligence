-- Messaging provider configuration table.
-- Idempotent; safe to re-run on any Supabase database.
--
-- Platform-wide SuperAdmin-managed config for Twilio, sent.dm,
-- Telegram, and WeCom. The application code reads from this table
-- first and falls back to environment variables when a row is
-- missing or disabled, so existing env-based deployments keep
-- working through the migration.

CREATE TABLE IF NOT EXISTS messaging_provider_configs (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL UNIQUE,
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_id   TEXT NULL,
  updated_by_name TEXT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed rows for the four providers so the SuperAdmin UI always has
-- something to render against. Existing rows are left untouched.
INSERT INTO messaging_provider_configs (id, provider, enabled, config)
  VALUES
    (gen_random_uuid()::text, 'twilio',   FALSE, '{}'::jsonb),
    (gen_random_uuid()::text, 'sent_dm',  FALSE, '{}'::jsonb),
    (gen_random_uuid()::text, 'telegram', FALSE, '{}'::jsonb),
    (gen_random_uuid()::text, 'wecom',    FALSE, '{"mode":"group_robot"}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- WeCom Pro External Contact user id on portal users.
ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS wecom_external_user_id TEXT NULL;

CREATE INDEX IF NOT EXISTS client_portal_users_wecom_external_user_id_idx
  ON client_portal_users (wecom_external_user_id);
