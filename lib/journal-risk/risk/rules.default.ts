import type { RiskRule } from '../types';

/**
 * Default risk rules aligned to ISA 240 fraud risk indicators.
 * Weights are defaults — overridden at runtime via config.weights[ruleId].
 */
export const DEFAULT_RULES: RiskRule[] = [
  // ── Timing dimension ───────────────────────────────────────────────────────
  {
    ruleId: 'T01',
    name: 'Post-close journal',
    severity: 'critical',
    weight: 25,
    condition: { type: 'derived', field: 'postedAt', derivedFn: 'isPostClose' },
    tags: ['timing_high_risk', 'post_close'],
  },
  {
    ruleId: 'T02',
    name: 'Period-end window journal',
    severity: 'high',
    weight: 15,
    condition: { type: 'derived', field: 'postedAt', derivedFn: 'isPeriodEndWindow' },
    tags: ['timing_high_risk', 'period_end'],
  },
  {
    ruleId: 'T03',
    name: 'Outside business hours',
    severity: 'medium',
    weight: 8,
    condition: { type: 'derived', field: 'postedAt', derivedFn: 'isOutsideBusinessHours' },
    tags: ['timing_high_risk', 'outside_hours'],
  },

  // ── User / Access dimension ────────────────────────────────────────────────
  {
    ruleId: 'U01',
    name: 'Senior management poster',
    severity: 'critical',
    weight: 25,
    condition: { type: 'derived', field: 'preparedByUserId', derivedFn: 'isSeniorPoster' },
    tags: ['access_override_risk', 'senior_poster'],
  },
  {
    ruleId: 'U02',
    name: 'Atypical poster',
    severity: 'high',
    weight: 12,
    condition: { type: 'derived', field: 'preparedByUserId', derivedFn: 'isAtypicalPoster' },
    tags: ['access_override_risk', 'atypical_poster'],
  },
  {
    ruleId: 'U03',
    name: 'Same preparer and approver',
    severity: 'high',
    weight: 12,
    condition: { type: 'derived', field: 'approvedByUserId', derivedFn: 'isSameAsApprover' },
    tags: ['access_override_risk', 'self_approved'],
  },

  // ── Content dimension ──────────────────────────────────────────────────────
  {
    ruleId: 'C01',
    name: 'Seldom-used account',
    severity: 'high',
    weight: 14,
    condition: { type: 'derived', field: 'debitAccountId', derivedFn: 'isSeldomUsedAccount' },
    tags: ['seldom_used_account'],
  },
  {
    ruleId: 'C02',
    name: 'Unusual account pair',
    severity: 'high',
    weight: 12,
    condition: { type: 'derived', field: 'debitAccountId', derivedFn: 'isUnusualAccountPair' },
    tags: ['unusual_account_pair'],
  },
  {
    ruleId: 'C03',
    name: 'Round number / consistent ending',
    severity: 'medium',
    weight: 8,
    condition: { type: 'derived', field: 'amount', derivedFn: 'isRoundNumber' },
    tags: ['round_number'],
  },

  // ── Description dimension ──────────────────────────────────────────────────
  {
    ruleId: 'D01',
    name: 'Weak or missing explanation',
    severity: 'high',
    weight: 10,
    condition: { type: 'derived', field: 'description', derivedFn: 'isEmptyOrLowInfo' },
    tags: ['weak_description'],
  },
  {
    ruleId: 'D02',
    name: 'Suspicious keywords',
    severity: 'high',
    weight: 14,
    condition: { type: 'derived', field: 'description', derivedFn: 'containsSuspiciousKeywords' },
    tags: ['suspicious_keywords'],
  },

  // ── Accounting Risk dimension ──────────────────────────────────────────────
  {
    ruleId: 'A01',
    name: 'Posts to judgmental/estimate account',
    severity: 'high',
    weight: 15,
    condition: { type: 'derived', field: 'debitAccountId', derivedFn: 'isJudgmentalAccount' },
    tags: ['estimate_account'],
  },

  // ── Behaviour dimension ────────────────────────────────────────────────────
  {
    ruleId: 'B01',
    name: 'Quick reversal',
    severity: 'medium',
    weight: 12,
    condition: { type: 'derived', field: 'reversalJournalId', derivedFn: 'isQuickReversal' },
    tags: ['quick_reversal'],
  },
];
