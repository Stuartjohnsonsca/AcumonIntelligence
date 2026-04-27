-- ─── G3Q Performance Dashboard ─────────────────────────────────────────
-- All tables backing the AQT lead's Performance Dashboard. Each row is
-- firm-scoped via firm_id, with FK to firms(id) on cascade delete.
--
-- Apply manually via Supabase SQL Editor.

-- ─── perf_monitoring_activities ────────────────────────────────────────
-- Cold/hot/spot/thematic file reviews, EQR process reviews, technical
-- consultations, FS pre-issuance reviews, ethical compliance reviews.
CREATE TABLE IF NOT EXISTS "perf_monitoring_activities" (
  "id"                TEXT NOT NULL,
  "firm_id"           TEXT NOT NULL,
  "activity_type"     TEXT NOT NULL, -- cold | hot | spot | thematic | eqr | consultation | preissuance | ethical
  "engagement_name"   TEXT,
  "engagement_id"     TEXT,
  "ri_name"           TEXT,
  "manager_name"      TEXT,
  "reviewer_name"     TEXT,
  "planned_date"      TIMESTAMP(3),
  "started_date"      TIMESTAMP(3),
  "completed_date"    TIMESTAMP(3),
  "status"            TEXT NOT NULL DEFAULT 'planned', -- planned | in_progress | complete | overdue | cancelled
  "outcome_rating"    TEXT, -- good | limited_improvements | improvements_required | significant_improvements
  "quality_score"     INTEGER,
  "findings_count"    INTEGER NOT NULL DEFAULT 0,
  "notes"             TEXT,
  "created_by_id"     TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_monitoring_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_monitoring_activities_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "perf_monitoring_activities_firm_type_idx"
  ON "perf_monitoring_activities" ("firm_id", "activity_type");

CREATE INDEX IF NOT EXISTS "perf_monitoring_activities_firm_status_idx"
  ON "perf_monitoring_activities" ("firm_id", "status");

-- ─── perf_findings ────────────────────────────────────────────────────
-- Findings raised from monitoring activities. Drives RCA tracker.
CREATE TABLE IF NOT EXISTS "perf_findings" (
  "id"                  TEXT NOT NULL,
  "firm_id"             TEXT NOT NULL,
  "activity_id"         TEXT,
  "title"               TEXT NOT NULL,
  "description"         TEXT,
  "root_cause_category" TEXT, -- process | methodology | supervision | data_ipe | resourcing | other
  "severity"            TEXT NOT NULL DEFAULT 'medium', -- low | medium | high | critical
  "raised_date"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rca_completed_date"  TIMESTAMP(3),
  "closed_date"         TIMESTAMP(3),
  "status"              TEXT NOT NULL DEFAULT 'open', -- open | rca_in_progress | rca_complete | closed
  "notes"               TEXT,
  "created_by_id"       TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_findings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_findings_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_findings_activity_id_fkey"
    FOREIGN KEY ("activity_id") REFERENCES "perf_monitoring_activities" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "perf_findings_firm_status_idx"
  ON "perf_findings" ("firm_id", "status");

CREATE INDEX IF NOT EXISTS "perf_findings_firm_root_cause_idx"
  ON "perf_findings" ("firm_id", "root_cause_category");

-- ─── perf_remediations ────────────────────────────────────────────────
-- Remediation actions linked to a finding. Effectiveness set on re-test.
CREATE TABLE IF NOT EXISTS "perf_remediations" (
  "id"             TEXT NOT NULL,
  "firm_id"        TEXT NOT NULL,
  "finding_id"     TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "owner_name"     TEXT,
  "due_date"       TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | implemented | retested | overdue
  "retested_date"  TIMESTAMP(3),
  "effective"      BOOLEAN, -- null = not yet retested
  "notes"          TEXT,
  "created_by_id"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_remediations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_remediations_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_remediations_finding_id_fkey"
    FOREIGN KEY ("finding_id") REFERENCES "perf_findings" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "perf_remediations_firm_status_idx"
  ON "perf_remediations" ("firm_id", "status");

-- ─── perf_csfs ────────────────────────────────────────────────────────
-- Critical Success Factors defined in the AQMP — one row per CSF, RAG
-- updated as the AQT lead reviews progress.
CREATE TABLE IF NOT EXISTS "perf_csfs" (
  "id"             TEXT NOT NULL,
  "firm_id"        TEXT NOT NULL,
  "pillar"         TEXT NOT NULL, -- goodwill | governance | growth | quality
  "sub_component"  TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "target_metric"  TEXT,
  "current_metric" TEXT,
  "rag"            TEXT NOT NULL DEFAULT 'grey', -- green | amber | red | grey
  "owner_name"     TEXT,
  "reviewed_date"  TIMESTAMP(3),
  "notes"          TEXT,
  "is_active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_csfs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_csfs_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "perf_csfs_firm_pillar_idx"
  ON "perf_csfs" ("firm_id", "pillar");

-- ─── perf_people_snapshots ────────────────────────────────────────────
-- Periodic snapshot of people metrics (Jul/Jan reporting cycle).
CREATE TABLE IF NOT EXISTS "perf_people_snapshots" (
  "id"                          TEXT NOT NULL,
  "firm_id"                     TEXT NOT NULL,
  "period_label"                TEXT NOT NULL,
  "period_end"                  TIMESTAMP(3) NOT NULL,
  "training_effectiveness_pct"  DOUBLE PRECISION,
  "staff_utilisation_pct"       DOUBLE PRECISION,
  "culture_survey_score"        DOUBLE PRECISION, -- 0-5
  "attrition_pct"               DOUBLE PRECISION,
  "notes"                       TEXT,
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_people_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_people_snapshots_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_people_snapshots_firm_period_unique"
    UNIQUE ("firm_id", "period_label")
);

CREATE INDEX IF NOT EXISTS "perf_people_snapshots_firm_end_idx"
  ON "perf_people_snapshots" ("firm_id", "period_end");

-- ─── perf_activity_schedule ───────────────────────────────────────────
-- Annual G3Q Gantt — one row per planned activity per month per year.
CREATE TABLE IF NOT EXISTS "perf_activity_schedule" (
  "id"             TEXT NOT NULL,
  "firm_id"        TEXT NOT NULL,
  "year"           INTEGER NOT NULL,
  "month_index"    INTEGER NOT NULL, -- 0-11
  "activity_name"  TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'planned', -- planned | on_track | at_risk | overdue | done
  "owner_name"     TEXT,
  "due_date"       TIMESTAMP(3),
  "completed_date" TIMESTAMP(3),
  "notes"          TEXT,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_activity_schedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_activity_schedule_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_activity_schedule_firm_year_month_name_unique"
    UNIQUE ("firm_id", "year", "month_index", "activity_name")
);

CREATE INDEX IF NOT EXISTS "perf_activity_schedule_firm_year_idx"
  ON "perf_activity_schedule" ("firm_id", "year");

-- ─── perf_isqm_evidence ───────────────────────────────────────────────
-- ISQM(UK)1 evidence per quality objective. RAG can be auto-derived
-- from evidence_count / target_count, OR set manually if rag_manual.
CREATE TABLE IF NOT EXISTS "perf_isqm_evidence" (
  "id"             TEXT NOT NULL,
  "firm_id"        TEXT NOT NULL,
  "objective"      TEXT NOT NULL, -- governance_leadership | ethics | acceptance_continuance | engagement_performance | resources | information_communication | monitoring_remediation | risk_assessment
  "evidence_count" INTEGER NOT NULL DEFAULT 0,
  "target_count"   INTEGER NOT NULL DEFAULT 0,
  "rag"            TEXT NOT NULL DEFAULT 'grey', -- green | amber | red | grey
  "rag_manual"     BOOLEAN NOT NULL DEFAULT FALSE,
  "notes"          TEXT,
  "reviewed_date"  TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_isqm_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_isqm_evidence_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_isqm_evidence_firm_objective_unique"
    UNIQUE ("firm_id", "objective")
);

-- ─── perf_pillar_scores ───────────────────────────────────────────────
-- Optional manual override of pillar score + strapline. Null manual_score
-- means the dashboard auto-derives from CSF RAG mix + monitoring progress.
CREATE TABLE IF NOT EXISTS "perf_pillar_scores" (
  "id"            TEXT NOT NULL,
  "firm_id"       TEXT NOT NULL,
  "pillar"        TEXT NOT NULL, -- goodwill | governance | growth | quality
  "manual_score"  INTEGER,
  "strapline"     TEXT,
  "reviewed_date" TIMESTAMP(3),
  "notes"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_pillar_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_pillar_scores_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms" ("id") ON DELETE CASCADE,
  CONSTRAINT "perf_pillar_scores_firm_pillar_unique"
    UNIQUE ("firm_id", "pillar")
);
