"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendAuditEvent = appendAuditEvent;
exports.createRunStartEvent = createRunStartEvent;
exports.createRunCompleteEvent = createRunCompleteEvent;
exports.createOverrideEvent = createOverrideEvent;
const fs_1 = __importDefault(require("fs"));
/**
 * Append a single audit trail event as a JSON line to the given file.
 * Creates the file if it does not exist.
 */
function appendAuditEvent(event, outputPath) {
    const line = JSON.stringify(event) + '\n';
    fs_1.default.appendFileSync(outputPath, line, 'utf-8');
}
/**
 * Create an audit event marking the start of a risk-scoring run.
 * Includes a simple config "hash" (JSON byte length) and the population hash totals.
 */
function createRunStartEvent(runId, config, populationEvidence) {
    return {
        type: 'run_start',
        timestamp: new Date().toISOString(),
        runId,
        data: {
            configHash: JSON.stringify(config).length,
            configVersion: config.version,
            populationRecordCount: populationEvidence.recordCount,
            hashTotals: {
                totalDebits: populationEvidence.hashTotals.totalDebits,
                totalCredits: populationEvidence.hashTotals.totalCredits,
                totalAbsoluteAmounts: populationEvidence.hashTotals.totalAbsoluteAmounts,
            },
            coverage: {
                fromDate: populationEvidence.coverage.fromDate,
                toDate: populationEvidence.coverage.toDate,
                includesPostClose: populationEvidence.coverage.includesPostClose,
                includesOpening: populationEvidence.coverage.includesOpening,
            },
            sourceSystem: populationEvidence.sourceSystem,
            extractRunId: populationEvidence.extractRunId,
        },
    };
}
/**
 * Create an audit event marking the completion of a risk-scoring run
 * with per-layer selection counts.
 */
function createRunCompleteEvent(runId, selectionSummary) {
    return {
        type: 'run_complete',
        timestamp: new Date().toISOString(),
        runId,
        data: {
            selectionSummary: {
                layer1_mandatory_high_risk: selectionSummary.layer1,
                layer2_targeted_coverage: selectionSummary.layer2,
                layer3_unpredictable: selectionSummary.layer3,
                not_selected: selectionSummary.notSelected,
                totalSelected: selectionSummary.layer1 +
                    selectionSummary.layer2 +
                    selectionSummary.layer3,
                totalPopulation: selectionSummary.layer1 +
                    selectionSummary.layer2 +
                    selectionSummary.layer3 +
                    selectionSummary.notSelected,
            },
        },
    };
}
/**
 * Create an audit event recording that a mandatory journal was overridden
 * (un-selected) by a user, with the justification.
 */
function createOverrideEvent(runId, journalId, justification, userId) {
    return {
        type: 'override_unselect_mandatory',
        timestamp: new Date().toISOString(),
        runId,
        data: {
            journalId,
            justification,
            userId,
        },
    };
}
//# sourceMappingURL=auditTrail.js.map