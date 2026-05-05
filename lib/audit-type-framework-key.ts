/**
 * Composite-key helpers for the (Audit Type, Framework) pair used by
 * the firm's Audit Type Configuration.
 *
 * Encoded into `MethodologyTemplate.auditType` as `<auditType>::<framework>`
 * so we get pair-keyed schedule mappings without changing the table's
 * unique constraint. The separator `::` is deliberately not a valid
 * character in either an audit-type code or a framework name, so the
 * round-trip parse is unambiguous.
 *
 * Special row `__framework_options` is preserved unchanged — it stores
 * the firm's list of framework options, not a per-pair mapping.
 */

export const PAIR_SEPARATOR = '::' as const;
export const FRAMEWORK_OPTIONS_KEY = '__framework_options' as const;
export const DEFAULT_FRAMEWORK = 'FRS102' as const;

/** Build the composite `auditType` value for a (pair) row. */
export function pairKey(auditType: string, framework: string): string {
  return `${auditType}${PAIR_SEPARATOR}${framework || DEFAULT_FRAMEWORK}`;
}

/** Parse a composite `auditType` back into its parts. Returns null for
 *  the framework-options row and for any input that doesn't carry the
 *  separator (so legacy bare-auditType rows are handled by callers). */
export function parsePairKey(raw: string): { auditType: string; framework: string } | null {
  if (raw === FRAMEWORK_OPTIONS_KEY) return null;
  const idx = raw.indexOf(PAIR_SEPARATOR);
  if (idx === -1) return null;
  const auditType = raw.slice(0, idx);
  const framework = raw.slice(idx + PAIR_SEPARATOR.length);
  if (!auditType || !framework) return null;
  return { auditType, framework };
}

/** True when the raw value is the special framework-options sentinel. */
export function isFrameworkOptionsKey(raw: string): boolean {
  return raw === FRAMEWORK_OPTIONS_KEY;
}
