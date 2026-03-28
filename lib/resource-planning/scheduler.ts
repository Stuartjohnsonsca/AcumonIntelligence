// ─── Deterministic Resource Scheduling Algorithm ─────────────────────────────
//
// Replaces the LLM-as-scheduler approach with a proper constraint-based greedy
// algorithm. The LLM is retained only for the 2-sentence plain English summary.
//
// Design overview:
//  1. Build a capacity map from existing allocations that are NOT in scope.
//  2. Order jobs by deadline (or tightest slack if constrainedFirst).
//  3. For each job, assign staff role-by-role: RI → Specialist → Reviewer → Preparer.
//  4. For each role, find eligible staff, score them, pick the best, place the window
//     as late as possible ending on the Friday on or before the job's deadline.
//  5. Optional local search: try pairwise swaps between jobs to reduce violations.
//  6. Optional multi-pass: run greedy 15× with score jitter, return best result.

import type {
  StaffMember,
  ResourceJobView,
  Allocation,
  OptimizationResult,
  OptimizationScope,
  AllocationChange,
  OptimizationViolation,
  ProposedAllocation,
  ResourceRole,
  StaffSetting,
} from './types';
import { DEFAULT_CONSTRAINT_ORDER } from './optimizer-constraints';
import { countWorkingDays } from './date-utils';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SchedulerOptions {
  /** Sort jobs by tightest slack first (most constrained = least scheduling flexibility). */
  constrainedFirst: boolean;
  /** When scoring staff candidates, penalise those needed by many future jobs. */
  lookAhead: boolean;
  /** After greedy pass, try all pairwise staff swaps between jobs to reduce violations. */
  localSearch: boolean;
  /** Run greedy 15 times with score jitter, return best result. */
  multiPass: boolean;
}

