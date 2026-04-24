/**
 * Seed the Payroll Leavers Test for a firm.
 *
 * Creates (or idempotently refreshes) one MethodologyTest whose
 * executionMode is 'action_pipeline' and whose outputFormat is
 * 'three_section_sampling'. The test has TWO flavours driven by a
 * single runtime config flag `sr_mode`:
 *
 *   • sr_mode = true  (Significant Risk)
 *     Step 0 asks the client for ALL periodic payroll reports for the
 *     audit period. Step 1 (identify_payroll_movements, sr_mode=true)
 *     ages each employee across the runs and surfaces everyone who
 *     stopped appearing — the full-SR population.
 *
 *   • sr_mode = false (non-Significant Risk)
 *     Step 0 asks the client only for a list of leavers. Step 1
 *     (identify_payroll_movements, sr_mode=false) parses that list
 *     as-is with light validation. Work is lighter-touch.
 *
 * Both flavours share the SAME downstream chain: sample → request
 * supporting paperwork → structured leaver questionnaire → evidence
 * match + daily-apportionment R/O/G → team review. That keeps the
 * output reports identical regardless of SR / non-SR, so a
 * Methodology Admin only has to know one test.
 *
 * STEP_CHAIN indices are what verify_payroll_movements uses to pull
 * back the original periodic reports ($step.0.documents) and the
 * sampled items ($step.2.sample_items). Do not re-order without
 * updating those bindings in lib/action-seed.ts.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Payroll Leavers Test';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'sr_mode',
    label: 'Significant-Risk Mode',
    type: 'boolean',
    required: true,
    defaultValue: false,
    description: 'When Wages & Salaries is a significant risk, turn this ON. The request-documents step asks for every periodic payroll report in the period (so we can age every employee) and the identify step does the full SR scan. When OFF, the client just supplies a list of leavers and we go straight to sampling.',
    group: 'Scope',
  },
  {
    code: 'amount_tolerance_gbp',
    label: 'Final-Pay Apportionment Tolerance (GBP)',
    type: 'number',
    required: false,
    defaultValue: 5,
    description: 'Absolute £ variance allowed between the recorded final pay and the daily-apportionment expectation before the R/O/G marker turns red.',
    group: 'Thresholds',
  },
  {
    code: 'working_days_per_month',
    label: 'Working Days per Month',
    type: 'number',
    required: false,
    defaultValue: 20,
    description: 'Used for the daily-apportionment check on final pay. Override on engagements whose payroll runs on a non-standard working-day convention.',
    group: 'Thresholds',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  // ── Step 0 — ask the client for the underlying data ────────────
  // In SR mode we need every periodic payroll report so the identify
  // action can age each employee. In non-SR we just ask for a list
  // of leavers. Same action, different message driven by sr_mode.
  {
    actionCode: 'request_documents',
    inputBindings: {
      message_to_client:
        'Please provide either (a) every periodic payroll report (weekly / monthly / fortnightly) covering the audit period, if payroll is flagged as a significant-risk area for this engagement; or (b) a list of everyone who left during the audit period (name, employee reference, leave date, final gross pay) if the methodology pack marks payroll as non-SR. Your audit team have configured the test with the mode they need — if you\u2019re not sure which, send both; we only use what the test asks for.',
      document_type: 'other',
      expected_document_match: 'auto_detect',
      validation_checks: ['client_name', 'period_dates'],
      filter_out_of_period: true,
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ── Step 1 — identify leavers (population) ─────────────────────
  // SR mode:      sr_mode=true  → scan every periodic report.
  // non-SR mode:  sr_mode=false → parse the client list as-is.
  {
    actionCode: 'identify_payroll_movements',
    inputBindings: {
      movement_type:   'leavers',
      sr_mode:         '$ctx.execution.config.sr_mode',
      source_documents:'$prev.documents',
      period_start:    '$ctx.engagement.periodStart',
      period_end:      '$ctx.engagement.periodEnd',
    },
  },
  // ── Step 2 — select a sample from the leaver population ────────
  {
    actionCode: 'select_sample',
    inputBindings: {
      sample_type: 'standard',
      population:  '$prev.data_table',
      output_action: 'request_documents',
    },
  },
  // ── Step 3 — request supporting paperwork for the sampled leavers
  // P45s, notice of termination, settlement agreements, etc.
  {
    actionCode: 'request_documents',
    inputBindings: {
      message_to_client:
        'Please provide, for each leaver listed below, their P45 (Parts 1A/2/3) and any notice of termination, settlement agreement or resignation letter on file. Upload as one zip per leaver or drag everything in and we\u2019ll auto-match by employee name / reference.',
      document_type: 'other',
      expected_document_match: 'per_sample_item',
      sample_items: '$prev.sample_items',
      validation_checks: ['client_name'],
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ── Step 4 — leaver-specific questionnaire ─────────────────────
  // Runs as a structured portal form. Gated on movement_count so we
  // auto-skip when no leavers were found in-period.
  {
    actionCode: 'request_portal_questions',
    inputBindings: {
      gate_on_count: true,
      gating_count:  '$step.1.movement_count',
      message_to_client:
        'For each of the leavers below, please confirm the following so we can complete their audit sample. These are routine questions the standards require us to ask for every leaver in the period.',
      questions: [
        { code: 'dispute',          question: 'Was there any dispute with this employee over their departure (grievance, tribunal, unresolved complaint)?', answer_type: 'yn_text', required: true },
        { code: 'termination_pay',  question: 'Was any termination payment or redundancy / ex-gratia payment made (in addition to normal pay)?',           answer_type: 'yn_text', required: true },
        { code: 'share_based_comp', question: 'Did this leaver have any share-based compensation (share options, RSUs, EMI, growth shares) that vested, lapsed, or was bought back on leaving?', answer_type: 'yn_text', required: true },
        { code: 'other_flag',       question: 'Is there anything else we should know about this leaver (garden leave, restrictive covenants, post-period payments still due)?', answer_type: 'yn_text', required: false },
      ],
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ── Step 5 — verify paperwork + daily-apportionment R/O/G ──────
  {
    actionCode: 'verify_payroll_movements',
    inputBindings: {
      movement_type:           'leavers',
      sample_items:            '$step.2.sample_items',
      evidence_documents:      '$step.3.documents',
      questionnaire_responses: '$step.4.data_table',
      periodic_reports:        '$step.0.documents',
      amount_tolerance_gbp:    '$ctx.execution.config.amount_tolerance_gbp',
      working_days_per_month:  '$ctx.execution.config.working_days_per_month',
    },
  },
  // ── Step 6 — team review / sign-off ────────────────────────────
  {
    actionCode: 'team_review',
    inputBindings: {
      instructions:
        'Review the R/O/G markers from the leavers verification. For every red item, decide whether to book the variance to the Error Schedule, accept the auditor\u2019s rationale, or request further evidence. Orange items need a short rationale captured in Evidence & Conclusions (apportionment difference with a reason — e.g. mid-month bonus, statutory pay). Green items can be signed off in bulk. Do not sign off until every red marker is resolved.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedPayrollLeaversTest(firmId: string): Promise<{ testId: string; created: boolean }> {
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
    throw new Error(`Cannot seed Payroll Leavers Test \u2014 missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  const description =
    'Tests leavers through the audit period against P45s, termination paperwork and a daily-apportionment check on their final pay. One test, two flavours: when Wages & Salaries is a Significant Risk the pipeline scans every periodic payroll report and derives the leaver population from the full set; when not SR the client supplies a leaver list and the work is lighter-touch. Downstream (sample → paperwork → questionnaire → R/O/G → team review) is identical in both modes. Red markers stream into Evidence & Conclusions for the Error Schedule.';

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
        assertions: ['Completeness', 'Accuracy', 'Cut-Off', 'Occurrence'] as any,
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
        assertions: ['Completeness', 'Accuracy', 'Cut-Off', 'Occurrence'] as any,
        isActive: true,
        isDraft: true,
      },
    });
    testId = newTest.id;
    created = true;
  }

  // Rebuild the step chain from scratch — matches the periodic-payroll
  // / accruals / URLA seed pattern and keeps the pipeline in lock-step
  // with this file if actions are re-ordered.
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
