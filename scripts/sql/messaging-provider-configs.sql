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
-- something to render against. Existing rows are left untouched for
-- twilio / sent_dm / telegram — wecom uses a merge below so the
-- connector defaults flow into an existing row too.
INSERT INTO messaging_provider_configs (id, provider, enabled, config)
  VALUES
    (gen_random_uuid()::text, 'twilio',   FALSE, '{}'::jsonb),
    (gen_random_uuid()::text, 'sent_dm',  FALSE, '{}'::jsonb),
    (gen_random_uuid()::text, 'telegram', FALSE, '{}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- WeCom seed — defaults match the firm's Railway-hosted connector
-- deployment. The auth value is intentionally absent (the SuperAdmin
-- pastes it via the UI). ON CONFLICT … DO UPDATE uses
-- `EXCLUDED.config || existing.config` so the seed only fills in
-- keys that are not already set — anything the SuperAdmin has saved
-- (e.g. a real auth value) is preserved on re-runs.
INSERT INTO messaging_provider_configs (id, provider, enabled, config)
VALUES (
  gen_random_uuid()::text,
  'wecom',
  FALSE,
  '{
    "mode": "external_contact_pro",
    "corpId": "ww8c5bf8b3e6e97d82",
    "proConnectorUrl": "https://wecom-connector-production.up.railway.app",
    "proConnectorHealthPath": "/health",
    "proConnectorProviderId": "prov-main",
    "proConnectorAuthHeader": "Authorization"
  }'::jsonb
)
ON CONFLICT (provider) DO UPDATE
  SET config = EXCLUDED.config || messaging_provider_configs.config;

-- WeCom Pro External Contact user id on portal users.
ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS wecom_external_user_id TEXT NULL;

CREATE INDEX IF NOT EXISTS client_portal_users_wecom_external_user_id_idx
  ON client_portal_users (wecom_external_user_id);
