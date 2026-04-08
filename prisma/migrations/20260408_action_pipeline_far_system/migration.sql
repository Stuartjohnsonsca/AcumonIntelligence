-- Action Pipeline System: ActionDefinition + TestActionStep
-- FAR fields on AuditTBRow + AuditEngagement
-- executionMode fields on MethodologyTest + TestExecution

-- ─── ActionDefinition ───────────────────────────────────────────────────────

CREATE TABLE "action_definitions" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "version" INTEGER NOT NULL DEFAULT 1,
    "input_schema" JSONB NOT NULL,
    "output_schema" JSONB NOT NULL,
    "handler_name" TEXT,
    "internal_flow" JSONB,
    "icon" TEXT,
    "color" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_definitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "action_definitions_firm_id_idx" ON "action_definitions"("firm_id");
CREATE INDEX "action_definitions_category_idx" ON "action_definitions"("category");
CREATE UNIQUE INDEX "action_definitions_firm_id_code_version_key" ON "action_definitions"("firm_id", "code", "version");

ALTER TABLE "action_definitions" ADD CONSTRAINT "action_definitions_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── TestActionStep ─────────────────────────────────────────────────────────

CREATE TABLE "test_action_steps" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "action_definition_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "input_bindings" JSONB NOT NULL,
    "config_overrides" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_action_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "test_action_steps_test_id_idx" ON "test_action_steps"("test_id");
CREATE UNIQUE INDEX "test_action_steps_test_id_step_order_key" ON "test_action_steps"("test_id", "step_order");

ALTER TABLE "test_action_steps" ADD CONSTRAINT "test_action_steps_test_id_fkey"
    FOREIGN KEY ("test_id") REFERENCES "methodology_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_action_steps" ADD CONSTRAINT "test_action_steps_action_definition_id_fkey"
    FOREIGN KEY ("action_definition_id") REFERENCES "action_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── MethodologyTest: add executionMode ─────────────────────────────────────

ALTER TABLE "methodology_tests" ADD COLUMN "execution_mode" TEXT NOT NULL DEFAULT 'flow';

-- ─── TestExecution: add pipeline fields ─────────────────────────────────────

ALTER TABLE "test_executions" ADD COLUMN "execution_mode" TEXT NOT NULL DEFAULT 'flow';
ALTER TABLE "test_executions" ADD COLUMN "current_step_index" INTEGER;
ALTER TABLE "test_executions" ADD COLUMN "action_step_id" TEXT;
ALTER TABLE "test_executions" ADD COLUMN "pipeline_state" JSONB;

-- ─── TestExecutionNodeRun: add actionStepId ─────────────────────────────────

ALTER TABLE "test_execution_node_runs" ADD COLUMN "action_step_id" TEXT;

-- ─── AuditTBRow: add farSchedule ────────────────────────────────────────────

ALTER TABLE "audit_tb_rows" ADD COLUMN "far_schedule" JSONB;

-- ─── AuditEngagement: add FAR config fields ─────────────────────────────────

ALTER TABLE "audit_engagements" ADD COLUMN "far_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "audit_engagements" ADD COLUMN "far_asset_type" TEXT;
ALTER TABLE "audit_engagements" ADD COLUMN "far_scope" TEXT;
ALTER TABLE "audit_engagements" ADD COLUMN "far_categories" JSONB;
