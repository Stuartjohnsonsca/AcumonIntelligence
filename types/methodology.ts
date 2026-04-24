// ─── Methodology Feature Types ──────────────────────────────────────────────

export type AuditType = 'SME' | 'PIE' | 'SME_CONTROLS' | 'PIE_CONTROLS' | 'GROUP';
export type EngagementStatus = 'pre_start' | 'active' | 'review' | 'complete' | 'archived';
export type TeamRole = 'Junior' | 'Manager' | 'RI' | 'Partner' | 'EQR';
export type SpecialistType = 'Specialist' | 'Expert' | 'EthicsPartner' | 'TechnicalAdvisor' | 'Ethics' | 'Technical';
export type InfoRequestType = 'preliminary' | 'standard';
export type ProgressStatus = 'Not Started' | 'In Progress' | 'Complete' | 'Overdue';
export type ToolAvailability = 'unavailable' | 'discretion' | 'available';

// ─── Risk Table Types ───────────────────────────────────────────────────────

export type RiskLevel = 'Remote' | 'Low' | 'Medium' | 'High' | 'Very High';
export type Likelihood = 'Remote' | 'Unlikely' | 'Neutral' | 'Likely' | 'Very Likely';
export type Magnitude = 'Remote' | 'Low' | 'Medium' | 'High' | 'Very High';
export type ControlRiskLevel = 'Not Tested' | 'Effective' | 'Not Effective' | 'Partially Effective';

export interface InherentRiskTable {
  // Rows: Likelihood, Columns: Magnitude → RiskLevel
  matrix: Record<Likelihood, Record<Magnitude, RiskLevel>>;
}

export interface ControlRiskTable {
  // Rows: InherentRisk, Columns: ControlRisk → RiskLevel
  matrix: Record<RiskLevel, Record<ControlRiskLevel, RiskLevel>>;
}

export interface AssertionsTable {
  // Rows: BS | PNL, Columns: assertion names → boolean (X or empty)
  rows: {
    key: string;
    label: string;
    completeness: boolean;
    occurrenceAccuracy: boolean;
    cutOff: boolean;
    classification: boolean;
    presentation: boolean;
    existence: boolean;
    valuation: boolean;
    rightsObligations: boolean;
    nr: boolean;
  }[];
}

// ─── Assertion Types ────────────────────────────────────────────────────────

export const ASSERTION_TYPES = [
  'Completeness',
  'Occurrence & Accuracy',
  'Cut Off',
  'Classification',
  'Presentation',
  'Existence',
  'Valuation',
  'Rights & Obligations',
] as const;

export type AssertionType = typeof ASSERTION_TYPES[number];

// Short display labels for assertions (used in grids, pills, RMM display)
export const ASSERTION_SHORT_LABELS: Record<string, string> = {
  'Completeness': 'Com',
  'Occurrence & Accuracy': 'O&A',
  'Cut Off': 'Cut',
  'Classification': 'Cla',
  'Presentation': 'Pre',
  'Existence': 'Exi',
  'Valuation': 'Val',
  'Rights & Obligations': 'R&O',
  // Handle common DB abbreviations → canonical short form
  'Rig': 'R&O',
  'Com': 'Com',
  'Comp': 'Com',
  'Occ': 'O&A',
  'O&A': 'O&A',
  'Acc': 'O&A',
  'Cut': 'Cut',
  'Cla': 'Cla',
  'Pre': 'Pre',
  'Exi': 'Exi',
  'Val': 'Val',
  'R&O': 'R&O',
};

/** Normalise any assertion string to its short display label */
export function assertionShortLabel(raw: string): string {
  return ASSERTION_SHORT_LABELS[raw] || ASSERTION_SHORT_LABELS[raw.trim()] || (raw.length > 5 ? raw.split(' ').map(w => w[0]).join('') : raw);
}

// ─── Assertion → Verification Check Mapping ─────────────────────────────────
// Each assertion maps to verification checks with priority weighting.
// The Audit Verification panel uses this to determine which columns to show
// and how to order them. "Consistency" always shows as a baseline check.

