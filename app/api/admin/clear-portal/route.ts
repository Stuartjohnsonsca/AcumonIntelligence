import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/clear-portal
 * Clear all portal requests, outstanding items, and test executions
 * for a specific client + period. Super Admin only.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { clientName, periodEnd } = await req.json();

  // Find the client
  const client = await prisma.client.findFirst({
    where: { clientName: { contains: clientName || 'Johnsons' } },
  });
  if (!client) return NextResponse.json({ error: `Client "${clientName}" not found` }, { status: 404 });

  // Find the period ending March 2026
  const periods = await prisma.clientPeriod.findMany({
    where: { clientId: client.id },
  });
  const period = periods.find(p => {
    const end = new Date(p.endDate);
    return end.getFullYear() === 2026 && end.getMonth() === 2; // March = 2 (0-indexed)
  });
  if (!period && periodEnd) {
    return NextResponse.json({ error: 'Period ending March 2026 not found', periods: periods.map(p => ({ id: p.id, end: p.endDate })) }, { status: 404 });
  }

  const engagements = await prisma.auditEngagement.findMany({
    where: { clientId: client.id, ...(period ? { periodId: period.id } : {}) },
    select: { id: true },
  });
  const engagementIds = engagements.map(e => e.id);

  if (engagementIds.length === 0) {
    return NextResponse.json({ error: 'No engagements found', clientId: client.id, periodId: period?.id });
  }

  // Delete in order (respecting FK constraints)
  const results: Record<string, number> = {};

  // Test execution node runs
  const nodeRuns = await prisma.testExecutionNodeRun.deleteMany({
    where: { execution: { engagementId: { in: engagementIds } } },
  });
  results.nodeRuns = nodeRuns.count;

  // Outstanding items
  const outstanding = await prisma.outstandingItem.deleteMany({
    where: { engagementId: { in: engagementIds } },
  });
  results.outstandingItems = outstanding.count;

  // Test executions
  const executions = await prisma.testExecution.deleteMany({
    where: { engagementId: { in: engagementIds } },
  });
  results.testExecutions = executions.count;

  // Portal uploads
  const uploads = await prisma.portalUpload.deleteMany({
    where: { engagementId: { in: engagementIds } },
  });
  results.portalUploads = uploads.count;

  // Portal requests
  const portalRequests = await prisma.portalRequest.deleteMany({
    where: { clientId: client.id, engagementId: { in: engagementIds } },
  });
  results.portalRequests = portalRequests.count;

  return NextResponse.json({
    message: `Cleared portal data for ${client.clientName}`,
    clientId: client.id,
    periodId: period?.id,
    engagementIds,
    deleted: results,
  });
}
