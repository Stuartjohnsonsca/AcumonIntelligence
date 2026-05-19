import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET  /api/engagements/:engagementId/planning-letter-jobs
 *   List recent Planning Letter jobs for the engagement. Polled by the
 *   client-side indicator to surface unacknowledged failures as the
 *   orange tab badge described in the spec. Query string:
 *     ?onlyUnacknowledged=1 → only jobs whose acknowledgedAt is null
 *     ?since=ISO            → only jobs updated at or after this time
 *   Defaults to the last 24h regardless.
 *
 * PUT  /api/engagements/:engagementId/planning-letter-jobs
 *   Acknowledge one or more jobs (sets acknowledgedAt = now). Body:
 *     { jobIds: string[] }
 *   Used by the orange badge's "dismiss" / "clear" action.
 */

type Ctx = { params: Promise<{ engagementId: string }> };

async function tenantCheck(engagementId: string, session: any) {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return { error: NextResponse.json({ error: 'Engagement not found' }, { status: 404 }) };
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { firmId: engagement.firmId };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const check = await tenantCheck(engagementId, session);
  if ('error' in check) return check.error;

  const { searchParams } = new URL(req.url);
  const onlyUnacknowledged = searchParams.get('onlyUnacknowledged') === '1';
  const sinceParam = searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = { engagementId, updatedAt: { gte: since } };
  if (onlyUnacknowledged) where.acknowledgedAt = null;

  const jobs = await (prisma as any).planningLetterJob.findMany({
    where: where as any,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ jobs });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const check = await tenantCheck(engagementId, session);
  if ('error' in check) return check.error;

  const body = await req.json().catch(() => null);
  const jobIds: string[] = Array.isArray(body?.jobIds) ? body.jobIds.filter((x: any) => typeof x === 'string') : [];
  if (jobIds.length === 0) {
    return NextResponse.json({ error: 'jobIds is required' }, { status: 400 });
  }

  // Scope the update to this engagement so a user can never ack a job
  // belonging to another engagement by guessing its id.
  await (prisma as any).planningLetterJob.updateMany({
    where: { id: { in: jobIds }, engagementId },
    data: { acknowledgedAt: new Date() },
  });
  return NextResponse.json({ ok: true, acknowledged: jobIds.length });
}
