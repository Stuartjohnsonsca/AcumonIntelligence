import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { summarizeSchedule } from '@/lib/resource-planning/optimizer-ai';
import { runScheduler, type SchedulerOptions } from '@/lib/resource-planning/scheduler';
import { DEFAULT_CONSTRAINT_ORDER } from '@/lib/resource-planning/optimizer-constraints';
import type { StaffMember, ResourceJobView, Allocation, OptimizationScope } from '@/lib/resource-planning/types';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  let body: { scope?: OptimizationScope; techniques?: Partial<SchedulerOptions>; skipSummary?: boolean } = {};
  try { body = await request.json(); } catch { /* default */ }

  const scope: OptimizationScope = body.scope === 'unscheduled' ? 'unscheduled' : 'all';
  const skipSummary: boolean = body.skipSummary === true;

  // Merge provided techniques with safe defaults
  const options: SchedulerOptions = {
    constrainedFirst: body.techniques?.constrainedFirst ?? true,
    lookAhead: body.techniques?.lookAhead ?? false,
    localSearch: body.techniques?.localSearch ?? false,
    multiPass: body.techniques?.multiPass ?? false,
  };

  // ── Fetch data ───────────────────────────────────────────────────────────
  const [staffRaw, jobsRaw, allocsRaw, settingsRaw, profilesRaw, clientSettingsRaw] = await Promise.all([
    prisma.user.findMany({
      where: { firmId, isActive: true },
      include: { resourceStaffSetting: true },
    }),
    prisma.resourceJob.findMany({
      where: {
        firmId,
        ...(scope === 'unscheduled' ? { schedulingStatus: 'unscheduled' } : {}),
      },
      include: { client: { select: { clientName: true } } },
    }),
    prisma.resourceAllocation.findMany({
      where: { firmId },
      include: { user: { select: { name: true } } },
    }),
    prisma.resourceOptimizerSettings.findUnique({ where: { firmId } }),
    prisma.resourceJobProfile.findMany({ where: { firmId } }),
    prisma.resourceClientSetting.findMany({ where: { firmId }, select: { clientId: true, serviceType: true } }),
  ]);

  // Map staff
  const staff: StaffMember[] = staffRaw.map((u) => ({
    id: u.id,
    displayId: (u as any).displayId ?? u.id,
    name: u.name ?? '',
    email: u.email ?? '',
    jobTitle: (u as any).jobTitle ?? null,
    isActive: u.isActive,
    resourceSetting: u.resourceStaffSetting
      ? {
          id: u.resourceStaffSetting.id,
          resourceRole: u.resourceStaffSetting.resourceRole as any,
          concurrentJobLimit: u.resourceStaffSetting.concurrentJobLimit,
          isRI: u.resourceStaffSetting.isRI,
          weeklyCapacityHrs: u.resourceStaffSetting.weeklyCapacityHrs,
          overtimeHrs: u.resourceStaffSetting.overtimeHrs,
          specialistJobLimit: u.resourceStaffSetting.specialistJobLimit,
          preparerJobLimit: u.resourceStaffSetting.preparerJobLimit,
          reviewerJobLimit: u.resourceStaffSetting.reviewerJobLimit,
          riJobLimit: u.resourceStaffSetting.riJobLimit,
        }
      : null,
  }));

  // Build lookup maps for profile fallback
  const profileById = new Map(profilesRaw.map((p) => [p.id, p]));
  const profileByName = new Map(profilesRaw.map((p) => [p.name.toLowerCase(), p]));
  const serviceTypeByClient = new Map(clientSettingsRaw.map((cs) => [cs.clientId, cs.serviceType]));

  // Resolve budget hours: job record → job profile → client service type profile → 0
  function resolveBudgetHours(j: typeof jobsRaw[0]) {
    const hasHours = j.budgetHoursRI > 0 || j.budgetHoursReviewer > 0 ||
                     j.budgetHoursPreparer > 0 || j.budgetHoursSpecialist > 0;
    if (hasHours) return {
      budgetHoursSpecialist: j.budgetHoursSpecialist,
      budgetHoursRI: j.budgetHoursRI,
      budgetHoursReviewer: j.budgetHoursReviewer,
      budgetHoursPreparer: j.budgetHoursPreparer,
    };
    // Fall back to job profile (by profileId, then by client service type name)
    let profile = j.jobProfileId ? (profileById.get(j.jobProfileId) ?? null) : null;
    if (!profile) {
      const st = serviceTypeByClient.get(j.clientId);
      profile = st ? (profileByName.get(st.toLowerCase()) ?? null) : null;
    }
    return {
      budgetHoursSpecialist: profile?.budgetHoursSpecialist ?? 0,
      budgetHoursRI: profile?.budgetHoursRI ?? 0,
      budgetHoursReviewer: profile?.budgetHoursReviewer ?? 0,
      budgetHoursPreparer: profile?.budgetHoursPreparer ?? 0,
    };
  }

  // Map jobs
  const jobs: ResourceJobView[] = jobsRaw.map((j) => ({
    id: j.id,
    clientId: j.clientId,
    clientName: j.client.clientName,
    auditType: j.auditType,
    serviceType: serviceTypeByClient.get(j.clientId) ?? null,
    periodEnd: j.periodEnd.toISOString(),
    targetCompletion: j.targetCompletion.toISOString(),
    ...resolveBudgetHours(j),
    engagementId: j.id,
    schedulingStatus: j.schedulingStatus as any,
    isScheduleLocked: j.isScheduleLocked,
    complianceDeadline: j.complianceDeadline?.toISOString() ?? null,
    customDeadline: j.customDeadline?.toISOString() ?? null,
    jobProfileId: j.jobProfileId,
    crmJobId: j.crmJobId,
    actualHoursSpecialist: j.actualHoursSpecialist,
    actualHoursRI: j.actualHoursRI,
    actualHoursReviewer: j.actualHoursReviewer,
    actualHoursPreparer: j.actualHoursPreparer,
    previousJobId: j.previousJobId,
    timesheetHours: (j as any).timesheetHours ?? 0,
  }));

  // Filter out locked jobs — they are context but won't be re-scheduled
  const jobsInScope = scope === 'all'
    ? jobs.filter((j) => !j.isScheduleLocked)
    : jobs.filter((j) => !j.isScheduleLocked && j.schedulingStatus === 'unscheduled');

  if (jobsInScope.length === 0) {
    return Response.json({
      schedule: [],
      violations: [],
      unschedulable: [],
      reasoning: 'No jobs in scope to optimise.',
      changes: [],
      qualityScore: 0,
      passesRun: 0,
    });
  }

  // Map allocations
  const allocations: Allocation[] = allocsRaw.map((a) => ({
    id: a.id,
    engagementId: a.engagementId,
    userId: a.userId,
    userName: a.user.name ?? '',
    role: a.role as any,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate.toISOString(),
    hoursPerDay: a.hoursPerDay,
    totalHours: a.totalHours,
    notes: a.notes,
  }));

  // Constraint order
  const storedOrder = settingsRaw?.constraintOrder;
  const constraintOrder: string[] =
    Array.isArray(storedOrder) && storedOrder.length > 0
      ? (storedOrder as string[])
      : DEFAULT_CONSTRAINT_ORDER;

  // ── Run deterministic scheduler ──────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  console.log(`[optimize] Running deterministic scheduler. Jobs in scope: ${jobsInScope.length}, Staff: ${staff.length}, Options: ${JSON.stringify(options)}`);

  let schedulerResult: ReturnType<typeof runScheduler>;
  try {
    schedulerResult = runScheduler(
      jobsInScope,
      staff,
      allocations,
      constraintOrder,
      scope,
      options,
      today,
    );
  } catch (err: any) {
    console.error('[optimize] Scheduler crashed:', err);
    return Response.json({ error: `Scheduler error: ${err?.message ?? 'unknown'}` }, { status: 500 });
  }

  console.log(`[optimize] Scheduler complete. Scheduled: ${schedulerResult.schedule.length}, Unschedulable: ${schedulerResult.unschedulable.length}, Violations: ${schedulerResult.violations.length}, Score: ${schedulerResult.qualityScore}, Passes: ${schedulerResult.passesRun}`);

  // ── AI summary (skipped for multi-pass intermediate calls) ───────────────
  const violationsByPriority: Record<number, number> = {};
  for (const v of schedulerResult.violations) {
    violationsByPriority[v.priority] = (violationsByPriority[v.priority] ?? 0) + 1;
  }

  let reasoning = '';
  if (skipSummary) {
    // Multi-pass intermediate call — skip AI to avoid timeout; summary added on final pass
    reasoning = '';
  } else {
    try {
      reasoning = await summarizeSchedule({
        jobsScheduled: schedulerResult.schedule.length,
        jobsUnschedulable: schedulerResult.unschedulable.length,
        violationCount: schedulerResult.violations.length,
        violationsByPriority,
        passesRun: schedulerResult.passesRun,
        qualityScore: schedulerResult.qualityScore,
      });
    } catch (err) {
      console.warn('[optimize] AI summary failed (non-fatal):', err);
      reasoning = `${schedulerResult.schedule.length} jobs scheduled with ${schedulerResult.violations.length} constraint violation${schedulerResult.violations.length !== 1 ? 's' : ''}.`;
    }
  }

  return Response.json({
    ...schedulerResult,
    reasoning,
  });
}
