-- One-off migration: reassign every methodology_templates row currently
-- saved against audit_type = 'ALL' to audit_type = 'SME' (Statutory Audit).
--
-- Why: the app no longer treats 'ALL' as a real audit-type bucket.
-- Schedules now belong to a specific audit type (SME by default), and the
-- Schedule Designer's UI has dropped the 'ALL' tab entirely. Without this
-- migration, schedules historically saved as 'ALL' would silently
-- disappear from the new UI.
--
-- Idempotent — safe to re-run. If a row already exists for
-- (firm_id, template_type, 'SME'), the 'ALL' row is dropped instead of
-- overwriting (keeping the SME row that was probably created later).
--
-- Wrapped in a DO $$ block so the SQL runner treats it as a single
-- atomic statement — the runner splits on ';' and would otherwise
-- execute each step in its own implicit transaction.

DO $$
DECLARE
  collisions_dropped INT;
  rows_promoted INT;
  remaining_all INT;
BEGIN
  -- 1. Drop 'ALL' rows that would collide with an existing 'SME' row
  --    on the unique key (firm_id, template_type, audit_type). The SME
  --    row wins — it's almost always the one the admin created more
  --    recently when intentionally splitting per-audit-type.
  DELETE FROM methodology_templates a
  WHERE a.audit_type = 'ALL'
    AND EXISTS (
      SELECT 1
      FROM methodology_templates b
      WHERE b.firm_id = a.firm_id
        AND b.template_type = a.template_type
        AND b.audit_type = 'SME'
    );
  GET DIAGNOSTICS collisions_dropped = ROW_COUNT;

  -- 2. Promote the rest.
  UPDATE methodology_templates
  SET audit_type = 'SME',
      updated_at = NOW()
  WHERE audit_type = 'ALL';
  GET DIAGNOSTICS rows_promoted = ROW_COUNT;

  -- 3. Sanity check.
  SELECT COUNT(*) INTO remaining_all
  FROM methodology_templates
  WHERE audit_type = 'ALL';

  RAISE NOTICE 'migrate-all-to-sme: dropped % collision rows, promoted % rows, % rows still tagged ALL',
    collisions_dropped, rows_promoted, remaining_all;
END
$$;
