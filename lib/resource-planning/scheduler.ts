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
  /**
   * Role-scarcity mode: jobs sorted by target completion date + profile presence,
   * then each role (RI → Specialist → Reviewer → Preparer) is allocated across
   * ALL jobs before moving to the next role. Ensures scarce senior roles are
   * distributed fairly by deadline rather than consumed job-by-job.
   */
  roleScarcity: boolean;
  /**
   * Simulated Annealing post-processing: run 800 iterations of probabilistic
   * search (T₀=15 → T_final=0.05) on the warm-start greedy result.
   * Escapes local optima that pairwise swaps cannot reach. Best for 40+ jobs.
   */
  combinatorial: boolean;
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

  // ── Role eligibility with graceful fallback ─────────────────────────────
  //
  // Many firms configure staff with only a primary resourceRole and the
  // legacy concurrentJobLimit — without setting per-role limits in admin.
  // The fallback rules below make the scheduler usable without needing
  // full per-role configuration:
  //
  //   RI:        isRI flag enables RI; riJobLimit defaults to 1 when unset.
  //   Reviewer:  reviewerJobLimit set → use it; else eligible if primary role
  //              is 'Reviewer' or 'RI' (defaulting to concurrentJobLimit).
  //   Preparer:  preparerJobLimit set → use it; else eligible if primary role
  //              is NOT a specialist-only or Reviewer-only type (default limit).
  //   Specialist: specialistJobLimit must be explicitly set (no fallback).

  switch (role) {
    case 'RI':
      // isRI flag OR resourceRole === 'RI' both qualify (admins often set the role
      // dropdown without separately ticking the isRI checkbox)
      if (!rs.isRI && rs.resourceRole !== 'RI') return false;
      // If no explicit limit, default to 1 concurrent RI job
      return (rs.riJobLimit ?? 1) > 0;

    case 'Reviewer':
      if (rs.reviewerJobLimit != null) return rs.reviewerJobLimit > 0;
      // Fallback: eligible if primary role is Reviewer or RI
      return (rs.resourceRole === 'Reviewer' || rs.resourceRole === 'RI') &&
             rs.concurrentJobLimit > 0;

    case 'Preparer':
      if (rs.preparerJobLimit != null) return rs.preparerJobLimit > 0;
      // Fallback: eligible if primary role is Preparer or Reviewer
      // (Reviewers can typically also prepare; exclude RI-only staff)
      return (rs.resourceRole === 'Preparer' || rs.resourceRole === 'Reviewer') &&
             rs.concurrentJobLimit > 0;

    case 'Specialist':
      if (rs.specialistJobLimit != null) return rs.specialistJobLimit > 0;
      // Fallback: eligible if primary role is a specialist type
      return rs.resourceRole === 'Specialist' && rs.concurrentJobLimit > 0;

    default:
      return false;
  }
}

