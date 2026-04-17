/**
 * Seed the Gross Margin Analytical Review Test for a firm.
 *
 * Pipeline chain (5 steps):
 *   0. request_gm_data             — revenue / COS / budget / PY breakdowns
 *   1. compute_gm_analysis         — GM% per period, variance table, flagging
 *   2. request_gm_explanations     — portal request for explanations of flagged variances
 *   3. assess_gm_explanations      — AI plausibility → R/O/G markers per variance
 *   4. team_review                 — sign-off
 *
 * outputFormat = 'four_section_gross_margin' — rendered by
 * components/methodology/panels/gross-margin/.
 */

import { prisma } from '@/lib/db';

const TEST_NAME = 'Gross Margin Analytical Review';

const PIPELINE_CONFIG_SCHEMA = [
  {
    code: 'comparison_periods',
    label: 'Comparison Periods',
    type: 'multiselect',
    required: true,
    defaultValue: ['prior_year'],
    description: 'Pick one or more periods/benchmarks to compare the current-year gross margin against.',
    group: 'Scope',
    options: [
      { value: 'prior_year', label: 'Prior year actual' },
      { value: 'multiple_py', label: 'Multiple prior periods (trend)' },
      { value: 'budget', label: 'Budget / forecast' },
      { value: 'industry_benchmark', label: 'Industry benchmark (user-supplied)' },
    ],
  },
  {
    code: 'expectation_model',
    label: 'Expectation Model',
    type: 'select',
    required: true,
    defaultValue: 'consistency_py',
    description: 'The analytical model used to derive the expected GM % for the current year.',
    group: 'Expectation',
    options: [
      { value: 'consistency_py', label: 'Consistency with prior year %' },
      { value: 'consistency_avg', label: 'Consistency with average of prior periods' },
      { value: 'budget', label: 'Comparison to budgeted margin %' },
      { value: 'reasonableness', label: 'Reasonableness — PY margin applied to CY revenue/cost' },
    ],
  },
  {
    code: 'analysis_type',
    label: 'Type of Analysis Performed',
    type: 'select',
    required: true,
    defaultValue: 'combination',
    description: 'Drives the wording of the final audit conclusion.',
    group: 'Conclusion',
    options: [
      { value: 'trend', label: 'Trend analysis' },
      { value: 'ratio', label: 'Ratio analysis (gross margin %)' },
      { value: 'reasonableness', label: 'Reasonableness test' },
      { value: 'combination', label: 'Combination of the above' },
    ],
  },
  {
    code: 'tolerance_pct',
    label: 'Tolerance — % point movement',
    type: 'number',
    required: true,
    defaultValue: 2,
    description: 'Flag a variance if the GM% movement (absolute) exceeds this many percentage points.',
    group: 'Tolerance',
  },
  {
    code: 'tolerance_pm_multiple',
    label: 'Tolerance — × Performance Materiality',
    type: 'number',
    required: true,
    defaultValue: 1,
    description: 'Flag a variance if the £ impact on profit exceeds this multiple of performance materiality.',
    group: 'Tolerance',
  },
];

interface StepSpec {
  actionCode: string;
  inputBindings: Record<string, any>;
}

const STEP_CHAIN: StepSpec[] = [
  // 0 — request GM data.
  {
    actionCode: 'request_gm_data',
    inputBindings: {
      comparison_periods: '$ctx.execution.config.comparison_periods',
      tolerance_pct: '$ctx.execution.config.tolerance_pct',
      tolerance_pm_multiple: '$ctx.execution.config.tolerance_pm_multiple',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 1 — compute GM analysis + variance table.
  {
    actionCode: 'compute_gm_analysis',
    inputBindings: {
      data_table: '$prev.data_table',
      expectation_model: '$ctx.execution.config.expectation_model',
      tolerance_pct: '$ctx.execution.config.tolerance_pct',
      tolerance_pm_multiple: '$ctx.execution.config.tolerance_pm_multiple',
      period_end: '$ctx.engagement.periodEnd',
    },
  },
  // 2 — request management explanations for flagged variances.
  {
    actionCode: 'request_gm_explanations',
    inputBindings: {
      variances: '$prev.variances',
    },
  },
  // 3 — AI plausibility assessment → R/O/G markers.
  {
    actionCode: 'assess_gm_explanations',
    inputBindings: {
      variances: '$step.1.variances',
      explanations: '$prev.explanations',
      calculations: '$step.1.calculations',
      analysis_type: '$ctx.execution.config.analysis_type',
    },
  },
  // 4 — team review / sign-off.
  {
    actionCode: 'team_review',
    inputBindings: {
      instructions: 'Review the Findings & Conclusions section. Confirm the expectation model, tolerance settings, flagged variances and AI plausibility verdicts. Resolve any Red items as Error (to the error schedule) or In TB. Sign off once all variances are concluded.',
      reviewer_role: 'reviewer',
      sign_off_required: true,
    },
  },
];

export async function seedGrossMarginTest(firmId: string): Promise<{ testId: string; created: boolean }> {
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
    throw new Error(`Cannot seed Gross Margin Analytical Review — missing action definitions: ${missing.join(', ')}`);
  }

  const existing = await prisma.methodologyTest.findUnique({
    where: { firmId_name: { firmId, name: TEST_NAME } },
  });

  const common = {
    description: 'Analytical review of gross margin %. Compares current-year GM% against a model-derived expectation (PY / average / budget / reasonableness), auto-flags variances that breach the percentage-point or PM-linked tolerance, requests management explanations for flagged variances, and uses AI plausibility assessment to assign a Red / Orange / Green verdict per variance.',
    framework: 'ALL',
    category: 'Analytical Review',
    outputFormat: 'four_section_gross_margin',
    executionMode: 'action_pipeline',
    pipelineConfigSchema: PIPELINE_CONFIG_SCHEMA as any,
    isActive: true,
  };

  let testId: string;
  let created: boolean;
  if (existing) {
    testId = existing.id;
    created = false;
    await prisma.methodologyTest.update({
      where: { id: testId },
      data: { ...common, testTypeCode: existing.testTypeCode || 'analytical_review' },
    });
  } else {
    const testTypeCode = await pickTestTypeCode(firmId);
    const newTest = await prisma.methodologyTest.create({
      data: { firmId, name: TEST_NAME, testTypeCode, isDraft: true, ...common },
    });
    testId = newTest.id;
    created = true;
  }

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
  // Prefer an analytical-review test type if the firm has one, otherwise
  // fall back to the first active test type or the sensible default.
  const preferred = await prisma.methodologyTestType.findFirst({
    where: { firmId, isActive: true, code: { contains: 'analytical', mode: 'insensitive' } as any },
    select: { code: true },
  });
  if (preferred?.code) return preferred.code;
  const row = await prisma.methodologyTestType.findFirst({
    where: { firmId, isActive: true },
    orderBy: { code: 'asc' },
    select: { code: true },
  });
  return row?.code || 'analytical_review';
}
