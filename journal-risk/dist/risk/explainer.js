"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.composeSelectionRationale = composeSelectionRationale;
exports.composeNotSelectedRationale = composeNotSelectedRationale;
/**
 * Build a human-readable rationale for a selected journal.
 * Deduplicates driver names and joins with semicolons.
 *
 * Example: "Selected because: post-close journal; senior management poster; suspicious keywords."
 */
function composeSelectionRationale(result) {
    if (result.drivers.length === 0) {
        return 'Selected (no specific risk drivers identified).';
    }
    const seen = new Set();
    const reasons = [];
    for (const driver of result.drivers) {
        const key = driver.ruleId;
        if (seen.has(key))
            continue;
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
function composeNotSelectedRationale(result) {
    return `Not selected. Risk score: ${result.riskScore} (${result.riskBand}).`;
}
//# sourceMappingURL=explainer.js.map