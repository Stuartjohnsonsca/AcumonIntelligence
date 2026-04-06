/**
 * Analytical Review (AR) calculation functions.
 *
 * Formula: Expected = X + (A + B) / 2 * Z
 * Difference = Recorded Amount - Expected Amount
 * Tolerance Materiality = (Recorded Amount / FS Note Rollup) * Performance Materiality
 * Threshold = Confidence Factor * Tolerance Materiality
 * Within Threshold = |Difference| <= Threshold
 */

// ─── Formula Variable Options ───────────────────────────────────────────────

export const FORMULA_XAB_OPTIONS = [
  'PY value(s)',
  'Sales',
  'Cost of Sales',
  'Non-Financial Data',
  '0',
  'Opening Balance from Balance Sheet Item',
  '12',
  'Units Sold',
] as const;

export const FORMULA_Z_OPTIONS = [
  'Change in Sales',
  'Change in Cost of Sales',
  'GPM%',
  'Inflation',
  'GDP',
  'FX rate to USD',
  'FX rate to Euro',
  'Interest rate',
  'User Entered',
] as const;

export const DIFFERENCE_ASSESSMENT_OPTIONS = [
  'Isolated and justifiable',
  'Isolated not explainable',
  'Systemic and justifiable',
  'Systemic and not justifiable',
] as const;

export const RMM_RECONSIDERATION_OPTIONS = ['No', 'Yes'] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TBSummary {
  accountCode: string;
  description: string;
  currentYear: number;
  priorYear: number;
  fsLevel: string | null;
  fsNoteLevel: string | null;
  fsStatement: string | null;
}

export interface ARCalculationInput {
  formulaX: string | null;
  formulaA: string | null;
  formulaB: string | null;
  formulaZ: string | null;
  xValue: number | null; // User-entered override or resolved
  aValue: number | null;
  bValue: number | null;
  zValue: number | null;
  recordedAmount: number;
  performanceMateriality: number;
  confidenceFactor: number;
  fsNoteRollup: number; // Sum of all account CY values in the same FS Note
}

export interface ARCalculationResult {
  expectedAmount: number;
  difference: number;
  toleranceMateriality: number;
  threshold: number;
  withinThreshold: boolean;
}

// ─── Core Calculation ───────────────────────────────────────────────────────

/**
 * Calculate the expected result using X + (A + B) / 2 * Z
 */
export function calculateExpectedResult(x: number, a: number, b: number, z: number): number {
  return x + ((a + b) / 2) * z;
}

/**
 * Calculate tolerance materiality as the proportion of recorded amount to the
 * FS Note rollup, multiplied by performance materiality.
 */
export function calculateToleranceMateriality(
  recordedAmount: number,
  fsNoteRollup: number,
  performanceMateriality: number,
): number {
  if (fsNoteRollup === 0) return performanceMateriality; // Avoid division by zero
  const proportion = Math.abs(recordedAmount) / Math.abs(fsNoteRollup);
  return proportion * performanceMateriality;
}

/**
 * Calculate the threshold: Confidence Factor * Tolerance Materiality
 */
export function calculateThreshold(confidenceFactor: number, toleranceMateriality: number): number {
  return confidenceFactor * toleranceMateriality;
}

/**
 * Full AR calculation from inputs.
 */
export function calculateAR(input: ARCalculationInput): ARCalculationResult {
  const x = input.xValue ?? 0;
  const a = input.aValue ?? 0;
  const b = input.bValue ?? 0;
  const z = input.zValue ?? 0;

  const expectedAmount = calculateExpectedResult(x, a, b, z);
  const difference = input.recordedAmount - expectedAmount;
  const toleranceMateriality = calculateToleranceMateriality(
    input.recordedAmount,
    input.fsNoteRollup,
    input.performanceMateriality,
  );
  const threshold = calculateThreshold(input.confidenceFactor, toleranceMateriality);
  const withinThreshold = Math.abs(difference) <= threshold;

  return { expectedAmount, difference, toleranceMateriality, threshold, withinThreshold };
}

