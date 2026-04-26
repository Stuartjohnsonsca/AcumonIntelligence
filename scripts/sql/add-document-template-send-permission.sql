-- Adds a `send_permission` column to document_templates so admins can
-- gate Document Generator actions (Download Planning Letter, Send
-- Planning Letter, etc.) on the engagement's sign-off state. Values:
--
--   'None'     — no gating (default; existing behaviour preserved)
--   'Preparer' — requires the engagement to be signed off as Preparer
--                (operator role) at minimum
--   'Reviewer' — requires Reviewer (Manager) OR RI (Partner) sign-off
--   'RI'       — requires RI (Partner) sign-off
--
-- The actual gating runs server-side in the send-/download- routes; if
-- the required sign-off isn't in place the response is 403 with reason
-- 'permission_not_ready', which the modal surfaces as a "Permission to
-- Send not Ready" popup.
--
-- Default 'None' keeps existing templates non-gated until an admin
-- opts in. Idempotent via IF NOT EXISTS.

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS send_permission TEXT NOT NULL DEFAULT 'None';

-- Sanity check: confirm column exists, all rows defaulted to 'None'.
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE send_permission = 'None') AS none_rows,
  COUNT(*) FILTER (WHERE send_permission != 'None') AS configured_rows
FROM document_templates;
