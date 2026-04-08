// ─── Input Types ────────────────────────────────────────────────────────────

export interface JournalRecord {
  journalId: string;
  postedAt: string; // ISO datetime
  period: string;
  source: string; // AP, AR, GL, etc.
  preparedByUserId: string;
  approvedByUserId: string | null;
  description: string | null;
  amount: number;
  debitAccountId: string;
  creditAccountId: string;
  accountIds?: string[]; // for multi-line journals
  reversalJournalId: string | null;
  entryCreatedAt?: string | null;
  entity: string;
  currency: string;
}

export interface UserRecord {
  userId: string;
  displayName: string;
  roleTitle: string;
  isSeniorMgmt?: boolean;
}

export interface AccountRecord {
  accountId: string;
  accountName: string;
  category: string; // revenue, cash, reserve, etc.
  isJudgmental: boolean;
  materialityGroup: string;
  normalBalance?: 'debit' | 'credit';
}

// ─── Config Type ────────────────────────────────────────────────────────────

export interface Config {
  version: string;
  timezone: string;
  businessHours: { start: string; end: string };
  periodStartDate: string;
  periodEndDate: string;
  postCloseCutoffDate: string;
  periodEndWindowDays: number;
  seniorRoles: string[];
  suspiciousKeywords: string[];
  thresholds: {
    highRiskMinScore: number;
    mandatorySelectMinScore: number;
    mandatorySelectMinCriticalTags: number;
  };
  selection: {
    layer2CoverageTargets: Record<string, number>;
    layer3UnpredictableCount: number;
    maxSampleSize: number;
  };
  weights: Record<string, number>;
}

// ─── Rule Types ─────────────────────────────────────────────────────────────

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface RuleCondition {
  type: 'equals' | 'in' | 'regex' | 'range' | 'exists' | 'derived';
  field: string;
  value?: any;
  min?: any;
  max?: any;
  pattern?: string;
  derivedFn?: string;
}

export interface RiskRule {
  ruleId: string;
  name: string;
  severity: Severity;
  weight: number;
  condition: RuleCondition;
  tags: string[];
}

// ─── Risk Output Types ──────────────────────────────────────────────────────

export interface RiskDriver {
  ruleId: string;
  ruleName: string;
  severity: string;
  weightApplied: number;
  explanation: string;
}

export type SelectionLayer =
  | 'layer1_mandatory_high_risk'
  | 'layer2_targeted_coverage'
  | 'layer3_unpredictable'
  | 'not_selected';

export interface SelectionInfo {
  selected: boolean;
  selectionLayer: SelectionLayer;
  mandatory: boolean;
  rationale: string;
}

export interface JournalRiskResult {
  journalId: string;
  postedAt: string;
  period: string;
  isManual: boolean;
  preparedByUserId: string;
  approvedByUserId: string | null;
  riskScore: number;
  riskBand: 'low' | 'medium' | 'high';
  riskTags: string[];
  drivers: RiskDriver[];
  selection: SelectionInfo;
}

// ─── Population Evidence ────────────────────────────────────────────────────

export interface HashTotals {
  totalDebits: number;
  totalCredits: number;
  totalAbsoluteAmounts: number;
}

export interface CoverageEvidence {
  fromDate: string;
  toDate: string;
  includesPostClose: boolean;
  includesOpening: boolean;
}

export interface PopulationEvidence {
  sourceSystem: string;
  extractRunId: string;
  recordCount: number;
  hashTotals: HashTotals;
  coverage: CoverageEvidence;
}

// ─── Run Result ─────────────────────────────────────────────────────────────

export interface RunResult {
  version: string;
  engagement: {
    engagementId: string;
    entityName: string;
    periodStart: string;
    periodEnd: string;
    baseCurrency: string;
  };
  population: PopulationEvidence;
  riskModel: {
    modelId: string;
    scoring: {
      method: 'weighted_additive';
      maxScore: number;
      explainability: { storeDrivers: true; storePerRuleContribution: true };
    };
    dimensions: Record<string, { rules: RiskRule[] }>;
    thresholds: Config['thresholds'];
    keywordLists: { suspicious: string[] };
  };
  results: {
    run: { runId: string; runAtUtc: string; engineVersion: string };
    journals: JournalRiskResult[];
  };
}

// ─── Audit Trail ────────────────────────────────────────────────────────────

export interface AuditTrailEvent {
  type: 'run_start' | 'run_complete' | 'override_unselect_mandatory';
  timestamp: string;
  runId: string;
  data: Record<string, any>;
}

// ─── Evaluation Context (passed to rule engine) ─────────────────────────────

export interface EvaluationContext {
  config: Config;
  users: Map<string, UserRecord>;
  accounts: Map<string, AccountRecord>;
  accountFrequency: Map<string, number>;
  pairFrequency: Map<string, number>;
  userPostingFrequency: Map<string, number>;
  userPostingPercentiles: Map<string, number>;
}
