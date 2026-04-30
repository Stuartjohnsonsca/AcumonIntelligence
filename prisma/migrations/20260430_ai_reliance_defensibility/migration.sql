-- ─── AI Reliance Defensibility ────────────────────────────────────────
-- Three tables underpinning the firm's regulatory-defensible position on
-- AI use across the audit practice. Aligned to FRC supervisory
-- expectations under ISQM(UK)1 and ISA 220 (Revised) on the use of
-- automated tools and techniques: every AI tool used in the audit
-- process must be registered, validated, and its usage human-reviewed
-- with evidence retained.
--
-- Apply manually via Supabase SQL Editor.

-- ─── perf_ai_tools ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "perf_ai_tools" (
  "id"                  TEXT NOT NULL,
  "firm_id"             TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "vendor"              TEXT,
  "model_version"       TEXT,
  "audit_area"          TEXT, -- revenue | je_testing | risk_assessment | controls | analytics | documentation | research | other
  "scope_of_use"        TEXT,
  "risk_rating"         TEXT NOT NULL DEFAULT 'medium', -- low | medium | high | critical
  "owner_name"          TEXT,
  "validation_status"   TEXT NOT NULL DEFAULT 'pending', -- pending | validated | under_review | withdrawn
  "last_validated_date" TIMESTAMP(3),
  "next_validation_due" TIMESTAMP(3),
  "approved_for_use"    BOOLEAN NOT NULL DEFAULT FALSE,
  "approved_by_name"    TEXT,
  "approved_date"       TIMESTAMP(3),
  "human_in_loop"       BOOLEAN NOT NULL DEFAULT TRUE,
  "notes"               TEXT,
  "is_active"           BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_ai_tools_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_ai_tools_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "perf_ai_tools_firm_active_idx"
  ON "perf_ai_tools" ("firm_id", "is_active");

CREATE INDEX IF NOT EXISTS "perf_ai_tools_firm_risk_idx"
  ON "perf_ai_tools" ("firm_id", "risk_rating");

-- ─── perf_ai_usage ────────────────────────────────────────────────────
-- One row per significant AI-assisted decision. The output_decision
-- column is the audit-trail evidence that a human reviewer engaged
-- (accepted / overridden / partial / rejected) — drives the override
-- rate KPI.
CREATE TABLE IF NOT EXISTS "perf_ai_usage" (
  "id"              TEXT NOT NULL,
  "firm_id"         TEXT NOT NULL,
  "tool_id"         TEXT NOT NULL,
  "engagement_name" TEXT,
  "engagement_id"   TEXT,
  "used_date"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewer_name"   TEXT,
  "output_decision" TEXT NOT NULL, -- accepted | overridden | partial | rejected
  "materiality"     TEXT NOT NULL DEFAULT 'medium', -- low | medium | high | critical
  "notes"           TEXT,
  "created_by_id"   TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "perf_ai_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_ai_usage_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_ai_usage_tool_id_fkey"
    FOREIGN KEY ("tool_id") REFERENCES "perf_ai_tools" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "perf_ai_usage_firm_tool_idx"
  ON "perf_ai_usage" ("firm_id", "tool_id");

CREATE INDEX IF NOT EXISTS "perf_ai_usage_firm_used_idx"
  ON "perf_ai_usage" ("firm_id", "used_date");

-- ─── perf_ai_validations ──────────────────────────────────────────────
-- One row per validation test run for a tool. Evidences that the firm
-- tested each tool before approval and on a defined re-test cadence
-- (drift, regression, accuracy, bias, edge cases, golden-set replay).
CREATE TABLE IF NOT EXISTS "perf_ai_validations" (
  "id"           TEXT NOT NULL,
  "firm_id"      TEXT NOT NULL,
  "tool_id"      TEXT NOT NULL,
  "test_date"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "test_type"    TEXT NOT NULL, -- accuracy | bias | regression | edge_case | drift | golden_set | other
  "result"       TEXT NOT NULL, -- pass | fail | partial
  "performed_by" TEXT,
  "sample_size"  INTEGER,
  "accuracy_pct" DOUBLE PRECISION,
  "evidence_url" TEXT,
  "notes"        TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "perf_ai_validations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_ai_validations_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_ai_validations_tool_id_fkey"
    FOREIGN KEY ("tool_id") REFERENCES "perf_ai_tools" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "perf_ai_validations_firm_tool_idx"
  ON "perf_ai_validations" ("firm_id", "tool_id");

CREATE INDEX IF NOT EXISTS "perf_ai_validations_firm_test_idx"
  ON "perf_ai_validations" ("firm_id", "test_date");
