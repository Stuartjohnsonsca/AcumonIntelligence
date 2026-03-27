import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ResourcePlanningClient } from '@/components/tools/resource-planning/ResourcePlanningClient';
import type { ResourceRole, SchedulingStatus } from '@/lib/resource-planning/types';

export default async function ResourcePlanningPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/resource-planning');
  }

  const firmId = session.user.firmId;

  // Fetch staff - use safe select that works even if new columns don't exist yet
  let staff: any[] = [];
  try {
    const staffRaw = await prisma.user.findMany({
      where: { firmId, isActive: true, isAuditStaff: true },
      select: {
        id: true,
        displayId: true,
        name: true,
        email: true,
        jobTitle: true,
        isActive: true,
        resourceStaffSetting: true,
      },
      orderBy: { name: 'asc' },
    });

    staff = staffRaw.map((s: any) => ({
      id: s.id,
      displayId: s.displayId,
      name: s.name,
      email: s.email,
      jobTitle: s.jobTitle,
      isActive: s.isActive,
      resourceSetting: s.resourceStaffSetting
        ? {
            id: s.resourceStaffSetting.id,
            resourceRole: (s.resourceStaffSetting.resourceRole ?? 'Preparer') as ResourceRole,
            concurrentJobLimit: s.resourceStaffSetting.concurrentJobLimit ?? 3,
            isRI: s.resourceStaffSetting.isRI ?? false,
            weeklyCapacityHrs: s.resourceStaffSetting.weeklyCapacityHrs ?? 37.5,
            overtimeHrs: s.resourceStaffSetting.overtimeHrs ?? 0,
            preparerJobLimit: s.resourceStaffSetting.preparerJobLimit ?? null,
            reviewerJobLimit: s.resourceStaffSetting.reviewerJobLimit ?? null,
            riJobLimit: s.resourceStaffSetting.riJobLimit ?? null,
            specialistJobLimit: s.resourceStaffSetting.specialistJobLimit ?? null,
          }
        : null,
    }));
  } catch (e) {
    console.error('Staff fetch error, trying minimal query:', e);
    // Fallback: fetch without resourceStaffSetting relation
    const staffRaw = await prisma.user.findMany({
      where: { firmId, isActive: true, isAuditStaff: true },
      select: { id: true, displayId: true, name: true, email: true, jobTitle: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    staff = staffRaw.map((s: any) => ({
      id: s.id, displayId: s.displayId, name: s.name, email: s.email,
      jobTitle: s.jobTitle, isActive: s.isActive, resourceSetting: null,
    }));
  }

  // Fetch jobs - safe with fallback
  let jobs: any[] = [];
  try {
    const jobsRaw = await prisma.resourceJob.findMany({
      where: { firmId },
      include: { client: { select: { clientName: true } } },
      orderBy: { targetCompletion: 'asc' },
    });

    const engagements = await prisma.auditEngagement.findMany({
      where: { firmId },
      select: { id: true, clientId: true, auditType: true },
    });
    const engagementMap = new Map<string, string>();
    for (const e of engagements) {
      engagementMap.set(`${e.clientId}:${e.auditType}`, e.id);
    }

    jobs = jobsRaw.map((j: any) => ({
      id: j.id,
      clientId: j.clientId,
      clientName: j.client?.clientName ?? 'Unknown',
      auditType: j.auditType,
      serviceType: j.serviceType ?? null,
      periodEnd: j.periodEnd?.toISOString() ?? new Date().toISOString(),
      targetCompletion: j.targetCompletion?.toISOString() ?? new Date().toISOString(),
      budgetHoursSpecialist: j.budgetHoursSpecialist ?? 0,
      budgetHoursRI: j.budgetHoursRI ?? 0,
      budgetHoursReviewer: j.budgetHoursReviewer ?? 0,
      budgetHoursPreparer: j.budgetHoursPreparer ?? 0,
      engagementId: engagementMap.get(`${j.clientId}:${j.auditType}`) ?? null,
      schedulingStatus: (j.schedulingStatus ?? 'unscheduled') as SchedulingStatus,
      complianceDeadline: j.complianceDeadline?.toISOString() ?? null,
      customDeadline: j.customDeadline?.toISOString() ?? null,
      jobProfileId: j.jobProfileId ?? null,
      crmJobId: j.crmJobId ?? null,
      actualHoursSpecialist: j.actualHoursSpecialist ?? 0,
      actualHoursRI: j.actualHoursRI ?? 0,
      actualHoursReviewer: j.actualHoursReviewer ?? 0,
      actualHoursPreparer: j.actualHoursPreparer ?? 0,
      previousJobId: j.previousJobId ?? null,
    }));
  } catch (e) {
    console.error('Jobs fetch error:', e);
  }

  // Fetch allocations (3-month window)
  let allocations: any[] = [];
  try {
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 14);
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + 84);

    const allocsRaw = await prisma.resourceAllocation.findMany({
      where: {
        firmId,
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });

    allocations = allocsRaw.map((a: any) => ({
      id: a.id,
      engagementId: a.engagementId,
      userId: a.userId,
      userName: a.user?.name ?? 'Unknown',
      role: a.role as ResourceRole,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      hoursPerDay: a.hoursPerDay,
      totalHours: a.totalHours ?? null,
      notes: a.notes,
    }));
  } catch (e) {
    console.error('Allocations fetch error:', e);
  }

  // Fetch scheduling status counts
  let unscheduledCount = 0;
  let completedUnscheduledCount = 0;
  try {
    unscheduledCount = await prisma.resourceJob.count({
      where: { firmId, schedulingStatus: 'unscheduled' },
    });
    completedUnscheduledCount = await prisma.resourceJob.count({
      where: { firmId, schedulingStatus: 'completed' },
    });
  } catch {
    // schedulingStatus column may not exist yet
  }

  return (
    <Suspense fallback={null}>
      <ResourcePlanningClient
        staff={staff}
        jobs={jobs}
        allocations={allocations}
        isResourceAdmin={session.user.isResourceAdmin || session.user.isSuperAdmin}
        userId={session.user.id}
        unscheduledCount={unscheduledCount}
        completedUnscheduledCount={completedUnscheduledCount}
      />
    </Suspense>
  );
}
