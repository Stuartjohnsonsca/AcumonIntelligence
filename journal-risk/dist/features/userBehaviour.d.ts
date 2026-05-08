/**
 * User-level analytics for journal risk scoring.
 */
import type { JournalRecord, UserRecord } from '../types';
/**
 * Counts how many journals each user has posted (by preparedByUserId).
 */
export declare function computeUserPostingFrequency(journals: JournalRecord[]): Map<string, number>;
/**
 * Computes the percentile rank for each user based on their posting count.
 * A user who posts very few journals will have a low percentile (near 0).
 * A user who posts the most will be near 100.
 */
export declare function computeUserPercentiles(frequency: Map<string, number>): Map<string, number>;
/**
 * Identifies user IDs whose role title partially matches any of the senior roles
 * (case-insensitive). For example, if seniorRoles includes "director",
 * a user with roleTitle "Finance Director" would be matched.
 */
export declare function identifySeniorUsers(users: Map<string, UserRecord>, seniorRoles: string[]): Set<string>;
//# sourceMappingURL=userBehaviour.d.ts.map