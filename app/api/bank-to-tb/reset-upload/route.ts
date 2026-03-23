import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId } = await req.json();

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Delete all files, transactions, and accounts for this session
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.deleteMany({ where: { sessionId } });
    await tx.bankAccount.deleteMany({ where: { sessionId } });
    await tx.bankToTBFile.deleteMany({ where: { sessionId } });

    // Cancel any running background tasks for this session
    await tx.backgroundTask.updateMany({
      where: {
        userId: session.user.id,
        type: 'bank-to-tb-parse',
        status: 'running',
      },
      data: {
        status: 'cancelled',
      },
    });
  });

  return NextResponse.json({ success: true });
}
