-- Per-engagement WeCom Group Robot webhook URL.
-- Idempotent; safe to re-run on any Supabase database.
-- Run in Supabase SQL Editor on production before deploying.
--
-- One WeCom group per engagement: the audit team creates a group
-- with the client, adds the Group Robot, pastes the webhook URL
-- here. notifyOnPortalRequestCreated mirrors every portal request
-- alert into the group so the audit team + client see it in WeCom
-- alongside email + per-user SMS/WhatsApp/Telegram channels.

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS wecom_group_webhook_url TEXT NULL;
