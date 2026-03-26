import type { StaffMember, Allocation, ResourceJobView, ResourceRole, ScheduleProposal, ProposedAllocation } from './types';
import { countWorkingDays } from './date-utils';

/**
 * Propose a schedule for a job.
 * Priority: Client familiarity first (50%), then availability (30%), then workload balance (20%)
 */
export function proposeSchedule(
  job: ResourceJobView,
  staff: StaffMember[],
  existingAllocations: Allocation[],
  startDate: Date,
  endDate: Date,
): ScheduleProposal {
  const proposals: ProposedAllocation[] = [];
  const conflicts: string[] = [];
  const usedStaffIds = new Set<string>();

  // Determine which roles need allocation based on budget hours
  const roleBudgets: { role: ResourceRole; hours: number }[] = [];
  if (job.budgetHoursSpecialist > 0) roleBudgets.push({ role: 'Specialist', hours: job.budgetHoursSpecialist });
  if (job.budgetHoursRI > 0) roleBudgets.push({ role: 'RI', hours: job.budgetHoursRI });
  if (job.budgetHoursReviewer > 0) roleBudgets.push({ role: 'Reviewer', hours: job.budgetHoursReviewer });
  if (job.budgetHoursPreparer > 0) roleBudgets.push({ role: 'Preparer', hours: job.budgetHoursPreparer });

  for (const { role, hours } of roleBudgets) {
    // Find eligible staff for this role
    const eligible = staff.filter(s => {
      if (!s.resourceSetting) return false;
      if (usedStaffIds.has(s.id) && role !== 'Specialist' && role !== 'Reviewer' && role !== 'Preparer') return false;
      // Check role eligibility
      const setting = s.resourceSetting;
      if (role === 'RI') return setting.isRI || setting.riJobLimit != null;
      if (role === 'Reviewer') return setting.resourceRole === 'Reviewer' || setting.reviewerJobLimit != null;
      if (role === 'Preparer') return setting.resourceRole === 'Preparer' || setting.preparerJobLimit != null;
      if (role === 'Specialist') return setting.resourceRole === 'Specialist' || setting.specialistJobLimit != null;
      return false;
    });

    // Score each candidate
    const scored = eligible.map(s => {
      const familiarityScore = computeFamiliarity(s.id, job.clientId, existingAllocations);
      const availabilityScore = computeAvailability(s, existingAllocations, startDate, endDate);
      const workloadScore = computeWorkloadBalance(s, existingAllocations, startDate, endDate);
      const totalScore = familiarityScore * 0.5 + availabilityScore * 0.3 + workloadScore * 0.2;
      return { staff: s, totalScore, familiarityScore, availabilityScore };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    if (scored.length === 0) {
      conflicts.push(`No eligible staff found for ${role}`);
      continue;
    }

    const best = scored[0];
    const workingDays = countWorkingDays(startDate, endDate);
    const hoursPerDay = workingDays > 0 ? hours / workingDays : 0;

    proposals.push({
      userId: best.staff.id,
      userName: best.staff.name,
      role,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      hoursPerDay: Math.round(hoursPerDay * 100) / 100,
      totalHours: hours,
      availabilityScore: Math.round(best.availabilityScore),
      familiarityScore: Math.round(best.familiarityScore),
    });

    usedStaffIds.add(best.staff.id);
  }

  return { jobId: job.id, allocations: proposals, conflicts };
}

/** Score 0-100 based on whether staff has worked on this client before */
function computeFamiliarity(userId: string, clientId: string, allocations: Allocation[]): number {
  // Check if user has any existing allocations for engagements linked to this client
  // Since we don't have clientId on allocations directly, we use engagementId patterns
  // In a full implementation this would query the DB. For now, check if user has any allocations.
  const userAllocs = allocations.filter(a => a.userId === userId);
  if (userAllocs.length === 0) return 20; // New staff, neutral score
  // Give higher score for more allocations (proxy for experience)
  return Math.min(100, 40 + userAllocs.length * 10);
}

/** Score 0-100 based on how much free time staff has in the period */
function computeAvailability(staff: StaffMember, allocations: Allocation[], start: Date, end: Date): number {
  const weeklyHrs = staff.resourceSetting?.weeklyCapacityHrs ?? 37.5;
  const overtimeHrs = staff.resourceSetting?.overtimeHrs ?? 0;
  const dailyHrs = (weeklyHrs + overtimeHrs) / 5;
  const workingDays = countWorkingDays(start, end);
  const totalHrs = workingDays * dailyHrs;

  // Sum existing allocated hours in this period
  const userAllocs = allocations.filter(a => {
    if (a.userId !== staff.id) return false;
    const aStart = new Date(a.startDate);
    const aEnd = new Date(a.endDate);
    return aStart <= end && aEnd >= start;
  });

  let allocatedHrs = 0;
  for (const alloc of userAllocs) {
    // Simple: count overlap days * hoursPerDay
    const overlapStart = new Date(Math.max(start.getTime(), new Date(alloc.startDate).getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), new Date(alloc.endDate).getTime()));
    const overlapDays = countWorkingDays(overlapStart, overlapEnd);
    allocatedHrs += overlapDays * alloc.hoursPerDay;
  }

  const freeHrs = totalHrs - allocatedHrs;
  if (totalHrs === 0) return 0;
  return Math.max(0, Math.min(100, (freeHrs / totalHrs) * 100));
}

/** Score 0-100 based on workload balance (fewer concurrent jobs = higher score) */
function computeWorkloadBalance(staff: StaffMember, allocations: Allocation[], start: Date, end: Date): number {
  const setting = staff.resourceSetting;
  if (!setting) return 50;

  const maxJobs = setting.concurrentJobLimit;
  const overlapping = allocations.filter(a => {
    if (a.userId !== staff.id) return false;
    const aStart = new Date(a.startDate);
    const aEnd = new Date(a.endDate);
    return aStart <= end && aEnd >= start;
  });

  const uniqueEngagements = new Set(overlapping.map(a => a.engagementId));
  const currentJobs = uniqueEngagements.size;

  if (maxJobs <= 0) return 0;
  const utilization = currentJobs / maxJobs;
  return Math.max(0, Math.min(100, (1 - utilization) * 100));
}

/** Batch schedule all eligible unscheduled jobs */
export function proposeScheduleAll(
  jobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
): ScheduleProposal[] {
  const unscheduled = jobs
    .filter(j => j.schedulingStatus === 'unscheduled')
    .sort((a, b) => new Date(a.targetCompletion).getTime() - new Date(b.targetCompletion).getTime());

  const proposals: ScheduleProposal[] = [];
  const runningAllocations = [...existingAllocations];

  for (const job of unscheduled) {
    // Skip if missing required data
    if (!job.customDeadline && !job.targetCompletion) continue;

    const startDate = new Date(); // Default start: today
    const endDate = new Date(job.customDeadline || job.targetCompletion);

    if (endDate <= startDate) continue; // Skip past-due jobs

    const proposal = proposeSchedule(job, staff, runningAllocations, startDate, endDate);
    proposals.push(proposal);

    // Add proposed allocations to running pool for subsequent scheduling
    for (const pa of proposal.allocations) {
      runningAllocations.push({
        id: `proposed-${job.id}-${pa.role}`,
        engagementId: job.engagementId || job.id,
        userId: pa.userId,
        userName: pa.userName,
        role: pa.role,
        startDate: pa.startDate,
        endDate: pa.endDate,
        hoursPerDay: pa.hoursPerDay,
        totalHours: pa.totalHours,
        notes: null,
      });
    }
  }

  return proposals;
}
