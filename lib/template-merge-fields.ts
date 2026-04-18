/**
 * Canonical catalog of merge fields available in document-template
 * bodies. Each entry describes a Handlebars path the admin can drop
 * into the template — e.g. `{{engagement.clientName}}` — and what it
 * will render to.
 *
 * This file is the ONE source of truth for:
 *   • the pill palette in the DocumentTemplateEditor
 *   • the `missingPlaceholders` check on preview (any `{{x.y}}` in
 *     the template that isn't covered here is flagged so the admin
 *     can see typos before they ship)
 *   • the sample values used when an admin hits Preview without
 *     selecting a live engagement.
 *
 * Scalars render inline. Arrays are intended for use with
 * `{{#each …}}` blocks and expose per-item fields in their `itemFields`.
 * The full context shape is built by `lib/template-context.ts`.
 */

export type MergeFieldType = 'scalar' | 'array' | 'object' | 'date' | 'currency';

export interface MergeFieldItemField {
  key: string;
  label: string;
  type: MergeFieldType;
  sampleValue: any;
}

export interface MergeField {
  /** Dot path from the root context object, e.g. "engagement.clientName". */
  key: string;
  label: string;
  type: MergeFieldType;
  group: string;
  description?: string;
  sampleValue: any;
  /** For arrays only: fields available on each iterated item (used to
   *  populate the `{{#each}}` child pill list in the editor). */
  itemFields?: MergeFieldItemField[];
}

/**
 * Adding a new field here makes it immediately available to every
 * document template. Keep sample values realistic — the admin
 * previews rely on them.
 */
