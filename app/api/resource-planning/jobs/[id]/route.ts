import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(
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
    schedulingStatus,
    budgetHoursSpecialist,
    budgetHoursRI,
    budgetHoursReviewer,
    budgetHoursPreparer,
    jobProfileId,
    customDeadline,
    complianceDeadline,
  } = body;

  const job = await prisma.resourceJob.update({
    where: { id },
    data: {
      ...(schedulingStatus !== undefined && { schedulingStatus }),
      ...(budgetHoursSpecialist !== undefined && { budgetHoursSpecialist }),
      ...(budgetHoursRI !== undefined && { budgetHoursRI }),
      ...(budgetHoursReviewer !== undefined && { budgetHoursReviewer }),
      ...(budgetHoursPreparer !== undefined && { budgetHoursPreparer }),
      ...(jobProfileId !== undefined && { jobProfileId }),
      ...(customDeadline !== undefined && { customDeadline: customDeadline ? new Date(customDeadline) : null }),
      ...(complianceDeadline !== undefined && {
        complianceDeadline: complianceDeadline ? new Date(complianceDeadline) : null,
      }),
    },
    include: {
      client: { select: { clientName: true } },
    },
  });

  return Response.json({
    job: {
      id: job.id,
      clientId: job.clientId,
      clientName: job.client.clientName,
      auditType: job.auditType,
      periodEnd: job.periodEnd.toISOString(),
      targetCompletion: job.targetCompletion.toISOString(),
      budgetHoursSpecialist: job.budgetHoursSpecialist,
      budgetHoursRI: job.budgetHoursRI,
      budgetHoursReviewer: job.budgetHoursReviewer,
      budgetHoursPreparer: job.budgetHoursPreparer,
      schedulingStatus: job.schedulingStatus,
      isScheduleLocked: job.isScheduleLocked,
      complianceDeadline: job.complianceDeadline?.toISOString() ?? null,
      customDeadline: job.customDeadline?.toISOString() ?? null,
      jobProfileId: job.jobProfileId,
      crmJobId: job.crmJobId,
      actualHoursSpecialist: job.actualHoursSpecialist,
      actualHoursRI: job.actualHoursRI,
      actualHoursReviewer: job.actualHoursReviewer,
      actualHoursPreparer: job.actualHoursPreparer,
      previousJobId: job.previousJobId,
    },
  });
}

// PATCH /api/resource-planning/jobs/[id] — toggle schedule lock
export async function PATCH(
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
  const { isScheduleLocked } = await request.json();

  const job = await prisma.resourceJob.update({
    where: { id, firmId: session.user.firmId },
    data: { isScheduleLocked },
  });

  return Response.json({ id: job.id, isScheduleLocked: job.isScheduleLocked });
}
