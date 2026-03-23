import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

// GET - load or create a session for client+period
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const periodId = searchParams.get('periodId');

  if (!clientId || !periodId) {
    return NextResponse.json({ error: 'clientId and periodId are required' }, { status: 400 });
  }

  const access = await verifyClientAccess(
    { id: session.user.id, firmId: session.user.firmId || '' },
    clientId
  );
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Access denied' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Find existing session or create new one
  let btbSession = await prisma.bankToTBSession.findFirst({
    where: { clientId, periodId, userId: session.user.id },
    include: {
      files: { orderBy: { createdAt: 'asc' } },
      accounts: { orderBy: { tabOrder: 'asc' } },
      transactions: { orderBy: { sortOrder: 'asc' } },
      trialBalance: { orderBy: { sortOrder: 'asc' } },
      journals: {
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!btbSession) {
    btbSession = await prisma.bankToTBSession.create({
      data: {
        clientId,
        periodId,
        userId: session.user.id,
        firmId: user.firmId,
      },
      include: {
        files: { orderBy: { createdAt: 'asc' } },
        accounts: { orderBy: { tabOrder: 'asc' } },
        transactions: { orderBy: { sortOrder: 'asc' } },
        trialBalance: { orderBy: { sortOrder: 'asc' } },
        journals: {
          include: { lines: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Create/update tool session for navbar
    await prisma.toolSession.upsert({
      where: {
        id: `${session.user.id}-bank-to-tb-${clientId}-${periodId}`,
      },
      create: {
        id: `${session.user.id}-bank-to-tb-${clientId}-${periodId}`,
        userId: session.user.id,
        toolKey: 'bank-to-tb',
        clientId,
        periodId,
        clientName: '', // filled below
        periodLabel: '',
        toolPath: `/tools/bank-to-tb?clientId=${clientId}&periodId=${periodId}`,
      },
      update: {
        lastAccessed: new Date(),
      },
    }).catch(() => {
      // Ignore if upsert fails due to race
    });
  }

  // Update tool session with proper names
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { clientName: true } });
  const period = await prisma.clientPeriod.findUnique({ where: { id: periodId }, select: { startDate: true, endDate: true } });

  if (client && period) {
    const periodLabel = `${period.startDate.toISOString().slice(0, 10)} to ${period.endDate.toISOString().slice(0, 10)}`;
    await prisma.toolSession.upsert({
      where: {
        id: `${session.user.id}-bank-to-tb-${clientId}-${periodId}`,
      },
      create: {
        id: `${session.user.id}-bank-to-tb-${clientId}-${periodId}`,
        userId: session.user.id,
        toolKey: 'bank-to-tb',
        clientId,
        periodId,
        clientName: client.clientName,
        periodLabel,
        toolPath: `/tools/bank-to-tb?clientId=${clientId}&periodId=${periodId}`,
      },
      update: {
        clientName: client.clientName,
        periodLabel,
        lastAccessed: new Date(),
      },
    }).catch(() => {});
  }

  return NextResponse.json({ session: btbSession });
}
