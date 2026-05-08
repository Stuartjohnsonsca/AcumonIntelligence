import type { JournalRecord, Config, HashTotals, CoverageEvidence, PopulationEvidence } from '../types';
/**
 * Compute hash totals for the journal population.
 *
 * - totalDebits: sum of amounts where the journal represents a debit (positive amount)
 * - totalCredits: sum of amounts where the journal represents a credit (positive amount, i.e. absolute value of negatives)
 * - totalAbsoluteAmounts: sum of absolute values of all amounts
 *
 * Convention: each journal row has a single `amount` field. Positive amounts are debits,
 * negative amounts are credits. Both debitAccountId and creditAccountId are always populated
 * because a journal entry always has two sides; the `amount` sign determines which side
 * this line belongs to.
 */
export declare function computeHashTotals(journals: JournalRecord[]): HashTotals;
/**
 * Check whether the journal population is balanced (debits approximately equal credits).
 * Returns an object with balanced status and the imbalance amount.
 *
 * Tolerance: 0.01 (one cent) to account for floating-point rounding.
 */
export declare function validateBalancedPopulation(journals: JournalRecord[]): {
    balanced: boolean;
    totalDebits: number;
    totalCredits: number;
    imbalance: number;
};
/**
 * Compute coverage evidence: date range and whether the population
 * includes post-close entries and opening-day entries.
 */
export declare function computeCoverageEvidence(journals: JournalRecord[], config: Config): CoverageEvidence;
/**
 * Build the full PopulationEvidence object for the journal population.
 *
 * sourceSystem and extractRunId are derived from the journal data:
 * - sourceSystem: the set of distinct sources joined (e.g. "AP, AR, GL")
 * - extractRunId: a deterministic hash-like identifier based on record count and totals
 */
export declare function buildPopulationEvidence(journals: JournalRecord[], config: Config): PopulationEvidence;
//# sourceMappingURL=completeness.d.ts.map