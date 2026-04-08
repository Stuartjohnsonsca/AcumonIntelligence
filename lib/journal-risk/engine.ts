import type { Config, RunResult, RiskRule, EvaluationContext, JournalRecord, UserRecord, AccountRecord } from './types';
import { buildPopulationEvidence } from './completeness';
import { computeAccountFrequency, computePairFrequency } from './features/accountUsage';
import { computeUserPostingFrequency, computeUserPercentiles } from './features/userBehaviour';
import { DEFAULT_RULES } from './risk/rules.default';
import { scoreAllJournals } from './risk/scorer';
import { selectJournals } from './selection/selector';
import { analyzeCoverage } from './selection/coverage';

const ENGINE_VERSION = '1.0.0';

export interface AnalysisInput {
  journals: JournalRecord[];
  users: UserRecord[];
  accounts: AccountRecord[];
  config: Config;
  engagementId: string;
  entityName: string;
  baseCurrency: string;
}

/**
 * Run the full journal risk analysis pipeline.
 * Pure function: no fs, no process, no side effects.
 * Returns the complete RunResult.
 */
export function runJournalRiskAnalysis(input: AnalysisInput): RunResult {
  const { journals, users, accounts, config, engagementId, entityName, baseCurrency } = input;

  // 1. Build lookup maps
  const usersMap = new Map(users.map(u => [u.userId, u]));
  const accountsMap = new Map(accounts.map(a => [a.accountId, a]));

  // 2. Compute population evidence
  const populationEvidence = buildPopulationEvidence(journals, config);

  // 3. Compute derived features
  const accountFrequency = computeAccountFrequency(journals);
  const pairFrequency = computePairFrequency(journals);
  const userPostingFrequency = computeUserPostingFrequency(journals);
  const userPostingPercentiles = computeUserPercentiles(userPostingFrequency);

  // 4. Build evaluation context
  const ctx: EvaluationContext = {
    config,
    users: usersMap,
    accounts: accountsMap,
    accountFrequency,
    pairFrequency,
    userPostingFrequency,
    userPostingPercentiles,
  };

  // 5. Apply config weight overrides to rules
  const rules: RiskRule[] = DEFAULT_RULES.map(r => ({
    ...r,
    weight: config.weights[r.ruleId] ?? r.weight,
  }));

  // 6. Score all journals
  let scoredResults = scoreAllJournals(journals, rules, ctx);

  // 7. Select journals via 3-layer strategy
  scoredResults = selectJournals(scoredResults, config);

  // 8. Analyze coverage
  const coverage = analyzeCoverage(scoredResults);

  // 9. Build RunResult
  const runId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const runResult: RunResult = {
    version: '1.0.0',
    engagement: {
      engagementId,
      entityName,
      periodStart: config.periodStartDate,
      periodEnd: config.periodEndDate,
      baseCurrency,
    },
    population: populationEvidence,
    riskModel: {
      modelId: 'journal-risk-v1',
      scoring: {
        method: 'weighted_additive',
        maxScore: 100,
        explainability: { storeDrivers: true, storePerRuleContribution: true },
      },
      dimensions: {
        timing: { rules: rules.filter(r => r.ruleId.startsWith('T')) },
        userAccess: { rules: rules.filter(r => r.ruleId.startsWith('U')) },
        content: { rules: rules.filter(r => r.ruleId.startsWith('C')) },
        description: { rules: rules.filter(r => r.ruleId.startsWith('D')) },
        accountingRisk: { rules: rules.filter(r => r.ruleId.startsWith('A')) },
        behaviour: { rules: rules.filter(r => r.ruleId.startsWith('B')) },
      },
      thresholds: config.thresholds,
      keywordLists: { suspicious: config.suspiciousKeywords },
    },
    results: {
      run: { runId, runAtUtc: new Date().toISOString(), engineVersion: ENGINE_VERSION },
      journals: scoredResults,
    },
  };

  return runResult;
}

export { analyzeCoverage };