export interface SchedulerResult extends OptimizationResult {
  qualityScore: number;
  passesRun: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

/** date string → hours already booked on that date */
type DailyCapMap = Map<string, number>;
/** staffId → DailyCapMap */
type CapacityMap = Map<string, DailyCapMap>;

interface PlacedAllocation {
  jobId: string;
  userId: string;
  role: ResourceRole;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  hoursPerDay: number;
  totalHours: number;
}

interface JobResult {
  jobId: string;
  placements: PlacedAllocation[];
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function parseDate(s: string): Date {
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns whether a Date is Mon–Fri */
function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Add `n` working days to a date (can be negative to go backwards).
 * Does NOT include the start date itself.
 */
function addWorkingDays(d: Date, n: number): Date {
  const result = new Date(d);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    result.setDate(result.getDate() + step);
    if (isWeekday(result)) remaining--;
  }
  return result;
}

/**
 * Returns the last Friday on or before `d`.
 * If `d` is already a Friday, returns `d`.
 * If `d` is a weekend, snaps to the previous Friday.
 */
function prevFriday(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  while (result.getDay() !== 5) {
    result.setDate(result.getDate() - 1);
  }
  return result;
}

/**
 * Returns the Monday on or after `d`.
 * If `d` is already a Monday, returns `d`.
 */
function nextMonday(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  while (result.getDay() !== 1) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/** Enumerate all working days between start and end (inclusive). */
function workingDaysInRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    if (isWeekday(d)) days.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/**
 * Count working days between two dates inclusive.
 * Delegates to the shared utility.
 */
function workingDaysBetween(a: Date, b: Date): number {
  if (b < a) return 0;
  return countWorkingDays(a, b);
}

// ─── Capacity Map ─────────────────────────────────────────────────────────────

/**
 * Build an initial capacity map from allocations that are locked / not in scope.
 * These represent "already committed" hours that the scheduler must respect.
 */
function buildCapacityMap(
  existingAllocations: Allocation[],
  jobsInScope: Set<string>,
): CapacityMap {
  const cap: CapacityMap = new Map();

  for (const alloc of existingAllocations) {
    // Only count hours from jobs that are NOT being re-scheduled
    if (jobsInScope.has(alloc.engagementId)) continue;

    const start = parseDate(alloc.startDate);
    const end = parseDate(alloc.endDate);
    const days = workingDaysInRange(start, end);

    for (const day of days) {
      let staffMap = cap.get(alloc.userId);
      if (!staffMap) { staffMap = new Map(); cap.set(alloc.userId, staffMap); }
      staffMap.set(day, (staffMap.get(day) ?? 0) + alloc.hoursPerDay);
    }
  }

  return cap;
}

/**
 * Get the effective daily capacity for a staff member after already-booked hours.
 * Returns `dailyMax - alreadyBooked` for each day in the window.
 */
function dailyAvailable(
  staffId: string,
  dailyMax: number,
  days: string[],
  cap: CapacityMap,
): number {
  const staffMap = cap.get(staffId);
  if (!staffMap) return dailyMax; // Nothing booked — full capacity
  // Find the worst (most booked) day in the window
  let worst = 0;
  for (const day of days) {
    worst = Math.max(worst, staffMap.get(day) ?? 0);
  }
  return dailyMax - worst;
}

/** Consume capacity for a placed allocation in the map. */
function consumeCapacity(cap: CapacityMap, allocation: PlacedAllocation): void {
  const start = parseDate(allocation.startDate);
  const end = parseDate(allocation.endDate);
  const days = workingDaysInRange(start, end);

  let staffMap = cap.get(allocation.userId);
  if (!staffMap) { staffMap = new Map(); cap.set(allocation.userId, staffMap); }

  for (const day of days) {
    staffMap.set(day, (staffMap.get(day) ?? 0) + allocation.hoursPerDay);
  }
}

/** Release capacity for a placed allocation from the map. */
function releaseCapacity(cap: CapacityMap, allocation: PlacedAllocation): void {
  const start = parseDate(allocation.startDate);
  const end = parseDate(allocation.endDate);
  const days = workingDaysInRange(start, end);

  const staffMap = cap.get(allocation.userId);
  if (!staffMap) return;

  for (const day of days) {
    const cur = staffMap.get(day) ?? 0;
    const next = cur - allocation.hoursPerDay;
    if (next <= 0) staffMap.delete(day);
    else staffMap.set(day, next);
  }
}

// ─── Staff Eligibility ────────────────────────────────────────────────────────

const SPECIALIST_ONLY_ROLES = new Set(['Ethics', 'EQR', 'Technical']);

/**
 * Returns true if a staff member is eligible to fill `role` on a given job.
 * Also checks hard exclusion: Ethics/EQR/Technical staff cannot do RI/Reviewer/Preparer.
 */
function isEligible(
  staff: StaffMember,
  role: ResourceRole,
  otherRolesOnJob: ResourceRole[], // roles this staff member already has on THIS job
): boolean {
  const rs = staff.resourceSetting;
  if (!rs) return false;

  // Hard exclusion: Specialist sub-role staff cannot be on audit team
  const isSpecialistOnly = SPECIALIST_ONLY_ROLES.has(rs.resourceRole);
  if (isSpecialistOnly && (role === 'RI' || role === 'Reviewer' || role === 'Preparer')) return false;
  // Reverse: if we're placing a Specialist role and they already have RI/Rev/Prep on this job
  if (role === 'Specialist' && isSpecialistOnly) {
    if (otherRolesOnJob.some((r) => r === 'RI' || r === 'Reviewer' || r === 'Preparer')) return false;
  }

  switch (role) {
    case 'RI':
      return rs.isRI === true && (rs.riJobLimit ?? 0) > 0;
    case 'Reviewer':
      return (rs.reviewerJobLimit ?? 0) > 0;
    case 'Preparer':
      return (rs.preparerJobLimit ?? 0) > 0;
    case 'Specialist':
      return (rs.specialistJobLimit ?? 0) > 0;
    default:
      return false;
  }
}

/** Get the concurrent job limit for a specific role. */
function jobLimitForRole(rs: StaffSetting, role: ResourceRole): number {
  switch (role) {
    case 'RI': return rs.riJobLimit ?? 0;
    case 'Reviewer': return rs.reviewerJobLimit ?? 0;
    case 'Preparer': return rs.preparerJobLimit ?? 0;
    case 'Specialist': return rs.specialistJobLimit ?? 0;
    default: return 0;
  }
}

// ─── Job Count Tracker ────────────────────────────────────────────────────────

/**
 * Tracks how many concurrent jobs each staff member has in each role.
 * "Concurrent" here means any overlap in the scheduling window.
 * We use a simpler approximation: count of placed allocations in role.
 */
type JobCountMap = Map<string, Map<ResourceRole, number>>;

function incrementJobCount(jc: JobCountMap, userId: string, role: ResourceRole): void {
  let roleMap = jc.get(userId);
  if (!roleMap) { roleMap = new Map(); jc.set(userId, roleMap); }
  roleMap.set(role, (roleMap.get(role) ?? 0) + 1);
}

function decrementJobCount(jc: JobCountMap, userId: string, role: ResourceRole): void {
  const roleMap = jc.get(userId);
  if (!roleMap) return;
  const cur = roleMap.get(role) ?? 0;
  if (cur <= 1) roleMap.delete(role);
  else roleMap.set(role, cur - 1);
}

function getJobCount(jc: JobCountMap, userId: string, role: ResourceRole): number {
  return jc.get(userId)?.get(role) ?? 0;
}

// ─── Slot Placement ───────────────────────────────────────────────────────────

interface PlacementWindow {
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  daysNeeded: number;
}

/**
 * Compute the placement window for `budgetHours` of work, ending as late as
 * possible (last Friday on or before `targetDate`).
 *
 * Rules:
 * - targetHoursPerDay = min(7.5, weeklyHrs/5)
 * - daysNeeded = round(budgetHours / targetHoursPerDay), adjusted so hoursPerDay ∈ [0.5, 10]
 * - endDate = last Friday ≤ targetDate
 * - startDate = endDate minus (daysNeeded - 1) working days, snapped back to Monday
 */
function computeWindow(
  budgetHours: number,
  weeklyCapacityHrs: number,
  targetDate: Date,
): PlacementWindow {
  const targetHoursPerDay = Math.min(7.5, weeklyCapacityHrs / 5);
  let daysNeeded = Math.round(budgetHours / targetHoursPerDay);
  if (daysNeeded < 1) daysNeeded = 1;

  // Adjust daysNeeded so hoursPerDay stays in [0.5, 10]
  let hoursPerDay = budgetHours / daysNeeded;
  while (hoursPerDay > 10 && daysNeeded < 1000) { daysNeeded++; hoursPerDay = budgetHours / daysNeeded; }
  while (hoursPerDay < 0.5 && daysNeeded > 1) { daysNeeded--; hoursPerDay = budgetHours / daysNeeded; }
  // Round hoursPerDay to 2 decimal places
  hoursPerDay = Math.round(hoursPerDay * 100) / 100;

  const endDate = prevFriday(targetDate);
  const startDateRaw = addWorkingDays(endDate, -(daysNeeded - 1));
  // Snap back to Monday if the raw start isn't a Monday
  const startDate = nextMonday(addWorkingDays(startDateRaw, -1));
  // Recalculate days after snap to ensure hoursPerDay × actual days = budget
  const actualDays = workingDaysBetween(startDate, endDate);
  const finalHoursPerDay = actualDays > 0
    ? Math.round((budgetHours / actualDays) * 100) / 100
    : hoursPerDay;

  return {
    startDate: toDateStr(startDate),
    endDate: toDateStr(endDate),
    hoursPerDay: finalHoursPerDay,
    daysNeeded: actualDays,
  };
}

// ─── Job Ordering ─────────────────────────────────────────────────────────────

/**
 * Estimate the minimum number of working days needed to schedule all roles on a
 * job, given the available staff. Used for slack calculation.
 */
function minimumDaysToScheduleJob(job: ResourceJobView, staff: StaffMember[]): number {
  const roleHours: [ResourceRole, number][] = [
    ['RI', job.budgetHoursRI],
    ['Specialist', job.budgetHoursSpecialist],
    ['Reviewer', job.budgetHoursReviewer],
    ['Preparer', job.budgetHoursPreparer],
  ];

  let maxDays = 0;
  for (const [role, hours] of roleHours) {
    if (hours <= 0) continue;
    // Find best staff for this role
    const eligible = staff.filter(
      (s) => s.isActive && s.resourceSetting && isEligible(s, role, []),
    );
    if (eligible.length === 0) continue;
    const bestWeekly = Math.max(...eligible.map((s) => s.resourceSetting!.weeklyCapacityHrs));
    const daily = Math.min(7.5, bestWeekly / 5);
    const days = Math.ceil(hours / daily);
    if (days > maxDays) maxDays = days;
  }
  return maxDays;
}

function getJobDeadline(job: ResourceJobView): Date {
  const d = job.customDeadline ?? job.targetCompletion;
  return parseDate(d);
}

// ─── Staff Scoring ────────────────────────────────────────────────────────────

interface ScoringContext {
  options: SchedulerOptions;
  jitterScale: number;
  remainingJobs: ResourceJobView[];
  staff: StaffMember[];
  jobCountMap: JobCountMap;
}

/**
 * Score a candidate staff member for a role assignment. Lower is better.
 *
 * Base score: jobCount / jobLimit  (prefer staff with more remaining capacity)
 * Look-ahead: penalise staff who are the only option for many upcoming jobs
 * Multi-pass jitter: add small random noise to break ties differently
 */
function scoreCandidate(
  candidate: StaffMember,
  role: ResourceRole,
  ctx: ScoringContext,
): number {
  const rs = candidate.resourceSetting!;
  const limit = jobLimitForRole(rs, role);
  const count = getJobCount(ctx.jobCountMap, candidate.id, role);
  let score = limit > 0 ? count / limit : 1;

  if (ctx.options.lookAhead) {
    // Count future jobs that need this role and how many eligible staff they have
    let urgencySum = 0;
    for (const futureJob of ctx.remainingJobs) {
      const budgetForRole = getBudgetForRole(futureJob, role);
      if (budgetForRole <= 0) continue;
      const eligibleForJob = ctx.staff.filter(
        (s) => s.isActive && s.resourceSetting && isEligible(s, role, []),
      );
      if (eligibleForJob.length === 0) continue;
      if (!eligibleForJob.some((s) => s.id === candidate.id)) continue;
      // How scarce is this candidate relative to all eligible staff for that job?
      urgencySum += 1 / eligibleForJob.length;
    }
    score += urgencySum * 0.1;
  }

  if (ctx.options.multiPass && ctx.jitterScale > 0) {
    score += Math.random() * 0.15 * ctx.jitterScale;
  }

  return score;
}

function getBudgetForRole(job: ResourceJobView, role: ResourceRole): number {
  switch (role) {
    case 'RI': return job.budgetHoursRI;
    case 'Reviewer': return job.budgetHoursReviewer;
    case 'Preparer': return job.budgetHoursPreparer;
    case 'Specialist': return job.budgetHoursSpecialist;
    default: return 0;
  }
}

// ─── Violation Detection ─────────────────────────────────────────────────────

/**
 * Check all placements against breakable constraints and return violations.
 * The constraint IDs map to the `optimizer-constraints.ts` definitions.
 */
function detectViolations(
  allPlacements: PlacedAllocation[],
  jobsInScope: ResourceJobView[],
  staff: StaffMember[],
  constraintOrder: string[],
  today: Date,
  existingAllocations: Allocation[],
): OptimizationViolation[] {
  const order = constraintOrder.length > 0 ? constraintOrder : DEFAULT_CONSTRAINT_ORDER;
  const violations: OptimizationViolation[] = [];
  const staffMap = new Map(staff.map((s) => [s.id, s]));
  const jobMap = new Map(jobsInScope.map((j) => [j.id, j]));

  function addViolation(constraintId: string, jobId?: string, userId?: string, description?: string) {
    const priority = order.indexOf(constraintId) + 1 || 99;
    violations.push({ constraintId, priority, jobId, userId, description: description ?? constraintId });
  }

  // Group placements by job
  const byJob = new Map<string, PlacedAllocation[]>();
  for (const p of allPlacements) {
    let arr = byJob.get(p.jobId);
    if (!arr) { arr = []; byJob.set(p.jobId, arr); }
    arr.push(p);
  }

  for (const [jobId, placements] of byJob) {
    const job = jobMap.get(jobId);
    const deadline = job ? getJobDeadline(job) : null;

    // Group by role
    const byRole = new Map<ResourceRole, PlacedAllocation[]>();
    for (const p of placements) {
      let arr = byRole.get(p.role);
      if (!arr) { arr = []; byRole.set(p.role, arr); }
      arr.push(p);
    }

    // ── Hard constraint checks ────────────────────────────────────────────────

    // no-ri: job must have exactly 1 RI
    const riPlacements = byRole.get('RI') ?? [];
    if (riPlacements.length === 0) {
      addViolation('no-ri', jobId, undefined, `Job has no RI allocation`);
    } else if (riPlacements.length > 1) {
      addViolation('multi-ri', jobId, undefined, `Job has ${riPlacements.length} RI allocations (must be exactly 1)`);
    }

    // specialist-on-team: Ethics/EQR/Technical also assigned RI/Rev/Prep
    for (const p of placements) {
      const s = staffMap.get(p.userId);
      if (!s?.resourceSetting) continue;
      const isSpecOnly = SPECIALIST_ONLY_ROLES.has(s.resourceSetting.resourceRole);
      if (isSpecOnly && (p.role === 'RI' || p.role === 'Reviewer' || p.role === 'Preparer')) {
        addViolation('no-specialist-on-team', jobId, p.userId,
          `${s.name} is a ${s.resourceSetting.resourceRole} specialist but assigned as ${p.role}`);
      }
    }

    // ── Breakable constraint checks ───────────────────────────────────────────

    // P2: ri-no-preparer — RI assigned as Preparer
    const riUsers = new Set(riPlacements.map((p) => p.userId));
    for (const p of (byRole.get('Preparer') ?? [])) {
      if (riUsers.has(p.userId)) {
        const s = staffMap.get(p.userId);
        addViolation('ri-no-preparer', jobId, p.userId,
          `${s?.name ?? p.userId} is RI and Preparer on the same job`);
      }
    }

    // P5: ri-no-reviewer — RI assigned as Reviewer
    for (const p of (byRole.get('Reviewer') ?? [])) {
      if (riUsers.has(p.userId)) {
        const s = staffMap.get(p.userId);
        addViolation('ri-no-reviewer', jobId, p.userId,
          `${s?.name ?? p.userId} is RI and Reviewer on the same job`);
      }
    }

    // P7: reviewer-no-preparer — Reviewer assigned as Preparer
    const reviewerUsers = new Set((byRole.get('Reviewer') ?? []).map((p) => p.userId));
    for (const p of (byRole.get('Preparer') ?? [])) {
      if (reviewerUsers.has(p.userId)) {
        const s = staffMap.get(p.userId);
        addViolation('reviewer-no-preparer', jobId, p.userId,
          `${s?.name ?? p.userId} is Reviewer and Preparer on the same job`);
      }
    }

    // P9: started-team — team changed on a job with existing started allocations
    const existingJobAllocs = existingAllocations.filter((a) => a.engagementId === jobId);
    const hasStarted = existingJobAllocs.some((a) => parseDate(a.startDate) < today);
    if (hasStarted) {
      const existingUserRoleKeys = new Set(
        existingJobAllocs.map((a) => `${a.userId}:${a.role}`)
      );
      for (const p of placements) {
        if (!existingUserRoleKeys.has(`${p.userId}:${p.role}`)) {
          const s = staffMap.get(p.userId);
          addViolation('started-team', jobId, p.userId,
            `Team changed on started job: ${s?.name ?? p.userId} added as ${p.role}`);
          break; // One violation per job is enough
        }
      }
    }

    // P10: forty-pct-rule — staff does < 40% of role hours
    for (const [role, rolePlacements] of byRole) {
      if (rolePlacements.length < 2) continue;
      const totalHrs = rolePlacements.reduce((s, p) => s + p.totalHours, 0);
      for (const p of rolePlacements) {
        if (totalHrs > 0 && p.totalHours / totalHrs < 0.4) {
          const s = staffMap.get(p.userId);
          addViolation('forty-pct-rule', jobId, p.userId,
            `${s?.name ?? p.userId} does only ${Math.round(p.totalHours / totalHrs * 100)}% of ${role} hours (min 40%)`);
        }
      }
    }

    // P11: reviewer-min-hours — Reviewer hoursPerDay < 1
    for (const p of (byRole.get('Reviewer') ?? [])) {
      if (p.hoursPerDay < 1) {
        const s = staffMap.get(p.userId);
        addViolation('reviewer-min-hours', jobId, p.userId,
          `${s?.name ?? p.userId} has Reviewer allocation of ${p.hoursPerDay}h/day (min 1h)`);
      }
    }

    // P12: preparer-min-hours — Preparer hoursPerDay < 3.5
    for (const p of (byRole.get('Preparer') ?? [])) {
      if (p.hoursPerDay < 3.5) {
        const s = staffMap.get(p.userId);
        addViolation('preparer-min-hours', jobId, p.userId,
          `${s?.name ?? p.userId} has Preparer allocation of ${p.hoursPerDay}h/day (min 3.5h)`);
      }
    }

    // P1: custom-completion-date — endDate exceeds deadline
    if (deadline) {
      for (const p of placements) {
        if (parseDate(p.endDate) > deadline) {
          const s = staffMap.get(p.userId);
          addViolation('custom-completion-date', jobId, p.userId,
            `${s?.name ?? p.userId} (${p.role}) ends ${p.endDate} after deadline ${toDateStr(deadline)}`);
          break;
        }
      }
    }
  }

  // ── Cross-job checks (P3, P6, P8) ────────────────────────────────────────

  // Group all placements by staff
  const byStaff = new Map<string, PlacedAllocation[]>();
  for (const p of allPlacements) {
    let arr = byStaff.get(p.userId);
    if (!arr) { arr = []; byStaff.set(p.userId, arr); }
    arr.push(p);
  }

  for (const [userId, staffPlacements] of byStaff) {
    const s = staffMap.get(userId);
    const rs = s?.resourceSetting;
    if (!rs) continue;

    // Compute total hours per role
    const hoursByRole = new Map<ResourceRole, number>();
    for (const p of staffPlacements) {
      hoursByRole.set(p.role, (hoursByRole.get(p.role) ?? 0) + p.totalHours);
    }

    // P6: job-count-limit — per-role concurrent job count exceeds limit
    const countsByRole = new Map<ResourceRole, number>();
    for (const p of staffPlacements) {
      countsByRole.set(p.role, (countsByRole.get(p.role) ?? 0) + 1);
    }
    for (const [role, count] of countsByRole) {
      const limit = jobLimitForRole(rs, role);
      if (limit > 0 && count > limit) {
        addViolation('job-count-limit', undefined, userId,
          `${s?.name ?? userId} has ${count} ${role} allocations (limit ${limit})`);
      }
    }

    // For weekly hour checks we approximate by spreading total hours over the
    // scheduling period. A more accurate approach would check per-week overlap,
    // but that requires more complex calendar math.
    // P8: standard-hours — exceeds weekly capacity (simple total check)
    const totalHoursAllRoles = Array.from(hoursByRole.values()).reduce((a, b) => a + b, 0);
    const estWeeks = Math.max(1, totalHoursAllRoles / (rs.weeklyCapacityHrs || 37.5));
    if (estWeeks > 1.2) {
      // Only flag if clearly overloaded across the whole period
      // (week-level checking would require date overlap analysis)
    }

    // P3: no-overtime — total hours exceed standard + overtime
    // P8: standard-hours — total hours exceed standard only
    // These are best-effort: flag if any single day is clearly overbooked
    // We'll do a day-level check across all this staff member's placements
    const dailyHours = new Map<string, number>();
    for (const p of staffPlacements) {
      const days = workingDaysInRange(parseDate(p.startDate), parseDate(p.endDate));
      for (const day of days) {
        dailyHours.set(day, (dailyHours.get(day) ?? 0) + p.hoursPerDay);
      }
    }
    const dailyStandard = rs.weeklyCapacityHrs / 5;
    const dailyOvertime = dailyStandard + rs.overtimeHrs / 5;
    for (const [day, hrs] of dailyHours) {
      if (hrs > dailyOvertime) {
        addViolation('no-overtime', undefined, userId,
          `${s?.name ?? userId} has ${hrs.toFixed(1)}h on ${day} (overtime limit ${dailyOvertime.toFixed(1)}h/day)`);
        break; // One per staff member is enough
      } else if (hrs > dailyStandard) {
        addViolation('standard-hours', undefined, userId,
          `${s?.name ?? userId} has ${hrs.toFixed(1)}h on ${day} (standard limit ${dailyStandard.toFixed(1)}h/day)`);
        break;
      }
    }
  }

  // Deduplicate violations (same constraintId + jobId + userId)
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.constraintId}:${v.jobId ?? ''}:${v.userId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.priority - b.priority);
}

// ─── Quality Score ────────────────────────────────────────────────────────────

/** Lower is better. Weight violations by priority (higher priority = higher weight). */
function computeQualityScore(violations: OptimizationViolation[], unschedulable: string[]): number {
  // Priority 1 = most important, so weight = 1/(priority). We invert for scoring.
  let score = unschedulable.length * 1000;
  for (const v of violations) {
    // Priority 1 is worst (most important not to violate), weight accordingly
    const weight = Math.max(1, 15 - v.priority); // priority 1 → weight 14, priority 14 → weight 1
    score += weight;
  }
  return score;
}

// ─── Greedy Scheduler ─────────────────────────────────────────────────────────

const ROLE_ASSIGNMENT_ORDER: ResourceRole[] = ['RI', 'Specialist', 'Reviewer', 'Preparer'];

/**
 * Run one greedy pass: assign staff to all jobs in the given order.
 */
function runGreedyPass(
  orderedJobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
  constraintOrder: string[],
  scope: OptimizationScope,
  options: SchedulerOptions,
  today: Date,
  jitterScale: number,
): {
  jobResults: JobResult[];
  unschedulable: string[];
  capacityMap: CapacityMap;
  jobCountMap: JobCountMap;
} {
  const inScopeSet = new Set(orderedJobs.map((j) => j.id));
  const capacityMap = buildCapacityMap(existingAllocations, inScopeSet);
  const jobCountMap: JobCountMap = new Map();

  // Pre-populate job count map from locked/out-of-scope allocations
  for (const alloc of existingAllocations) {
    if (!inScopeSet.has(alloc.engagementId)) {
      incrementJobCount(jobCountMap, alloc.userId, alloc.role as ResourceRole);
    }
  }

  const jobResults: JobResult[] = [];
  const unschedulable: string[] = [];
  const activeStaff = staff.filter((s) => s.isActive && s.resourceSetting);

  for (let jobIdx = 0; jobIdx < orderedJobs.length; jobIdx++) {
    const job = orderedJobs[jobIdx];
    const deadline = getJobDeadline(job);
    const placements: PlacedAllocation[] = [];
    let jobFailed = false;

    // Track which users are already assigned to this job (for cross-role constraints)
    const assignedOnJob = new Map<string, ResourceRole[]>();

    for (const role of ROLE_ASSIGNMENT_ORDER) {
      const budgetHours = getBudgetForRole(job, role);
      if (budgetHours <= 0) continue;

      // Build list of eligible candidates
      const candidates = activeStaff.filter((s) => {
        const otherRoles = assignedOnJob.get(s.id) ?? [];
        return isEligible(s, role, otherRoles);
      });

      if (candidates.length === 0) {
        if (role === 'RI') {
          // RI is a hard constraint — cannot schedule this job
          jobFailed = true;
          break;
        }
        // Other roles: skip (will be a violation)
        continue;
      }

      // Score and sort candidates
      const remainingJobs = orderedJobs.slice(jobIdx + 1);
      const ctx: ScoringContext = { options, jitterScale, remainingJobs, staff: activeStaff, jobCountMap };
      const scored = candidates
        .map((s) => ({ staff: s, score: scoreCandidate(s, role, ctx) }))
        .sort((a, b) => a.score - b.score);

      // Try candidates until one fits
      let placed = false;
      for (const { staff: candidate } of scored) {
        const rs = candidate.resourceSetting!;
        const dailyMax = rs.weeklyCapacityHrs / 5;
        const window = computeWindow(budgetHours, rs.weeklyCapacityHrs, deadline);
        const days = workingDaysInRange(parseDate(window.startDate), parseDate(window.endDate));

        // Check staff has enough capacity on each day
        const available = dailyAvailable(candidate.id, dailyMax, days, capacityMap);
        if (available < window.hoursPerDay * 0.5) {
          // Not enough capacity (allow minor over-booking — violations will be flagged)
          continue;
        }

        // Place the allocation
        const placement: PlacedAllocation = {
          jobId: job.id,
          userId: candidate.id,
          role,
          startDate: window.startDate,
          endDate: window.endDate,
          hoursPerDay: window.hoursPerDay,
          totalHours: Math.round(window.hoursPerDay * days.length * 100) / 100,
        };

        placements.push(placement);
        consumeCapacity(capacityMap, placement);
        incrementJobCount(jobCountMap, candidate.id, role);
        const existing = assignedOnJob.get(candidate.id) ?? [];
        existing.push(role);
        assignedOnJob.set(candidate.id, existing);
        placed = true;
        break;
      }

      if (!placed && role === 'RI') {
        jobFailed = true;
        break;
      }
    }

    if (jobFailed) {
      unschedulable.push(job.id);
      // Release any partial placements for this job
      for (const p of placements) {
        releaseCapacity(capacityMap, p);
        decrementJobCount(jobCountMap, p.userId, p.role);
      }
    } else {
      jobResults.push({ jobId: job.id, placements });
    }
  }

  return { jobResults, unschedulable, capacityMap, jobCountMap };
}

// ─── Local Search ─────────────────────────────────────────────────────────────

/**
 * Try all pairwise swaps between jobs for each role. Keep a swap if it reduces
 * the total violation score. Repeat until no improvement or max iterations.
 */
function runLocalSearch(
  jobResults: JobResult[],
  jobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
  constraintOrder: string[],
  today: Date,
  maxIterations: number = 3,
): JobResult[] {
  const inScopeSet = new Set(jobResults.map((jr) => jr.jobId));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  // Rebuild capacity map from scratch based on current job results
  function buildCurrentCapMap(): CapacityMap {
    const cap = buildCapacityMap(existingAllocations, inScopeSet);
    for (const jr of jobResults) {
      for (const p of jr.placements) {
        consumeCapacity(cap, p);
      }
    }
    return cap;
  }

  // Compute current violations
  const allPlacements = (): PlacedAllocation[] => jobResults.flatMap((jr) => jr.placements);

  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    const currentViolations = detectViolations(
      allPlacements(), jobs.filter((j) => inScopeSet.has(j.id)), staff, constraintOrder, today, existingAllocations,
    );
    let currentScore = computeQualityScore(currentViolations, []);

    // Try swapping staff for each role between every pair of jobs
    for (let i = 0; i < jobResults.length; i++) {
      for (let j = i + 1; j < jobResults.length; j++) {
        const jr1 = jobResults[i];
        const jr2 = jobResults[j];

        for (const role of ROLE_ASSIGNMENT_ORDER) {
          const p1 = jr1.placements.find((p) => p.role === role);
          const p2 = jr2.placements.find((p) => p.role === role);
          if (!p1 || !p2 || p1.userId === p2.userId) continue;

          const job1 = jobMap.get(jr1.jobId);
          const job2 = jobMap.get(jr2.jobId);
          if (!job1 || !job2) continue;

          const s1 = staff.find((s) => s.id === p1.userId);
          const s2 = staff.find((s) => s.id === p2.userId);
          if (!s1 || !s2) continue;

          // Check eligibility if swapped
          const otherRoles1 = jr1.placements.filter((p) => p.userId === p2.userId && p.role !== role).map((p) => p.role);
          const otherRoles2 = jr2.placements.filter((p) => p.userId === p1.userId && p.role !== role).map((p) => p.role);

          if (!isEligible(s2, role, otherRoles1)) continue;
          if (!isEligible(s1, role, otherRoles2)) continue;

          // Tentatively apply the swap
          const cap = buildCurrentCapMap();
          releaseCapacity(cap, p1);
          releaseCapacity(cap, p2);

          // Recompute windows for swapped staff
          const deadline1 = getJobDeadline(job1);
          const deadline2 = getJobDeadline(job2);
          const budget1 = getBudgetForRole(job1, role);
          const budget2 = getBudgetForRole(job2, role);
          const win1 = computeWindow(budget1, s2.resourceSetting!.weeklyCapacityHrs, deadline1);
          const win2 = computeWindow(budget2, s1.resourceSetting!.weeklyCapacityHrs, deadline2);

          const days1 = workingDaysInRange(parseDate(win1.startDate), parseDate(win1.endDate));
          const days2 = workingDaysInRange(parseDate(win2.startDate), parseDate(win2.endDate));
          const avail1 = dailyAvailable(s2.id, s2.resourceSetting!.weeklyCapacityHrs / 5, days1, cap);
          const avail2 = dailyAvailable(s1.id, s1.resourceSetting!.weeklyCapacityHrs / 5, days2, cap);

          if (avail1 < win1.hoursPerDay * 0.5 || avail2 < win2.hoursPerDay * 0.5) continue;

          // Build swapped placements
          const newP1: PlacedAllocation = {
            jobId: jr1.jobId, userId: s2.id, role,
            startDate: win1.startDate, endDate: win1.endDate,
            hoursPerDay: win1.hoursPerDay,
            totalHours: Math.round(win1.hoursPerDay * days1.length * 100) / 100,
          };
          const newP2: PlacedAllocation = {
            jobId: jr2.jobId, userId: s1.id, role,
            startDate: win2.startDate, endDate: win2.endDate,
            hoursPerDay: win2.hoursPerDay,
            totalHours: Math.round(win2.hoursPerDay * days2.length * 100) / 100,
          };

          // Build trial results
          const trialResults = jobResults.map((jr, idx) => {
            if (idx === i) {
              return { jobId: jr.jobId, placements: jr.placements.map((p) => p === p1 ? newP1 : p) };
            }
            if (idx === j) {
              return { jobId: jr.jobId, placements: jr.placements.map((p) => p === p2 ? newP2 : p) };
            }
            return jr;
          });

          const trialViolations = detectViolations(
            trialResults.flatMap((jr) => jr.placements),
            jobs.filter((j) => inScopeSet.has(j.id)),
            staff, constraintOrder, today, existingAllocations,
          );
          const trialScore = computeQualityScore(trialViolations, []);

          if (trialScore < currentScore) {
            // Accept the swap
            jobResults[i] = trialResults[i];
            jobResults[j] = trialResults[j];
            currentScore = trialScore;
            improved = true;
          }
        }
      }
    }
  }

