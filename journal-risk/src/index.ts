import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

import { Config, RunResult, RiskRule, EvaluationContext } from './types';
import { loadJournalsCsv, loadUsersCsv, loadAccountsCsv } from './ingest/loadCsv';
import { loadConfig } from './ingest/loadJson';
import { validateJournals, validateUsers, validateAccounts, validateConfig } from './ingest/validators';
import { buildPopulationEvidence } from './ingest/completeness';
import { computeAccountFrequency, computePairFrequency } from './features/accountUsage';
import { computeUserPostingFrequency, computeUserPercentiles } from './features/userBehaviour';
import { DEFAULT_RULES } from './risk/rules.default';
import { scoreAllJournals } from './risk/scorer';
import { selectJournals } from './selection/selector';
import { analyzeCoverage } from './selection/coverage';
import { exportJournalsCsv } from './reporting/exportCsv';
import { exportMarkdownSummary } from './reporting/exportMarkdown';
import { exportResultJson } from './reporting/exportJson';
import { appendAuditEvent, createRunStartEvent, createRunCompleteEvent } from './reporting/auditTrail';

const ENGINE_VERSION = '1.0.0';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1] || '';
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const journalsPath = args.journals;
  const usersPath = args.users;
  const accountsPath = args.accounts;
  const configPath = args.config;
  const outDir = args.out || './out';

  if (!journalsPath || !usersPath || !accountsPath || !configPath) {
    console.error('Usage: node dist/index.js --journals <path> --users <path> --accounts <path> --config <path> [--out <dir>]');
    process.exit(1);
  }

  // 1. Load config and validate
  console.log('Loading config...');
  const config = loadConfig(path.resolve(configPath));
  validateConfig(config);

  // 2. Load datasets
  console.log('Loading datasets...');
  const journals = loadJournalsCsv(path.resolve(journalsPath));
  const usersArr = loadUsersCsv(path.resolve(usersPath));
  const accountsArr = loadAccountsCsv(path.resolve(accountsPath));

  validateJournals(journals);
  validateUsers(usersArr);
  validateAccounts(accountsArr);

  console.log(`  Journals: ${journals.length}`);
  console.log(`  Users: ${usersArr.length}`);
  console.log(`  Accounts: ${accountsArr.length}`);

  // 3. Build lookup maps
  const usersMap = new Map(usersArr.map(u => [u.userId, u]));
  const accountsMap = new Map(accountsArr.map(a => [a.accountId, a]));

  // 4. Compute population evidence
  console.log('Computing population evidence...');
  const populationEvidence = buildPopulationEvidence(journals, config);
  console.log(`  Records: ${populationEvidence.recordCount}`);
  console.log(`  Debits: ${populationEvidence.hashTotals.totalDebits.toFixed(2)}`);
  console.log(`  Credits: ${populationEvidence.hashTotals.totalCredits.toFixed(2)}`);
  console.log(`  Post-close: ${populationEvidence.coverage.includesPostClose}`);

  // 5. Compute derived features (statistics)
  console.log('Computing features...');
  const accountFrequency = computeAccountFrequency(journals);
  const pairFrequency = computePairFrequency(journals);
  const userPostingFrequency = computeUserPostingFrequency(journals);
  const userPostingPercentiles = computeUserPercentiles(userPostingFrequency);

  // 6. Build evaluation context
  const ctx: EvaluationContext = {
    config,
    users: usersMap,
    accounts: accountsMap,
    accountFrequency,
    pairFrequency,
    userPostingFrequency,
    userPostingPercentiles,
  };

  // 7. Evaluate rules and score
  console.log('Evaluating rules and scoring...');
  const rules: RiskRule[] = DEFAULT_RULES.map(r => ({
    ...r,
    weight: config.weights[r.ruleId] ?? r.weight,
  }));

  let scoredResults = scoreAllJournals(journals, rules, ctx);

  // 8. Select journals via 3 layers
  console.log('Selecting journals...');
  scoredResults = selectJournals(scoredResults, config);

  const coverage = analyzeCoverage(scoredResults);
  console.log(`  Layer 1 (mandatory): ${coverage.byLayer.layer1_mandatory_high_risk || 0}`);
  console.log(`  Layer 2 (targeted): ${coverage.byLayer.layer2_targeted_coverage || 0}`);
  console.log(`  Layer 3 (unpredictable): ${coverage.byLayer.layer3_unpredictable || 0}`);
  console.log(`  Not selected: ${coverage.byLayer.not_selected || 0}`);
  console.log(`  Total selected: ${coverage.totalSelected} / ${coverage.totalPopulation}`);

  // 9. Build run result
  const runId = crypto.randomUUID();
  const runResult: RunResult = {
    version: '1.0.0',
    engagement: {
      engagementId: 'sample-engagement',
      entityName: journals[0]?.entity || 'Unknown',
      periodStart: config.periodStartDate,
      periodEnd: config.periodEndDate,
      baseCurrency: journals[0]?.currency || 'GBP',
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

  // 10. Output
  console.log(`\nWriting outputs to ${outDir}/...`);
  fs.mkdirSync(outDir, { recursive: true });

  const auditTrailPath = path.join(outDir, 'audit_trail.jsonl');
  appendAuditEvent(createRunStartEvent(runId, config, populationEvidence), auditTrailPath);

  exportResultJson(runResult, path.join(outDir, 'result.json'));
  exportJournalsCsv(scoredResults, path.join(outDir, 'journals_scored.csv'));
  exportMarkdownSummary(runResult, path.join(outDir, 'selection_summary.md'));

  appendAuditEvent(createRunCompleteEvent(runId, {
    layer1: coverage.byLayer.layer1_mandatory_high_risk || 0,
    layer2: coverage.byLayer.layer2_targeted_coverage || 0,
    layer3: coverage.byLayer.layer3_unpredictable || 0,
    notSelected: coverage.byLayer.not_selected || 0,
  }), auditTrailPath);

  console.log('\nDone.');
  console.log(`  result.json`);
  console.log(`  journals_scored.csv`);
  console.log(`  selection_summary.md`);
  console.log(`  audit_trail.jsonl`);

  // Print top 10 by risk score
  console.log('\n─── Top 10 Journals by Risk Score ───');
  const top10 = [...scoredResults].sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
  for (const j of top10) {
    console.log(`  ${j.journalId} | score=${j.riskScore} (${j.riskBand}) | ${j.selection.selectionLayer} | ${j.riskTags.join(', ')}`);
  }

  // Confirm rule coverage
  console.log('\n─── Rule Trigger Counts ───');
  const ruleCounts: Record<string, number> = {};
  for (const r of scoredResults) {
    for (const d of r.drivers) {
      ruleCounts[d.ruleId] = (ruleCounts[d.ruleId] || 0) + 1;
    }
  }
  for (const [ruleId, count] of Object.entries(ruleCounts).sort()) {
    console.log(`  ${ruleId}: ${count} journal(s)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