export const MERGE_FIELDS: MergeField[] = [
  // ─── Dates ────────────────────────────────────────────────────────────────
  { group: 'Dates', key: 'currentDate', label: 'Current date (today)', type: 'date', sampleValue: '2026-04-18' },
  { group: 'Dates', key: 'currentYear', label: 'Current year', type: 'scalar', sampleValue: 2026 },

  // ─── Engagement ──────────────────────────────────────────────────────────
  { group: 'Engagement', key: 'engagement.clientName', label: 'Client name', type: 'scalar', sampleValue: 'Acme Holdings Ltd' },
  { group: 'Engagement', key: 'engagement.auditType', label: 'Audit type', type: 'scalar', sampleValue: 'SME' },
  { group: 'Engagement', key: 'engagement.framework', label: 'Financial reporting framework', type: 'scalar', sampleValue: 'FRS 102' },
  { group: 'Engagement', key: 'engagement.status', label: 'Engagement status', type: 'scalar', sampleValue: 'active' },
  { group: 'Engagement', key: 'engagement.hardCloseDate', label: 'Hard close date', type: 'date', sampleValue: '2026-06-30' },
  { group: 'Engagement', key: 'engagement.priorPeriodEnd', label: 'Prior period end', type: 'date', sampleValue: '2025-12-31' },

  // ─── Period ──────────────────────────────────────────────────────────────
  { group: 'Period', key: 'period.periodStart', label: 'Period start', type: 'date', sampleValue: '2026-01-01' },
  { group: 'Period', key: 'period.periodEnd', label: 'Period end', type: 'date', sampleValue: '2026-12-31' },

  // ─── Client ──────────────────────────────────────────────────────────────
  { group: 'Client', key: 'client.name', label: 'Client legal name', type: 'scalar', sampleValue: 'Acme Holdings Ltd' },
  { group: 'Client', key: 'client.companyNumber', label: 'Company number', type: 'scalar', sampleValue: '07654321' },
  { group: 'Client', key: 'client.registeredAddress', label: 'Registered address', type: 'scalar', sampleValue: '1 High Street, London, EC1A 1AA' },
  { group: 'Client', key: 'client.sector', label: 'Sector / industry', type: 'scalar', sampleValue: 'Professional services' },

  // ─── Firm ────────────────────────────────────────────────────────────────
  { group: 'Firm', key: 'firm.name', label: 'Firm name', type: 'scalar', sampleValue: 'Johnsons Financial Management LLP' },
  { group: 'Firm', key: 'firm.address', label: 'Firm address', type: 'scalar', sampleValue: '100 King Street, Manchester, M2 4WU' },

  // ─── Team ────────────────────────────────────────────────────────────────
  { group: 'Team', key: 'ri.name', label: 'Responsible Individual (RI) name', type: 'scalar', sampleValue: 'Stuart Thomson' },
  { group: 'Team', key: 'ri.email', label: 'RI email', type: 'scalar', sampleValue: 'stuart@johnsonsca.com' },
  { group: 'Team', key: 'reviewer.name', label: 'Reviewer name', type: 'scalar', sampleValue: 'Jane Patel' },
  { group: 'Team', key: 'reviewer.email', label: 'Reviewer email', type: 'scalar', sampleValue: 'jane@johnsonsca.com' },
  { group: 'Team', key: 'preparer.name', label: 'Preparer name', type: 'scalar', sampleValue: 'Alex Brown' },
  { group: 'Team', key: 'team', label: 'Engagement team (array)', type: 'array', sampleValue: [
    { name: 'Stuart Thomson', role: 'RI', email: 'stuart@johnsonsca.com' },
    { name: 'Jane Patel', role: 'Reviewer', email: 'jane@johnsonsca.com' },
    { name: 'Alex Brown', role: 'Preparer', email: 'alex@johnsonsca.com' },
  ], itemFields: [
    { key: 'name', label: 'Name', type: 'scalar', sampleValue: 'Stuart Thomson' },
    { key: 'role', label: 'Role', type: 'scalar', sampleValue: 'RI' },
    { key: 'email', label: 'Email', type: 'scalar', sampleValue: 'stuart@johnsonsca.com' },
  ]},

  // ─── Materiality ─────────────────────────────────────────────────────────
  { group: 'Materiality', key: 'materiality.overall', label: 'Overall materiality', type: 'currency', sampleValue: 125000 },
  { group: 'Materiality', key: 'materiality.performance', label: 'Performance materiality', type: 'currency', sampleValue: 87500 },
  { group: 'Materiality', key: 'materiality.clearlyTrivial', label: 'Clearly trivial', type: 'currency', sampleValue: 6250 },
  { group: 'Materiality', key: 'materiality.benchmark', label: 'Benchmark', type: 'scalar', sampleValue: 'Profit before tax' },
  { group: 'Materiality', key: 'materiality.benchmarkAmount', label: 'Benchmark amount', type: 'currency', sampleValue: 2500000 },
  { group: 'Materiality', key: 'materiality.benchmarkPct', label: 'Benchmark %', type: 'scalar', sampleValue: 5 },

  // ─── Error Schedule ──────────────────────────────────────────────────────
  { group: 'Error Schedule', key: 'errorSchedule', label: 'Error schedule items (array)', type: 'array',
    description: 'Use with {{#each errorSchedule}} to loop over each error.',
    sampleValue: [
      { fsLine: 'Revenue', description: 'Cut-off — December invoice booked in January', amount: 45000, errorType: 'factual', resolution: 'error' },
      { fsLine: 'Cost of Sales', description: 'Accrual understatement', amount: 12500, errorType: 'factual', resolution: 'error' },
    ], itemFields: [
      { key: 'fsLine', label: 'FS line', type: 'scalar', sampleValue: 'Revenue' },
      { key: 'description', label: 'Description', type: 'scalar', sampleValue: 'Cut-off — December invoice booked in January' },
      { key: 'amount', label: 'Amount', type: 'currency', sampleValue: 45000 },
      { key: 'errorType', label: 'Error type', type: 'scalar', sampleValue: 'factual' },
      { key: 'resolution', label: 'Resolution (error | in_tb)', type: 'scalar', sampleValue: 'error' },
      { key: 'explanation', label: 'Explanation', type: 'scalar', sampleValue: 'Timing difference identified during cut-off testing.' },
    ]},
  { group: 'Error Schedule', key: 'errorScheduleTotals.adjusted', label: 'Total adjusted errors', type: 'currency', sampleValue: 57500 },
  { group: 'Error Schedule', key: 'errorScheduleTotals.unadjusted', label: 'Total unadjusted errors', type: 'currency', sampleValue: 0 },
  { group: 'Error Schedule', key: 'errorScheduleTotals.count', label: 'Number of errors', type: 'scalar', sampleValue: 2 },

  // ─── Test Conclusions / Audit Plan ───────────────────────────────────────
  { group: 'Audit Plan', key: 'testConclusions', label: 'Test conclusions (array)', type: 'array',
    description: 'Use with {{#each testConclusions}}. Each row is one completed test.',
    sampleValue: [
      { fsLine: 'Revenue', testDescription: 'Revenue cut-off test', conclusion: 'green', totalErrors: 0, extrapolatedError: 0 },
      { fsLine: 'Cash', testDescription: 'Bank confirmations', conclusion: 'green', totalErrors: 0, extrapolatedError: 0 },
    ], itemFields: [
      { key: 'fsLine', label: 'FS line', type: 'scalar', sampleValue: 'Revenue' },
      { key: 'testDescription', label: 'Test description', type: 'scalar', sampleValue: 'Revenue cut-off test' },
      { key: 'conclusion', label: 'Conclusion (green|orange|red)', type: 'scalar', sampleValue: 'green' },
      { key: 'totalErrors', label: 'Total errors', type: 'currency', sampleValue: 0 },
      { key: 'extrapolatedError', label: 'Extrapolated error', type: 'currency', sampleValue: 0 },
      { key: 'auditorNotes', label: 'Auditor notes', type: 'scalar', sampleValue: 'No exceptions.' },
    ]},
  { group: 'Audit Plan', key: 'auditPlan.significantRisks', label: 'Significant risks (array)', type: 'array',
    sampleValue: [ { fsLine: 'Revenue', name: 'Revenue recognition (ISA 240 rebuttable presumption)' } ],
    itemFields: [
      { key: 'fsLine', label: 'FS line', type: 'scalar', sampleValue: 'Revenue' },
      { key: 'name', label: 'Risk name', type: 'scalar', sampleValue: 'Revenue recognition (ISA 240 rebuttable presumption)' },
    ]},
  { group: 'Audit Plan', key: 'auditPlan.areasOfFocus', label: 'Areas of focus (array)', type: 'array',
    sampleValue: [ { fsLine: 'Trade Debtors', reason: 'Material balance; prior-year debates over doubtful provision.' } ],
    itemFields: [
      { key: 'fsLine', label: 'FS line', type: 'scalar', sampleValue: 'Trade Debtors' },
      { key: 'reason', label: 'Reason', type: 'scalar', sampleValue: 'Material balance.' },
    ]},

  // ─── Questionnaires ──────────────────────────────────────────────────────
  // Each questionnaire's answers are exposed in three complementary
  // shapes so admins can pick whichever is most readable:
  //   1. `questionnaires.<type>.<key>` — by the human-readable `key`
  //      from the firm's questionnaire schema (e.g. `engagement_letter_date`).
  //      Works for any answered question; this is the recommended form.
  //   2. `questionnaires.<type>.bySection.<section>.<key>` — same
  //      answers grouped by the section the question belongs to
  //      (section names are slugified to lowercase_with_underscores).
  //   3. `questionnaires.<type>.<uuid>` — the original raw UUID key,
  //      preserved for back-compat. Rarely used — keys are clearer.
  { group: 'Questionnaires', key: 'questionnaires.permanentFile', label: 'Permanent file answers (object)', type: 'object',
    description: 'Drill in by question key, e.g. {{questionnaires.permanentFile.entity_activities}}.',
    sampleValue: { entity_activities: 'Professional services (accountancy and advisory).', key_customers: 'Mixed SME portfolio in the North West.' } },
  { group: 'Questionnaires', key: 'questionnaires.ethics', label: 'Ethics answers (object)', type: 'object',
    description: 'Drill in by question key, e.g. {{questionnaires.ethics.independence_confirmed}}.',
    sampleValue: { independence_confirmed: true, fee_dependency: false, non_audit_services: 'None provided in the year.' } },
  { group: 'Questionnaires', key: 'questionnaires.continuance', label: 'Continuance answers (object)', type: 'object',
    description: 'Drill in by question key, e.g. {{questionnaires.continuance.engagement_letter_date}}.',
    sampleValue: { engagement_letter_date: '2025-01-01', entity_type: 'Limited Company', py_mgmt_letter: 'First Year of Audit' } },
  { group: 'Questionnaires', key: 'questionnaires.continuance.engagement_letter_date', label: 'Engagement letter date (Continuance Q)', type: 'date',
    description: 'Date captured in the Continuance questionnaire. Wrap in {{formatDate … "dd MMMM yyyy"}} for a formatted string.',
    sampleValue: '2025-01-01' },
  { group: 'Questionnaires', key: 'questionnaires.materiality', label: 'Materiality questionnaire answers (object)', type: 'object',
    description: 'Drill in by question key.',
    sampleValue: { benchmark_rationale: 'PBT is the most appropriate given continuing profitable trading.' } },

  // ─── TB ──────────────────────────────────────────────────────────────────
  { group: 'Trial Balance', key: 'tb.revenue', label: 'Revenue (CY)', type: 'currency', sampleValue: 2500000 },
  { group: 'Trial Balance', key: 'tb.costOfSales', label: 'Cost of sales (CY)', type: 'currency', sampleValue: 1625000 },
  { group: 'Trial Balance', key: 'tb.grossProfit', label: 'Gross profit (CY)', type: 'currency', sampleValue: 875000 },
  { group: 'Trial Balance', key: 'tb.grossMarginPct', label: 'Gross margin %', type: 'scalar', sampleValue: 35 },
  { group: 'Trial Balance', key: 'tb.profitBeforeTax', label: 'Profit before tax (CY)', type: 'currency', sampleValue: 425000 },
  { group: 'Trial Balance', key: 'tb.totalAssets', label: 'Total assets (CY)', type: 'currency', sampleValue: 3200000 },
  { group: 'Trial Balance', key: 'tb.totalEquity', label: 'Total equity (CY)', type: 'currency', sampleValue: 1800000 },
  { group: 'Trial Balance', key: 'tb.rows', label: 'All TB rows (array)', type: 'array',
    description: 'Each row: fsStatement, fsLevel, fsLine, accountCode, description, currentYear, priorYear.',
    sampleValue: [
      { fsStatement: 'Profit & Loss', fsLevel: 'Revenue', fsLine: 'Sales', accountCode: '4000', description: 'Trade sales', currentYear: 2500000, priorYear: 2200000 },
    ], itemFields: [
      { key: 'fsStatement', label: 'FS statement', type: 'scalar', sampleValue: 'Profit & Loss' },
      { key: 'fsLevel', label: 'FS level', type: 'scalar', sampleValue: 'Revenue' },
      { key: 'fsLine', label: 'FS line', type: 'scalar', sampleValue: 'Sales' },
      { key: 'accountCode', label: 'Account code', type: 'scalar', sampleValue: '4000' },
      { key: 'description', label: 'Description', type: 'scalar', sampleValue: 'Trade sales' },
      { key: 'currentYear', label: 'Current year', type: 'currency', sampleValue: 2500000 },
      { key: 'priorYear', label: 'Prior year', type: 'currency', sampleValue: 2200000 },
    ]},
];

/** Build a canned sample context (exactly what Preview runs against
 *  when no real engagement is selected). The admin sees a realistic
 *  rendering without touching live data. */
export function buildSampleContext(): Record<string, any> {
  const ctx: Record<string, any> = {};
  for (const f of MERGE_FIELDS) {
    setPath(ctx, f.key, f.sampleValue);
  }
  return ctx;
}

function setPath(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Return true when the dotted path resolves to a defined value in
 *  the given context — used by the preview endpoint to report
 *  missing placeholders. Treats `0`, `''`, `false` as defined. */
export function contextHasPath(ctx: any, path: string): boolean {
  const parts = path.split('.');
  let cur: any = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(p in cur)) return false;
    cur = cur[p];
  }
  return cur !== undefined;
}

/** Groups → fields for the editor's pill palette. */
export function mergeFieldsByGroup(): Record<string, MergeField[]> {
  const out: Record<string, MergeField[]> = {};
  for (const f of MERGE_FIELDS) {
    if (!out[f.group]) out[f.group] = [];
    out[f.group].push(f);
  }
  return out;
}
