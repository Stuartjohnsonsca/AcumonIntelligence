-- Portal Messaging — WhatsApp / Telegram / SMS schema additions.
-- Idempotent; safe to re-run on any Supabase database.
-- Run in Supabase SQL Editor on production before deploying.
--
-- Adds:
--   • Per-user contact fields + opt-in flags on client_portal_users
--     and client_portal_staff_members (so the Portal Principal can
--     pre-fill numbers during staff setup).
--   • Telegram link-code columns on client_portal_users so the
--     "Connect Telegram" deep-link flow has somewhere to store the
--     one-time code while we wait for the bot's /start callback.
--   • portal_messages table for outbound + inbound message logging,
--     keyed by client / portal user / related request so the audit
--     trail on a request shows every nudge that went out and every
--     reply that came back.

-- ─── client_portal_users: messaging contact + opt-in fields ──────────────
ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS whatsapp_number             TEXT NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telegram_handle             TEXT NULL,
  ADD COLUMN IF NOT EXISTS telegram_chat_id            TEXT NULL,
  ADD COLUMN IF NOT EXISTS telegram_opt_in             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telegram_link_code          TEXT NULL,
  ADD COLUMN IF NOT EXISTS telegram_link_expires_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sms_number                  TEXT NULL,
  ADD COLUMN IF NOT EXISTS sms_opt_in                  BOOLEAN NOT NULL DEFAULT FALSE;

-- Unique index on telegram_link_code so a single /start callback can
-- resolve to exactly one user. Created as a partial-unique index so
-- multiple users with NULL link_code don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_users_telegram_link_code_key
  ON client_portal_users (telegram_link_code)
  WHERE telegram_link_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_portal_users_whatsapp_number_idx
  ON client_portal_users (whatsapp_number);
CREATE INDEX IF NOT EXISTS client_portal_users_sms_number_idx
  ON client_portal_users (sms_number);
CREATE INDEX IF NOT EXISTS client_portal_users_telegram_chat_id_idx
  ON client_portal_users (telegram_chat_id);

-- ─── client_portal_staff_members: pre-portal contact hints ──────────────
ALTER TABLE client_portal_staff_members
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telegram_handle TEXT NULL,
  ADD COLUMN IF NOT EXISTS telegram_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_number      TEXT NULL,
  ADD COLUMN IF NOT EXISTS sms_opt_in      BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── portal_messages: outbound + inbound message log ────────────────────
CREATE TABLE IF NOT EXISTS portal_messages (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL,
  portal_user_id      TEXT NULL,
  related_request_id  TEXT NULL,
  direction           TEXT NOT NULL,                -- 'outbound' | 'inbound'
  channel             TEXT NOT NULL,                -- 'whatsapp' | 'telegram' | 'sms'
  provider_message_id TEXT NULL,
  from_address        TEXT NULL,
  to_address          TEXT NULL,
  body                TEXT NOT NULL,
  media_json          JSONB NULL,
  status              TEXT NOT NULL DEFAULT 'queued',
  error_message       TEXT NULL,
  provider_raw        JSONB NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK to clients — cascade so deleting a client cleans up its message
-- log alongside its portal users and requests.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_messages_client_id_fkey') THEN
    ALTER TABLE portal_messages
      ADD CONSTRAINT portal_messages_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- FK to client_portal_users — SET NULL so an orphaned inbound message
-- (e.g. from a number we haven't linked yet) survives user deletion
-- and stays available for triage.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_messages_portal_user_id_fkey') THEN
    ALTER TABLE portal_messages
      ADD CONSTRAINT portal_messages_portal_user_id_fkey
      FOREIGN KEY (portal_user_id) REFERENCES client_portal_users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS portal_messages_client_id_idx
  ON portal_messages (client_id);
CREATE INDEX IF NOT EXISTS portal_messages_client_channel_created_idx
  ON portal_messages (client_id, channel, created_at);
CREATE INDEX IF NOT EXISTS portal_messages_portal_user_id_idx
  ON portal_messages (portal_user_id);
CREATE INDEX IF NOT EXISTS portal_messages_related_request_id_idx
  ON portal_messages (related_request_id);
CREATE INDEX IF NOT EXISTS portal_messages_provider_message_id_idx
  ON portal_messages (provider_message_id);

-- updated_at is maintained by Prisma's @updatedAt annotation at the
-- application layer, matching every other portal table — no DB
-- trigger needed.
