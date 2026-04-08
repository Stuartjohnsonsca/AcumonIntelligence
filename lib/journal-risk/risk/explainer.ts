import type { JournalRiskResult } from '../types';

/**
 * Build a human-readable rationale for a selected journal.
 * Deduplicates driver names and joins with semicolons.
 *
 * Example: "Selected because: post-close journal; senior management poster; suspicious keywords."
 */
export function composeSelectionRationale(result: JournalRiskResult): string {
  if (result.drivers.length === 0) {
    return 'Selected (no specific risk drivers identified).';
  }

  const seen = new Set<string>();
  const reasons: string[] = [];

  for (const driver of result.drivers) {
    const key = driver.ruleId;
    if (seen.has(key)) continue;
    seen.add(key);
    // Convert rule name to lowercase for natural reading
    reasons.push(driver.ruleName.toLowerCase());
  }

  return `Selected because: ${reasons.join('; ')}.`;
}

/**
 * Build a human-readable rationale for a journal that was not selected.
 *
 * Example: "Not selected. Risk score: 25 (low)."
 */
export function composeNotSelectedRationale(result: JournalRiskResult): string {
  return `Not selected. Risk score: ${result.riskScore} (${result.riskBand}).`;
}