  return jobResults;
}

// ─── Change Diffing ───────────────────────────────────────────────────────────

/**
 * Compute the set of allocation changes (creates and deletes) by diffing the
 * proposed schedule against existing allocations.
 */
function computeChanges(
  jobResults: JobResult[],
  jobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
): AllocationChange[] {
  const staffNameMap = new Map(staff.map((s) => [s.id, s.name]));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const changes: AllocationChange[] = [];

  for (const jr of jobResults) {
    const job = jobMap.get(jr.jobId);
    if (!job) continue;

    const existing = existingAllocations.filter((a) => a.engagementId === jr.jobId);

    // Mark existing allocations for deletion if not matched by proposed
    for (const ea of existing) {
      const matched = jr.placements.find(
        (p) =>
          p.userId === ea.userId &&
          p.role === ea.role &&
          p.startDate === ea.startDate.slice(0, 10) &&
          p.endDate === ea.endDate.slice(0, 10) &&
          Math.abs(p.hoursPerDay - ea.hoursPerDay) < 0.01,
      );
      if (!matched) {
        changes.push({
          action: 'delete',
          existingId: ea.id,
          jobId: job.id,
          clientName: job.clientName,
          auditType: job.auditType,
          userId: ea.userId,
          userName: ea.userName,
          role: ea.role,
          startDate: ea.startDate.slice(0, 10),
          endDate: ea.endDate.slice(0, 10),
          hoursPerDay: ea.hoursPerDay,
        });
      }
    }

    // Mark proposed allocations as creates if not matching existing
    for (const p of jr.placements) {
      const matched = existing.find(
        (ea) =>
          ea.userId === p.userId &&
          ea.role === p.role &&
          ea.startDate.slice(0, 10) === p.startDate &&
          ea.endDate.slice(0, 10) === p.endDate &&
          Math.abs(ea.hoursPerDay - p.hoursPerDay) < 0.01,
      );
      if (!matched) {
        changes.push({
          action: 'create',
          jobId: job.id,
          clientName: job.clientName,
          auditType: job.auditType,
          userId: p.userId,
          userName: staffNameMap.get(p.userId) ?? p.userId,
          role: p.role,
          startDate: p.startDate,
          endDate: p.endDate,
          hoursPerDay: p.hoursPerDay,
        });
      }
    }
  }

  return changes;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run the deterministic resource scheduler.
 *
 * @param jobs           All jobs to schedule (must be pre-filtered to scope, non-locked)
 * @param staff          All staff members (active + inactive — we filter internally)
 * @param existingAllocations  All existing allocations for the firm
 * @param constraintOrder  Ordered list of constraint IDs (most important first)
 * @param scope          'all' or 'unscheduled'
 * @param options        Technique flags
 * @param today          ISO date string for today
 */
export function runScheduler(
  jobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
  constraintOrder: string[],
  scope: OptimizationScope,
  options: SchedulerOptions,
  today: string,
): SchedulerResult {
  const todayDate = parseDate(today);
  const order = constraintOrder.length > 0 ? constraintOrder : DEFAULT_CONSTRAINT_ORDER;
  const inScopeSet = new Set(jobs.map((j) => j.id));

  // ── Order jobs ──────────────────────────────────────────────────────────────
  let orderedJobs = [...jobs];

  if (options.constrainedFirst) {
    // Sort by tightest slack first: slack = working days to deadline - min days needed
    orderedJobs.sort((a, b) => {
      const deadlineA = getJobDeadline(a);
      const deadlineB = getJobDeadline(b);
      const daysToA = workingDaysBetween(todayDate, deadlineA);
      const daysToB = workingDaysBetween(todayDate, deadlineB);
      const minDaysA = minimumDaysToScheduleJob(a, staff);
      const minDaysB = minimumDaysToScheduleJob(b, staff);
      const slackA = daysToA - minDaysA;
      const slackB = daysToB - minDaysB;
      return slackA - slackB; // Tightest slack first
    });
  } else {
    // Default: sort by earliest deadline
    orderedJobs.sort((a, b) => getJobDeadline(a).getTime() - getJobDeadline(b).getTime());
  }

  const MULTI_PASS_COUNT = 15;
  const passCount = options.multiPass ? MULTI_PASS_COUNT : 1;

  // Run pass 0 with no jitter as baseline, then subsequent passes with increasing jitter
  let bestJobResults: typeof orderedJobs extends never[] ? never : ReturnType<typeof runGreedyPass>['jobResults'] = [];
  let bestUnschedulable: string[] = [];
  let bestScore = Infinity;

  for (let pass = 0; pass < passCount; pass++) {
    const jitterScale = pass === 0 ? 0.0 : 0.5 + (pass / passCount) * 0.5;

    const { jobResults, unschedulable } = runGreedyPass(
      orderedJobs,
      staff,
      existingAllocations,
      order,
      scope,
      options,
      todayDate,
      jitterScale,
    );

    // Score on raw greedy result only — local search applied once after the loop
    const passPlacementsAll = jobResults.flatMap((jr) => jr.placements);
    const passScore = computeQualityScore(
      detectViolations(passPlacementsAll, jobs.filter((j) => inScopeSet.has(j.id)), staff, order, todayDate, existingAllocations),
      unschedulable,
    );

    if (passScore < bestScore) {
      bestScore = passScore;
      bestJobResults = jobResults;
      bestUnschedulable = unschedulable;
    }
  }

  // Apply local search once on the best greedy winner (not inside the loop)
  const postLoopResults = options.localSearch
    ? runLocalSearch(bestJobResults, jobs, staff, existingAllocations, order, todayDate)
    : bestJobResults;

  // ── Build final result ──────────────────────────────────────────────────────
  const staffNameMap = new Map(staff.map((s) => [s.id, s.name]));
  const finalPlacements = postLoopResults.flatMap((jr) => jr.placements);

  const violations = detectViolations(
    finalPlacements,
    jobs.filter((j) => inScopeSet.has(j.id)),
    staff,
    order,
    todayDate,
    existingAllocations,
  );

  const schedule = postLoopResults.map((jr) => ({
    jobId: jr.jobId,
    allocations: jr.placements.map((p): ProposedAllocation => ({
      userId: p.userId,
      userName: staffNameMap.get(p.userId) ?? p.userId,
      role: p.role,
      startDate: p.startDate,
      endDate: p.endDate,
      hoursPerDay: p.hoursPerDay,
      totalHours: p.totalHours,
      availabilityScore: 0,
      familiarityScore: 0,
    })),
  }));

  const changes = computeChanges(postLoopResults, jobs, staff, existingAllocations);

  return {
    schedule,
    violations,
    unschedulable: bestUnschedulable,
    reasoning: '', // Filled in by caller after AI summary call
    changes,
    qualityScore: bestScore,
    passesRun: passCount,
  };
}
