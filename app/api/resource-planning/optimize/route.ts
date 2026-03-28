import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildOptimizerPrompt, runOptimizer, parseOptimizerResponse } from '@/lib/resource-planning/optimizer-ai';
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
  let body: { scope?: OptimizationScope } = {};
  try { body = await request.json(); } catch { /* default */ }
  const scope: OptimizationScope = body.scope === 'unscheduled' ? 'unscheduled' : 'all';

  // ── Fetch data ───────────────────────────────────────────────────────────
  const [staffRaw, jobsRaw, allocsRaw, settingsRaw] = await Promise.all([
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

  // Map jobs
  const jobs: ResourceJobView[] = jobsRaw.map((j) => ({
    id: j.id,
    clientId: j.clientId,
    clientName: j.client.clientName,
    auditType: j.auditType,
    serviceType: null,
    periodEnd: j.periodEnd.toISOString(),
    targetCompletion: j.targetCompletion.toISOString(),
    budgetHoursSpecialist: j.budgetHoursSpecialist,
    budgetHoursRI: j.budgetHoursRI,
    budgetHoursReviewer: j.budgetHoursReviewer,
    budgetHoursPreparer: j.budgetHoursPreparer,
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
  }));

  // Filter out locked jobs for 'all' scope — they are passed as context but won't be re-scheduled
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

  // ── Build prompt & call AI ───────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const prompt = buildOptimizerPrompt(jobsInScope, staff, allocations, constraintOrder, scope, today);

  console.log(`[optimize] Calling AI. Jobs in scope: ${jobsInScope.length}, Staff: ${staff.length}, Prompt chars: ${prompt.length}`);

  let rawResult;
  try {
    rawResult = await runOptimizer(prompt);
  } catch (err: any) {
    console.error('[optimize] AI call failed:', err);
    return Response.json({ error: `AI optimiser error: ${err?.message ?? 'Unknown error'}` }, { status: 502 });
  }

  console.log(`[optimize] AI responded. Model: ${rawResult.model}, tokens: ${rawResult.promptTokens}+${rawResult.completionTokens}, raw length: ${rawResult.json.length}`);
  console.log('[optimize] Raw response (first 1000):\n', rawResult.json.slice(0, 1000));

  const result = parseOptimizerResponse(
    rawResult.json,
    jobsInScope,
    staff,
    allocations,
    constraintOrder,
  );

  return Response.json({
    ...result,
    promptTokens: rawResult.promptTokens,
    completionTokens: rawResult.completionTokens,
  });
}
