import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST - mark out-of-period transactions
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: { period: true },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const { startDate, endDate } = btbSession.period;

  // Mark transactions outside the period
  const result = await prisma.bankTransaction.updateMany({
    where: {
      sessionId,
      OR: [
        { date: { lt: startDate } },
        { date: { gt: endDate } },
      ],
    },
    data: { inPeriod: false },
  });

  return NextResponse.json({
    success: true,
    removedCount: result.count,
  });
}