export interface VerificationCheck {
  key: string;           // Unique key for the check
  label: string;         // Column header display
  shortLabel: string;    // Abbreviated label for tight columns
  description: string;   // What the AI should verify
  priority: number;      // Lower = higher priority (shown first)
}

// Standard 4 verification columns — always shown regardless of assertions
export const STANDARD_VERIFICATION_COLUMNS: VerificationCheck[] = [
  {
    key: 'match',
    label: 'Match',
    shortLabel: 'Match',
    description: 'Does the evidence match the item? Checks amount agreement, description consistency, and whether the account code is appropriate for this type of transaction.',
    priority: 1,
  },
  {
    key: 'period',
    label: 'Period',
    shortLabel: 'Period',
    description: 'Does the item indicate any risk to the correct allocation period? Checks transaction date, and whether the description suggests costs spanning multiple periods (insurance, rent, subscriptions, retainers, service contracts).',
    priority: 2,
  },
  {
    key: 'disclosure',
    label: 'Disclosure',
    shortLabel: 'Disclosure',
    description: 'Does the evidence indicate any specific additional financial statement disclosure requirement? E.g. related party, contingent liability, subsequent event.',
    priority: 3,
  },
  {
    key: 'audit',
    label: 'Other Concerns',
    shortLabel: 'Other',
    description: 'Does the evidence indicate any other concerns? E.g. unusual terms, complex arrangements, fraud indicators, voided transactions, credit notes, cash payments.',
    priority: 4,
  },
];

// Legacy mapping — still used by getVerificationChecks for backward compatibility
export const VERIFICATION_CHECKS: Record<string, VerificationCheck[]> = {};

export const CONSISTENCY_CHECK: VerificationCheck = STANDARD_VERIFICATION_COLUMNS[0];

/**
 * Get ordered verification checks for a set of assertions.
 * Deduplicates by key, orders by priority, always includes consistency.
 */
export function getVerificationChecks(_assertions: string[]): VerificationCheck[] {
  // Always return the standard 4 columns — Match, Period, Disclosure, Audit
  return [...STANDARD_VERIFICATION_COLUMNS];
}

// Legacy function kept for reference — no longer used
function _legacyGetVerificationChecks(assertions: string[]): VerificationCheck[] {
  const checkMap = new Map<string, VerificationCheck>();

  for (const rawAssertion of assertions) {
    const normalised = Object.entries(ASSERTION_SHORT_LABELS).find(([, short]) =>
      short === assertionShortLabel(rawAssertion)
    )?.[0] || rawAssertion;

    const checks = VERIFICATION_CHECKS[normalised] ||
      Object.entries(VERIFICATION_CHECKS).find(([key]) =>
        key.toLowerCase().includes(normalised.toLowerCase()) ||
        normalised.toLowerCase().includes(key.toLowerCase())
      )?.[1] || [];

    for (const check of checks) {
      if (!checkMap.has(check.key) || check.priority < (checkMap.get(check.key)?.priority || 99)) {
        checkMap.set(check.key, check);
      }
    }
  }

  // If no assertions provided, use a default set
  if (checkMap.size === 0) {
    checkMap.set('amount', { key: 'amount', label: 'Amount Match', shortLabel: 'Amt', description: 'Verify the amount on the evidence agrees to the ledger amount', priority: 1 });
    checkMap.set('date', { key: 'date', label: 'Date Match', shortLabel: 'Date', description: 'Verify the document date matches the recorded transaction date', priority: 2 });
    checkMap.set('period', { key: 'period', label: 'Period Check', shortLabel: 'Period', description: 'Verify the transaction falls within the correct accounting period', priority: 3 });
  }

  // Always add consistency
  checkMap.set(CONSISTENCY_CHECK.key, CONSISTENCY_CHECK);

  // Sort by priority
  return Array.from(checkMap.values()).sort((a, b) => a.priority - b.priority);
}

// ─── Test Bank Types ────────────────────────────────────────────────────────

export interface TestBankEntry {
  description: string;
  testTypeCode: string;
}

export const DEFAULT_TEST_TYPES = [
  { code: 'ar', name: 'Analytical Review' },
  { code: 'tod', name: 'Test of Details' },
  { code: 'jdg', name: 'Judgement' },
] as const;

