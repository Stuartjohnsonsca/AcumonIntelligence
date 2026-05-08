"use strict";
/**
 * Account-level analytics for journal risk scoring.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAccountFrequency = computeAccountFrequency;
exports.computePairFrequency = computePairFrequency;
exports.getSeldomAccounts = getSeldomAccounts;
/**
 * Counts how many journals each account appears in (as either debit or credit).
 * Each journal contributes at most 1 to each account it touches.
 */
function computeAccountFrequency(journals) {
    const freq = new Map();
    for (const j of journals) {
        // Count each account once per journal even if debit === credit
        const accounts = new Set();
        accounts.add(j.debitAccountId);
        accounts.add(j.creditAccountId);
        for (const acct of accounts) {
            freq.set(acct, (freq.get(acct) ?? 0) + 1);
        }
    }
    return freq;
}
/**
 * Counts frequency of debit-credit account pair combinations.
 * Key format: "debitAccountId|creditAccountId"
 */
function computePairFrequency(journals) {
    const freq = new Map();
    for (const j of journals) {
        const key = `${j.debitAccountId}|${j.creditAccountId}`;
        freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    return freq;
}
/**
 * Returns the set of account IDs with frequency at or below the threshold.
 * Default threshold is 2 (accounts appearing in 2 or fewer journals).
 */
function getSeldomAccounts(frequency, threshold = 2) {
    const result = new Set();
    for (const [accountId, count] of frequency) {
        if (count <= threshold) {
            result.add(accountId);
        }
    }
    return result;
}
//# sourceMappingURL=accountUsage.js.map