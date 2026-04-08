import type { Config } from './types';
import { DEFAULT_SUSPICIOUS_KEYWORDS } from './features/keywords';

const ENGINE_VERSION = '1.0.0';

/**
 * Build a default Config from engagement period dates.
 * Users can override individual fields before running.
 */
export function buildDefaultConfig(opts: {
  periodStartDate: string;
  periodEndDate: string;
}): Config {
  // Post-close cutoff: 90 days after period end (standard audit window)
  const peDate = new Date(opts.periodEndDate);
  peDate.setDate(peDate.getDate() + 90);
  const postCloseCutoff = peDate.toISOString().slice(0, 10);

  return {
    version: ENGINE_VERSION,
    timezone: 'Europe/London',
    businessHours: { start: '08:00', end: '18:00' },
    periodStartDate: opts.periodStartDate,
    periodEndDate: opts.periodEndDate,
    postCloseCutoffDate: postCloseCutoff,
    periodEndWindowDays: 5,
    seniorRoles: ['Director', 'Finance Director', 'CFO', 'CEO', 'Managing Director', 'Partner', 'Owner', 'Chairman'],
    suspiciousKeywords: DEFAULT_SUSPICIOUS_KEYWORDS,
    thresholds: {
      highRiskMinScore: 70,
      mandatorySelectMinScore: 80,
      mandatorySelectMinCriticalTags: 1,
    },
    selection: {
      layer2CoverageTargets: {
        timing_high_risk: 2,
        access_override_risk: 2,
        seldom_used_account: 2,
        unusual_account_pair: 2,
        suspicious_keywords: 2,
        weak_description: 2,
        estimate_account: 2,
      },
      layer3UnpredictableCount: 5,
      maxSampleSize: 100,
    },
    weights: {
      T01: 25, T02: 15, T03: 8,
      U01: 25, U02: 12, U03: 12,
      C01: 14, C02: 12, C03: 8,
      D01: 10, D02: 14,
      A01: 15,
      B01: 12,
    },
  };
}
