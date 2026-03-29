import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  const jobs = await prisma.resourceJob.findMany({
    where: { firmId },
    include: {
      client: {
        select: { clientName: true },
      },
    },
    orderBy: { targetCompletion: 'asc' },
  });

  // Find matching engagements for each job
  const engagements = await prisma.auditEngagement.findMany({
    where: { firmId },
    select: { id: true, clientId: true, auditType: true },
  });

  const engagementMap = new Map<string, string>();
  for (const e of engagements) {
    engagementMap.set(`${e.clientId}:${e.auditType}`, e.id);
  }

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
    engagementId: engagementMap.get(`${j.clientId}:${j.auditType}`) ?? null,
    schedulingStatus: j.schedulingStatus,
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

  return Response.json({ jobs: mapped });
}
