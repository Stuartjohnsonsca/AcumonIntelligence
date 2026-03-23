import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { id: clientId, periodId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { firmId: true } });
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && client.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const period = await prisma.clientPeriod.findUnique({
    where: { id: periodId },
    include: {
      productAssignments: {
        include: {
          user: { select: { id: true, name: true, email: true, displayId: true } },
        },
      },
    },
  });

  if (!period || period.clientId !== clientId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(period);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { id: clientId, periodId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { firmId: true } });
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && client.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const period = await prisma.clientPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.clientId !== clientId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.clientPeriod.delete({ where: { id: periodId } });
  return NextResponse.json({ ok: true });
}
