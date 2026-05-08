"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const loadCsv_1 = require("./ingest/loadCsv");
const loadJson_1 = require("./ingest/loadJson");
const validators_1 = require("./ingest/validators");
const completeness_1 = require("./ingest/completeness");
const accountUsage_1 = require("./features/accountUsage");
const userBehaviour_1 = require("./features/userBehaviour");
const rules_default_1 = require("./risk/rules.default");
const scorer_1 = require("./risk/scorer");
const selector_1 = require("./selection/selector");
const coverage_1 = require("./selection/coverage");
const exportCsv_1 = require("./reporting/exportCsv");
const exportMarkdown_1 = require("./reporting/exportMarkdown");
const exportJson_1 = require("./reporting/exportJson");
const auditTrail_1 = require("./reporting/auditTrail");
const ENGINE_VERSION = '1.0.0';
function parseArgs(argv) {
    const args = {};
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
    const config = (0, loadJson_1.loadConfig)(path.resolve(configPath));
    (0, validators_1.validateConfig)(config);
    // 2. Load datasets
    console.log('Loading datasets...');
    const journals = (0, loadCsv_1.loadJournalsCsv)(path.resolve(journalsPath));
    const usersArr = (0, loadCsv_1.loadUsersCsv)(path.resolve(usersPath));
    const accountsArr = (0, loadCsv_1.loadAccountsCsv)(path.resolve(accountsPath));
    (0, validators_1.validateJournals)(journals);
    (0, validators_1.validateUsers)(usersArr);
    (0, validators_1.validateAccounts)(accountsArr);
    console.log(`  Journals: ${journals.length}`);
    console.log(`  Users: ${usersArr.length}`);
    console.log(`  Accounts: ${accountsArr.length}`);
    // 3. Build lookup maps
    const usersMap = new Map(usersArr.map(u => [u.userId, u]));
    const accountsMap = new Map(accountsArr.map(a => [a.accountId, a]));
    // 4. Compute population evidence
    console.log('Computing population evidence...');
    const populationEvidence = (0, completeness_1.buildPopulationEvidence)(journals, config);
    console.log(`  Records: ${populationEvidence.recordCount}`);
    console.log(`  Debits: ${populationEvidence.hashTotals.totalDebits.toFixed(2)}`);
    console.log(`  Credits: ${populationEvidence.hashTotals.totalCredits.toFixed(2)}`);
    console.log(`  Post-close: ${populationEvidence.coverage.includesPostClose}`);
    // 5. Compute derived features (statistics)
    console.log('Computing features...');
    const accountFrequency = (0, accountUsage_1.computeAccountFrequency)(journals);
    const pairFrequency = (0, accountUsage_1.computePairFrequency)(journals);
    const userPostingFrequency = (0, userBehaviour_1.computeUserPostingFrequency)(journals);
    const userPostingPercentiles = (0, userBehaviour_1.computeUserPercentiles)(userPostingFrequency);
    // 6. Build evaluation context
    const ctx = {
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
    const rules = rules_default_1.DEFAULT_RULES.map(r => ({
        ...r,
        weight: config.weights[r.ruleId] ?? r.weight,
    }));
    let scoredResults = (0, scorer_1.scoreAllJournals)(journals, rules, ctx);
    // 8. Select journals via 3 layers
    console.log('Selecting journals...');
    scoredResults = (0, selector_1.selectJournals)(scoredResults, config);
    const coverage = (0, coverage_1.analyzeCoverage)(scoredResults);
    console.log(`  Layer 1 (mandatory): ${coverage.byLayer.layer1_mandatory_high_risk || 0}`);
    console.log(`  Layer 2 (targeted): ${coverage.byLayer.layer2_targeted_coverage || 0}`);
    console.log(`  Layer 3 (unpredictable): ${coverage.byLayer.layer3_unpredictable || 0}`);
    console.log(`  Not selected: ${coverage.byLayer.not_selected || 0}`);
    console.log(`  Total selected: ${coverage.totalSelected} / ${coverage.totalPopulation}`);
    // 9. Build run result
    const runId = crypto.randomUUID();
    const runResult = {
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
    (0, auditTrail_1.appendAuditEvent)((0, auditTrail_1.createRunStartEvent)(runId, config, populationEvidence), auditTrailPath);
    (0, exportJson_1.exportResultJson)(runResult, path.join(outDir, 'result.json'));
    (0, exportCsv_1.exportJournalsCsv)(scoredResults, path.join(outDir, 'journals_scored.csv'));
    (0, exportMarkdown_1.exportMarkdownSummary)(runResult, path.join(outDir, 'selection_summary.md'));
    (0, auditTrail_1.appendAuditEvent)((0, auditTrail_1.createRunCompleteEvent)(runId, {
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
    const ruleCounts = {};
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
//# sourceMappingURL=index.js.map