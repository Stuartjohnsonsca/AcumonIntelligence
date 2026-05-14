/**
 * Audit Tools — substantive procedure templates the auditor can
 * deploy from the Plan Customiser against a scoped FS Line.
 *
 * Two consumers share this list:
 *   1. PlanCustomiserModal (in-engagement): renders the dropdown,
 *      filters by per-firm availability and fires the deploy.
 *   2. ToolsSettingsClient (Methodology Admin): renders the same
 *      tools alongside Sampling Calculator / Bank Audit / etc. so
 *      the firm admin can mark each one Unavailable / Discretion /
 *      Available depending on whether the firm has purchased it.
 *
 * The MethodologyToolSetting Prisma model keys availability by
 * `(toolName, methodName, auditType)`; for these tools we use
 * AUDIT_TOOLS_GROUP as the toolName and the tool's `label` as
 * methodName, so the existing settings table accommodates them
 * without a schema change.
 */

export interface AuditTool {
  /** Stable key used in client-side state and on the wire. */
  key: string;
  /** Human-readable label shown in the dropdown + admin grid. */
  label: string;
  /** Short description shown under the label. */
  description: string;
  /** outputFormat the deployed test will render with. */
  outputFormat: 'three_section_no_sampling' | 'three_section_sampling' | 'spreadsheet' | 'document_summary';
  /** Test type code recorded against the resulting custom test. */
  testTypeCode: 'team_action' | 'ai_action' | 'client_action';
  /** Default assertions seeded on the deployed test. */
  defaultAssertions: string[];
  /**
   * Tool-specific instruction the default flow's AI step uses to
   * frame its work. Combined with the engagement / TB-row context at
   * runtime by buildDefaultFlowForTool() below. Keeping it inline
   * here (instead of in a separate prompt registry) lets the
   * methodology admin tweak a single source of truth and have every
   * deployed copy of the tool benefit on its next run.
   */
  aiInstruction: string;
}

/**
 * The toolName key used in MethodologyToolSetting rows for this
 * group. Kept in one place so admin and runtime read/write the
 * same identifier.
 */
export const AUDIT_TOOLS_GROUP = 'Audit Tools';

export const AUDIT_TOOLS: AuditTool[] = [
  {
    key: 'sample_selection',
    label: 'Sample selection',
    description: 'Select a representative sample of items from the TB codes for substantive testing.',
    outputFormat: 'three_section_sampling',
    testTypeCode: 'team_action',
    defaultAssertions: ['E', 'A', 'V'],
    aiInstruction:
      'Design a sample-selection plan for this balance. Recommend the population to draw from, an appropriate sample size given the FS line balance and assertions in scope, the selection method (monetary unit sampling / random / risk-based / stratified) and justify each choice. Where possible, propose stratification cut-offs in £ terms. Output as: Population definition · Sample size · Method · Stratification · Reasoning.',
  },
  {
    key: 'recalculation',
    label: 'Recalculation',
    description: 'Recompute balances independently and agree to the recorded amount.',
    outputFormat: 'spreadsheet',
    testTypeCode: 'team_action',
    defaultAssertions: ['A', 'V'],
    aiInstruction:
      'Outline the recalculation procedure for this balance. State the recorded amount, the inputs needed (rates, base amounts, formulae, supporting schedules), the independent recalc you would perform, the materiality threshold to apply, and what would constitute an acceptable variance. Conclude on the assertions covered.',
  },
  {
    key: 'confirmation',
    label: 'Third-party confirmation',
    description: 'Issue confirmations to banks, customers or suppliers and reconcile responses.',
    outputFormat: 'three_section_no_sampling',
    testTypeCode: 'client_action',
    defaultAssertions: ['E', 'R&O'],
    aiInstruction:
      'Plan a third-party confirmation procedure for this balance. Identify which counterparties to confirm with (banks / customers / suppliers / lawyers / lenders as relevant), the confirmation type (positive vs negative, blank vs prefilled), the wording focus, and alternative procedures for non-responses. Note which assertions confirmations cover and which they do not.',
  },
  {
    key: 'reconciliation',
    label: 'Reconciliation',
    description: 'Reconcile two independent populations (e.g. ledger to listing) and investigate variances.',
    outputFormat: 'spreadsheet',
    testTypeCode: 'team_action',
    defaultAssertions: ['C', 'A'],
    aiInstruction:
      'Plan a reconciliation between two independent populations for this balance (e.g. nominal ledger vs sub-ledger or supporting listing). Specify the two populations, the matching key, expected reconciling items (in-transit, accruals, timing differences), the variance threshold for investigation, and the steps to clear residual differences.',
  },
  {
    key: 'analytical_review',
    label: 'Substantive analytical review',
    description: 'Develop an expectation, compare to recorded balance, investigate variances above threshold.',
    outputFormat: 'three_section_no_sampling',
    testTypeCode: 'team_action',
    defaultAssertions: ['E', 'V'],
    aiInstruction:
      'Design a substantive analytical review for this balance. Build an expectation using prior-year, budget, ratio analysis or external benchmarks. State the expected amount, the threshold for investigation (link to Performance Materiality), and the procedures to investigate variances above threshold. Conclude on whether the SAP provides sufficient assurance on its own or whether it must be combined with detail testing.',
  },
  {
    key: 'cutoff',
    label: 'Cut-off testing',
    description: 'Test transactions either side of period-end to ensure recording in the correct period.',
    outputFormat: 'three_section_sampling',
    testTypeCode: 'team_action',
    defaultAssertions: ['CO'],
    aiInstruction:
      'Design a cut-off test for this balance. Specify the window either side of period-end (e.g. ±5 working days), the population (sales / purchases / journals / payroll runs depending on the line), the sample size, the documents to inspect (delivery notes, invoices, GRNs, contracts), and the matters to confirm — recorded in the correct period vs strict goods-passed / services-performed dates.',
  },
];

