/**
 * Keyword matching utilities for suspicious journal description scanning.
 */
/**
 * Builds a reusable matcher function that returns all keywords found
 * (case-insensitive substring match) in the given text.
 */
export declare function buildKeywordMatcher(keywords: string[]): (text: string) => string[];
/**
 * Extensive default list of suspicious keywords for journal entry descriptions.
 * These cover fraud indicators, override language, and low-quality descriptions.
 */
export declare const DEFAULT_SUSPICIOUS_KEYWORDS: string[];
//# sourceMappingURL=keywords.d.ts.map