import type { Config, RunResult, RiskRule, EvaluationContext, JournalRecord, UserRecord, AccountRecord } from './types';
import { buildPopulationEvidence } from './completeness';
import { computeAccountFrequency, computePairFrequency } from './features/accountUsage';
import { computeUserPostingFrequency, computeUserPercentiles } from './features/userBehaviour';
import { DEFAULT_RULES } from './risk/rules.default';
import { scoreAllJournals } from './risk/scorer';
import { selectJournals } from './selection/selector';
import { analyzeCoverage } from './selection/coverage';

const DEFAULT_OFFSETTING_WINDOW_DAYS = 7;

/**
 * Build the offsetting index: pairs of journals with the same absolute amount,
 * posted on the mirrored account pair (A→B and B→A), within `windowDays` of
 * each other. Returns a map keyed by journalId → its match.
 *
 * Only the first match found for each journal is recorded — a journal can
 * only belong to one offsetting pair for scoring purposes.
 */
function buildOffsettingIndex(
  journals: JournalRecord[],
  windowDays: number,
): Map<string, string> {
  const index = new Map<string, string>();

  // Bucket by absolute amount to keep the comparison O(n) instead of O(n²)
  // across the whole population.
  const byAmount = new Map<number, JournalRecord[]>();
  for (const j of journals) {
    const abs = Math.abs(j.amount);
    if (abs === 0) continue;
    if (!byAmount.has(abs)) byAmount.set(abs, []);
    byAmount.get(abs)!.push(j);
  }

  const msPerDay = 86_400_000;
  for (const bucket of byAmount.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i];
      if (index.has(a.journalId)) continue;
      for (let k = i + 1; k < bucket.length; k++) {
        const b = bucket[k];
        if (index.has(b.journalId)) continue;
        // Mirrored account pair: A's debit = B's credit AND A's credit = B's debit.
        if (a.debitAccountId !== b.creditAccountId) continue;
        if (a.creditAccountId !== b.debitAccountId) continue;
        const days = Math.abs(
          (new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime()) / msPerDay,
        );
        if (days > windowDays) continue;
        index.set(a.journalId, b.journalId);
        index.set(b.journalId, a.journalId);
        break;
      }
    }
  }
  return index;
}

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
  const offsettingIndex = buildOffsettingIndex(
    journals,
    config.offsettingWindowDays ?? DEFAULT_OFFSETTING_WINDOW_DAYS,
  );

  // 4. Build evaluation context
  const ctx: EvaluationContext = {
    config,
    users: usersMap,
    accounts: accountsMap,
    accountFrequency,
    pairFrequency,
    userPostingFrequency,
    userPostingPercentiles,
    offsettingIndex,
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
