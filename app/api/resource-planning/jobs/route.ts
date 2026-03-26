import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
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
    budgetHoursRI: j.budgetHoursRI,
    budgetHoursReviewer: j.budgetHoursReviewer,
    budgetHoursPreparer: j.budgetHoursPreparer,
    engagementId: engagementMap.get(`${j.clientId}:${j.auditType}`) ?? null,
  }));

  return Response.json({ jobs: mapped });
}
