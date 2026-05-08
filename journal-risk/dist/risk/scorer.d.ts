import type { RiskDriver, RiskRule, JournalRecord, JournalRiskResult, EvaluationContext } from '../types';
export declare function scoreJournal(drivers: RiskDriver[], maxScore?: number, highRiskMinScore?: number): {
    riskScore: number;
    riskBand: 'low' | 'medium' | 'high';
};
export declare function scoreAllJournals(journals: JournalRecord[], rules: RiskRule[], ctx: EvaluationContext): JournalRiskResult[];
//# sourceMappingURL=scorer.d.ts.map