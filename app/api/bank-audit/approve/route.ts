import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { sessionId, userName, userId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const auditSession = await prisma.bankAuditSession.findUnique({
      where: { id: sessionId },
    });

    if (!auditSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    await prisma.bankAuditSession.update({
      where: { id: sessionId },
      data: {
        status: 'approved',
        reviewedBy: `${userName} (${userId})`,
        reviewedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, approvedAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[BankAudit Approve]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
