/**
 * Seed the Recalculation of Interest Expense Test for a firm.
 *
 * Pipeline chain:
 *   0. request_documents               — loan agreements / facility letters
 *   1. extract_loan_agreements         — tranche-level data_table (rate,
 *                                        drawdown, payments, maturity, fees)
 *   2. compute_loan_interest_schedule  — independent interest recalc with
 *                                        per-tranche schedule + grand total
 *   3. compute_loan_fees_schedule      — effective-interest amortisation of
 *                                        loan fees (incl. prior-period roll)
 *   4. compare_interest_expense_to_tb  — reconcile both totals to TB
 *   5. team_review
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Recalculation of interest expense';

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  // 0 — request loan agreements via the portal.
  {
    actionCode: 'request_documents',
    inputBindings: {
      document_type: 'contract',
      message_to_client: 'Please provide all loan agreements / facility letters in force during the period, together with any amendments, side-letters and drawdown notices. Where a loan was repaid in the period please include the final settlement statement. Where a loan has multiple tranches please ensure each tranche’s drawdown date, principal, interest rate, repayment terms, maturity date and any arrangement / commitment fees are clearly identifiable.',
      area_of_work: 'Interest payable and similar income',
    },
  },
  // 1 — extract tranche-level data from the agreements.
  {
    actionCode: 'extract_loan_agreements',
    inputBindings: {
      source_documents: '$prev.documents',
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 2 — recalculate interest charge for the period.
  {
    actionCode: 'compute_loan_interest_schedule',
    inputBindings: {
      loan_data: '$prev.data_table',
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 3 — recalculate fees charge using the effective-interest method on the
  // tranche data extracted in step 1 (not the schedule from step 2).
  {
    actionCode: 'compute_loan_fees_schedule',
    inputBindings: {
      loan_data: '$step.1.data_table',
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 4 — reconcile both totals to the trial balance.
  {
    actionCode: 'compare_interest_expense_to_tb',
    inputBindings: {
      calculated_interest: '$step.2.total_interest',
      calculated_fees: '$prev.total_fees_charge',
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 5 — sign-off.
  {
    actionCode: 'team_review',
    inputBindings: {
      instructions: 'Review the interest and fees recalculation. Resolve any Red variances as Error (book to the error schedule) or In TB (already reflected). Sign off once both interest and fees lines agree to the trial balance within tolerance.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedInterestExpenseTest(firmId: string): Promise<{ testId: string; created: boolean }> {
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
    throw new Error(`Cannot seed Recalculation of Interest Expense Test — missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  const common = {
    description: 'Independent recalculation of the period’s interest expense and loan-fees charge. Loan agreements are requested via the portal, AI extracts each tranche’s rate / drawdown / payments / maturity / fees, the action engine builds a day-by-day interest schedule and an effective-interest fees schedule, and the totals are reconciled to the relevant trial-balance accounts.',
    framework: 'ALL',
    category: 'Normal',
    outputFormat: 'three_section_no_sampling',
    executionMode: 'action_pipeline',
    pipelineConfigSchema: [] as any,
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

  // Rebuild the chain idempotently.
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
