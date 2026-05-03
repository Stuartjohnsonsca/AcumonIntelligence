-- Adds editor-only metadata for tests (hiddenStages) and branch rules
-- for individual pipeline steps (conditional / goto / skip flow control).
-- Both columns are nullable; existing rows continue to behave linearly.

ALTER TABLE "methodology_tests"
  ADD COLUMN IF NOT EXISTS "editor_config" JSONB;

ALTER TABLE "test_action_steps"
  ADD COLUMN IF NOT EXISTS "branch_rules" JSONB;
