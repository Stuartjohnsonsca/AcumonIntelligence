import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { AllocationChange } from '@/lib/resource-planning/types';

export async function POST(request: NextRequest) {
  try {
    return await handleCommit(request);
  } catch (err: any) {
    console.error('[optimize/commit] Unhandled error:', err);
    return Response.json({ error: `Commit error: ${err?.message ?? 'unknown'}` }, { status: 500 });
  }
}

async function handleCommit(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  let body: { changes?: AllocationChange[]; scope?: 'all' | 'unscheduled' } = {};
  try { body = await request.json(); } catch { /* default */ }

  const changes = body.changes ?? [];
  if (changes.length === 0) {
    return Response.json({ committed: 0 });
  }

  // scope determines whether we replace existing allocations for these jobs.
  // 'unscheduled' → jobs had no prior schedule; never delete existing allocations.
  // 'all'         → full reschedule; replace previous allocations for the same jobs.
  const scope = body.scope ?? 'unscheduled';

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

  // Pre-compute all allocation rows before the transaction (working-day count is CPU work)
  function countWorkingDays(start: Date, end: Date): number {
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  const rowsToCreate = toCreate.map((c) => {
    const engagementId = jobEngagementIdMap.get(c.jobId) ?? c.jobId;
    const start = new Date(c.startDate);
    const end = new Date(c.endDate);
    const totalHours = Math.round(c.hoursPerDay * countWorkingDays(start, end) * 100) / 100;
    return { firmId, engagementId, userId: c.userId, role: c.role, startDate: start, endDate: end, hoursPerDay: c.hoursPerDay, totalHours, notes: 'Scheduled by Resource Optimiser' };
  });

  // For 'all' scope: replace existing allocations for these jobs (full reschedule).
  // For 'unscheduled' scope: jobs had no prior schedule — never delete existing allocations.
  const engagementIdsToReplace = scope === 'all'
    ? [...new Set(rowsToCreate.map((r) => r.engagementId))]
    : [];

  // Single transaction: at most 3 DB operations — no per-row round-trips
  await prisma.$transaction([
    ...(engagementIdsToReplace.length > 0
      ? [prisma.resourceAllocation.deleteMany({
          where: { engagementId: { in: engagementIdsToReplace }, firmId },
        })]
      : []),
    ...(rowsToCreate.length > 0
      ? [prisma.resourceAllocation.createMany({ data: rowsToCreate })]
      : []),
    ...(scheduledJobIds.length > 0
      ? [prisma.resourceJob.updateMany({
          where: { id: { in: scheduledJobIds }, firmId, schedulingStatus: { in: ['unscheduled', 'pre_scheduled'] } },
          data: { schedulingStatus: 'scheduled' },
        })]
      : []),
  ]);

  return Response.json({ committed: rowsToCreate.length });
}
