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

  // Fetch staff with resource settings
  const staffRaw = await prisma.user.findMany({
    where: { firmId, isActive: true },
    select: {
      id: true,
      displayId: true,
      name: true,
      email: true,
      jobTitle: true,
      isActive: true,
      resourceStaffSetting: {
        select: {
          id: true,
          resourceRole: true,
          concurrentJobLimit: true,
          isRI: true,
          weeklyCapacityHrs: true,
          overtimeHrs: true,
          preparerJobLimit: true,
          reviewerJobLimit: true,
          riJobLimit: true,
          specialistJobLimit: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const staff = staffRaw.map((s) => ({
    id: s.id,
    displayId: s.displayId,
    name: s.name,
    email: s.email,
    jobTitle: s.jobTitle,
    isActive: s.isActive,
    resourceSetting: s.resourceStaffSetting
      ? {
          id: s.resourceStaffSetting.id,
          resourceRole: s.resourceStaffSetting.resourceRole as ResourceRole,
          concurrentJobLimit: s.resourceStaffSetting.concurrentJobLimit,
          isRI: s.resourceStaffSetting.isRI,
          weeklyCapacityHrs: s.resourceStaffSetting.weeklyCapacityHrs,
          overtimeHrs: s.resourceStaffSetting.overtimeHrs,
          preparerJobLimit: s.resourceStaffSetting.preparerJobLimit,
          reviewerJobLimit: s.resourceStaffSetting.reviewerJobLimit,
          riJobLimit: s.resourceStaffSetting.riJobLimit,
          specialistJobLimit: s.resourceStaffSetting.specialistJobLimit,
        }
      : null,
  }));

  // Fetch jobs
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

  const jobs = jobsRaw.map((j) => ({
    id: j.id,
    clientId: j.clientId,
    clientName: j.client.clientName,
    auditType: j.auditType,
    periodEnd: j.periodEnd.toISOString(),
    targetCompletion: j.targetCompletion.toISOString(),
    budgetHoursSpecialist: j.budgetHoursSpecialist,
    budgetHoursRI: j.budgetHoursRI,
    budgetHoursReviewer: j.budgetHoursReviewer,
    budgetHoursPreparer: j.budgetHoursPreparer,
    engagementId: engagementMap.get(`${j.clientId}:${j.auditType}`) ?? null,
    schedulingStatus: j.schedulingStatus as SchedulingStatus,
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

  // Fetch allocations (3-month window)
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

  const allocations = allocsRaw.map((a) => ({
    id: a.id,
    engagementId: a.engagementId,
    userId: a.userId,
    userName: a.user.name,
    role: a.role as ResourceRole,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate.toISOString(),
    hoursPerDay: a.hoursPerDay,
    totalHours: a.totalHours,
    notes: a.notes,
  }));

  // Fetch scheduling status counts
  const unscheduledCount = await prisma.resourceJob.count({
    where: { firmId, schedulingStatus: 'unscheduled' },
  });
  const completedUnscheduledCount = await prisma.resourceJob.count({
    where: { firmId, schedulingStatus: 'completed' },
  });

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