// ─── Variable Resolution ────────────────────────────────────────────────────

/**
 * Resolve a formula X/A/B variable from TB data.
 * Returns the numeric value, or null if user input is needed.
 */
export function resolveXABVariable(
  selector: string | null,
  accountTB: TBSummary,
  allTBRows: TBSummary[],
  userValue?: number | null,
): number | null {
  if (!selector) return 0;

  switch (selector) {
    case 'PY value(s)':
      return accountTB.priorYear;
    case 'Sales':
      return sumByFsLevel(allTBRows, 'Revenue', 'priorYear');
    case 'Cost of Sales':
      return sumByFsLevel(allTBRows, 'Cost of Sales', 'priorYear');
    case 'Non-Financial Data':
      return userValue ?? null; // Requires user input
    case '0':
      return 0;
    case 'Opening Balance from Balance Sheet Item':
      return accountTB.priorYear; // PY balance = opening for CY
    case '12':
      return 12;
    case 'Units Sold':
      return userValue ?? null; // Requires user input
    default:
      return userValue ?? 0;
  }
}

/**
 * Resolve a formula Z variable.
 * Returns the numeric value, or null if user input is needed.
 */
export function resolveZVariable(
  selector: string | null,
  allTBRows: TBSummary[],
  userValue?: number | null,
): number | null {
  if (!selector) return 0;

  const cyRevenue = sumByFsLevel(allTBRows, 'Revenue', 'currentYear');
  const pyRevenue = sumByFsLevel(allTBRows, 'Revenue', 'priorYear');
  const cyCOS = sumByFsLevel(allTBRows, 'Cost of Sales', 'currentYear');
  const pyCOS = sumByFsLevel(allTBRows, 'Cost of Sales', 'priorYear');

  switch (selector) {
    case 'Change in Sales':
      return pyRevenue !== 0 ? (cyRevenue - pyRevenue) / pyRevenue : 0;
    case 'Change in Cost of Sales':
      return pyCOS !== 0 ? (cyCOS - pyCOS) / pyCOS : 0;
    case 'GPM%':
      return cyRevenue !== 0 ? (cyRevenue - cyCOS) / cyRevenue : 0;
    case 'Inflation':
    case 'GDP':
    case 'FX rate to USD':
    case 'FX rate to Euro':
    case 'Interest rate':
    case 'User Entered':
      return userValue ?? null; // Requires user input
    default:
      return userValue ?? 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sumByFsLevel(rows: TBSummary[], fsLevel: string, field: 'currentYear' | 'priorYear'): number {
  const aliases: Record<string, string[]> = {
    'Revenue': ['Revenue', 'Turnover', 'Sales', 'Income', 'Fees'],
    'Cost of Sales': ['Cost of Sales', 'Cost of Goods Sold', 'Direct Costs'],
  };
  const matchNames = aliases[fsLevel] || [fsLevel];
  return rows
    .filter(r => r.fsLevel && matchNames.some(n => r.fsLevel!.toLowerCase().includes(n.toLowerCase())))
    .reduce((sum, r) => sum + (r[field] || 0), 0);
}

/**
 * Calculate the FS Note rollup — sum of all CY amounts for accounts in the same FS Note grouping.
 */
export function calculateFsNoteRollup(accountCode: string, allTBRows: TBSummary[]): number {
  const account = allTBRows.find(r => r.accountCode === accountCode);
  if (!account?.fsNoteLevel) {
    // Fall back to fsLevel if no note level
    if (!account?.fsLevel) return Math.abs(account?.currentYear || 0);
    return allTBRows
      .filter(r => r.fsLevel === account.fsLevel)
      .reduce((sum, r) => sum + Math.abs(r.currentYear || 0), 0);
  }
  return allTBRows
    .filter(r => r.fsNoteLevel === account.fsNoteLevel)
    .reduce((sum, r) => sum + Math.abs(r.currentYear || 0), 0);
}
