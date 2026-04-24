/**
 * Seed the Periodic Payroll Test for a firm.
 *
 * Creates (or idempotently refreshes) one MethodologyTest whose
 * executionMode is 'action_pipeline' and whose outputFormat is
 * 'three_section_sampling'. The pipeline chains four actions:
 *
 *   1. request_documents       — client uploads payroll evidence
 *      (zip / PDF payslips / Excel / FPS). Auto-detect matching; the
 *      documents action unzips + splits + filters out-of-period rows.
 *   2. extract_payroll_data    — parse into a single data_table with
 *      Gross Pay / Employer NI / PAYE / BIK / Other columns plus any
 *      additional columns detected on the payslips. Out-of-period
 *      rows are filtered out and surfaced on the extraction report.
 *   3. payroll_totals_to_tb    — reconcile each column total against
 *      the TB accounts the admin mapped to that column. Green marker
 *      = agrees (\u2264 tolerance), red marker = difference (hover
 *      shows the TB account + the £ gap). Red markers land in the
 *      findings table for Evidence & Conclusions.
 *   4. team_review             — reviewer evaluates the findings and
 *      books any differences to the Error Schedule in the usual way.
 *
 * Seed is firm-scoped; every firm gets its own copy of the test row.
 * Action definitions themselves live at firmId = null so every firm
 * shares the same action catalogue.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Periodic Payroll Test';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'period_frequency',
    label: 'Payroll Frequency',
    type: 'select',
    required: true,
    defaultValue: 'monthly',
    description: 'How often the client runs payroll \u2014 drives how the request wording phrases the number of pay periods you\u2019re asking for.',
    group: 'Scope',
    options: [
      { value: 'weekly',     label: 'Weekly' },
      { value: 'fortnightly',label: 'Fortnightly' },
      { value: 'four_weekly',label: 'Four-weekly' },
      { value: 'monthly',    label: 'Monthly' },
      { value: 'custom',     label: 'Custom' },
    ],
  },
  {
    code: 'tolerance_gbp',
    label: 'TB Reconciliation Tolerance (GBP)',
    type: 'number',
    required: false,
    defaultValue: 1,
    description: 'Columns whose £ difference vs TB is within this tolerance show a green dot ("Agrees to TB"); anything larger shows red with the TB account + variance on hover.',
    group: 'Reconciliation',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  {
    actionCode: 'request_documents',
    inputBindings: {
      // Payroll-specific default message. Admin can override at runtime.
      message_to_client:
        'Please provide payroll evidence for the audit period — e.g. monthly payroll reports, payslips, HMRC FPS submissions, or any export from your payroll system. A single zip with everything is fine; PDF / Excel / CSV are all accepted.',
      document_type: 'other',
      expected_document_match: 'auto_detect',
      // Validation + period-window filtering are done by the extract
      // step below; the request action only needs to catch obvious
      // client-name / period mismatches at upload time.
      validation_checks: ['client_name', 'period_dates'],
      filter_out_of_period: true,
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  {
    actionCode: 'extract_payroll_data',
    inputBindings: {
      source_documents: '$prev.documents',
      period_start:     '$ctx.engagement.periodStart',
      period_end:       '$ctx.engagement.periodEnd',
      // required_columns + currency fall back to the action's own
      // defaults (Gross Pay / Employer NI / PAYE / BIK / Other,
      // currency = engagement.currency if set, otherwise GBP).
    },
  },
  {
    actionCode: 'payroll_totals_to_tb',
    inputBindings: {
      summary_totals:  '$prev.summary_totals',
      tolerance_gbp:   '$ctx.execution.config.tolerance_gbp',
      period_end:      '$ctx.engagement.periodEnd',
      // column_account_map is captured at runtime from firm-wide
      // Wages & Salaries account assignments (or the auditor picks
      // them per-engagement when they're not pre-configured).
    },
  },
  {
    actionCode: 'team_review',
    inputBindings: {
      instructions:
        'Review the payroll reconciliation. Each column shows a green dot ("Agrees to TB") or a red dot (with the TB account and variance on hover). For every red item, decide whether to (a) book the difference to the Error Schedule, (b) mark it as "In TB" if already accounted for elsewhere, or (c) record a rationale in the Evidence & Conclusions panel. Sign off once every red marker has been resolved.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedPeriodicPayrollTest(firmId: string): Promise<{ testId: string; created: boolean }> {
  // Every action referenced in STEP_CHAIN must already exist in
  // action_definitions. Caller (the Methodology Admin seed route)
  // runs ensureSystemActionsUpserted() first so we can trust the
  // codes resolve.
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
    throw new Error(`Cannot seed Periodic Payroll Test \u2014 missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  const description =
    'Requests periodic payroll evidence from the client, extracts per-payslip rows into a single spreadsheet keyed by Gross Pay / Employer NI / PAYE / Benefits in Kind / Other, then reconciles each column total to the trial balance. Each column shows a green "Agrees to TB" marker or a red marker with the TB account + £ variance on hover. Red variances flow straight into Evidence & Conclusions ready to send to the Error Schedule.';

  if (existing) {
    testId = existing.id;
    created = false;
    await prisma.methodologyTest.update({
      where: { id: testId },
      data: {
        description,
        testTypeCode: existing.testTypeCode || 'substantive',
        framework: 'ALL',
        category: 'Normal',
        outputFormat: 'three_section_sampling',
        executionMode: 'action_pipeline',
        pipelineConfigSchema: PIPELINE_CONFIG_SCHEMA as any,
        assertions: ['Completeness', 'Accuracy', 'Cut-Off'] as any,
        isActive: true,
      },
    });
  } else {
    const testTypeCode = await pickTestTypeCode(firmId);
    const newTest = await prisma.methodologyTest.create({
      data: {
        firmId,
        name: TEST_NAME,
        description,
        testTypeCode,
        framework: 'ALL',
        category: 'Normal',
        outputFormat: 'three_section_sampling',
        executionMode: 'action_pipeline',
        pipelineConfigSchema: PIPELINE_CONFIG_SCHEMA as any,
        assertions: ['Completeness', 'Accuracy', 'Cut-Off'] as any,
        isActive: true,
        isDraft: true,
      },
    });
    testId = newTest.id;
    created = true;
  }

  // Rebuild the step chain from scratch \u2014 matches the accruals /
  // URLA seed pattern and keeps the pipeline in lock-step with this
  // file if the actions are re-ordered.
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
