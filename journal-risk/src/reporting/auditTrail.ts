import fs from 'fs';
import type { AuditTrailEvent, Config, PopulationEvidence } from '../types';

/**
 * Append a single audit trail event as a JSON line to the given file.
 * Creates the file if it does not exist.
 */
export function appendAuditEvent(
  event: AuditTrailEvent,
  outputPath: string
): void {
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(outputPath, line, 'utf-8');
}

/**
 * Create an audit event marking the start of a risk-scoring run.
 * Includes a simple config "hash" (JSON byte length) and the population hash totals.
 */
export function createRunStartEvent(
  runId: string,
  config: Config,
  populationEvidence: PopulationEvidence
): AuditTrailEvent {
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
export function createRunCompleteEvent(
  runId: string,
  selectionSummary: {
    layer1: number;
    layer2: number;
    layer3: number;
    notSelected: number;
  }
): AuditTrailEvent {
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
        totalSelected:
          selectionSummary.layer1 +
          selectionSummary.layer2 +
          selectionSummary.layer3,
        totalPopulation:
          selectionSummary.layer1 +
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
export function createOverrideEvent(
  runId: string,
  journalId: string,
  justification: string,
  userId: string
): AuditTrailEvent {
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
