-- Portal WeCom Pro External Contact bind support.
-- Idempotent; safe to re-run.
--
-- Adds the three columns we need to mint per-user Contact Way QRs,
-- match the WeCom change_external_contact webhook back to the right
-- portal user, and remember the WeCom-issued config_id for later
-- admin actions (delete/update Contact Way).

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS wecom_bind_code              TEXT NULL,
  ADD COLUMN IF NOT EXISTS wecom_bind_code_expires_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS wecom_config_id              TEXT NULL;

-- Partial unique index — multiple users with NULL bind_code are fine
-- but two pending binds with the same code would collide on the
-- webhook lookup. Same pattern as the Telegram link code.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_users_wecom_bind_code_key
  ON client_portal_users (wecom_bind_code)
  WHERE wecom_bind_code IS NOT NULL;
