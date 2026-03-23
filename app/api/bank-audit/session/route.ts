import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { clientId, periodId } = await req.json();
  if (!clientId || !periodId) {
    return NextResponse.json({ error: 'clientId and periodId required' }, { status: 400 });
  }

  const user = session.user as { id: string; firmId: string; isSuperAdmin?: boolean };
  const access = await verifyClientAccess(user, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    // Find existing or create new
    const existing = await prisma.bankAuditSession.findUnique({
      where: {
        clientId_periodId_userId: { clientId, periodId, userId: user.id },
      },
      include: { tests: true, files: true },
    });

    if (existing) {
      // Register/update tool session
      await prisma.toolSession.upsert({
        where: { id: existing.id },
        create: {
          id: existing.id,
          userId: user.id,
          toolKey: 'bank-audit',
          clientId,
          periodId,
          clientName: (await prisma.client.findUnique({ where: { id: clientId }, select: { clientName: true } }))?.clientName || '',
          periodLabel: '',
          toolPath: `/tools/bank-audit?session=${existing.id}`,
        },
        update: { lastAccessed: new Date() },
      });

      return NextResponse.json({ sessionId: existing.id, session: existing });
    }

    const newSession = await prisma.bankAuditSession.create({
      data: {
        userId: user.id,
        clientId,
        periodId,
        status: 'draft',
      },
    });

    // Register tool session
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { clientName: true } });
    const period = await prisma.clientPeriod.findUnique({ where: { id: periodId }, select: { startDate: true, endDate: true } });
    const periodLabel = period
      ? `${period.startDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} – ${period.endDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
      : '';

    await prisma.toolSession.create({
      data: {
        id: newSession.id,
        userId: user.id,
        toolKey: 'bank-audit',
        clientId,
        periodId,
        clientName: client?.clientName || '',
        periodLabel,
        toolPath: `/tools/bank-audit?session=${newSession.id}`,
      },
    });

    return NextResponse.json({ sessionId: newSession.id, session: newSession });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[BankAudit Session]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
