import type { JournalRiskResult } from '../types';
/**
 * Build a human-readable rationale for a selected journal.
 * Deduplicates driver names and joins with semicolons.
 *
 * Example: "Selected because: post-close journal; senior management poster; suspicious keywords."
 */
export declare function composeSelectionRationale(result: JournalRiskResult): string;
/**
 * Build a human-readable rationale for a journal that was not selected.
 *
 * Example: "Not selected. Risk score: 25 (low)."
 */
export declare function composeNotSelectedRationale(result: JournalRiskResult): string;
//# sourceMappingURL=explainer.d.ts.map