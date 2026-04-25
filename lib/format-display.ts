/**
 * Display formatting for computed schedule cell values.
 *
 * Storage and cross-references (other formulas, document templates)
 * always see the RAW number — formatting only runs at render time so
 * downstream consumers don't get a string with a '%' that breaks
 * arithmetic. Specifically used by formula / number / currency cells
 * configured by the admin via TemplateQuestion.displayFormat /
 * TemplateQuestionColumn.displayFormat.
 *
 * Format vocabulary (case-insensitive):
 *   ''  / undefined         → raw value as-is
 *   'percent' / 'percent:N' → "12.345%". Input is treated as
 *                              already-percent (e.g. a formula that
 *                              multiplies by 100); no second × 100
 *                              happens here. N defaults to 2.
 *   'currency' / 'currency:N'
 *                            → "£1,234.50" — £ prefix, comma
 *                              thousand separators, N decimals
 *                              (default 0). Negatives in accounting
 *                              parens.
 *   'number' / 'number:N'   → "1,234.50" — locale-formatted, N
 *                              decimals (default 0).
 *
 * Robustness:
 *   • non-numeric inputs (null, undefined, '', strings that aren't
 *     numbers) pass through unchanged — better than coercing to NaN
 *     and showing nothing.
 *   • unrecognised format strings pass through unchanged.
 */
export function formatDisplayValue(
  value: unknown,
  format: string | null | undefined,
): unknown {
  if (!format || typeof format !== 'string') return value;
  if (value === null || value === undefined || value === '') return value;

  const trimmed = format.trim().toLowerCase();
  if (!trimmed) return value;

  // Pull a trailing ":N" decimals modifier off the format string.
  const [kind, decimalsRaw] = trimmed.split(':');
  const decimals = decimalsRaw == null ? null : Number(decimalsRaw);
  const validDecimals = decimals != null && Number.isFinite(decimals) && decimals >= 0 && decimals <= 10;

  // Coerce to number — accept either an actual number or a numeric
  // string (formula engine returns numbers; ad-hoc text fields might
  // round-trip values as strings).
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return value;

  switch (kind) {
    case 'percent': {
      const dp = validDecimals ? Math.floor(decimals!) : 2;
      // Input is treated as already-percent — formula engine's
      // PERCENT() helper emits 0..100 values, and admins routinely
      // multiply by 100 in their formulas (`x/y * 100`). Doubling
      // again here would give "100% as 10000%", confusing every-
      // body. So just .toFixed and append the sign.
      return `${num.toFixed(dp)}%`;
    }
    case 'currency': {
      const dp = validDecimals ? Math.floor(decimals!) : 0;
      const abs = Math.abs(num);
      const formatted = abs.toLocaleString('en-GB', {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      });
      return num < 0 ? `(£${formatted})` : `£${formatted}`;
    }
    case 'number': {
      const dp = validDecimals ? Math.floor(decimals!) : 0;
      return num.toLocaleString('en-GB', {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      });
    }
    default:
      return value;
  }
}

/**
 * Catalog of admin-pickable display formats for the AppendixTemplateEditor
 * dropdown. Order matters — most-used presets first.
 */
export const DISPLAY_FORMAT_OPTIONS: Array<{ value: string; label: string; example: string }> = [
  { value: '',            label: 'Raw value (no formatting)',     example: '0.343' },
  { value: 'percent',     label: 'Percent — 2 decimals',          example: '0.34%' },
  { value: 'percent:0',   label: 'Percent — 0 decimals',          example: '0%' },
  { value: 'percent:1',   label: 'Percent — 1 decimal',           example: '0.3%' },
  { value: 'percent:3',   label: 'Percent — 3 decimals',          example: '0.343%' },
  { value: 'percent:4',   label: 'Percent — 4 decimals',          example: '0.3430%' },
  { value: 'currency',    label: 'Currency £ — 0 decimals',       example: '£1,234' },
  { value: 'currency:2',  label: 'Currency £ — 2 decimals',       example: '£1,234.50' },
  { value: 'number',      label: 'Number — 0 decimals',           example: '1,234' },
  { value: 'number:1',    label: 'Number — 1 decimal',            example: '1,234.5' },
  { value: 'number:2',    label: 'Number — 2 decimals',           example: '1,234.50' },
];
