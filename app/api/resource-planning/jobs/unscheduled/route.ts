import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  const jobs = await prisma.resourceJob.findMany({
    where: { firmId, schedulingStatus: 'unscheduled' },
    include: {
      client: { select: { clientName: true } },
    },
    orderBy: { targetCompletion: 'asc' },
  });

  const mapped = jobs.map((j) => ({
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
    schedulingStatus: j.schedulingStatus,
    complianceDeadline: j.complianceDeadline?.toISOString() ?? null,
    customDeadline: j.customDeadline?.toISOString() ?? null,
    jobProfileId: j.jobProfileId,
    crmJobId: j.crmJobId,
    previousJobId: j.previousJobId,
  }));

  return Response.json({ jobs: mapped });
}
