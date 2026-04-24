/**
 * Seed the Payroll Joiners Test for a firm.
 *
 * Mirror image of the Payroll Leavers Test — same STEP_CHAIN shape,
 * same sr_mode toggle, but focused on joiners: people who appeared
 * on payroll for the first time during the audit period. The two
 * flavours are:
 *
 *   • sr_mode = true  (Significant Risk)
 *     Step 0 asks the client for every periodic payroll report in
 *     the period AND the final payroll report from the prior period.
 *     The prior-period report is the cross-check that a detected
 *     joiner wasn\u2019t already on payroll the month before (would
 *     otherwise be flagged as a false-positive joiner).
 *
 *   • sr_mode = false (non-Significant Risk)
 *     Step 0 asks for a simple list of joiners. identify_payroll_
 *     movements parses it as-is.
 *
 * Downstream (sample → contract / offer / right-to-work paperwork
 * → structured joiner questionnaire → first-pay apportionment R/O/G
 * → team review) is identical in both modes.
 *
 * STEP_CHAIN indices are what verify_payroll_movements uses to pull
 * back the original periodic reports ($step.0.documents) and the
 * sampled items ($step.2.sample_items). Do not re-order without
 * updating the bindings in lib/action-seed.ts.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Payroll Joiners Test';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'sr_mode',
    label: 'Significant-Risk Mode',
    type: 'boolean',
    required: true,
    defaultValue: false,
    description: 'When Wages & Salaries is a significant risk, turn this ON. The request-documents step asks for every periodic payroll report in the period plus the final payroll report from the prior period (used to eliminate false-positive joiners). When OFF, the client just supplies a list of joiners and we go straight to sampling.',
    group: 'Scope',
  },
  {
    code: 'amount_tolerance_gbp',
    label: 'First-Pay Apportionment Tolerance (GBP)',
    type: 'number',
    required: false,
    defaultValue: 5,
    description: 'Absolute £ variance allowed between the recorded first pay and the daily-apportionment expectation before the R/O/G marker turns red.',
    group: 'Thresholds',
  },
  {
    code: 'working_days_per_month',
    label: 'Working Days per Month',
    type: 'number',
    required: false,
    defaultValue: 20,
    description: 'Used for the daily-apportionment check on first pay. Override on engagements whose payroll runs on a non-standard working-day convention.',
    group: 'Thresholds',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  // ── Step 0 — underlying data ───────────────────────────────────
  // SR mode: every periodic payroll report + prior-period final run.
  // Non-SR: a list of joiners. Same action, different message.
  {
    actionCode: 'request_documents',
    inputBindings: {
      message_to_client:
        'Please provide either (a) every periodic payroll report (weekly / monthly / fortnightly) covering the audit period AND the final payroll report from the period immediately before, if payroll is flagged as a significant-risk area for this engagement; or (b) a list of everyone who joined during the audit period (name, employee reference, start date, first gross pay) if the methodology pack marks payroll as non-SR. Your audit team have configured the test with the mode they need — if you\u2019re not sure which, send both; we only use what the test asks for.',
      document_type: 'other',
      expected_document_match: 'auto_detect',
      validation_checks: ['client_name', 'period_dates'],
      filter_out_of_period: false,
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ── Step 1 — identify joiners (population) ─────────────────────
  // SR mode:     sr_mode=true  → scan every periodic report + cross
  //              check each detected joiner against the prior-period
  //              final payroll run.
  // Non-SR mode: sr_mode=false → parse the client list as-is.
  {
    actionCode: 'identify_payroll_movements',
    inputBindings: {
      movement_type:       'joiners',
      sr_mode:             '$ctx.execution.config.sr_mode',
      source_documents:    '$prev.documents',
      period_start:        '$ctx.engagement.periodStart',
      period_end:          '$ctx.engagement.periodEnd',
      // The action itself will pick the prior-period final run out
      // of source_documents when the file is included. No separate
      // prior_period_report binding needed — keeping the interface
      // aligned with the leavers seed.
    },
  },
  // ── Step 2 — sample joiners ────────────────────────────────────
  {
    actionCode: 'select_sample',
    inputBindings: {
      sample_type: 'standard',
      population:  '$prev.data_table',
      output_action: 'request_documents',
    },
  },
  // ── Step 3 — request supporting paperwork for sampled joiners
  // Contracts / offer letters / right-to-work / starter checklists.
  {
    actionCode: 'request_documents',
    inputBindings: {
      message_to_client:
        'Please provide, for each joiner listed below, their signed contract of employment (or offer letter if the contract is still outstanding), right-to-work evidence (passport / share code / visa), and the HMRC starter checklist or P45 from their previous employment. Upload as one zip per joiner or drag everything in and we\u2019ll auto-match by employee name / reference.',
      document_type: 'other',
      expected_document_match: 'per_sample_item',
      sample_items: '$prev.sample_items',
      validation_checks: ['client_name'],
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ── Step 4 — joiner-specific questionnaire ─────────────────────
  // Gated on movement_count so we auto-skip when there are no
  // joiners in the period.
  {
    actionCode: 'request_portal_questions',
    inputBindings: {
      gate_on_count: true,
      gating_count:  '$step.1.movement_count',
      message_to_client:
        'For each of the joiners below, please confirm the following so we can complete their audit sample. These are routine questions the standards require us to ask for every joiner in the period.',
      questions: [
        { code: 'joining_payment',  question: 'Was any joining payment, signing bonus, relocation allowance or golden hello paid to this new starter?',         answer_type: 'yn_text', required: true },
        { code: 'share_based_comp', question: 'Does this joiner have any share-based compensation (options, RSUs, EMI, growth shares) granted on or since joining?', answer_type: 'yn_text', required: true },
        { code: 'related_party',    question: 'Is the joiner a related party of the company (director, close family of a director or key management personnel)?', answer_type: 'yn_text', required: true },
        { code: 'other_flag',       question: 'Is there anything else we should know about this joiner (non-standard start date, secondment from group company, salary guarantee)?', answer_type: 'yn_text', required: false },
      ],
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ── Step 5 — verify paperwork + daily-apportionment R/O/G ──────
  {
    actionCode: 'verify_payroll_movements',
    inputBindings: {
      movement_type:           'joiners',
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
        'Review the R/O/G markers from the joiners verification. For every red item, decide whether to book the variance to the Error Schedule, accept the auditor\u2019s rationale, or request further evidence. Orange items need a short rationale captured in Evidence & Conclusions (apportionment difference with a reason — e.g. mid-month start, probationary period pay). Green items can be signed off in bulk. Do not sign off until every red marker is resolved.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedPayrollJoinersTest(firmId: string): Promise<{ testId: string; created: boolean }> {
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
    throw new Error(`Cannot seed Payroll Joiners Test \u2014 missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  const description =
    'Tests joiners through the audit period against contracts, right-to-work evidence and a daily-apportionment check on their first pay. One test, two flavours: when Wages & Salaries is a Significant Risk the pipeline scans every periodic payroll report and cross-checks each detected joiner against the prior period\u2019s final run to eliminate false positives; when not SR the client supplies a joiner list and the work is lighter-touch. Downstream (sample → paperwork → questionnaire → R/O/G → team review) is identical in both modes. Red markers stream into Evidence & Conclusions for the Error Schedule.';

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
