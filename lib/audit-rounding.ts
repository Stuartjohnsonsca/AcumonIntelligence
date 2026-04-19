// Shared rounding helpers used across PAR, RMM, Audit Plan and Completion.
// The raw stored value is always in whole pounds (GBP). Rounding is a
// display concern: the chosen mode divides the raw value by a factor and
// formats with an appropriate number of decimals. Inputs that the user
// edits therefore work in the *same unit* as the display — e.g. in
// "thousands" mode typing 12.5 stores 12500, keeping the spreadsheet
// feel most auditors expect.

export type RoundingMode = 'unrounded' | 'pounds' | 'thousands' | 'millions';

export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  unrounded: 'Unrounded',
  pounds: 'Pounds',
  thousands: 'Thousands',
  millions: 'Millions',
};

export const DEFAULT_ROUNDING_ORDER: RoundingMode[] = ['unrounded', 'pounds', 'thousands', 'millions'];

/** Divisor to turn a raw pound value into the display value. */
export function roundingDivisor(mode: RoundingMode): number {
  switch (mode) {
    case 'thousands': return 1_000;
    case 'millions': return 1_000_000;
    default: return 1;
  }
}

/** Decimal places to show in each mode. */
export function roundingFractionDigits(mode: RoundingMode): number {
  switch (mode) {
    case 'unrounded': return 2;
    case 'pounds': return 0;
    case 'thousands': return 1;
    case 'millions': return 2;
  }
}

/** Short unit suffix shown in column headers so readers know the scale. */
export function roundingUnitSuffix(mode: RoundingMode): string {
  switch (mode) {
    case 'thousands': return '(000)';
    case 'millions': return '(m)';
    default: return '';
  }
}

/** Format a raw pound value for display under the chosen rounding mode. */
export function formatRounded(
  value: number | null | undefined,
  mode: RoundingMode,
  opts: { allowNegative?: boolean; empty?: string } = {},
): string {
  if (value == null || isNaN(value)) return opts.empty ?? '';
  const divided = value / roundingDivisor(mode);
  const digits = roundingFractionDigits(mode);
  return divided.toLocaleString('en-GB', {
    minimumFractionDigits: mode === 'pounds' ? 0 : digits,
    maximumFractionDigits: digits,
  });
}

/** Parse a user-typed value (shown in the chosen rounding unit) back into
 *  a raw pound value for storage. Returns null for blank / unparsable input. */
export function parseRoundedInput(input: string, mode: RoundingMode): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[£,\s]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!isFinite(num)) return null;
  return num * roundingDivisor(mode);
}
