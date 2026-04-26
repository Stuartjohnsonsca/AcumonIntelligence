-- Adds `send_signoff_section` to document_templates so the
-- send-permission gate can check a SPECIFIC schedule's sign-off
-- record (e.g. only RMM sign-off matters for the Planning Letter)
-- instead of always checking the engagement-level rollup.
--
-- Values: NULL means engagement-level (sectionKey '__signoffs') —
-- the existing default. A non-null value (e.g. 'rmm', 'materiality',
-- 'par') is appended to give sectionKey '__signoffs_<value>', which
-- mirrors how `getPermanentFileSignOffs(engagementId, suffix)` keys
-- per-schedule sign-offs in lib/signoff-handler.ts.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS. Existing rows default to
-- NULL so the gate behaviour is unchanged until an admin opts in.

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS send_signoff_section TEXT;

-- Sanity check — column exists; counts of NULL vs configured.
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE send_signoff_section IS NULL) AS engagement_level,
  COUNT(*) FILTER (WHERE send_signoff_section IS NOT NULL) AS schedule_level
FROM document_templates;
