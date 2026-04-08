/**
 * Account-level analytics for journal risk scoring.
 */

import type { JournalRecord } from '../types';

/**
 * Counts how many journals each account appears in (as either debit or credit).
 * Each journal contributes at most 1 to each account it touches.
 */
export function computeAccountFrequency(
  journals: JournalRecord[],
): Map<string, number> {
  const freq = new Map<string, number>();

  for (const j of journals) {
    // Count each account once per journal even if debit === credit
    const accounts = new Set<string>();
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
export function computePairFrequency(
  journals: JournalRecord[],
): Map<string, number> {
  const freq = new Map<string, number>();

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
export function getSeldomAccounts(
  frequency: Map<string, number>,
  threshold: number = 2,
): Set<string> {
  const result = new Set<string>();

  for (const [accountId, count] of frequency) {
    if (count <= threshold) {
      result.add(accountId);
    }
  }

  return result;
}
