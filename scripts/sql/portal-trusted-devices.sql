-- Portal trusted devices + 2FA trust-day setting.
-- Idempotent; safe to re-run on any Supabase database.
-- Run in Supabase SQL Editor on production before deploying.
--
-- Lets the Portal Principal set a per-engagement window during
-- which a previously-2FA'd browser can re-authenticate with just
-- username + password. A different browser has no trust cookie and
-- always falls back to the email-code flow.

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS portal_2fa_trust_days INTEGER NULL;

CREATE TABLE IF NOT EXISTS client_portal_trusted_devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  device_token  TEXT NOT NULL UNIQUE,
  label         TEXT NULL,
  user_agent    TEXT NULL,
  ip_address    TEXT NULL,
  trusted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_trusted_devices_user_id_fkey') THEN
    ALTER TABLE client_portal_trusted_devices
      ADD CONSTRAINT client_portal_trusted_devices_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES client_portal_users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS client_portal_trusted_devices_user_idx
  ON client_portal_trusted_devices (user_id);
CREATE INDEX IF NOT EXISTS client_portal_trusted_devices_user_expires_idx
  ON client_portal_trusted_devices (user_id, expires_at);
CREATE INDEX IF NOT EXISTS client_portal_trusted_devices_user_revoked_idx
  ON client_portal_trusted_devices (user_id, revoked_at);
