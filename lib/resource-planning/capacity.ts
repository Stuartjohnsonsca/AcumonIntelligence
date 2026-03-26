// ─── Capacity Calculations for Resource Planning ─────────────────────

import type { StaffMember, Allocation, StaffCapacity } from './types';
import { countOverlapWorkingDays } from './date-utils';

/** Compute capacity for all staff over a date range */
export function computeStaffCapacity(
  staff: StaffMember[],
  allocations: Allocation[],
  rangeStart: Date,
  rangeEnd: Date,
): StaffCapacity[] {
  return staff.map((s) => {
    const weeklyHrs = s.resourceSetting?.weeklyCapacityHrs ?? 37.5;
    const overtimeHrs = s.resourceSetting?.overtimeHrs ?? 0;
    const dailyHrs = (weeklyHrs + overtimeHrs) / 5;

    // Count working days in range
    const workingDays = countWorkingDaysInRange(rangeStart, rangeEnd);
    const totalHrs = workingDays * dailyHrs;

    // Sum allocated hours
    const userAllocs = allocations.filter((a) => a.userId === s.id);
    let allocatedHrs = 0;
    const engagementIds = new Set<string>();

    for (const alloc of userAllocs) {
      const overlapDays = countOverlapWorkingDays(
        rangeStart,
        rangeEnd,
        new Date(alloc.startDate),
        new Date(alloc.endDate),
      );
      allocatedHrs += overlapDays * alloc.hoursPerDay;
      engagementIds.add(alloc.engagementId);
    }

    return {
      userId: s.id,
      name: s.name,
      totalHrs: Math.round(totalHrs * 10) / 10,
      allocatedHrs: Math.round(allocatedHrs * 10) / 10,
      netHrs: Math.round((totalHrs - allocatedHrs) * 10) / 10,
      jobCount: engagementIds.size,
    };
  });
}

function countWorkingDaysInRange(start: Date, end: Date): number {
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

/** Check if adding an allocation would exceed concurrent job limit */
export function checkConcurrentJobLimit(
  userId: string,
  existingAllocations: Allocation[],
  newStartDate: Date,
  newEndDate: Date,
  concurrentJobLimit: number,
  excludeAllocationId?: string,
): { ok: boolean; currentCount: number } {
  const overlapping = existingAllocations.filter((a) => {
    if (a.userId !== userId) return false;
    if (excludeAllocationId && a.id === excludeAllocationId) return false;
    const aStart = new Date(a.startDate);
    const aEnd = new Date(a.endDate);
    return aStart <= newEndDate && aEnd >= newStartDate;
  });

  const uniqueEngagements = new Set(overlapping.map((a) => a.engagementId));
  return {
    ok: uniqueEngagements.size < concurrentJobLimit,
    currentCount: uniqueEngagements.size,
  };
}
