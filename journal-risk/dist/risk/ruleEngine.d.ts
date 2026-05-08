import type { RiskRule, RiskDriver, JournalRecord, EvaluationContext } from '../types';
export declare function evaluateRule(rule: RiskRule, journal: JournalRecord, ctx: EvaluationContext): {
    hit: boolean;
    tags: string[];
    driver: RiskDriver | null;
};
export declare function evaluateAllRules(rules: RiskRule[], journal: JournalRecord, ctx: EvaluationContext): {
    drivers: RiskDriver[];
    tags: string[];
};
//# sourceMappingURL=ruleEngine.d.ts.map