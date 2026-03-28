import { Suspense } from 'react';
import { redirect } from 'next/navigation';

export const revalidate = 60; // cache page for 60 seconds
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
  const now = new Date();
  const rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate() - 14);
  const rangeEnd = new Date(now); rangeEnd.setDate(rangeEnd.getDate() + 84);

  // Run all queries in parallel
  const [staffRaw, jobsRaw, engagements, allocsRaw, unscheduledCount, completedUnscheduledCount, jobProfilesRaw, clientSettingsRaw] = await Promise.all([
    prisma.user.findMany({
      where: { firmId, isActive: true, resourceStaffSetting: { isNot: null } },
      select: {
        id: true, displayId: true, name: true, email: true, jobTitle: true, isActive: true,
        resourceStaffSetting: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.resourceJob.findMany({
      where: { firmId },
      include: { client: { select: { clientName: true } } },
      orderBy: { targetCompletion: 'asc' },
    }),
    prisma.auditEngagement.findMany({
      where: { firmId },
      select: { id: true, clientId: true, auditType: true },
    }),
    prisma.resourceAllocation.findMany({
      where: { firmId, startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    }),
    prisma.resourceJob.count({ where: { firmId, schedulingStatus: 'unscheduled' } }).catch(() => 0),
    prisma.resourceJob.count({ where: { firmId, schedulingStatus: 'completed' } }).catch(() => 0),
    prisma.resourceJobProfile.findMany({ where: { firmId }, orderBy: { name: 'asc' } }),
    prisma.resourceClientSetting.findMany({ where: { firmId }, select: { clientId: true, serviceType: true } }).catch(() => []),
  ]);

  const engagementMap = new Map<string, string>();
  for (const e of engagements) {
    engagementMap.set(`${e.clientId}:${e.auditType}`, e.id);
  }

  // Map clientId → serviceType for auto-profile matching
  const clientServiceTypeMap = new Map<string, string>();
  for (const cs of (clientSettingsRaw as any[])) {
    if (cs.serviceType) clientServiceTypeMap.set(cs.clientId, cs.serviceType);
  }

  const jobProfiles = (jobProfilesRaw as any[]).map((p) => ({
    id: p.id,
    firmId: p.firmId,
    name: p.name,
    budgetHoursSpecialist: p.budgetHoursSpecialist ?? 0,
    budgetHoursRI: p.budgetHoursRI ?? 0,
    budgetHoursReviewer: p.budgetHoursReviewer ?? 0,
    budgetHoursPreparer: p.budgetHoursPreparer ?? 0,
    budgetHoursSpecialistDetail: (p.budgetHoursSpecialistDetail as Record<string, number>) ?? {},
    isDefault: p.isDefault ?? false,
  }));

  const staff = staffRaw.map((s: any) => ({
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

  const jobs = jobsRaw.map((j: any) => ({
    id: j.id,
    clientId: j.clientId,
    clientName: j.client?.clientName ?? 'Unknown',
    auditType: j.auditType,
    periodEnd: j.periodEnd?.toISOString() ?? new Date().toISOString(),
    targetCompletion: j.targetCompletion?.toISOString() ?? new Date().toISOString(),
    budgetHoursSpecialist: j.budgetHoursSpecialist ?? 0,
    budgetHoursRI: j.budgetHoursRI ?? 0,
    budgetHoursReviewer: j.budgetHoursReviewer ?? 0,
    budgetHoursPreparer: j.budgetHoursPreparer ?? 0,
    serviceType: clientServiceTypeMap.get(j.clientId) ?? null,
    engagementId: engagementMap.get(`${j.clientId}:${j.auditType}`) ?? null,
    schedulingStatus: (j.schedulingStatus ?? 'unscheduled') as SchedulingStatus,
    isScheduleLocked: j.isScheduleLocked ?? false,
    complianceDeadline: j.complianceDeadline?.toISOString() ?? null,
    customDeadline: j.customDeadline?.toISOString() ?? null,
    jobProfileId: j.jobProfileId ?? null,
    crmJobId: j.crmJobId ?? null,
    actualHoursSpecialist: j.actualHoursSpecialist ?? 0,
    actualHoursRI: j.actualHoursRI ?? 0,
    actualHoursReviewer: j.actualHoursReviewer ?? 0,
    actualHoursPreparer: j.actualHoursPreparer ?? 0,
    previousJobId: j.previousJobId ?? null,
    timesheetHours: j.timesheetHours ?? 0,
  }));

  const allocations = allocsRaw.map((a: any) => ({
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

  return (
    <Suspense fallback={null}>
      <ResourcePlanningClient
        staff={staff}
        jobs={jobs}
        allocations={allocations}
        jobProfiles={jobProfiles}
        isResourceAdmin={session.user.isResourceAdmin || session.user.isSuperAdmin}
        userId={session.user.id}
        unscheduledCount={unscheduledCount}
        completedUnscheduledCount={completedUnscheduledCount}
      />
    </Suspense>
  );
}
