/**
 * Account-level analytics for journal risk scoring.
 */
import type { JournalRecord } from '../types';
/**
 * Counts how many journals each account appears in (as either debit or credit).
 * Each journal contributes at most 1 to each account it touches.
 */
export declare function computeAccountFrequency(journals: JournalRecord[]): Map<string, number>;
/**
 * Counts frequency of debit-credit account pair combinations.
 * Key format: "debitAccountId|creditAccountId"
 */
export declare function computePairFrequency(journals: JournalRecord[]): Map<string, number>;
/**
 * Returns the set of account IDs with frequency at or below the threshold.
 * Default threshold is 2 (accounts appearing in 2 or fewer journals).
 */
export declare function getSeldomAccounts(frequency: Map<string, number>, threshold?: number): Set<string>;
//# sourceMappingURL=accountUsage.d.ts.map