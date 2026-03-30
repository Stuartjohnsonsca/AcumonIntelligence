// ─── Date Utilities for Resource Planning ────────────────────────────

/** Count working days (Mon-Fri) between two dates inclusive */
export function countWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Count overlapping working days between two date ranges */
export function countOverlapWorkingDays(
  rangeStart: Date,
  rangeEnd: Date,
  allocStart: Date,
  allocEnd: Date,
): number {
  const overlapStart = new Date(Math.max(rangeStart.getTime(), allocStart.getTime()));
  const overlapEnd = new Date(Math.min(rangeEnd.getTime(), allocEnd.getTime()));
  if (overlapStart > overlapEnd) return 0;
  return countWorkingDays(overlapStart, overlapEnd);
}

/** Get the Monday of the week containing a given date */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Generate an array of week-start (Monday) dates in a range */
export function getWeeksInRange(start: Date, end: Date): Date[] {
  const weeks: Date[] = [];
  const current = getWeekStart(new Date(start));
  const endDate = new Date(end);
  while (current <= endDate) {
    weeks.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

/** Generate an array of dates (each day) in a range */
export function getDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  while (current <= endDate) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

/** Format date as "DD Mon" */
export function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

/** Format date as "W/C DD Mon" */
export function formatWeekLabel(date: Date): string {
  return `W/C ${formatShortDate(date)}`;
}

/** Check if a date is a weekday */
export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/** Check if two dates are the same day */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Get a date range: today +/- weeks */
export function getDefaultDateRange(weeksBefore: number = 2, weeksAfter: number = 12): { start: Date; end: Date } {
  const now = new Date();
  const start = getWeekStart(now);
  start.setDate(start.getDate() - weeksBefore * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + (weeksBefore + weeksAfter) * 7 - 1);
  return { start, end };
}

/** Check if an allocation overlaps with a date range */
export function allocationOverlaps(allocStart: string, allocEnd: string, rangeStart: Date, rangeEnd: Date): boolean {
  const aStart = new Date(allocStart);
  const aEnd = new Date(allocEnd);
  return aStart <= rangeEnd && aEnd >= rangeStart;
}

/**
 * Compute per-week flex weights for focus-mode rendering.
 *
 * ALL weeks inside the focus window (expandedWeekIdx … expandedWeekIdx+focusWindowWeeks-1)
 * receive equal weight `BASE_FLEX`.  Weeks outside decay by 0.65 per step from the
 * nearest edge of the focus window, flooring at MIN_FLEX.
 *
 * Used by DateBar, AllocationBar, and StaffAvailabilityRow — they must all call this
 * with identical arguments so bars stay pixel-aligned with date-column headers.
 */
export function computeWeekFlexWeights(
  weekCount: number,
  expandedWeekIdx: number | null,
  focusWindowWeeks: number,
): number[] {
  if (expandedWeekIdx === null) return Array(weekCount).fill(1);

  const BASE_FLEX = 5;   // each focus-window week gets this weight
  const MIN_FLEX  = 0.35; // floor for extreme-end weeks
  const DECAY     = 0.65; // multiplier per step outside the window

  return Array.from({ length: weekCount }, (_, i) => {
    // Inside the focus window → full weight
    if (i >= expandedWeekIdx && i < expandedWeekIdx + focusWindowWeeks) {
      return BASE_FLEX;
    }
    // Outside → decay from the nearest window edge
    const dist = i < expandedWeekIdx
      ? expandedWeekIdx - i
      : i - (expandedWeekIdx + focusWindowWeeks - 1);
    return Math.max(MIN_FLEX, Math.pow(DECAY, dist) * BASE_FLEX);
  });
}
