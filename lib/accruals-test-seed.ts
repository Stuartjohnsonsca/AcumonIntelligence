/**
 * Seed the Year-End Accruals Test for a firm.
 *
 * Creates (or idempotently refreshes) one MethodologyTest whose
 * `executionMode` is `action_pipeline` and whose `outputFormat` is
 * `four_section_accruals`. The test chains the six actions described
 * in the pipeline plan. Sample-selection, document-request, and
 * team-review actions are the existing system Actions; the three new
 * actions (request_accruals_listing, extract_accruals_evidence,
 * verify_accruals_sample) are what make this test distinct.
 *
 * This seed is firm-scoped: every firm that seeds system actions gets
 * its own copy of the test. Action definitions themselves live at
 * firmId = null (system-wide) so the test steps all reference the
 * same ActionDefinition rows.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Year-End Accruals Test';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'x_days_post_ye',
    label: 'Post-Year-End Evidence Window (days)',
    type: 'number',
    required: true,
    defaultValue: 60,
    description: 'How many days after period end we look at for subsequent invoices and payments that support the recorded accruals.',
    group: 'Evidence Window',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  {
    actionCode: 'request_accruals_listing',
    inputBindings: {
      // message_to_client / tolerance_gbp / accrual_account_codes fall back
      // to the action's defaultValue unless the audit team overrides at runtime.
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  {
    actionCode: 'select_sample',
    inputBindings: {
      population: '$prev.data_table',
      // sample_type chosen by the audit team at the pause prompt.
    },
  },
  {
    actionCode: 'request_documents',
    inputBindings: {
      // document_type — auditor selects from the 7 YE-support options at runtime.
      // Transactions/sample carried forward from the sampling step.
      transactions: '$prev.data_table',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  {
    actionCode: 'extract_accruals_evidence',
    inputBindings: {
      source_documents: '$prev.documents',
      sample_items: '$step.1.sample_items',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  {
    actionCode: 'verify_accruals_sample',
    inputBindings: {
      sample_items: '$step.1.sample_items',
      extracted_evidence: '$prev.extracted_evidence',
      period_end: '$ctx.engagement.periodEnd',
      x_days_post_ye: '$ctx.execution.config.x_days_post_ye',
    },
  },
  {
    actionCode: 'team_review',
    inputBindings: {
      instructions: 'Review the Findings & Conclusions section. Confirm Red items have been resolved as either Error (booked to the Error Schedule) or In TB (already reflected in the trial balance). Sign off once all sample items are concluded.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedAccrualsTest(firmId: string): Promise<{ testId: string; created: boolean }> {
  // Every action referenced in STEP_CHAIN must already exist in
  // action_definitions. The admin route runs ensureSystemActionsUpserted()
  // first so we can trust that the codes are present.
  const actionDefs = await prisma.actionDefinition.findMany({
    where: {
      firmId: null,
      code: { in: STEP_CHAIN.map(s => s.actionCode) },
      isActive: true,
    },
  });
  const byCode: Record<string, { id: string; version: number }> = {};
  for (const a of actionDefs) {
    // Prefer latest version if multiple exist.
    const existing = byCode[a.code];
    if (!existing || (a.version ?? 1) > existing.version) {
      byCode[a.code] = { id: a.id, version: a.version ?? 1 };
    }
  }

  const missing = STEP_CHAIN.map(s => s.actionCode).filter(c => !byCode[c]);
  if (missing.length > 0) {
    throw new Error(`Cannot seed Year-End Accruals Test — missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  if (existing) {
    testId = existing.id;
    created = false;
    await prisma.methodologyTest.update({
      where: { id: testId },
      data: {
        description: 'Samples the year-end accruals listing and verifies each accrual against post-year-end invoices and payments. Handles straightforward accruals, mis-dated obligations, missing support, and service periods that span the year end (time-apportioned).',
        testTypeCode: existing.testTypeCode || 'substantive',
        framework: 'ALL',
        category: 'Normal',
        outputFormat: 'four_section_accruals',
        executionMode: 'action_pipeline',
        pipelineConfigSchema: PIPELINE_CONFIG_SCHEMA as any,
        isActive: true,
      },
    });
  } else {
    const testTypeCode = await pickTestTypeCode(firmId);
    const newTest = await prisma.methodologyTest.create({
      data: {
        firmId,
        name: TEST_NAME,
        description: 'Samples the year-end accruals listing and verifies each accrual against post-year-end invoices and payments. Handles straightforward accruals, mis-dated obligations, missing support, and service periods that span the year end (time-apportioned).',
        testTypeCode,
        framework: 'ALL',
        category: 'Normal',
        outputFormat: 'four_section_accruals',
        executionMode: 'action_pipeline',
        pipelineConfigSchema: PIPELINE_CONFIG_SCHEMA as any,
        isActive: true,
        isDraft: true,
      },
    });
    testId = newTest.id;
    created = true;
  }

  // Rebuild the step chain from scratch — idempotent and avoids drift if
  // the action order changes in code.
  await prisma.testActionStep.deleteMany({ where: { testId } });
  for (let i = 0; i < STEP_CHAIN.length; i++) {
    const spec = STEP_CHAIN[i];
    await prisma.testActionStep.create({
      data: {
        testId,
        actionDefinitionId: byCode[spec.actionCode].id,
        stepOrder: i,
        inputBindings: spec.inputBindings as any,
        isActive: true,
      },
    });
  }

  return { testId, created };
}

async function pickTestTypeCode(firmId: string): Promise<string> {
  const row = await prisma.methodologyTestType.findFirst({
    where: { firmId, isActive: true },
    orderBy: { code: 'asc' },
    select: { code: true },
  });
  return row?.code || 'substantive';
}
