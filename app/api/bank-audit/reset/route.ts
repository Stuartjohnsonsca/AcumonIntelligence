import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { sessionId } = await req.json();
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

    const auditSession = await prisma.bankAuditSession.findUnique({ where: { id: sessionId } });
    if (!auditSession || auditSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Delete all associated files
    await prisma.bankAuditFile.deleteMany({ where: { sessionId } });

    // Clear bank data and reset source
    await prisma.bankAuditSession.update({
      where: { id: sessionId },
      data: {
        dataSource: null,
        bankData: Prisma.DbNull,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[BankAudit Reset]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