export const MANDATORY_FS_LINES = [
  'Going Concern',
  'Management Override',
  'Notes and Disclosures',
] as const;

// ─── Engagement Types (for URL routing) ─────────────────────────────────────

export const AUDIT_TYPE_ROUTES: Record<string, AuditType> = {
  'StatAudit': 'SME',
  'pie-audit': 'PIE',
  'StatControlsAudit': 'SME_CONTROLS',
  'pie-controls-audit': 'PIE_CONTROLS',
  'group': 'GROUP',
};

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  SME: 'Statutory Audit',
  PIE: 'PIE Audit',
  SME_CONTROLS: 'Statutory Controls Based Audit',
  PIE_CONTROLS: 'PIE Controls Based Audit',
  GROUP: 'Group',
};

// ─── Default Methodology Templates ──────────────────────────────────────────

export const DEFAULT_AGREED_DATES = [
  'Planning',
  'Fieldwork',
  'Completion',
  'Sign off',
];

export const DEFAULT_INFO_REQUEST_STANDARD = [
  'Client Portal Invitation',
  'Engagement terms and fees estimate',
  'Notification of Team',
  'Trial balance to [Client Period End]',
  'Director and Key Management Changes',
  'Product/Service offering changes',
  'Developments in Systems and IT Environment',
  'Regulatory, industry developments and actual or possible litigation',
  'Financial position with a focus on cash position and cash generation',
];

export const DEFAULT_INFO_REQUEST_PRELIMINARY = [
  'Client Portal Invitation',
  'Engagement terms and fees estimate',
  'Notification of Team',
  'Trial balance to [Hard Close Date]',
  'Director and Key Management Changes',
  'Product/Service offering changes',
  'Developments in Systems and IT Environment',
  'Regulatory, industry developments and actual or possible litigation',
  'Financial position with a focus on cash position and cash generation',
];

// ─── Permanent File Section Keys ────────────────────────────────────────────

export const PERMANENT_FILE_SECTIONS = [
  { key: 'entity_details', label: 'Entity Details' },
  { key: 'understanding_entity', label: 'Understanding the Entity' },
  { key: 'financial_reporting', label: 'Financial Reporting Framework' },
  { key: 'laws_regulations', label: 'Laws and Regulations' },
  { key: 'related_parties', label: 'Related Parties' },
  { key: 'it_environment', label: 'IT Environment' },
  { key: 'accounting_estimates', label: 'Accounting Estimates' },
  { key: 'fraud_risk', label: 'Fraud Risk Analysis' },
  { key: 'auditor_expert', label: "Auditor's Expert" },
  { key: 'management_expert', label: 'Management Expert' },
  { key: 'service_organisation', label: 'Service Organisation' },
] as const;

// ─── Intelligence Categories ────────────────────────────────────────────────

export const INTELLIGENCE_CATEGORIES = [
  { key: 'background', label: 'Background to the Company' },
  { key: 'financial', label: 'Assessment of Financial Position' },
  { key: 'positive_adverse', label: 'Review of Positive and Adverse' },
  { key: 'competitors', label: 'Competitor Landscape' },
  { key: 'regulatory', label: 'Regulatory Issues' },
  { key: 'sector', label: 'Sector Developments' },
  { key: 'other', label: 'Any Other News' },
] as const;

// ─── Inherent Risk Sub-components ───────────────────────────────────────────

export const INHERENT_RISK_COMPONENTS = [
  { key: 'complexity', label: 'Complexity' },
  { key: 'subjectivity', label: 'Subjectivity' },
  { key: 'change', label: 'Change' },
  { key: 'uncertainty', label: 'Uncertainty' },
  { key: 'susceptibility', label: 'Susceptibility' },
] as const;

// ─── RMM Mandatory Rows ────────────────────────────────────────────────────

export const RMM_MANDATORY_ROWS = [
  { lineItem: 'Going Concern', sortOrder: 0 },
  { lineItem: 'Management Override of Controls', sortOrder: 1 },
  { lineItem: 'Disclosures and Related Areas', sortOrder: 2 },
] as const;

