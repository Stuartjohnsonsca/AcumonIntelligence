import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    budgetHoursSpecialist,
    budgetHoursRI,
    budgetHoursReviewer,
    budgetHoursPreparer,
    startDate,
    endDate,
    allocations,
  } = body;

  // Fetch the original job
  const originalJob = await prisma.resourceJob.findUnique({ where: { id } });
  if (!originalJob) {
    return Response.json({ error: 'Original job not found' }, { status: 404 });
  }

  // Create the rolled-forward job with previousJobId pointing to original
  const newJob = await prisma.resourceJob.create({
    data: {
      firmId: originalJob.firmId,
      clientId: originalJob.clientId,
      auditType: originalJob.auditType,
      periodEnd: endDate ? new Date(endDate) : originalJob.periodEnd,
      targetCompletion: endDate ? new Date(endDate) : originalJob.targetCompletion,
      budgetHoursSpecialist: budgetHoursSpecialist ?? originalJob.budgetHoursSpecialist,
      budgetHoursRI: budgetHoursRI ?? originalJob.budgetHoursRI,
      budgetHoursReviewer: budgetHoursReviewer ?? originalJob.budgetHoursReviewer,
      budgetHoursPreparer: budgetHoursPreparer ?? originalJob.budgetHoursPreparer,
      schedulingStatus: 'unscheduled',
      jobProfileId: originalJob.jobProfileId,
      previousJobId: id,
    },
    include: {
      client: { select: { clientName: true } },
    },
  });

  // Create allocations if provided
  if (allocations && Array.isArray(allocations) && allocations.length > 0) {
    // Look up engagement for the client+auditType
    const engagement = await prisma.auditEngagement.findFirst({
      where: { clientId: originalJob.clientId, auditType: originalJob.auditType },
      select: { id: true },
    });

    if (engagement) {
      await prisma.resourceAllocation.createMany({
        data: allocations.map((a: { userId: string; role: string; startDate: string; endDate: string; hoursPerDay?: number; totalHours?: number }) => ({
          firmId: originalJob.firmId,
          engagementId: engagement.id,
          userId: a.userId,
          role: a.role,
          startDate: new Date(a.startDate),
          endDate: new Date(a.endDate),
          hoursPerDay: a.hoursPerDay ?? 7.5,
          totalHours: a.totalHours ?? null,
        })),
      });
    }
  }

  return Response.json({
    job: {
      id: newJob.id,
      clientId: newJob.clientId,
      clientName: newJob.client.clientName,
      auditType: newJob.auditType,
      periodEnd: newJob.periodEnd.toISOString(),
      targetCompletion: newJob.targetCompletion.toISOString(),
      budgetHoursSpecialist: newJob.budgetHoursSpecialist,
      budgetHoursRI: newJob.budgetHoursRI,
      budgetHoursReviewer: newJob.budgetHoursReviewer,
      budgetHoursPreparer: newJob.budgetHoursPreparer,
      schedulingStatus: newJob.schedulingStatus,
      complianceDeadline: newJob.complianceDeadline?.toISOString() ?? null,
      customDeadline: newJob.customDeadline?.toISOString() ?? null,
      jobProfileId: newJob.jobProfileId,
      crmJobId: newJob.crmJobId,
      actualHoursSpecialist: newJob.actualHoursSpecialist,
      actualHoursRI: newJob.actualHoursRI,
      actualHoursReviewer: newJob.actualHoursReviewer,
      actualHoursPreparer: newJob.actualHoursPreparer,
      previousJobId: newJob.previousJobId,
    },
  }, { status: 201 });
}
