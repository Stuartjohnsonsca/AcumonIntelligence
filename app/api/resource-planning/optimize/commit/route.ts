import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { AllocationChange } from '@/lib/resource-planning/types';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  let body: { changes?: AllocationChange[] } = {};
  try { body = await request.json(); } catch { /* default */ }

  const changes = body.changes ?? [];
  if (changes.length === 0) {
    return Response.json({ committed: 0 });
  }

  const toDelete = changes.filter((c) => c.action === 'delete' && c.existingId).map((c) => c.existingId!);
  const toCreate = changes.filter((c) => c.action === 'create');

  // Collect job IDs that gain new allocations (for status update)
  const scheduledJobIds = [...new Set(toCreate.map((c) => c.jobId))];

  // ── Build engagementId map ────────────────────────────────────────────────
  // The resource planning grid matches allocations to jobs using:
  //   job.engagementId (AuditEngagement.id, keyed by clientId:auditType) || job.id
  // We must store the same engagementId so new allocations are visible in the grid.
  const jobsForCommit = scheduledJobIds.length > 0
    ? await prisma.resourceJob.findMany({
        where: { id: { in: scheduledJobIds }, firmId },
        select: { id: true, clientId: true, auditType: true },
      })
    : [];

  const clientIds = [...new Set(jobsForCommit.map((j) => j.clientId))];
  const engagementsForCommit = clientIds.length > 0
    ? await prisma.auditEngagement.findMany({
        where: { clientId: { in: clientIds }, firmId },
        select: { id: true, clientId: true, auditType: true },
      })
    : [];

  // Map: "clientId:auditType" → AuditEngagement.id
  const engagementMap = new Map<string, string>();
  for (const e of engagementsForCommit) {
    engagementMap.set(`${e.clientId}:${e.auditType}`, e.id);
  }

  // Map: ResourceJob.id → correct engagementId (AuditEngagement.id or ResourceJob.id)
  const jobEngagementIdMap = new Map<string, string>();
  for (const j of jobsForCommit) {
    const auditEngagementId = engagementMap.get(`${j.clientId}:${j.auditType}`);
    jobEngagementIdMap.set(j.id, auditEngagementId ?? j.id);
  }

  let committed = 0;

  await prisma.$transaction(async (tx) => {
    // Delete removed allocations
    if (toDelete.length > 0) {
      await tx.resourceAllocation.deleteMany({
        where: { id: { in: toDelete }, firmId },
      });
    }

    // Create new allocations using the correct engagementId for the grid
    for (const c of toCreate) {
      const engagementId = jobEngagementIdMap.get(c.jobId) ?? c.jobId;
      await tx.resourceAllocation.create({
        data: {
          firmId,
          engagementId,
          userId: c.userId,
          role: c.role,
          startDate: new Date(c.startDate),
          endDate: new Date(c.endDate),
          hoursPerDay: c.hoursPerDay,
        },
      });
      committed++;
    }

    // Update job status to 'scheduled' for jobs that gained allocations
    if (scheduledJobIds.length > 0) {
      await tx.resourceJob.updateMany({
        where: {
          id: { in: scheduledJobIds },
          firmId,
          schedulingStatus: { in: ['unscheduled', 'pre_scheduled'] },
        },
        data: { schedulingStatus: 'scheduled' },
      });
    }
  });

  return Response.json({ committed });
}
