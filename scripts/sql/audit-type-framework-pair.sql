-- Audit Type Configuration: switch from per-AuditType to per-(AuditType, Framework).
--
-- Idempotent. Safe to re-run in Supabase SQL Editor — every step is
-- guarded with a check that prevents double-encoding the composite key.
--
-- 1.  Add `framework` to audit_engagements (default FRS102).
-- 2.  Re-key existing methodology_templates rows for the two affected
--     templateTypes (`audit_type_schedules`, `audit_type_framework`)
--     so that `audit_type` becomes `<auditType>::FRS102`. Rows that
--     already contain `::` are left untouched (idempotency). The
--     special row `__framework_options` is also skipped — it stores
--     the firm-wide list of framework options, not a per-pair config.

-- 1) framework column on audit_engagements
ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS framework TEXT NOT NULL DEFAULT 'FRS102';

-- 2) Re-key audit_type_schedules + audit_type_framework rows to encode the pair.
DO $$
BEGIN
  -- Skip rows already in composite form, and the special framework-options row.
  UPDATE methodology_templates
  SET audit_type = audit_type || '::FRS102'
  WHERE template_type IN ('audit_type_schedules', 'audit_type_framework')
    AND audit_type NOT LIKE '%::%'
    AND audit_type <> '__framework_options';
END $$;
