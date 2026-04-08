import type {
  JournalRecord,
  Config,
  HashTotals,
  CoverageEvidence,
  PopulationEvidence,
} from './types';

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
export function computeHashTotals(journals: JournalRecord[]): HashTotals {
  let totalDebits = 0;
  let totalCredits = 0;
  let totalAbsoluteAmounts = 0;

  for (const j of journals) {
    const abs = Math.abs(j.amount);
    totalAbsoluteAmounts += abs;

    if (j.amount >= 0) {
      totalDebits += j.amount;
    } else {
      totalCredits += abs;
    }
  }

  // Round to avoid floating-point drift
  return {
    totalDebits: Math.round(totalDebits * 100) / 100,
    totalCredits: Math.round(totalCredits * 100) / 100,
    totalAbsoluteAmounts: Math.round(totalAbsoluteAmounts * 100) / 100,
  };
}

/**
 * Check whether the journal population is balanced (debits approximately equal credits).
 * Returns an object with balanced status and the imbalance amount.
 *
 * Tolerance: 0.01 (one cent) to account for floating-point rounding.
 */
export function validateBalancedPopulation(journals: JournalRecord[]): {
  balanced: boolean;
  totalDebits: number;
  totalCredits: number;
  imbalance: number;
} {
  const hash = computeHashTotals(journals);
  const imbalance = Math.round(Math.abs(hash.totalDebits - hash.totalCredits) * 100) / 100;
  const balanced = imbalance <= 0.01;

  return {
    balanced,
    totalDebits: hash.totalDebits,
    totalCredits: hash.totalCredits,
    imbalance,
  };
}

/**
 * Compute coverage evidence: date range and whether the population
 * includes post-close entries and opening-day entries.
 */
export function computeCoverageEvidence(
  journals: JournalRecord[],
  config: Config
): CoverageEvidence {
  if (journals.length === 0) {
    return {
      fromDate: '',
      toDate: '',
      includesPostClose: false,
      includesOpening: false,
    };
  }

  const periodEndDate = new Date(config.periodEndDate);
  const periodStartDate = new Date(config.periodStartDate);

  // Normalise a date to YYYY-MM-DD for day-level comparisons
  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const periodEndDay = toDateStr(periodEndDate);
  const periodStartDay = toDateStr(periodStartDate);

  let earliest: Date | null = null;
  let latest: Date | null = null;
  let includesPostClose = false;
  let includesOpening = false;

  for (const j of journals) {
    const posted = new Date(j.postedAt);
    if (isNaN(posted.getTime())) continue;

    if (earliest === null || posted < earliest) earliest = posted;
    if (latest === null || posted > latest) latest = posted;

    // Post-close: any entry posted strictly after the period end date
    if (posted > periodEndDate) {
      includesPostClose = true;
    }

    // Opening: any entry posted on the period start date
    const postedDay = toDateStr(posted);
    if (postedDay === periodStartDay) {
      includesOpening = true;
    }
  }

  return {
    fromDate: earliest ? earliest.toISOString() : '',
    toDate: latest ? latest.toISOString() : '',
    includesPostClose,
    includesOpening,
  };
}

/**
 * Build the full PopulationEvidence object for the journal population.
 *
 * sourceSystem and extractRunId are derived from the journal data:
 * - sourceSystem: the set of distinct sources joined (e.g. "AP, AR, GL")
 * - extractRunId: a deterministic hash-like identifier based on record count and totals
 */
export function buildPopulationEvidence(
  journals: JournalRecord[],
  config: Config
): PopulationEvidence {
  const hashTotals = computeHashTotals(journals);
  const coverage = computeCoverageEvidence(journals, config);

  // Derive source system label from distinct sources in the data
  const sources = [...new Set(journals.map((j) => j.source))].sort();
  const sourceSystem = sources.join(', ') || 'unknown';

  // Build a deterministic extract run ID from the population fingerprint
  const fingerprint = `n=${journals.length}|d=${hashTotals.totalDebits}|c=${hashTotals.totalCredits}|from=${coverage.fromDate}|to=${coverage.toDate}`;
  const extractRunId = simpleHash(fingerprint);

  return {
    sourceSystem,
    extractRunId,
    recordCount: journals.length,
    hashTotals,
    coverage,
  };
}

/**
 * Simple deterministic hash for generating an extract run ID.
 * Not cryptographic — just a fingerprint for traceability.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0; // Convert to 32-bit integer
  }
  // Return as unsigned hex with prefix
  return `extract-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
