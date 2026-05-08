/**
 * Deterministic derived feature functions for journal risk scoring.
 * Each function computes a single boolean or structured result from journal fields.
 */

/**
 * True if the journal was posted after the period end date.
 */
export function isPostClose(postedAt: string, periodEndDate: string): boolean {
  const posted = new Date(postedAt);
  const end = new Date(periodEndDate);
  // Compare date portions only — strip time by using UTC date strings
  const postedDate = new Date(posted.getUTCFullYear(), posted.getUTCMonth(), posted.getUTCDate());
  const endDate = new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return postedDate.getTime() > endDate.getTime();
}

/**
 * True if postedAt falls within `windowDays` days before periodEndDate (inclusive).
 * e.g. windowDays=5 means the 5 calendar days up to and including periodEndDate.
 */
export function isPeriodEndWindow(
  postedAt: string,
  periodEndDate: string,
  windowDays: number,
): boolean {
  const posted = new Date(postedAt);
  const end = new Date(periodEndDate);
  const postedDate = new Date(posted.getUTCFullYear(), posted.getUTCMonth(), posted.getUTCDate());
  const endDate = new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  const windowStart = new Date(endDate);
  windowStart.setDate(windowStart.getDate() - windowDays);

  return postedDate.getTime() > windowStart.getTime() && postedDate.getTime() <= endDate.getTime();
}

/**
 * True if the posting time falls outside business hours.
 * Uses a simple approach: extracts the hour/minute from the ISO string directly.
 * The timezone param is accepted for future use but the current implementation
 * works with the UTC hour embedded in the ISO string.
 */
export function isOutsideBusinessHours(
  postedAt: string,
  _timezone: string,
  businessHours: { start: string; end: string },
): boolean {
  const date = new Date(postedAt);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const timeMinutes = hour * 60 + minute;

  const [startH, startM] = businessHours.start.split(':').map(Number);
  const [endH, endM] = businessHours.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return timeMinutes < startMinutes || timeMinutes >= endMinutes;
}

/**
 * True if the absolute amount is >= 100 and ends in 000 or 00.
 * i.e. the number is a "round" amount — multiples of 100 at minimum.
 */
export function isRoundNumber(amount: number): boolean {
  const abs = Math.abs(amount);
  if (abs < 100) return false;
  return abs % 100 === 0;
}

const LOW_INFO_PATTERNS = /^(n\/a|adj|reclass|tbc|xxx|na|nil)$/i;

/**
 * True if the description is null, empty, very short (< 8 chars),
 * or matches common low-information filler text.
 */
export function isEmptyOrLowInfo(description: string | null): boolean {
  if (description === null || description === undefined) return true;
  const trimmed = description.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 8) return true;
  if (LOW_INFO_PATTERNS.test(trimmed)) return true;
  return false;
}

/**
 * Case-insensitive substring scan for suspicious keywords in a description.
 */
export function containsSuspiciousKeywords(
  description: string | null,
  keywords: string[],
): { found: boolean; matchedKeywords: string[] } {
  if (!description) return { found: false, matchedKeywords: [] };
  const lower = description.toLowerCase();
  const matched = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return { found: matched.length > 0, matchedKeywords: matched };
}

/**
 * True if the preparer and approver are the same person.
 */
export function isSameAsApprover(
  preparedBy: string,
  approvedBy: string | null,
): boolean {
  if (!approvedBy) return false;
  return preparedBy === approvedBy;
}

/**
 * True if the user's posting percentile is below the 5th percentile,
 * indicating they rarely post journals.
 */
export function isAtypicalPoster(
  userId: string,
  percentiles: Map<string, number>,
): boolean {
  const pct = percentiles.get(userId);
  if (pct === undefined) return true; // unknown user treated as atypical
  return pct < 5;
}

/**
 * True if the account has 2 or fewer postings in the population.
 */
export function isSeldomUsedAccount(
  accountId: string,
  frequency: Map<string, number>,
): boolean {
  const count = frequency.get(accountId);
  if (count === undefined) return true; // unknown account treated as seldom
  return count <= 2;
}

/**
 * True if the debit-credit account pair appears only once or not at all.
 * Key format: "debitId|creditId"
 */
export function isUnusualAccountPair(
  debitId: string,
  creditId: string,
  pairFrequency: Map<string, number>,
): boolean {
  const key = `${debitId}|${creditId}`;
  const count = pairFrequency.get(key);
  if (count === undefined) return true;
  return count <= 1;
}
