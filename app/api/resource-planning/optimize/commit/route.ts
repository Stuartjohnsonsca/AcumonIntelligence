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

  let committed = 0;

  await prisma.$transaction(async (tx) => {
    // Delete removed allocations
    if (toDelete.length > 0) {
      await tx.resourceAllocation.deleteMany({
        where: { id: { in: toDelete }, firmId },
      });
    }

    // Create new allocations
    for (const c of toCreate) {
      await tx.resourceAllocation.create({
        data: {
          firmId,
          engagementId: c.jobId,
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
    // Only update jobs currently at unscheduled or pre_scheduled
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
