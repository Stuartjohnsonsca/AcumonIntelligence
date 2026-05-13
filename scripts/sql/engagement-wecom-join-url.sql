-- Per-engagement WeCom JOIN url (client-facing).
-- Idempotent; safe to re-run on any Supabase database.
--
-- Distinct from the existing wecom_group_webhook_url (which is what
-- our backend POSTs to). This new column is the URL or QR-image-URL
-- that CLIENTS tap to join the firm's WeCom group. Pasted once by
-- the Portal Principal during Setup; read-only for staff.

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS wecom_join_url TEXT NULL;
