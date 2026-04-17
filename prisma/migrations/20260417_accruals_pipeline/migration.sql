-- Year-End Accruals Testing Pipeline schema changes.
--
-- 1. New SampleItemMarker table (per-sample-item Red/Orange/Green state
--    with user override tracking).
-- 2. Linkage fields on audit_error_schedules so Red items resolved as
--    "error" can be traced back to the marker, and items resolved as
--    "in_tb" can sit alongside real errors for completeness.
-- 3. is_accrual_account flag on audit_tb_rows for the listing-to-TB
--    reconciliation step.
-- 4. pipeline_config_schema on methodology_tests for the start-of-test
--    config modal (captures x_days_post_ye).
-- 5. config_json on test_executions to persist the captured config.

-- ─── 1. sample_item_markers ─────────────────────────────────────────────────
CREATE TABLE "sample_item_markers" (
  "id"                 TEXT NOT NULL,
  "execution_id"       TEXT NOT NULL,
  "step_index"         INTEGER NOT NULL,
  "sample_item_ref"    TEXT NOT NULL,
  "colour"             TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "marker_type"        TEXT,
  "calc_json"          JSONB,
  "overridden_by"      TEXT,
  "overridden_by_name" TEXT,
  "overridden_at"      TIMESTAMP(3),
  "override_reason"    TEXT,
  "original_colour"    TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sample_item_markers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sample_item_markers_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "test_executions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sample_item_markers_execution_id_idx"
  ON "sample_item_markers" ("execution_id");

-- One marker per (execution, step, sample item). A re-run of the step
-- should upsert by this key rather than producing duplicates.
CREATE UNIQUE INDEX "sample_item_markers_execution_id_step_index_sample_item_ref_key"
  ON "sample_item_markers" ("execution_id", "step_index", "sample_item_ref");

-- ─── 2. audit_error_schedules linkage ───────────────────────────────────────
ALTER TABLE "audit_error_schedules"
  ADD COLUMN "sample_item_marker_id" TEXT,
  ADD COLUMN "resolution"            TEXT,
  ADD COLUMN "resolved_by"           TEXT,
  ADD COLUMN "resolved_by_name"      TEXT,
  ADD COLUMN "resolved_at"           TIMESTAMP(3);

ALTER TABLE "audit_error_schedules"
  ADD CONSTRAINT "audit_error_schedules_sample_item_marker_id_fkey"
    FOREIGN KEY ("sample_item_marker_id") REFERENCES "sample_item_markers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "audit_error_schedules_sample_item_marker_id_idx"
  ON "audit_error_schedules" ("sample_item_marker_id");

-- ─── 3. audit_tb_rows accruals flag ─────────────────────────────────────────
ALTER TABLE "audit_tb_rows"
  ADD COLUMN "is_accrual_account" BOOLEAN NOT NULL DEFAULT false;

-- ─── 4. methodology_tests.pipeline_config_schema ────────────────────────────
ALTER TABLE "methodology_tests"
  ADD COLUMN "pipeline_config_schema" JSONB;

-- ─── 5. test_executions.config_json ─────────────────────────────────────────
ALTER TABLE "test_executions"
  ADD COLUMN "config_json" JSONB;
