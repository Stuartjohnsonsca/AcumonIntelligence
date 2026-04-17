/**
 * Seed the Unrecorded Liabilities Test for a firm.
 *
 * Pipeline chain:
 *   0. request_documents               — post-YE bank statements / exports
 *   1. extract_post_ye_bank_payments   — population of payments in the window
 *   2. request_accruals_listing        — creditors/accruals listing at YE
 *                                        (reused — gives us the ≤-YE lookup
 *                                        needed in the verify step)
 *   3. select_unrecorded_liabilities_sample
 *                                      — above-threshold + AI risk + residual
 *   4. request_documents               — supporting docs per sampled payment
 *   5. extract_accruals_evidence       — reused supplier-invoice extractor
 *   6. verify_unrecorded_liabilities_sample
 *                                      — R/O/G markers per sample item
 *   7. team_review
 *
 * outputFormat = 'four_section_unrecorded_liabilities' — rendered in the
 * runtime by components/methodology/panels/unrecorded-liabilities/.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Unrecorded Liabilities Test';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'x_days_post_ye',
    label: 'Post-Year-End Payments Window (days)',
    type: 'number',
    required: true,
    defaultValue: 60,
    description: 'How many days after period end we scan for payments that may represent obligations of the audited year.',
    group: 'Evidence Window',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

// Matches the order in the docblock above.
const STEP_CHAIN: StepSpec[] = [
  // 0 — request post-YE bank statements.
  {
    actionCode: 'request_documents',
    inputBindings: {
      document_type: 'bank_statement',
      area_of_work: 'Unrecorded Liabilities',
    },
  },
  // 1 — extract payments in the window.
  {
    actionCode: 'extract_post_ye_bank_payments',
    inputBindings: {
      source_documents: '$prev.documents',
      period_end: '$ctx.engagement.periodEnd',
      x_days_post_ye: '$ctx.execution.config.x_days_post_ye',
    },
  },
  // 2 — request creditors/accruals listing as at YE.
  {
    actionCode: 'request_accruals_listing',
    inputBindings: {
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 3 — select sample (above-threshold + AI + residual).
  {
    actionCode: 'select_unrecorded_liabilities_sample',
    inputBindings: {
      population: '$step.1.data_table',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 4 — request supporting docs for each sampled payment.
  {
    actionCode: 'request_documents',
    inputBindings: {
      transactions: '$prev.sample_items',
      area_of_work: 'Unrecorded Liabilities',
    },
  },
  // 5 — extract supplier-side evidence for each supporting doc.
  {
    actionCode: 'extract_accruals_evidence',
    inputBindings: {
      source_documents: '$prev.documents',
      sample_items: '$step.3.sample_items',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 6 — verify + mark R/O/G.
  {
    actionCode: 'verify_unrecorded_liabilities_sample',
    inputBindings: {
      sample_items: '$step.3.sample_items',
      extracted_evidence: '$prev.extracted_evidence',
      creditors_portal_request_id: '$step.2.portal_request_id',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 7 — team review / sign-off.
  {
    actionCode: 'team_review',
    inputBindings: {
      instructions: 'Review the Findings & Conclusions section. Resolve any Red items as either Error (book to the error schedule as "Unrecorded liability") or In TB (already reflected in the trial balance). Sign off once every sample item is concluded.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedUnrecordedLiabilitiesTest(firmId: string): Promise<{ testId: string; created: boolean }> {
  const actionDefs = await prisma.actionDefinition.findMany({
    where: {
      firmId: null,
      code: { in: STEP_CHAIN.map(s => s.actionCode) },
      isActive: true,
    },
  });
  const byCode: Record<string, { id: string; version: number }> = {};
  for (const a of actionDefs) {
    const existing = byCode[a.code];
    if (!existing || (a.version ?? 1) > existing.version) {
      byCode[a.code] = { id: a.id, version: a.version ?? 1 };
    }
  }

  const missing = STEP_CHAIN.map(s => s.actionCode).filter(c => !byCode[c]);
  if (missing.length > 0) {
    throw new Error(`Cannot seed Unrecorded Liabilities Test — missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  const common = {
    description: 'Tests post-year-end bank payments for obligations that relate to the audited year and asks: is there a matching creditor or accrual at year end? Samples above performance materiality, AI-risk-ranks the remainder, and applies stratified/MUS/haphazard residual sampling.',
    framework: 'ALL',
    category: 'Normal',
    outputFormat: 'four_section_unrecorded_liabilities',
    executionMode: 'action_pipeline',
    pipelineConfigSchema: PIPELINE_CONFIG_SCHEMA as any,
    isActive: true,
  };
  if (existing) {
    testId = existing.id;
    created = false;
    await prisma.methodologyTest.update({
      where: { id: testId },
      data: { ...common, testTypeCode: existing.testTypeCode || 'substantive' },
    });
  } else {
    const testTypeCode = await pickTestTypeCode(firmId);
    const newTest = await prisma.methodologyTest.create({
      data: { firmId, name: TEST_NAME, testTypeCode, isDraft: true, ...common },
    });
    testId = newTest.id;
    created = true;
  }

  // Rebuild chain.
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
