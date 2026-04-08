import type {
  RiskDriver,
  RiskRule,
  JournalRecord,
  JournalRiskResult,
  EvaluationContext,
} from '../types';
import { evaluateAllRules } from './ruleEngine';

// ─── Score a single journal from its drivers ───────────────────────────────

export function scoreJournal(
  drivers: RiskDriver[],
  maxScore: number = 100,
  highRiskMinScore: number = 70,
): { riskScore: number; riskBand: 'low' | 'medium' | 'high' } {
  const raw = drivers.reduce((sum, d) => sum + d.weightApplied, 0);
  const riskScore = Math.min(raw, maxScore);

  let riskBand: 'low' | 'medium' | 'high';
  if (riskScore >= highRiskMinScore) {
    riskBand = 'high';
  } else if (riskScore >= 40) {
    riskBand = 'medium';
  } else {
    riskBand = 'low';
  }

  return { riskScore, riskBand };
}

// ─── Score all journals in the population ──────────────────────────────────

export function scoreAllJournals(
  journals: JournalRecord[],
  rules: RiskRule[],
  ctx: EvaluationContext,
): JournalRiskResult[] {
  const highRiskMinScore = ctx.config.thresholds?.highRiskMinScore ?? 70;

  return journals.map((journal) => {
    const { drivers, tags } = evaluateAllRules(rules, journal, ctx);
    const { riskScore, riskBand } = scoreJournal(drivers, 100, highRiskMinScore);

    const result: JournalRiskResult = {
      journalId: journal.journalId,
      postedAt: journal.postedAt,
      period: journal.period,
      isManual: journal.source === 'GL' || journal.source === 'MANUAL',
      preparedByUserId: journal.preparedByUserId,
      approvedByUserId: journal.approvedByUserId,
      riskScore,
      riskBand,
      riskTags: tags,
      drivers,
      selection: {
        selected: false,
        selectionLayer: 'not_selected',
        mandatory: false,
        rationale: '',
      },
    };

    return result;
  });
}
