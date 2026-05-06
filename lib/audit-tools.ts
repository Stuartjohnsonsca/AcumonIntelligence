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
  },
  {
    key: 'recalculation',
    label: 'Recalculation',
    description: 'Recompute balances independently and agree to the recorded amount.',
    outputFormat: 'spreadsheet',
    testTypeCode: 'team_action',
    defaultAssertions: ['A', 'V'],
  },
  {
    key: 'confirmation',
    label: 'Third-party confirmation',
    description: 'Issue confirmations to banks, customers or suppliers and reconcile responses.',
    outputFormat: 'three_section_no_sampling',
    testTypeCode: 'client_action',
    defaultAssertions: ['E', 'R&O'],
  },
  {
    key: 'reconciliation',
    label: 'Reconciliation',
    description: 'Reconcile two independent populations (e.g. ledger to listing) and investigate variances.',
    outputFormat: 'spreadsheet',
    testTypeCode: 'team_action',
    defaultAssertions: ['C', 'A'],
  },
  {
    key: 'analytical_review',
    label: 'Substantive analytical review',
    description: 'Develop an expectation, compare to recorded balance, investigate variances above threshold.',
    outputFormat: 'three_section_no_sampling',
    testTypeCode: 'team_action',
    defaultAssertions: ['E', 'V'],
  },
  {
    key: 'cutoff',
    label: 'Cut-off testing',
    description: 'Test transactions either side of period-end to ensure recording in the correct period.',
    outputFormat: 'three_section_sampling',
    testTypeCode: 'team_action',
    defaultAssertions: ['CO'],
  },
];

/** Lookup helper — returns the tool definition by key. */
export function findAuditTool(key: string): AuditTool | undefined {
  return AUDIT_TOOLS.find(t => t.key === key);
}
