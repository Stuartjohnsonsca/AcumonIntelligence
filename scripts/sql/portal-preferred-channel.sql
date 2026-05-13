-- Portal user preferred communication channel.
-- Idempotent; safe to re-run on any Supabase database.
--
-- Single-select preference set by the user (or the Portal Principal on
-- their behalf). notifyPortalUser honours this in place of the prior
-- multi-channel fan-out so the user gets one notification per request
-- on whichever channel they actually read.

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS preferred_communication_channel TEXT NULL;
