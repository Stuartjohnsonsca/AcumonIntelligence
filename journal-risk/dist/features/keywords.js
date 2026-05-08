"use strict";
/**
 * Keyword matching utilities for suspicious journal description scanning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SUSPICIOUS_KEYWORDS = void 0;
exports.buildKeywordMatcher = buildKeywordMatcher;
/**
 * Builds a reusable matcher function that returns all keywords found
 * (case-insensitive substring match) in the given text.
 */
function buildKeywordMatcher(keywords) {
    const lowerKeywords = keywords.map((kw) => ({ original: kw, lower: kw.toLowerCase() }));
    return (text) => {
        if (!text)
            return [];
        const lowerText = text.toLowerCase();
        return lowerKeywords
            .filter(({ lower }) => lowerText.includes(lower))
            .map(({ original }) => original);
    };
}
/**
 * Extensive default list of suspicious keywords for journal entry descriptions.
 * These cover fraud indicators, override language, and low-quality descriptions.
 */
exports.DEFAULT_SUSPICIOUS_KEYWORDS = [
    // Management / authority
    'director',
    'ceo',
    'cfo',
    'board',
    'chairman',
    'senior management',
    // Adjustments and corrections
    'adjustment',
    'true-up',
    'true up',
    'error',
    'correction',
    'correcting',
    'write off',
    'write-off',
    'writeoff',
    'reclassification',
    'reclass',
    // Override / manual
    'manual',
    'override',
    'overridden',
    'force',
    'forced',
    'bypass',
    'exception',
    // Reversal language
    'reverse',
    'reversal',
    'void',
    'cancel',
    'cancelled',
    'canceled',
    // Instruction / authority language
    'requested by',
    'as instructed',
    'as directed',
    'per instruction',
    'per request',
    'as per',
    // Red-flag / fraud language
    'off the books',
    'cover',
    'cover up',
    'coverup',
    'illegal',
    'nobody will find out',
    'grey area',
    'gray area',
    'do not volunteer information',
    'not ethical',
    'unethical',
    'hide',
    'hidden',
    'conceal',
    'disguise',
    'fictitious',
    'fabricated',
    'inflate',
    'deflate',
    'manipulate',
    'misstate',
    'misrepresent',
    'off balance sheet',
    'side agreement',
    'kickback',
    'bribe',
    'personal expense',
    'bonus accrual',
    'cookie jar',
    'channel stuffing',
    'round trip',
    'swap',
    'wash',
    'plug',
    'plugged',
    'squeeze',
    'smooth',
    'smoothing',
    // Urgency / pressure
    'urgent',
    'immediately',
    'do not question',
    'confidential',
    'secret',
    'no audit trail',
    // Timing
    'year end',
    'year-end',
    'quarter end',
    'quarter-end',
    'period end',
    'close',
    'closing',
];
//# sourceMappingURL=keywords.js.map