// ─── Materiality Benchmarks ─────────────────────────────────────────────────

export const MATERIALITY_BENCHMARKS = [
  'Profit before Tax',
  'Gross Profit',
  'Total Revenue',
  'Total Expenses',
  'Total Equity or Net Assets',
  'Total Assets',
] as const;

// ─── Template Question Types (for dynamic form rendering) ──────────────────

export type QuestionInputType = 'text' | 'textarea' | 'yesno' | 'yes_only' | 'dropdown' | 'number' | 'currency' | 'date' | 'formula' | 'checkbox' | 'yna' | 'table_row' | 'subheader';

export interface TemplateQuestion {
  id: string;
  sectionKey: string;
  questionText: string;
  inputType: QuestionInputType;
  dropdownOptions?: string[];
  formulaExpression?: string;
  crossRef?: string;
  isRequired?: boolean;
  sortOrder: number;
  validationMin?: number;
  validationMax?: number;
  validationDecimals?: number;
  /** Show this question only when another question on the same
   *  schedule satisfies the operator+value check. `operator` defaults
   *  to 'eq' when absent for back-compat with the original
   *  equality-only implementation.
   *
   *  For table-layout sections the dependency can target a specific
   *  CELL of the parent question via `columnIndex`:
   *    - undefined → parent's main value (standard layout / row-level
   *      answer)
   *    - 1, 2, 3 … → parent's `<questionId>_col<N>` cell value
   *  So a row can be hidden until e.g. column 2 of another row shows
   *  "Y". */
  conditionalOn?: {
    questionId: string;
    value: string;
    operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'notContains' | 'isEmpty' | 'isNotEmpty';
    columnIndex?: number;
  };
  mergedWith?: string;
  isBold?: boolean; // For conclusion/header rows in tables
  /** Per-column cell configuration for this ROW when the parent
   *  section uses a table layout (3/4/5-col). One entry per non-label
   *  column — columns[0] is the cell in column 1, columns[1] is the
   *  cell in column 2, etc. Each row configures its own cells
   *  independently (a currency row and a commentary row can sit in
   *  the same table with different widgets per column). When missing
   *  the cell falls back to the row's own `inputType`. */
  columns?: TemplateQuestionColumn[];
}

export interface TemplateQuestionColumn {
  inputType: QuestionInputType;
  dropdownOptions?: string[];
  validationMin?: number;
  validationMax?: number;
  placeholder?: string;
}

export type SectionLayout = 'standard' | 'table_4col' | 'table_3col' | 'table_5col';

export interface TemplateSectionMeta {
  key: string;
  label: string;
  layout: SectionLayout;
  /** Flat list of column heading strings, one per column (including
   *  the label column at index 0). Headers are shared by every row
   *  in the table; per-row cell widgets are configured on each
   *  question via TemplateQuestion.columns (see types above). */
  columnHeaders?: string[];
  signOff?: boolean; // Whether section has Preparer/Reviewer/RI sign-off
}

export const DEFAULT_COLUMN_HEADERS: Record<SectionLayout, string[]> = {
  standard: [],
  table_4col: ['Item', 'Procedures Performed', 'Conclusion', 'WP Reference'],
  table_3col: ['Particulars', 'Audit Team Response', 'WP Reference'],
  table_5col: ['Particulars', 'Planning Amount', 'Final Amount', 'Comment', 'WP Reference'],
};

/** Template data stored in MethodologyTemplate.items for completion schedules */
export interface CompletionTemplateData {
  questions: TemplateQuestion[];
  sectionMeta: Record<string, TemplateSectionMeta>;
}

// ─── Materiality Benchmark Ranges (from Appendix E) ────────────────────────

export const MATERIALITY_RANGES: Record<string, { low: number; high: number }> = {
  'Profit before Tax': { low: 0.05, high: 0.10 },
  'Gross Profit': { low: 0.01, high: 0.04 },
  'Total Revenue': { low: 0.005, high: 0.02 },
  'Total Expenses': { low: 0.005, high: 0.02 },
  'Total Equity or Net Assets': { low: 0.01, high: 0.05 },
  'Total Assets': { low: 0.005, high: 0.02 },
};
