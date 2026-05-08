import type { AuditTrailEvent, Config, PopulationEvidence } from '../types';
/**
 * Append a single audit trail event as a JSON line to the given file.
 * Creates the file if it does not exist.
 */
export declare function appendAuditEvent(event: AuditTrailEvent, outputPath: string): void;
/**
 * Create an audit event marking the start of a risk-scoring run.
 * Includes a simple config "hash" (JSON byte length) and the population hash totals.
 */
export declare function createRunStartEvent(runId: string, config: Config, populationEvidence: PopulationEvidence): AuditTrailEvent;
/**
 * Create an audit event marking the completion of a risk-scoring run
 * with per-layer selection counts.
 */
export declare function createRunCompleteEvent(runId: string, selectionSummary: {
    layer1: number;
    layer2: number;
    layer3: number;
    notSelected: number;
}): AuditTrailEvent;
/**
 * Create an audit event recording that a mandatory journal was overridden
 * (un-selected) by a user, with the justification.
 */
export declare function createOverrideEvent(runId: string, journalId: string, justification: string, userId: string): AuditTrailEvent;
//# sourceMappingURL=auditTrail.d.ts.map