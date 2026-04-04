// ─── Methodology Feature Types ──────────────────────────────────────────────

export type AuditType = 'SME' | 'PIE' | 'SME_CONTROLS' | 'PIE_CONTROLS' | 'GROUP';
export type EngagementStatus = 'pre_start' | 'active' | 'review' | 'complete' | 'archived';
export type TeamRole = 'Junior' | 'Manager' | 'RI';
export type SpecialistType = 'Specialist' | 'Expert' | 'EthicsPartner' | 'TechnicalAdvisor';
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

export const VERIFICATION_CHECKS: Record<string, VerificationCheck[]> = {
  'Completeness': [
    { key: 'population_coverage', label: 'Population Coverage', shortLabel: 'Pop', description: 'Verify all items in the population have supporting evidence and none are missing', priority: 1 },
    { key: 'amount', label: 'Amount Match', shortLabel: 'Amt', description: 'Verify the amount on the evidence agrees to the ledger amount', priority: 2 },
  ],
  'Occurrence & Accuracy': [
    { key: 'amount', label: 'Amount Match', shortLabel: 'Amt', description: 'Verify the amount on the evidence exactly matches the recorded transaction amount', priority: 1 },
    { key: 'existence_check', label: 'Transaction Occurred', shortLabel: 'Occ', description: 'Verify the transaction actually occurred — evidence of goods/services delivered', priority: 2 },
  ],
  'Cut Off': [
    { key: 'date', label: 'Date Match', shortLabel: 'Date', description: 'Verify the document date matches the recorded transaction date', priority: 1 },
    { key: 'period', label: 'Period Check', shortLabel: 'Period', description: 'Verify the transaction falls within the correct accounting period (before/after period end)', priority: 1 },
  ],
  'Classification': [
    { key: 'account_classification', label: 'Account Classification', shortLabel: 'Class', description: 'Verify the transaction is recorded in the correct account and classification', priority: 1 },
  ],
  'Presentation': [
    { key: 'disclosure', label: 'Disclosure', shortLabel: 'Disc', description: 'Verify the transaction is properly presented and disclosed in the financial statements', priority: 1 },
  ],
  'Existence': [
    { key: 'existence_check', label: 'Exists', shortLabel: 'Exists', description: 'Verify the asset, liability or transaction exists — physical evidence or third-party confirmation', priority: 1 },
    { key: 'amount', label: 'Amount Match', shortLabel: 'Amt', description: 'Verify the recorded amount agrees to supporting evidence', priority: 2 },
  ],
  'Valuation': [
    { key: 'amount', label: 'Amount Match', shortLabel: 'Amt', description: 'Verify the valuation amount is correctly calculated and supported', priority: 1 },
    { key: 'calculation', label: 'Calculation Check', shortLabel: 'Calc', description: 'Verify mathematical accuracy of the valuation calculation', priority: 2 },
  ],
  'Rights & Obligations': [
    { key: 'entity_match', label: 'Entity Match', shortLabel: 'Entity', description: 'Verify the entity named on the evidence is the audit client (rights holder or obligor)', priority: 1 },
    { key: 'ownership', label: 'Ownership', shortLabel: 'Own', description: 'Verify the client has legal ownership or obligation for the recorded item', priority: 2 },
  ],
};

// The consistency check always applies regardless of assertions
export const CONSISTENCY_CHECK: VerificationCheck = {
  key: 'consistency', label: 'Consistency', shortLabel: 'Consist',
  description: 'Verify the description on the evidence is not inconsistent with the account code description',
  priority: 99,
};

/**
 * Get ordered verification checks for a set of assertions.
 * Deduplicates by key, orders by priority, always includes consistency.
 */
export function getVerificationChecks(assertions: string[]): VerificationCheck[] {
  const checkMap = new Map<string, VerificationCheck>();

  // Normalise assertions and collect checks
  for (const rawAssertion of assertions) {
    const normalised = Object.entries(ASSERTION_SHORT_LABELS).find(([, short]) =>
      short === assertionShortLabel(rawAssertion)
    )?.[0] || rawAssertion;

    // Find in VERIFICATION_CHECKS using exact or partial match
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
  'sme-audit': 'SME',
  'pie-audit': 'PIE',
  'sme-controls-audit': 'SME_CONTROLS',
  'pie-controls-audit': 'PIE_CONTROLS',
  'group': 'GROUP',
};

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  SME: 'SME Audit',
  PIE: 'PIE Audit',
  SME_CONTROLS: 'SME Controls Based Audit',
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

export type QuestionInputType = 'text' | 'textarea' | 'yesno' | 'yes_only' | 'dropdown' | 'number' | 'currency' | 'date' | 'formula' | 'checkbox' | 'yna';

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
  conditionalOn?: { questionId: string; value: string };
  mergedWith?: string;
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
