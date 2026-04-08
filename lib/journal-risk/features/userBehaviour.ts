/**
 * User-level analytics for journal risk scoring.
 */

import type { JournalRecord, UserRecord } from '../types';
import { computePercentile } from './stats';

/**
 * Counts how many journals each user has posted (by preparedByUserId).
 */
export function computeUserPostingFrequency(
  journals: JournalRecord[],
): Map<string, number> {
  const freq = new Map<string, number>();

  for (const j of journals) {
    freq.set(j.preparedByUserId, (freq.get(j.preparedByUserId) ?? 0) + 1);
  }

  return freq;
}

/**
 * Computes the percentile rank for each user based on their posting count.
 * A user who posts very few journals will have a low percentile (near 0).
 * A user who posts the most will be near 100.
 */
export function computeUserPercentiles(
  frequency: Map<string, number>,
): Map<string, number> {
  const percentiles = new Map<string, number>();
  const allCounts = Array.from(frequency.values());

  for (const [userId, count] of frequency) {
    percentiles.set(userId, computePercentile(allCounts, count));
  }

  return percentiles;
}

/**
 * Identifies user IDs whose role title partially matches any of the senior roles
 * (case-insensitive). For example, if seniorRoles includes "director",
 * a user with roleTitle "Finance Director" would be matched.
 */
export function identifySeniorUsers(
  users: Map<string, UserRecord>,
  seniorRoles: string[],
): Set<string> {
  const result = new Set<string>();
  const lowerRoles = seniorRoles.map((r) => r.toLowerCase());

  for (const [userId, user] of users) {
    const lowerTitle = user.roleTitle.toLowerCase();
    const isSenior = lowerRoles.some((role) => lowerTitle.includes(role));
    if (isSenior) {
      result.add(userId);
    }
  }

  return result;
}
