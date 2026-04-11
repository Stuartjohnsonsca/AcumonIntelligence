-- Add is_draft to methodology_tests
ALTER TABLE "methodology_tests"
  ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: any test that already has at least one allocation is "in use",
-- so flip it out of draft. Tests with zero allocations stay as drafts so
-- the Methodology Admin can decide when to publish them.
UPDATE "methodology_tests" mt
SET "is_draft" = false
WHERE EXISTS (
  SELECT 1
  FROM "methodology_test_allocations" mta
  WHERE mta."test_id" = mt."id"
);

-- Filter index for the audit-plan / Plan Customiser hot path. Most reads
-- ask for "non-draft tests for this firm", so a partial index speeds up
-- the engagement test-allocations endpoint.
CREATE INDEX "methodology_tests_firm_id_is_draft_idx"
  ON "methodology_tests" ("firm_id", "is_draft");
