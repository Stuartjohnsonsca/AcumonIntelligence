/**
 * Seed the "Payroll Check to Bank" Test for a firm.
 *
 * Five-step action_pipeline that ties payroll evidence to actual
 * bank movements:
 *
 *   0. request_documents       — client uploads payroll evidence
 *      (zip / PDF payslips / Excel / FPS) via the portal.
 *   1. extract_payroll_data    — parses payslips into per-row data
 *      and per-column totals (Gross Pay / Employer NI / Employee NI /
 *      PAYE / Net Pay / etc.).
 *   2. request_documents       — client uploads bank statements for
 *      the period.
 *   3. extract_bank_statements — parses every transaction with header
 *      info (bank, account, sort code, statement date) per row.
 *   4. ai_analysis             — verification step. Searches the bank
 *      transactions for (a) HMRC payments matching PAYE + employee NI
 *      + employer NI, (b) net pay paid either as a single batch debit
 *      (~ sum(net_pay)) or as N individual debits matching each
 *      employee's net_pay row.
 *
 * Step 4 is the gap called out at design time: the off-the-shelf
 * ai_analysis handler only sends one `input_data` slot to the LLM, so
 * we bind it to the bank transaction table (the haystack) and embed
 * the payroll context inline in the prompt template. To make the
 * three-way comparison fully data-driven, ai_analysis needs to grow
 * either an `extra_data` array input or `{{$step.N.field}}` templating
 * — handler change tracked separately. The cross-step bindings on
 * step 4 are still set so the moment that handler change lands, the
 * pipeline picks up the additional data without further edits here.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Payroll Check to Bank';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'period_frequency',
    label: 'Payroll Frequency',
    type: 'select',
    required: true,
    defaultValue: 'monthly',
    description: 'How often the client runs payroll — used in the request wording.',
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
    code: 'amount_tolerance_gbp',
    label: 'Match Tolerance (GBP)',
    type: 'number',
    required: false,
    defaultValue: 1,
    description: 'Absolute variance allowed when matching a payroll figure to a bank debit (HMRC payment, batch net pay debit, individual net pay debit). Anything above this is treated as unmatched.',
    group: 'Matching',
  },
  {
    code: 'hmrc_payment_window_days',
    label: 'HMRC Payment Window (days)',
    type: 'number',
    required: false,
    defaultValue: 30,
    description: 'Days after each pay date in which a matching HMRC debit may appear (typical UK PAYE: 22nd of the following month).',
    group: 'Matching',
  },
  {
    code: 'net_pay_window_days',
    label: 'Net Pay Window (days)',
    type: 'number',
    required: false,
    defaultValue: 5,
    description: 'Days either side of the pay date in which the net-pay debit (batch or individual) must clear the bank.',
    group: 'Matching',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  // ─── Step 0: Request payroll evidence ────────────────────────────
  {
    actionCode: 'request_documents',
    inputBindings: {
      message_to_client:
        'Please provide payroll evidence covering the audit period — e.g. periodic payroll reports, payslips, HMRC FPS submissions, or any export from your payroll system. A single zip with everything is fine; PDF / Excel / CSV are all accepted.',
      document_type: 'other',
      expected_document_match: 'auto_detect',
      validation_checks: ['client_name', 'period_dates'],
      filter_out_of_period: true,
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ─── Step 1: Parse payroll into rows + totals ────────────────────
  {
    actionCode: 'extract_payroll_data',
    inputBindings: {
      source_documents: '$prev.documents',
      period_start:     '$ctx.engagement.periodStart',
      period_end:       '$ctx.engagement.periodEnd',
      // required_columns includes employee_ni explicitly so the HMRC
      // total comparison (PAYE + employer NI + employee NI) has every
      // component available in summary_totals.
      required_columns: ['gross_pay', 'employer_ni', 'employee_ni', 'paye', 'benefits_in_kind', 'other'],
    },
  },
  // ─── Step 2: Request bank statements ─────────────────────────────
  {
    actionCode: 'request_documents',
    inputBindings: {
      message_to_client:
        'Please provide bank statements covering the audit period for every account from which payroll is paid (net pay to employees and PAYE/NIC to HMRC). PDF, image, or CSV/Excel exports are all fine — multiple accounts can be sent together.',
      document_type: 'bank_statement',
      expected_document_match: 'auto_detect',
      validation_checks: ['client_name', 'period_dates', 'document_type'],
      filter_out_of_period: false,
      period_start: '$ctx.engagement.periodStart',
      period_end: '$ctx.engagement.periodEnd',
      area_of_work: '$ctx.test.fsLine',
    },
  },
  // ─── Step 3: Parse bank statements into transactions ─────────────
  {
    actionCode: 'extract_bank_statements',
    inputBindings: {
      source_files: '$prev.documents',
      client_name:  '$ctx.engagement.clientName',
      currency:     'GBP',
      period_start: '$ctx.engagement.periodStart',
      period_end:   '$ctx.engagement.periodEnd',
      evidence_tag_level: 'account',
    },
  },
  // ─── Step 4: AI verification — payroll vs bank ──────────────────
  {
    actionCode: 'ai_analysis',
    inputBindings: {
      // The bank data_table is the haystack — bind it as the single
      // input_data slot the ai_analysis handler currently consumes.
      // The cross-step references in the prompt below stay set so
      // they Just Work the moment the handler is extended to template
      // {{$step.N.field}} placeholders.
      input_data: '$step.3.data_table',
      system_instruction:
        'You are a statutory auditor verifying that payroll obligations were actually paid. You compare extracted payroll figures to bank-statement debits. Always show your working: which bank line you matched to which payroll figure, the date gap, and the £ variance. Use the configured tolerances; flag anything outside them as an exception. Be deterministic — if a match is ambiguous, list both candidates and mark the row "review".',
      prompt_template:
        // Header
        'Verify that the period\'s payroll obligations were paid correctly through the bank.\n\n' +
        // Inputs the LLM needs to know about
        'PAYROLL CONTEXT (from earlier pipeline steps — reference at runtime):\n' +
        '  Per-payslip rows  : {{$step.1.data_table}}\n' +
        '  Column totals     : {{$step.1.summary_totals}}\n\n' +
        // The single auto-bound data slot
        'BANK TRANSACTIONS (provided as Data below): every transaction extracted from the period\'s bank statements. Columns include date, description, debit, credit, balance, plus header fields (bank, account, sort_code).\n\n' +
        // Tolerances from pipeline config
        'MATCHING RULES:\n' +
        '  Tolerance (GBP)         : {{$ctx.execution.config.amount_tolerance_gbp}}\n' +
        '  HMRC payment window     : {{$ctx.execution.config.hmrc_payment_window_days}} days after each pay date\n' +
        '  Net pay payment window  : {{$ctx.execution.config.net_pay_window_days}} days either side of pay date\n\n' +
        // The two checks
        'CHECKS TO PERFORM:\n' +
        '  1. HMRC PAYMENT MATCH — for each pay date, find one or more bank debits within the HMRC window whose total ~= (PAYE + employer_ni + employee_ni) for that period within tolerance. Description should plausibly reference HMRC / PAYE / NIC.\n' +
        '  2. NET PAY MATCH — for each pay date, find EITHER:\n' +
        '       (a) a single batch debit within the net-pay window whose amount ~= sum(net_pay) for that pay date within tolerance, OR\n' +
        '       (b) N individual debits within the net-pay window, one per employee, each ~= that employee\'s net_pay within tolerance.\n' +
        '     Pick whichever interpretation explains more of the data; never count the same bank line against more than one payroll figure.\n\n' +
        // Output shape
        'OUTPUT — return a single data_table with columns:\n' +
        '  pay_date, check ("hmrc" | "net_pay_batch" | "net_pay_individual"), payroll_amount, bank_amount, bank_date, bank_description, variance, status ("match" | "variance" | "missing" | "review"), notes.\n' +
        'One row per matched/expected payment. Add a final summary row per check showing totals and the count of matches / variances / missing.',
      output_format: 'data_table',
      requires_review: true,
    },
  },
];

export async function seedPayrollCheckToBankTest(firmId: string): Promise<{ testId: string; created: boolean }> {
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
    throw new Error(`Cannot seed Payroll Check to Bank Test — missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  let testId: string;
  let created: boolean;
  const description =
    'Five-step pipeline that requests periodic payroll evidence and bank statements from the client, parses both, and uses AI verification to confirm the period\'s payroll obligations were actually paid through the bank — PAYE + NIC paid to HMRC, and net pay paid to employees (either as a single batch debit or as individual employee payments). Outputs a row-per-payment reconciliation with variance and status, ready for the auditor\'s Evidence & Conclusions section.';

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
        assertions: ['Existence', 'Accuracy', 'Cut-Off'] as any,
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
        assertions: ['Existence', 'Accuracy', 'Cut-Off'] as any,
        isActive: true,
        isDraft: true,
      },
    });
    testId = newTest.id;
    created = true;
  }

  // Rebuild the step chain from scratch so this file is the single
  // source of truth for the pipeline shape.
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