/** Lookup helper — returns the tool definition by key. */
export function findAuditTool(key: string): AuditTool | undefined {
  return AUDIT_TOOLS.find(t => t.key === key);
}

/**
 * Build the default flow that ships with every AI-Tool deployment.
 *
 * Shape: `start → ai_action → end`. The AI node carries:
 *   • a system instruction common to every tool (UK statutory audit
 *     assistant framing, plus a stand-by for the auditor to refine);
 *   • a prompt template that interpolates the tool's `aiInstruction`
 *     with engagement / TB-row context the flow engine has in scope
 *     at run time (`{{fsLine}}`, `{{tbRow.accountCode}}`,
 *     `{{tbRow.description}}`, `{{tbRow.currentYear}}`,
 *     `{{tbRow.priorYear}}`, `{{testDescription}}`).
 *
 * Auditors can refine each deployed flow via the Flow Builder. This
 * baseline exists so that AI Tools are EXECUTABLE the moment they
 * land on the audit plan — which they weren't before today (every
 * Run hit "No flow configured" because the catalogue shipped no
 * flow with the tool).
 *
 * Returns plain JSON (not a typed FlowData) on purpose — this module
 * is consumed by both the modal and the server route, and pulling in
 * the flow-engine types would create an import cycle.
 */
export function buildDefaultFlowForTool(tool: AuditTool): unknown {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      {
        id: 'ai_action',
        type: 'action',
        position: { x: 0, y: 120 },
        data: {
          label: tool.label,
          assignee: 'ai',
          executionDef: {
            systemInstruction:
              'You are a UK statutory audit assistant. Be precise, reference specific figures from the trial-balance context, and align with FRC Audit Quality Inspection findings. Write in the firm’s working-paper voice.',
            promptTemplate:
              `${tool.aiInstruction}\n\nContext:\n` +
              '- FS line: {{fsLine}}\n' +
              '- Account: {{tbRow.accountCode}} {{tbRow.description}}\n' +
              '- Current-year balance: {{tbRow.currentYear}}\n' +
              '- Prior-year balance: {{tbRow.priorYear}}\n' +
              '- Test: {{testDescription}}\n\n' +
              'Return the plan as concise audit working-paper text. If a procedure cannot be specified from the context, say so explicitly rather than guess.',
            outputFormat: 'text',
            inputs: [],
          },
        },
      },
      { id: 'end', type: 'end', position: { x: 0, y: 240 }, data: { label: 'Complete' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ai_action' },
      { id: 'e2', source: 'ai_action', target: 'end' },
    ],
  };
}
