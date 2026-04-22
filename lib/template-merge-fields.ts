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
  { group: 'Materiality', key: 'materiality.overall', label: 'Overall materiality (current period)', type: 'currency', sampleValue: 125000 },
  { group: 'Materiality', key: 'materiality.performance', label: 'Performance materiality (current period)', type: 'currency', sampleValue: 87500 },
  { group: 'Materiality', key: 'materiality.clearlyTrivial', label: 'Clearly trivial (current period)', type: 'currency', sampleValue: 6250 },
  { group: 'Materiality', key: 'materiality.benchmark', label: 'Benchmark (current period)', type: 'scalar', sampleValue: 'Profit before tax' },
  { group: 'Materiality', key: 'materiality.benchmarkAmount', label: 'Benchmark amount (current period)', type: 'currency', sampleValue: 2500000 },
  { group: 'Materiality', key: 'materiality.benchmarkPct', label: 'Benchmark % (current period)', type: 'scalar', sampleValue: 5 },
  // Narrative / qualitative fields captured on the Materiality tab's
  // Justification section. Current period.
  { group: 'Materiality', key: 'materiality.keyJudgements', label: 'Key judgements in setting materiality (current period)', type: 'scalar',
    description: 'Text captured in the Materiality tab under Justification → Key judgements.',
    sampleValue: 'PBT is the most appropriate benchmark given continuing profitable trading and the stakeholder focus on post-tax profit.' },
  { group: 'Materiality', key: 'materiality.stakeholders', label: 'Stakeholders identified (current period)', type: 'scalar', sampleValue: 'Shareholders, HMRC, senior lender.' },
  { group: 'Materiality', key: 'materiality.stakeholderFocus', label: 'How audit team assessed stakeholder focus (current period)', type: 'scalar', sampleValue: 'Shareholders focus on dividend capacity; lender focus on covenant compliance.' },
  { group: 'Materiality', key: 'materiality.basisChanged', label: 'Change in basis from prior period (Yes/No, current period)', type: 'scalar', sampleValue: false },
  { group: 'Materiality', key: 'materiality.basisChangeReason', label: 'Reason for change in basis (current period)', type: 'scalar', sampleValue: '' },
  // Prior-period equivalents — resolved from the prior engagement's
  // materiality record, with the current engagement's priorOverrides
  // taking precedence. Null when there is no prior engagement yet.
  { group: 'Materiality', key: 'materiality.prior.overall', label: 'Overall materiality (prior period)', type: 'currency', sampleValue: 110000,
    description: 'Prior-period overall materiality — auto from the prior engagement, overridable on the Materiality tab.' },
  { group: 'Materiality', key: 'materiality.prior.performance', label: 'Performance materiality (prior period)', type: 'currency', sampleValue: 77000 },
  { group: 'Materiality', key: 'materiality.prior.clearlyTrivial', label: 'Clearly trivial (prior period)', type: 'currency', sampleValue: 5500 },
  { group: 'Materiality', key: 'materiality.prior.benchmark', label: 'Benchmark (prior period)', type: 'scalar', sampleValue: 'Profit before tax' },
  { group: 'Materiality', key: 'materiality.prior.benchmarkPct', label: 'Benchmark % (prior period)', type: 'scalar', sampleValue: 5 },
  { group: 'Materiality', key: 'materiality.prior.basisChanged', label: 'Change in basis from prior period (Yes/No)', type: 'scalar', sampleValue: false },
  { group: 'Materiality', key: 'materiality.prior.basisChangeReason', label: 'Reason for change in basis (prior period)', type: 'scalar', sampleValue: '' },
  { group: 'Materiality', key: 'materiality.prior.stakeholders', label: 'Stakeholders identified (prior period)', type: 'scalar', sampleValue: '' },
  { group: 'Materiality', key: 'materiality.prior.stakeholderFocus', label: 'Stakeholder focus (prior period)', type: 'scalar', sampleValue: '' },
  { group: 'Materiality', key: 'materiality.prior.keyJudgements', label: 'Key judgements in setting materiality (prior period)', type: 'scalar', sampleValue: '' },

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
  // Shared itemFields for the three risk views — defined once and
  // reused so adding a field updates every view. Each view exposes
  // the full RMM row so simple templates can pick one column (Risk
  // name) and detailed templates can pick many (risk + likelihood +
  // magnitude + assertions + final risk assessment + ...).
  { group: 'Audit Plan', key: 'auditPlan.risks', label: 'All risks (significant + areas of focus, array)', type: 'array',
    description: 'Every RMM row flagged as a Significant Risk OR an Area of Focus. Use with a dynamic table and optionally filter on rowCategory to show either / both.',
    sampleValue: [
      { id: 'r1', name: 'Revenue recognition', fsLine: 'Revenue', description: 'Revenue recognition risk (ISA 240 rebuttable presumption).', assertions: 'EO, CO', relevance: 'Y', inherentRiskLevel: 'High', likelihood: 'Likely', magnitude: 'High', finalRiskAssessment: 'High', controlRisk: 'Not Tested', overallRisk: 'High', rowCategory: 'significant_risk', amount: 2500000, sortOrder: 1 },
      { id: 'r2', name: 'Trade debtors recoverability', fsLine: 'Trade Debtors', description: 'Doubtful recoverability of the aged debtors.', assertions: 'V, E', relevance: 'Y', inherentRiskLevel: 'Medium', likelihood: 'Neutral', magnitude: 'Medium', finalRiskAssessment: 'Medium', controlRisk: 'Partially Effective', overallRisk: 'Medium', rowCategory: 'area_of_focus', amount: 420000, sortOrder: 2 },
    ],
    itemFields: [
      { key: 'name',                label: 'Risk name',           type: 'scalar',   sampleValue: 'Revenue recognition' },
      { key: 'fsLine',              label: 'FS line',             type: 'scalar',   sampleValue: 'Revenue' },
      { key: 'description',         label: 'Full description',    type: 'scalar',   sampleValue: 'Revenue recognition risk.' },
      { key: 'assertions',          label: 'Assertions',          type: 'scalar',   sampleValue: 'EO, CO' },
      { key: 'relevance',           label: 'Relevance',           type: 'scalar',   sampleValue: 'Y' },
      { key: 'inherentRiskLevel',   label: 'Inherent risk',       type: 'scalar',   sampleValue: 'High' },
      { key: 'likelihood',          label: 'Likelihood',          type: 'scalar',   sampleValue: 'Likely' },
      { key: 'magnitude',           label: 'Magnitude',           type: 'scalar',   sampleValue: 'High' },
      { key: 'finalRiskAssessment', label: 'Final risk',          type: 'scalar',   sampleValue: 'High' },
      { key: 'controlRisk',         label: 'Control risk',        type: 'scalar',   sampleValue: 'Not Tested' },
      { key: 'overallRisk',         label: 'Overall risk',        type: 'scalar',   sampleValue: 'High' },
      { key: 'rowCategory',         label: 'Category (significant_risk | area_of_focus)', type: 'scalar', sampleValue: 'significant_risk' },
      { key: 'amount',              label: 'Amount',              type: 'currency', sampleValue: 2500000 },
      { key: 'aiSummary',           label: 'AI summary',          type: 'scalar',   sampleValue: 'AI-generated summary of the risk.' },
      { key: 'complexityText',      label: 'Complexity notes',    type: 'scalar',   sampleValue: 'Complex revenue arrangements…' },
      { key: 'subjectivityText',    label: 'Subjectivity notes',  type: 'scalar',   sampleValue: 'Management judgement involved…' },
      { key: 'changeText',          label: 'Change notes',        type: 'scalar',   sampleValue: 'New pricing model this year.' },
      { key: 'uncertaintyText',     label: 'Uncertainty notes',   type: 'scalar',   sampleValue: 'Estimation uncertainty around…' },
      { key: 'susceptibilityText',  label: 'Susceptibility notes',type: 'scalar',   sampleValue: 'Susceptible to management bias.' },
      { key: 'notes',               label: 'Auditor notes',       type: 'scalar',   sampleValue: 'Discussed with partner 14 Apr.' },
      { key: 'fsStatement',         label: 'FS statement',        type: 'scalar',   sampleValue: 'Profit & Loss' },
      { key: 'fsLevel',             label: 'FS level',            type: 'scalar',   sampleValue: 'Revenue' },
      { key: 'sortOrder',           label: 'Sort order',          type: 'scalar',   sampleValue: 1 },
    ]},
  { group: 'Audit Plan', key: 'auditPlan.significantRisks', label: 'Significant risks (array)', type: 'array',
    description: 'Subset of auditPlan.risks filtered to rowCategory=significant_risk. Same fields as All risks — pick any combination in the dynamic table.',
    sampleValue: [
      { id: 'r1', name: 'Revenue recognition', fsLine: 'Revenue', description: 'Revenue recognition risk (ISA 240 rebuttable presumption).', assertions: 'EO, CO', inherentRiskLevel: 'High', finalRiskAssessment: 'High', overallRisk: 'High', rowCategory: 'significant_risk', amount: 2500000, sortOrder: 1 },
    ],
    itemFields: [
      { key: 'name',                label: 'Risk name',           type: 'scalar',   sampleValue: 'Revenue recognition' },
      { key: 'fsLine',              label: 'FS line',             type: 'scalar',   sampleValue: 'Revenue' },
      { key: 'description',         label: 'Full description',    type: 'scalar',   sampleValue: 'Revenue recognition risk.' },
      { key: 'assertions',          label: 'Assertions',          type: 'scalar',   sampleValue: 'EO, CO' },
      { key: 'relevance',           label: 'Relevance',           type: 'scalar',   sampleValue: 'Y' },
      { key: 'inherentRiskLevel',   label: 'Inherent risk',       type: 'scalar',   sampleValue: 'High' },
      { key: 'likelihood',          label: 'Likelihood',          type: 'scalar',   sampleValue: 'Likely' },
      { key: 'magnitude',           label: 'Magnitude',           type: 'scalar',   sampleValue: 'High' },
      { key: 'finalRiskAssessment', label: 'Final risk',          type: 'scalar',   sampleValue: 'High' },
      { key: 'controlRisk',         label: 'Control risk',        type: 'scalar',   sampleValue: 'Not Tested' },
      { key: 'overallRisk',         label: 'Overall risk',        type: 'scalar',   sampleValue: 'High' },
      { key: 'amount',              label: 'Amount',              type: 'currency', sampleValue: 2500000 },
      { key: 'aiSummary',           label: 'AI summary',          type: 'scalar',   sampleValue: 'AI-generated summary.' },
      { key: 'complexityText',      label: 'Complexity notes',    type: 'scalar',   sampleValue: '' },
      { key: 'subjectivityText',    label: 'Subjectivity notes',  type: 'scalar',   sampleValue: '' },
      { key: 'changeText',          label: 'Change notes',        type: 'scalar',   sampleValue: '' },
      { key: 'uncertaintyText',     label: 'Uncertainty notes',   type: 'scalar',   sampleValue: '' },
      { key: 'susceptibilityText',  label: 'Susceptibility notes',type: 'scalar',   sampleValue: '' },
      { key: 'notes',               label: 'Auditor notes',       type: 'scalar',   sampleValue: '' },
      { key: 'fsStatement',         label: 'FS statement',        type: 'scalar',   sampleValue: 'Profit & Loss' },
      { key: 'fsLevel',             label: 'FS level',            type: 'scalar',   sampleValue: 'Revenue' },
      { key: 'sortOrder',           label: 'Sort order',          type: 'scalar',   sampleValue: 1 },
    ]},
  { group: 'Audit Plan', key: 'auditTimetable', label: 'Audit Timetable (array)', type: 'array',
    description: 'Agreed dates from the Opening Tab — Planning, Fieldwork, Completion, etc. Use with {{#each auditTimetable}} or insert a dynamic table.',
    sampleValue: [
      { milestone: 'Planning',   targetDate: '2026-04-15', revisedTarget: null, progress: 'Complete',    sortOrder: 1 },
      { milestone: 'Fieldwork',  targetDate: '2026-05-20', revisedTarget: null, progress: 'In Progress', sortOrder: 2 },
      { milestone: 'Completion', targetDate: '2026-06-30', revisedTarget: null, progress: 'Not Started', sortOrder: 3 },
    ], itemFields: [
      { key: 'milestone',     label: 'Milestone',       type: 'scalar', sampleValue: 'Planning' },
      { key: 'targetDate',    label: 'Target date',     type: 'date',   sampleValue: '2026-04-15' },
      { key: 'revisedTarget', label: 'Revised target',  type: 'date',   sampleValue: null },
      { key: 'progress',      label: 'Progress status', type: 'scalar', sampleValue: 'Complete' },
      { key: 'sortOrder',     label: 'Sort order',      type: 'scalar', sampleValue: 1 },
    ]},
  { group: 'Audit Plan', key: 'auditPlan.areasOfFocus', label: 'Areas of focus (array)', type: 'array',
    description: 'Subset of auditPlan.risks filtered to rowCategory=area_of_focus. Same full field spread as Significant Risks.',
    sampleValue: [
      { id: 'r2', name: 'Trade debtors recoverability', fsLine: 'Trade Debtors', description: 'Material balance; prior-year debates over doubtful provision.', assertions: 'V, E', inherentRiskLevel: 'Medium', finalRiskAssessment: 'Medium', overallRisk: 'Medium', rowCategory: 'area_of_focus', amount: 420000, sortOrder: 2 },
    ],
    itemFields: [
      { key: 'name',                label: 'Name',                type: 'scalar',   sampleValue: 'Trade debtors recoverability' },
      { key: 'fsLine',              label: 'FS line',             type: 'scalar',   sampleValue: 'Trade Debtors' },
      { key: 'description',         label: 'Description / reason',type: 'scalar',   sampleValue: 'Material balance.' },
      { key: 'assertions',          label: 'Assertions',          type: 'scalar',   sampleValue: 'V, E' },
      { key: 'relevance',           label: 'Relevance',           type: 'scalar',   sampleValue: 'Y' },
      { key: 'inherentRiskLevel',   label: 'Inherent risk',       type: 'scalar',   sampleValue: 'Medium' },
      { key: 'likelihood',          label: 'Likelihood',          type: 'scalar',   sampleValue: 'Neutral' },
      { key: 'magnitude',           label: 'Magnitude',           type: 'scalar',   sampleValue: 'Medium' },
      { key: 'finalRiskAssessment', label: 'Final risk',          type: 'scalar',   sampleValue: 'Medium' },
      { key: 'controlRisk',         label: 'Control risk',        type: 'scalar',   sampleValue: 'Partially Effective' },
      { key: 'overallRisk',         label: 'Overall risk',        type: 'scalar',   sampleValue: 'Medium' },
      { key: 'amount',              label: 'Amount',              type: 'currency', sampleValue: 420000 },
      { key: 'aiSummary',           label: 'AI summary',          type: 'scalar',   sampleValue: '' },
      { key: 'complexityText',      label: 'Complexity notes',    type: 'scalar',   sampleValue: '' },
      { key: 'subjectivityText',    label: 'Subjectivity notes',  type: 'scalar',   sampleValue: '' },
      { key: 'changeText',          label: 'Change notes',        type: 'scalar',   sampleValue: '' },
      { key: 'uncertaintyText',     label: 'Uncertainty notes',   type: 'scalar',   sampleValue: '' },
      { key: 'susceptibilityText',  label: 'Susceptibility notes',type: 'scalar',   sampleValue: '' },
      { key: 'notes',               label: 'Auditor notes',       type: 'scalar',   sampleValue: '' },
      { key: 'fsStatement',         label: 'FS statement',        type: 'scalar',   sampleValue: 'Balance Sheet' },
      { key: 'fsLevel',             label: 'FS level',            type: 'scalar',   sampleValue: 'Current Assets' },
      { key: 'sortOrder',           label: 'Sort order',          type: 'scalar',   sampleValue: 2 },
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

  // ─── Questionnaires as arrays (for dynamic tables) ──────────────────────
  // Each questionnaire also exposes an `asList` array keyed to the
  // firm's questionnaire schema. Use with {{#each}} to render the
  // whole Q&A as a table whose row count matches the number of
  // answered questions.
  { group: 'Questionnaires', key: 'questionnaires.permanentFile.asList', label: 'Permanent File Q&A (array)', type: 'array',
    description: 'Use with {{#each}} to render every answered permanent-file question.',
    sampleValue: [
      { question: 'What are the entity\u2019s principal activities?', key: 'entity_activities', answer: 'Professional services.', section: 'Understanding the Entity', sortOrder: 1 },
    ], itemFields: [
      { key: 'question', label: 'Question text', type: 'scalar', sampleValue: 'What are the entity\u2019s principal activities?' },
      { key: 'answer', label: 'Answer', type: 'scalar', sampleValue: 'Professional services.' },
      { key: 'section', label: 'Section', type: 'scalar', sampleValue: 'Understanding the Entity' },
      { key: 'key', label: 'Question key', type: 'scalar', sampleValue: 'entity_activities' },
      { key: 'previousQuestion', label: 'Previous question text', type: 'scalar', sampleValue: 'Has the risk been identified?' },
      { key: 'previousAnswer', label: 'Previous question\u2019s answer', type: 'scalar', sampleValue: 'Y' },
      { key: 'previousKey', label: 'Previous question\u2019s key', type: 'scalar', sampleValue: 'risks_identified' },
      { key: 'nextQuestion', label: 'Next question text', type: 'scalar', sampleValue: 'Please explain the activities further.' },
      { key: 'nextAnswer', label: 'Next question\u2019s answer', type: 'scalar', sampleValue: 'Services largely to SMEs.' },
      { key: 'nextKey', label: 'Next question\u2019s key', type: 'scalar', sampleValue: 'entity_activities_detail' },
      { key: 'isEmpty', label: 'Answer is blank (boolean)', type: 'scalar', sampleValue: false },
    ]},
  { group: 'Questionnaires', key: 'questionnaires.ethics.asList', label: 'Ethics Q&A (array)', type: 'array',
    description: 'Use with {{#each}} to render every answered ethics question.',
    // The sample intentionally includes a "Non Audit Services" triplet
    // (service name, Y/N flag, threats text) so the preview actually
    // renders data when the admin uses the common
    //   {{#each (filterWhere (filterBySection … "Non Audit Services") "answer" "eq" "Y")}}
    // pattern. Without this, the filter returned [] on sample context
    // and the preview was blank even though the template was correct.
    // Other sections get a single item each so examples across groups
    // also render a row.
    sampleValue: [
      { question: 'Is independence confirmed?', key: 'independence_confirmed', answer: 'Yes', section: 'Independence', sortOrder: 1, previousAnswer: null, nextAnswer: 'Preparation of accounts', itemIndex: 0, isEmpty: false },
      { question: 'Preparation of accounts', key: 'nas_prep_accounts_name', answer: 'Preparation of accounts', section: 'Non Audit Services', sortOrder: 10, previousAnswer: 'Yes', nextAnswer: 'Y', itemIndex: 1, isEmpty: false },
      { question: 'Service provided? (Y/N)', key: 'nas_prep_accounts_flag', answer: 'Y', section: 'Non Audit Services', sortOrder: 11, previousAnswer: 'Preparation of accounts', nextAnswer: 'Self-review threat mitigated by an independent technical review before the audit file is issued.', itemIndex: 2, isEmpty: false },
      { question: 'Threats & safeguards', key: 'nas_prep_accounts_threats', answer: 'Self-review threat mitigated by an independent technical review before the audit file is issued.', section: 'Non Audit Services', sortOrder: 12, previousAnswer: 'Y', nextAnswer: 'Payroll', itemIndex: 3, isEmpty: false },
      { question: 'Payroll', key: 'nas_payroll_name', answer: 'Payroll', section: 'Non Audit Services', sortOrder: 13, previousAnswer: 'Self-review threat mitigated by an independent technical review before the audit file is issued.', nextAnswer: 'Y', itemIndex: 4, isEmpty: false },
      { question: 'Service provided? (Y/N)', key: 'nas_payroll_flag', answer: 'Y', section: 'Non Audit Services', sortOrder: 14, previousAnswer: 'Payroll', nextAnswer: 'Management threat mitigated by the client signing off all statutory submissions.', itemIndex: 5, isEmpty: false },
      { question: 'Threats & safeguards', key: 'nas_payroll_threats', answer: 'Management threat mitigated by the client signing off all statutory submissions.', section: 'Non Audit Services', sortOrder: 15, previousAnswer: 'Y', nextAnswer: null, itemIndex: 6, isEmpty: false },
    ], itemFields: [
      { key: 'question', label: 'Question text', type: 'scalar', sampleValue: 'Is independence confirmed?' },
      { key: 'answer', label: 'Answer', type: 'scalar', sampleValue: 'Yes' },
      { key: 'section', label: 'Section', type: 'scalar', sampleValue: 'Independence' },
      { key: 'key', label: 'Question key', type: 'scalar', sampleValue: 'independence_confirmed' },
      { key: 'previousQuestion', label: 'Previous question text', type: 'scalar', sampleValue: 'Were any threats identified?' },
      { key: 'previousAnswer', label: 'Previous question\u2019s answer', type: 'scalar', sampleValue: 'N' },
      { key: 'previousKey', label: 'Previous question\u2019s key', type: 'scalar', sampleValue: 'threat_identified' },
      { key: 'nextQuestion', label: 'Next question text', type: 'scalar', sampleValue: 'Please explain any safeguards in place.' },
      { key: 'nextAnswer', label: 'Next question\u2019s answer', type: 'scalar', sampleValue: 'Review by second partner.' },
      { key: 'nextKey', label: 'Next question\u2019s key', type: 'scalar', sampleValue: 'safeguards' },
      { key: 'itemIndex', label: 'Row index (0-based)', type: 'scalar', sampleValue: 2 },
      { key: 'isEmpty', label: 'Answer is blank (boolean)', type: 'scalar', sampleValue: false },
    ]},
  { group: 'Questionnaires', key: 'questionnaires.continuance.asList', label: 'Continuance Q&A (array)', type: 'array',
    description: 'Use with {{#each}} to render every answered continuance question.',
    sampleValue: [
      { question: 'What is the date of the engagement letter?', key: 'engagement_letter_date', answer: '2025-01-01', section: 'Continuity', sortOrder: 8 },
      { question: 'What type of entity is this?', key: 'entity_type', answer: 'Limited Company', section: 'Entity Details', sortOrder: 1 },
    ], itemFields: [
      { key: 'question', label: 'Question text', type: 'scalar', sampleValue: 'What type of entity is this?' },
      { key: 'answer', label: 'Answer', type: 'scalar', sampleValue: 'Limited Company' },
      { key: 'section', label: 'Section', type: 'scalar', sampleValue: 'Entity Details' },
      { key: 'key', label: 'Question key', type: 'scalar', sampleValue: 'entity_type' },
      { key: 'previousQuestion', label: 'Previous question text', type: 'scalar', sampleValue: 'Has AML been updated?' },
      { key: 'previousAnswer', label: 'Previous question\u2019s answer', type: 'scalar', sampleValue: 'Y' },
      { key: 'previousKey', label: 'Previous question\u2019s key', type: 'scalar', sampleValue: 'aml_updated' },
      { key: 'nextQuestion', label: 'Next question text', type: 'scalar', sampleValue: 'When was the engagement letter signed?' },
      { key: 'nextAnswer', label: 'Next question\u2019s answer', type: 'scalar', sampleValue: '2025-01-01' },
      { key: 'nextKey', label: 'Next question\u2019s key', type: 'scalar', sampleValue: 'engagement_letter_date' },
      { key: 'itemIndex', label: 'Row index (0-based)', type: 'scalar', sampleValue: 3 },
      { key: 'isEmpty', label: 'Answer is blank (boolean)', type: 'scalar', sampleValue: false },
    ]},
  { group: 'Questionnaires', key: 'questionnaires.materiality.asList', label: 'Materiality questionnaire Q&A (array)', type: 'array',
    description: 'Use with {{#each}} to render every answered materiality question.',
    sampleValue: [
      { question: 'What benchmark is most appropriate and why?', key: 'benchmark_rationale', answer: 'PBT — continuing profitable trading.', section: 'Benchmark', sortOrder: 1 },
    ], itemFields: [
      { key: 'question', label: 'Question text', type: 'scalar', sampleValue: 'What benchmark is most appropriate and why?' },
      { key: 'answer', label: 'Answer', type: 'scalar', sampleValue: 'PBT \u2014 continuing profitable trading.' },
      { key: 'section', label: 'Section', type: 'scalar', sampleValue: 'Benchmark' },
      { key: 'key', label: 'Question key', type: 'scalar', sampleValue: 'benchmark_rationale' },
      { key: 'previousQuestion', label: 'Previous question text', type: 'scalar', sampleValue: 'Which benchmark?' },
      { key: 'previousAnswer', label: 'Previous question\u2019s answer', type: 'scalar', sampleValue: 'Profit Before Tax' },
      { key: 'previousKey', label: 'Previous question\u2019s key', type: 'scalar', sampleValue: 'benchmark' },
      { key: 'nextQuestion', label: 'Next question text', type: 'scalar', sampleValue: 'What percentage?' },
      { key: 'nextAnswer', label: 'Next question\u2019s answer', type: 'scalar', sampleValue: '5%' },
      { key: 'nextKey', label: 'Next question\u2019s key', type: 'scalar', sampleValue: 'benchmark_pct' },
      { key: 'itemIndex', label: 'Row index (0-based)', type: 'scalar', sampleValue: 1 },
      { key: 'isEmpty', label: 'Answer is blank (boolean)', type: 'scalar', sampleValue: false },
    ]},

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
