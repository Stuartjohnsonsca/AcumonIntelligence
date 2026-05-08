/**
 * Deterministic derived feature functions for journal risk scoring.
 * Each function computes a single boolean or structured result from journal fields.
 */
/**
 * True if the journal was posted after the period end date.
 */
export declare function isPostClose(postedAt: string, periodEndDate: string): boolean;
/**
 * True if postedAt falls within `windowDays` days before periodEndDate (inclusive).
 * e.g. windowDays=5 means the 5 calendar days up to and including periodEndDate.
 */
export declare function isPeriodEndWindow(postedAt: string, periodEndDate: string, windowDays: number): boolean;
/**
 * True if the posting time falls outside business hours.
 * Uses a simple approach: extracts the hour/minute from the ISO string directly.
 * The timezone param is accepted for future use but the current implementation
 * works with the UTC hour embedded in the ISO string.
 */
export declare function isOutsideBusinessHours(postedAt: string, _timezone: string, businessHours: {
    start: string;
    end: string;
}): boolean;
/**
 * True if the absolute amount is >= 100 and ends in 000 or 00.
 * i.e. the number is a "round" amount — multiples of 100 at minimum.
 */
export declare function isRoundNumber(amount: number): boolean;
/**
 * True if the description is null, empty, very short (< 8 chars),
 * or matches common low-information filler text.
 */
export declare function isEmptyOrLowInfo(description: string | null): boolean;
/**
 * Case-insensitive substring scan for suspicious keywords in a description.
 */
export declare function containsSuspiciousKeywords(description: string | null, keywords: string[]): {
    found: boolean;
    matchedKeywords: string[];
};
/**
 * True if the preparer and approver are the same person.
 */
export declare function isSameAsApprover(preparedBy: string, approvedBy: string | null): boolean;
/**
 * True if the user's posting percentile is below the 5th percentile,
 * indicating they rarely post journals.
 */
export declare function isAtypicalPoster(userId: string, percentiles: Map<string, number>): boolean;
/**
 * True if the account has 2 or fewer postings in the population.
 */
export declare function isSeldomUsedAccount(accountId: string, frequency: Map<string, number>): boolean;
/**
 * True if the debit-credit account pair appears only once or not at all.
 * Key format: "debitId|creditId"
 */
export declare function isUnusualAccountPair(debitId: string, creditId: string, pairFrequency: Map<string, number>): boolean;
//# sourceMappingURL=derived.d.ts.map