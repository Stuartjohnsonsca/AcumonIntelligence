import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

/**
 * POST: Create a new sampling engagement for a client+period.
 * GET: List engagements for a client+period.
 */

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, periodId, auditArea, testingType, assertions, auditData } = body;

  if (!clientId || !periodId) {
    return NextResponse.json({ error: 'clientId and periodId required' }, { status: 400 });
  }

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  // Create engagement + audit data in a transaction
  const engagement = await prisma.samplingEngagement.create({
    data: {
      clientId,
      periodId,
      userId: session.user.id,
      auditArea: auditArea || null,
      testingType: testingType || null,
      assertions: assertions || null,
      status: 'configured',
      auditData: auditData ? {
        create: {
          performanceMateriality: auditData.performanceMateriality,
          clearlyTrivial: auditData.clearlyTrivial,
          tolerableMisstatement: auditData.tolerableMisstatement,
          functionalCurrency: auditData.functionalCurrency || 'GBP',
          dataType: auditData.dataType,
          testType: auditData.testType,
        },
      } : undefined,
    },
    include: { auditData: true },
  });

  return NextResponse.json(engagement);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const periodId = searchParams.get('periodId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const where: Record<string, unknown> = { clientId };
  if (periodId) where.periodId = periodId;

  const engagements = await prisma.samplingEngagement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      auditData: true,
      _count: { select: { runs: true, populations: true } },
    },
    take: 50,
  });

  return NextResponse.json(engagements);
}
