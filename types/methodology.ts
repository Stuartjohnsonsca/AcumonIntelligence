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