/** Get the concurrent job limit for a specific role. */
function jobLimitForRole(rs: StaffSetting, role: ResourceRole): number {
  switch (role) {
    case 'RI':       return rs.riJobLimit ?? ((rs.isRI || rs.resourceRole === 'RI') ? 1 : 0);
    case 'Reviewer': return rs.reviewerJobLimit ??
                       ((rs.resourceRole === 'Reviewer' || rs.resourceRole === 'RI') ? rs.concurrentJobLimit : 0);
    case 'Preparer': return rs.preparerJobLimit ??
                       ((rs.resourceRole === 'Preparer' || rs.resourceRole === 'Reviewer') ? rs.concurrentJobLimit : 0);
    case 'Specialist': return rs.specialistJobLimit ??
                         (rs.resourceRole === 'Specialist' ? rs.concurrentJobLimit : 0);
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
  today: Date = new Date(),
): PlacementWindow {
  const safeCap = weeklyCapacityHrs > 0 ? weeklyCapacityHrs : 37.5; // fallback: standard full-time
  const targetHoursPerDay = Math.min(7.5, safeCap / 5);
  let daysNeeded = Math.round(budgetHours / targetHoursPerDay);
  if (daysNeeded < 1) daysNeeded = 1;

  // Adjust daysNeeded so hoursPerDay stays in [0.5, 10]
  let hoursPerDay = budgetHours / daysNeeded;
  while (hoursPerDay > 10 && daysNeeded < 1000) { daysNeeded++; hoursPerDay = budgetHours / daysNeeded; }
  while (hoursPerDay < 0.5 && daysNeeded > 1) { daysNeeded--; hoursPerDay = budgetHours / daysNeeded; }
  // Round hoursPerDay to 2 decimal places
  hoursPerDay = Math.round(hoursPerDay * 100) / 100;

  // If the deadline is already in the past, schedule as soon as possible starting
  // from today — work can't be placed in the past (it would never appear in the grid).
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const naturalEnd = prevFriday(targetDate);
  const endDate = naturalEnd < todayStart
    ? prevFriday(addWorkingDays(todayStart, daysNeeded + 4)) // push end to cover the work
    : naturalEnd;

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
  // constrainedFirst: window-congestion scoring
  capacityMap?: CapacityMap;
  currentJobDeadline?: Date;
  currentBudgetHours?: number;
  /** clientId:auditType:role → userIds who held that role previously */
  previousTeam?: Map<string, string[]>;
  /** today reference used to clamp past deadlines in computeWindow */
  today?: Date;
  /** clientId of the job currently being scored */
  currentJobClientId?: string;
  /** auditType of the job currently being scored */
  currentJobAuditType?: string;
}

/**
 * Score a candidate staff member for a role assignment. Lower is better.
 *
 * Base score:          jobCount / jobLimit  (prefer staff with more remaining capacity)
 * constrainedFirst:    window-congestion penalty — avoid staff already heavily booked
 *                      in the current job's scheduling window (reduces concurrent violations)
 * Look-ahead:          penalise staff who are the only option for many upcoming jobs
 * Multi-pass jitter:   add small random noise to break ties differently
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

  if (ctx.options.constrainedFirst && ctx.capacityMap && ctx.currentJobDeadline && ctx.currentBudgetHours && ctx.currentBudgetHours > 0 && rs.weeklyCapacityHrs > 0) {
    // Compute the window this candidate would occupy for this job.
    // Guard: weeklyCapacityHrs must be > 0 to avoid divide-by-zero in computeWindow.
    const win = computeWindow(ctx.currentBudgetHours, rs.weeklyCapacityHrs, ctx.currentJobDeadline, ctx.today);
    const days = workingDaysInRange(parseDate(win.startDate), parseDate(win.endDate));
    if (days.length > 0) {
      const dailyMax = rs.weeklyCapacityHrs / 5;
      const staffCap = ctx.capacityMap.get(candidate.id);
      let busyDays = 0;
      if (staffCap) {
        for (const d of days) {
          if ((staffCap.get(d) ?? 0) > dailyMax * 0.4) busyDays++;
        }
      }
      // Congestion fraction: 0 = fully free in window, 1 = fully booked
      score += (busyDays / days.length) * 0.6;
    }
  }

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

  // Continuity preference: strongly prefer staff who held this role on the
  // same client engagement last year (lower score = preferred).
  if (ctx.previousTeam && ctx.currentJobClientId && ctx.currentJobAuditType) {
    const key = `${ctx.currentJobClientId}:${ctx.currentJobAuditType}:${role}`.toLowerCase();
    const prev = ctx.previousTeam.get(key);
    if (prev && prev.includes(candidate.id)) {
      score -= 0.4; // significant preference without hard-locking
    }
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
  previousTeam: Map<string, string[]>,
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

    // team-continuity — different staff from last year on same engagement
    if (previousTeam.size > 0) {
      const job = jobMap.get(jobId);
      if (job) {
        for (const [role, rolePlacements] of byRole) {
          const key = `${job.clientId}:${job.auditType}:${role}`.toLowerCase();
          const prevUsers = previousTeam.get(key);
          if (!prevUsers || prevUsers.length === 0) continue;

          for (const p of rolePlacements) {
            if (prevUsers.includes(p.userId)) continue; // same person — no violation

            // Check if any previous team member is still active and eligible for this role
            // (if they're no longer eligible, their "title changed" — no violation)
            const prevStillEligible = prevUsers.some((prevUserId) => {
              const prevStaff = staffMap.get(prevUserId);
              if (!prevStaff || !prevStaff.isActive) return false;
              return isEligible(prevStaff, role as ResourceRole, []);
            });
            if (!prevStillEligible) continue;

            const s = staffMap.get(p.userId);
            const prevNames = prevUsers
              .map((uid) => staffMap.get(uid)?.name ?? uid)
              .join(', ');
            addViolation(
              'team-continuity',
              jobId,
              p.userId,
              `${s?.name ?? p.userId} replaces ${prevNames} as ${role} — team changed from last year`,
            );
            break; // one violation per role per job is enough
          }
        }
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
  previousTeam: Map<string, string[]>,
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
      const ctx: ScoringContext = {
        options, jitterScale, remainingJobs, staff: activeStaff, jobCountMap,
        capacityMap, currentJobDeadline: deadline, currentBudgetHours: budgetHours,
        previousTeam,
        currentJobClientId: job.clientId,
        currentJobAuditType: job.auditType,
      };
      const scored = candidates
        .map((s) => ({ staff: s, score: scoreCandidate(s, role, ctx) }))
        .sort((a, b) => a.score - b.score);

      // Try candidates until one fits; track least-overloaded as fallback.
      // If no candidate passes the soft capacity gate we still place the best
      // available one — overbooking violations will be flagged downstream.
      let placed = false;
      let fallbackCandidate: StaffMember | null = null;
      let fallbackWindow: PlacementWindow | null = null;
      let fallbackDays: string[] = [];
      let fallbackAvailable = -Infinity;

      for (const { staff: candidate } of scored) {
        const rs = candidate.resourceSetting!;
        const dailyMax = rs.weeklyCapacityHrs / 5;
        const window = computeWindow(budgetHours, rs.weeklyCapacityHrs, deadline, today);
        const days = workingDaysInRange(parseDate(window.startDate), parseDate(window.endDate));

        // Check staff has enough capacity on each day
        const available = dailyAvailable(candidate.id, dailyMax, days, capacityMap);

        // Remember the least-overloaded candidate in case everyone fails the gate
        if (available > fallbackAvailable) {
          fallbackAvailable = available;
          fallbackCandidate = candidate;
          fallbackWindow = window;
          fallbackDays = days;
        }

        if (available < window.hoursPerDay * 0.5) {
          // Not enough capacity — keep searching; will force-place below if needed
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

      // ── Force-place fallback ───────────────────────────────────────────────
      // No candidate passed the soft capacity gate but we still want the role
      // shown in the schedule (overbooking violations will surface in the UI).
      // For RI: also force-place so the job isn't silently dropped.
      if (!placed && fallbackCandidate && fallbackWindow) {
        const placement: PlacedAllocation = {
          jobId: job.id,
          userId: fallbackCandidate.id,
          role,
          startDate: fallbackWindow.startDate,
          endDate: fallbackWindow.endDate,
          hoursPerDay: fallbackWindow.hoursPerDay,
          totalHours: Math.round(fallbackWindow.hoursPerDay * fallbackDays.length * 100) / 100,
        };
        placements.push(placement);
        consumeCapacity(capacityMap, placement);
        incrementJobCount(jobCountMap, fallbackCandidate.id, role);
        const existing = assignedOnJob.get(fallbackCandidate.id) ?? [];
        existing.push(role);
        assignedOnJob.set(fallbackCandidate.id, existing);
        placed = true;
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

// ─── Role-Scarcity Pass ────────────────────────────────────────────────────────

/**
 * Role-scarcity scheduler: assign ONE role across ALL jobs before moving to
 * the next role.  Order: RI → Specialist → Reviewer → Preparer.
 * Jobs are sorted by target-completion date (ascending), with jobs that have an
 * explicit profile sorted before those without on the same deadline.
 *
 * This prevents a single role from being "used up" by the first jobs in a
 * deadline-ordered list — every job gets its senior roles filled before preparers
 * are distributed.
 */
function runRoleScarcityPass(
  orderedJobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
  constraintOrder: string[],
  scope: OptimizationScope,
  options: SchedulerOptions,
  today: Date,
  jitterScale: number,
  previousTeam: Map<string, string[]>,
): {
  jobResults: JobResult[];
  unschedulable: string[];
  capacityMap: CapacityMap;
  jobCountMap: JobCountMap;
} {
  // Sort by targetCompletion asc; jobs with a profile first on ties
  const sorted = [...orderedJobs].sort((a, b) => {
    const da = new Date(a.targetCompletion).getTime();
    const db = new Date(b.targetCompletion).getTime();
    if (da !== db) return da - db;
    return (a.jobProfileId ? 0 : 1) - (b.jobProfileId ? 0 : 1);
  });

  const inScopeSet = new Set(sorted.map((j) => j.id));
  const capacityMap = buildCapacityMap(existingAllocations, inScopeSet);
  const jobCountMap: JobCountMap = new Map();

  for (const alloc of existingAllocations) {
    if (!inScopeSet.has(alloc.engagementId)) {
      incrementJobCount(jobCountMap, alloc.userId, alloc.role as ResourceRole);
    }
  }

  const activeStaff = staff.filter((s) => s.isActive && s.resourceSetting);

  // Per-job state — persists across role passes
  const jobPlacementsMap = new Map<string, PlacedAllocation[]>();
  // jobId → userId → roles already assigned on that job (cross-role constraint)
  const assignedOnJob = new Map<string, Map<string, ResourceRole[]>>();
  const failedJobs = new Set<string>();

  for (const role of ROLE_ASSIGNMENT_ORDER) {
    for (let jobIdx = 0; jobIdx < sorted.length; jobIdx++) {
      const job = sorted[jobIdx];
      if (failedJobs.has(job.id)) continue;

      const budgetHours = getBudgetForRole(job, role);
      if (budgetHours <= 0) continue;

      const deadline = getJobDeadline(job);
      const jobRoleMap = assignedOnJob.get(job.id) ?? new Map<string, ResourceRole[]>();

      const candidates = activeStaff.filter((s) => {
        const otherRoles = jobRoleMap.get(s.id) ?? [];
        return isEligible(s, role, otherRoles);
      });

      if (candidates.length === 0) {
        if (role === 'RI') failedJobs.add(job.id);
        continue;
      }

      const ctx: ScoringContext = {
        options,
        jitterScale,
        remainingJobs: sorted.slice(jobIdx + 1),
        staff: activeStaff,
        jobCountMap,
        capacityMap,
        currentJobDeadline: deadline,
        currentBudgetHours: budgetHours,
        previousTeam,
        currentJobClientId: job.clientId,
        currentJobAuditType: job.auditType,
        today,
      };

      const scored = candidates
        .map((s) => ({ staff: s, score: scoreCandidate(s, role, ctx) }))
        .sort((a, b) => a.score - b.score);

      let placed = false;
      let fallbackCandidate: StaffMember | null = null;
      let fallbackWindow: PlacementWindow | null = null;
      let fallbackDays: string[] = [];
      let fallbackAvailable = -Infinity;

      for (const { staff: candidate } of scored) {
        const rs = candidate.resourceSetting!;
        const dailyMax = rs.weeklyCapacityHrs / 5;
        const window = computeWindow(budgetHours, rs.weeklyCapacityHrs, deadline, today);
        const days = workingDaysInRange(parseDate(window.startDate), parseDate(window.endDate));
        const available = dailyAvailable(candidate.id, dailyMax, days, capacityMap);

        if (available > fallbackAvailable) {
          fallbackAvailable = available;
          fallbackCandidate = candidate;
          fallbackWindow = window;
          fallbackDays = days;
        }

        if (available < window.hoursPerDay * 0.5) continue;

        const placement: PlacedAllocation = {
          jobId: job.id,
          userId: candidate.id,
          role,
          startDate: window.startDate,
          endDate: window.endDate,
          hoursPerDay: window.hoursPerDay,
          totalHours: Math.round(window.hoursPerDay * days.length * 100) / 100,
        };

        if (!jobPlacementsMap.has(job.id)) jobPlacementsMap.set(job.id, []);
        jobPlacementsMap.get(job.id)!.push(placement);
        consumeCapacity(capacityMap, placement);
        incrementJobCount(jobCountMap, candidate.id, role);

        const existing = jobRoleMap.get(candidate.id) ?? [];
        existing.push(role);
        jobRoleMap.set(candidate.id, existing);
        assignedOnJob.set(job.id, jobRoleMap);

        placed = true;
        break;
      }

      // Force-place if no candidate cleared the soft capacity gate
      if (!placed && fallbackCandidate && fallbackWindow) {
        const placement: PlacedAllocation = {
          jobId: job.id,
          userId: fallbackCandidate.id,
          role,
          startDate: fallbackWindow.startDate,
          endDate: fallbackWindow.endDate,
          hoursPerDay: fallbackWindow.hoursPerDay,
          totalHours: Math.round(fallbackWindow.hoursPerDay * fallbackDays.length * 100) / 100,
        };

        if (!jobPlacementsMap.has(job.id)) jobPlacementsMap.set(job.id, []);
        jobPlacementsMap.get(job.id)!.push(placement);
        consumeCapacity(capacityMap, placement);
        incrementJobCount(jobCountMap, fallbackCandidate.id, role);

        const existing = jobRoleMap.get(fallbackCandidate.id) ?? [];
        existing.push(role);
        jobRoleMap.set(fallbackCandidate.id, existing);
        assignedOnJob.set(job.id, jobRoleMap);
        placed = true;
      }

      if (!placed && role === 'RI') {
        failedJobs.add(job.id);
      }
    }
  }

  // Build results; release capacity for any job that had RI fail
  const jobResults: JobResult[] = [];
  const unschedulable: string[] = [];

  for (const job of sorted) {
    if (failedJobs.has(job.id)) {
      unschedulable.push(job.id);
      for (const p of (jobPlacementsMap.get(job.id) ?? [])) {
        releaseCapacity(capacityMap, p);
        decrementJobCount(jobCountMap, p.userId, p.role);
      }
    } else {
      jobResults.push({ jobId: job.id, placements: jobPlacementsMap.get(job.id) ?? [] });
    }
  }

  return { jobResults, unschedulable, capacityMap, jobCountMap };
}

// ─── Local Search ─────────────────────────────────────────────────────────────

/**
 * Violation-driven swap search.
 *
 * Three-gate system to minimise expensive detectViolations() calls:
 *
 * Gate 1 — Hot-job filter: only consider pairs where at least one job contains
 *   a staff member already named in a violation. Skips all non-violating pairs.
 *
 * Gate 2 — Congestion filter: release p1/p2 from the shared cap map then check
 *   whether at least one person would move to a LESS LOADED time window
 *   (measured by dailyAvailable in their current vs proposed window). Swapping
 *   two equally-busy windows never helps. This is O(days_in_window) — cheap.
 *
 * Gate 3 — Budget: hard cap of MAX_DETECT_CALLS per iteration so that in the
 *   worst case (many violations, many staff) the function still returns quickly.
 *
 * Only swaps that pass all three gates reach the expensive detectViolations().
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
  const MAX_DETECT_CALLS = 200; // hard ceiling per iteration

  const inScopeSet = new Set(jobResults.map((jr) => jr.jobId));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const jobsInScope = jobs.filter((j) => inScopeSet.has(j.id));

  function buildCurrentCapMap(): CapacityMap {
    const cap = buildCapacityMap(existingAllocations, inScopeSet);
    for (const jr of jobResults) {
      for (const p of jr.placements) { consumeCapacity(cap, p); }
    }
    return cap;
  }

  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    const cap = buildCurrentCapMap();
    const currentViolations = detectViolations(
      jobResults.flatMap((jr) => jr.placements), jobsInScope, staff, constraintOrder, today, existingAllocations, new Map(),
    );
    let currentScore = computeQualityScore(currentViolations, []);

    // Gate 1: build set of jobs that contain a violating staff member
    const violatingUserIds = new Set(currentViolations.map((v) => v.userId).filter(Boolean) as string[]);
    if (violatingUserIds.size === 0) break; // nothing to fix

    const hotJobIndices = new Set<number>();
    for (let k = 0; k < jobResults.length; k++) {
      if (jobResults[k].placements.some((p) => violatingUserIds.has(p.userId))) {
        hotJobIndices.add(k);
      }
    }

    let detectCalls = 0;

    for (const i of hotJobIndices) {
      if (detectCalls >= MAX_DETECT_CALLS) break;
      const jr1 = jobResults[i];

      for (let j = 0; j < jobResults.length && detectCalls < MAX_DETECT_CALLS; j++) {
        if (j === i) continue;
        const jr2 = jobResults[j];

        for (const role of ROLE_ASSIGNMENT_ORDER) {
          const p1 = jr1.placements.find((p) => p.role === role);
          const p2 = jr2.placements.find((p) => p.role === role);
          if (!p1 || !p2 || p1.userId === p2.userId) continue;

          const job1 = jobMap.get(jr1.jobId);
          const job2 = jobMap.get(jr2.jobId);
          if (!job1 || !job2) continue;

          const s1 = staffById.get(p1.userId);
          const s2 = staffById.get(p2.userId);
          if (!s1 || !s2 || !s1.resourceSetting || !s2.resourceSetting) continue;

          const otherRoles1 = jr1.placements.filter((p) => p.userId === p2.userId && p.role !== role).map((p) => p.role);
          const otherRoles2 = jr2.placements.filter((p) => p.userId === p1.userId && p.role !== role).map((p) => p.role);
          if (!isEligible(s2, role, otherRoles1)) continue;
          if (!isEligible(s1, role, otherRoles2)) continue;

          const safeCap_s1 = s1.resourceSetting.weeklyCapacityHrs > 0 ? s1.resourceSetting.weeklyCapacityHrs : 37.5;
          const safeCap_s2 = s2.resourceSetting.weeklyCapacityHrs > 0 ? s2.resourceSetting.weeklyCapacityHrs : 37.5;
          const deadline1 = getJobDeadline(job1);
          const deadline2 = getJobDeadline(job2);
          const budget1 = getBudgetForRole(job1, role);
          const budget2 = getBudgetForRole(job2, role);

          // Compute proposed new windows (s2 takes job1, s1 takes job2)
          const win1 = computeWindow(budget1, safeCap_s2, deadline1, today);
          const win2 = computeWindow(budget2, safeCap_s1, deadline2, today);
          const days1 = workingDaysInRange(parseDate(win1.startDate), parseDate(win1.endDate));
          const days2 = workingDaysInRange(parseDate(win2.startDate), parseDate(win2.endDate));

          // Release current placements so cap reflects "other jobs only"
          releaseCapacity(cap, p1);
          releaseCapacity(cap, p2);

          // Gate 2: congestion filter
          // Check each person's load in their CURRENT window vs proposed window.
          // (Current window is p1/p2's dates; p1&p2 are released so cap shows other-job load only.)
          const origDays1 = workingDaysInRange(parseDate(p1.startDate), parseDate(p1.endDate));
          const origDays2 = workingDaysInRange(parseDate(p2.startDate), parseDate(p2.endDate));
          const curAvail_s1 = dailyAvailable(s1.id, safeCap_s1 / 5, origDays1, cap); // s1 in old window
          const curAvail_s2 = dailyAvailable(s2.id, safeCap_s2 / 5, origDays2, cap); // s2 in old window
          const newAvail_s1 = dailyAvailable(s1.id, safeCap_s1 / 5, days2, cap);     // s1 in new window
          const newAvail_s2 = dailyAvailable(s2.id, safeCap_s2 / 5, days1, cap);     // s2 in new window

          // At least one person must move to a less congested window
          const s1GainsRoom = newAvail_s1 > curAvail_s1;
          const s2GainsRoom = newAvail_s2 > curAvail_s2;

          if (!s1GainsRoom && !s2GainsRoom) {
            consumeCapacity(cap, p1);
            consumeCapacity(cap, p2);
            continue; // Gate 2 rejected — neither person benefits
          }

          // Check minimum feasibility (new windows must have sufficient capacity)
          if (newAvail_s2 < win1.hoursPerDay * 0.5 || newAvail_s1 < win2.hoursPerDay * 0.5) {
            consumeCapacity(cap, p1);
            consumeCapacity(cap, p2);
            continue;
          }

          // Gate 3: budget check before the expensive detectViolations call
          if (detectCalls >= MAX_DETECT_CALLS) {
            consumeCapacity(cap, p1);
            consumeCapacity(cap, p2);
            break;
          }

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

          const trialJr1 = { jobId: jr1.jobId, placements: jr1.placements.map((p) => p === p1 ? newP1 : p) };
          const trialJr2 = { jobId: jr2.jobId, placements: jr2.placements.map((p) => p === p2 ? newP2 : p) };
          const trialPlacements = jobResults.flatMap((jr, idx) =>
            idx === i ? trialJr1.placements : idx === j ? trialJr2.placements : jr.placements
          );

          detectCalls++;
          const trialScore = computeQualityScore(
            detectViolations(trialPlacements, jobsInScope, staff, constraintOrder, today, existingAllocations, new Map()),
            [],
          );

          if (trialScore < currentScore) {
            jobResults[i] = trialJr1;
            jobResults[j] = trialJr2;
            consumeCapacity(cap, newP1);
            consumeCapacity(cap, newP2);
            currentScore = trialScore;
            improved = true;
          } else {
            consumeCapacity(cap, p1);
            consumeCapacity(cap, p2);
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

// ─── Simulated Annealing ──────────────────────────────────────────────────────

/**
 * Post-processing optimiser: 800 iterations of probabilistic search using
 * geometric cooling (T₀=15 → T_final=0.05). Escapes local optima that
 * pairwise swaps in runLocalSearch cannot reach.
 */
function runSimulatedAnnealing(
  warmStart: JobResult[],
  unschedulableWarm: string[],
  orderedJobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
  constraintOrder: string[],
  scope: OptimizationScope,
  options: SchedulerOptions,
  today: Date,
  jitterScale: number,
  previousTeam: Map<string, string[]>,
): { jobResults: JobResult[]; unschedulable: string[] } {
  const T0 = 15.0;
  const T_FINAL = 0.05;
  const N_ITER = 100;
  const SA_WALL_MS = 4_000; // 4 s max — leaves headroom for DB + greedy phases
  const saDeadline = Date.now() + SA_WALL_MS;

  const activeStaff = staff.filter((s) => s.isActive !== false && s.resourceSetting);
  const jobMap = new Map(orderedJobs.map((j) => [j.id, j]));

  function cloneState(state: JobResult[]): JobResult[] {
    return state.map((jr) => ({ jobId: jr.jobId, placements: [...jr.placements] }));
  }

  function evalScore(state: JobResult[]): number {
    const allPlacements = state.flatMap((jr) => jr.placements);
    const violations = detectViolations(
      allPlacements,
      orderedJobs,
      staff,
      constraintOrder,
      today,
      existingAllocations,
      previousTeam,
    );
    return computeQualityScore(violations, unschedulableWarm);
  }

  // ── Move A: Reassign one (job, role) to a different eligible staff member ──
  function moveReassign(state: JobResult[]): JobResult[] | null {
    const scheduled = state.filter((jr) => jr.placements.length > 0);
    if (scheduled.length === 0) return null;
    const jr = scheduled[Math.floor(Math.random() * scheduled.length)];
    const pIdx = Math.floor(Math.random() * jr.placements.length);
    const placement = jr.placements[pIdx];
    const job = jobMap.get(jr.jobId);
    if (!job) return null;

    const eligible = activeStaff.filter((s) => {
      if (s.id === placement.userId) return false;
      return isEligible(s, placement.role, []);
    });
    if (eligible.length === 0) return null;

    const candidate = eligible[Math.floor(Math.random() * eligible.length)];
    const budget = getBudgetForRole(job, placement.role);
    if (budget <= 0) return null;
    const weeklyHrs = candidate.resourceSetting!.weeklyCapacityHrs ?? 37.5;
    const deadline = getJobDeadline(job);
    const win = computeWindow(budget, weeklyHrs, deadline, today);

    const newState = cloneState(state);
    const newJr = newState.find((r) => r.jobId === jr.jobId)!;
    const daysCount = workingDaysBetween(parseDate(win.startDate), parseDate(win.endDate));
    newJr.placements[pIdx] = {
      jobId: jr.jobId,
      userId: candidate.id,
      role: placement.role,
      startDate: win.startDate,
      endDate: win.endDate,
      hoursPerDay: win.hoursPerDay,
      totalHours: Math.round(win.hoursPerDay * daysCount * 10) / 10,
    };
    return newState;
  }

  // ── Move B: Swap staff for the same role between two jobs ──────────────────
  function moveSwap(state: JobResult[]): JobResult[] | null {
    if (state.length < 2) return null;
    const i = Math.floor(Math.random() * state.length);
    let j = Math.floor(Math.random() * (state.length - 1));
    if (j >= i) j++;
    const jr1 = state[i];
    const jr2 = state[j];
    const role = ROLE_ASSIGNMENT_ORDER[Math.floor(Math.random() * ROLE_ASSIGNMENT_ORDER.length)];
    const p1 = jr1.placements.find((p) => p.role === role);
    const p2 = jr2.placements.find((p) => p.role === role);
    if (!p1 || !p2 || p1.userId === p2.userId) return null;

    const s1 = staff.find((s) => s.id === p1.userId);
    const s2 = staff.find((s) => s.id === p2.userId);
    if (!s1 || !s2) return null;

    if (!isEligible(s2, role, [])) return null;
    if (!isEligible(s1, role, [])) return null;

    const job1 = jobMap.get(jr1.jobId);
    const job2 = jobMap.get(jr2.jobId);
    if (!job1 || !job2) return null;

    const weeklyHrs1 = s2.resourceSetting!.weeklyCapacityHrs ?? 37.5;
    const weeklyHrs2 = s1.resourceSetting!.weeklyCapacityHrs ?? 37.5;
    const budget1 = getBudgetForRole(job1, role);
    const budget2 = getBudgetForRole(job2, role);
    if (budget1 <= 0 || budget2 <= 0) return null;

    const win1 = computeWindow(budget1, weeklyHrs1, getJobDeadline(job1), today);
    const win2 = computeWindow(budget2, weeklyHrs2, getJobDeadline(job2), today);

    const newState = cloneState(state);
    const newJr1 = newState[i];
    const newJr2 = newState[j];
    const p1idx = newJr1.placements.findIndex((p) => p.role === role);
    const p2idx = newJr2.placements.findIndex((p) => p.role === role);
    const days1 = workingDaysBetween(parseDate(win1.startDate), parseDate(win1.endDate));
    const days2 = workingDaysBetween(parseDate(win2.startDate), parseDate(win2.endDate));

    newJr1.placements[p1idx] = {
      jobId: jr1.jobId, userId: s2.id, role,
      startDate: win1.startDate, endDate: win1.endDate, hoursPerDay: win1.hoursPerDay,
      totalHours: Math.round(win1.hoursPerDay * days1 * 10) / 10,
    };
    newJr2.placements[p2idx] = {
      jobId: jr2.jobId, userId: s1.id, role,
      startDate: win2.startDate, endDate: win2.endDate, hoursPerDay: win2.hoursPerDay,
      totalHours: Math.round(win2.hoursPerDay * days2 * 10) / 10,
    };
    return newState;
  }

  // ── Move C: Drop a non-RI placement and re-fill with single-job greedy ──────
  function moveDropFill(state: JobResult[]): JobResult[] | null {
    const withNonRI = state.filter((jr) => jr.placements.some((p) => p.role !== 'RI'));
    if (withNonRI.length === 0) return null;
    const jr = withNonRI[Math.floor(Math.random() * withNonRI.length)];
    const nonRI = jr.placements.filter((p) => p.role !== 'RI');
    const target = nonRI[Math.floor(Math.random() * nonRI.length)];
    const job = jobMap.get(jr.jobId);
    if (!job) return null;

    const newState = cloneState(state);
    const newJr = newState.find((r) => r.jobId === jr.jobId)!;
    newJr.placements = newJr.placements.filter(
      (p) => !(p.role === target.role && p.userId === target.userId),
    );

    // Build synthetic existing allocations from the rest of the state for capacity context
    const syntheticAllocs: Allocation[] = newState.flatMap((r) =>
      r.placements.map((p, idx) => ({
        id: `sa-temp-${r.jobId}-${idx}`,
        engagementId: p.jobId,
        userId: p.userId,
        userName: '',
        role: p.role,
        startDate: p.startDate,
        endDate: p.endDate,
        hoursPerDay: p.hoursPerDay,
        totalHours: p.totalHours,
        notes: null,
      } as Allocation)),
    );

    const { jobResults: refilled } = runGreedyPass(
      [job], staff, [...existingAllocations, ...syntheticAllocs],
      constraintOrder, scope, options, today, 0, previousTeam,
    );
    const refilledJr = refilled.find((r) => r.jobId === jr.jobId);
    const newPlacement = refilledJr?.placements.find((p) => p.role === target.role);
    if (newPlacement) newJr.placements.push(newPlacement);

    return newState;
  }

  // ── SA main loop ──────────────────────────────────────────────────────────
  let current = cloneState(warmStart);
  let currentScore = evalScore(current);
  let best = cloneState(current);
  let bestScore = currentScore;

  for (let k = 0; k < N_ITER; k++) {
    if (Date.now() > saDeadline) break; // time guard — stay within Vercel function budget
    const T = T0 * Math.pow(T_FINAL / T0, k / N_ITER);
    const r = Math.random();

    let candidate: JobResult[] | null;
    if (r < 0.60) {
      candidate = moveReassign(current);
    } else if (r < 0.90) {
      candidate = moveSwap(current);
    } else {
      candidate = moveDropFill(current);
    }

    if (!candidate) continue;

    const candidateScore = evalScore(candidate);
    const deltaE = candidateScore - currentScore;

    if (deltaE < 0 || Math.random() < Math.exp(-deltaE / T)) {
      current = candidate;
      currentScore = candidateScore;
      if (currentScore < bestScore) {
        best = cloneState(current);
        bestScore = currentScore;
      }
    }
  }

  return { jobResults: best, unschedulable: unschedulableWarm };
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
  previousTeam: Map<string, string[]> = new Map(),
): SchedulerResult {
  const todayDate = parseDate(today);
  const order = constraintOrder.length > 0 ? constraintOrder : DEFAULT_CONSTRAINT_ORDER;
  const inScopeSet = new Set(jobs.map((j) => j.id));

  // ── Order jobs ──────────────────────────────────────────────────────────────
  let orderedJobs = [...jobs];

  // Always sort by earliest deadline — temporal order is already optimal for this problem.
  // constrainedFirst improves staff *selection* (via window-congestion scoring), not job ordering.
  orderedJobs.sort((a, b) => getJobDeadline(a).getTime() - getJobDeadline(b).getTime());

  const MULTI_PASS_COUNT = 15;

  // Role-scarcity mode runs a single deterministic pass with its own job ordering
  if (options.roleScarcity) {
    const { jobResults, unschedulable } = runRoleScarcityPass(
      orderedJobs,
      staff,
      existingAllocations,
      order,
      scope,
      options,
      todayDate,
      0,
      previousTeam,
    );
    const postScarcityResults = options.localSearch
      ? runLocalSearch(jobResults, jobs, staff, existingAllocations, order, todayDate)
      : jobResults;

    const postSAScarcityResults = options.combinatorial
      ? runSimulatedAnnealing(
          postScarcityResults,
          unschedulable,
          orderedJobs,
          staff,
          existingAllocations,
          order,
          scope,
          options,
          todayDate,
          0,
          previousTeam,
        ).jobResults
      : postScarcityResults;

    const staffNameMap = new Map(staff.map((s) => [s.id, s.name]));
    const finalPlacements = postSAScarcityResults.flatMap((jr) => jr.placements);
    const violations = detectViolations(
      finalPlacements,
      jobs.filter((j) => inScopeSet.has(j.id)),
      staff,
      order,
      todayDate,
      existingAllocations,
      previousTeam,
    );
    const scarcitySchedule = postSAScarcityResults.map((jr) => ({
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
    const scarcityChanges = computeChanges(postSAScarcityResults, jobs, staff, existingAllocations);
    return {
      schedule: scarcitySchedule,
      violations,
      changes: scarcityChanges,
      unschedulable,
      reasoning: '',
      qualityScore: computeQualityScore(violations, unschedulable),
      passesRun: 1,
    };
  }

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
      previousTeam,
    );

    // Score on raw greedy result only — local search applied once after the loop
    const passPlacementsAll = jobResults.flatMap((jr) => jr.placements);
    const passScore = computeQualityScore(
      detectViolations(passPlacementsAll, jobs.filter((j) => inScopeSet.has(j.id)), staff, order, todayDate, existingAllocations, previousTeam),
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

  const postSAResults = options.combinatorial
    ? runSimulatedAnnealing(
        postLoopResults,
        bestUnschedulable,
        orderedJobs,
        staff,
        existingAllocations,
        order,
        scope,
        options,
        todayDate,
        0,
        previousTeam,
      ).jobResults
    : postLoopResults;

  // ── Build final result ──────────────────────────────────────────────────────
  const staffNameMap = new Map(staff.map((s) => [s.id, s.name]));
  const finalPlacements = postSAResults.flatMap((jr) => jr.placements);

  const violations = detectViolations(
    finalPlacements,
    jobs.filter((j) => inScopeSet.has(j.id)),
    staff,
    order,
    todayDate,
    existingAllocations,
    previousTeam,
  );

  const schedule = postSAResults.map((jr) => ({
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

  const changes = computeChanges(postSAResults, jobs, staff, existingAllocations);

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
