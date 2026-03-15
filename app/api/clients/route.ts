import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const firmId = searchParams.get('firmId') || session.user.firmId;

  const clients = await prisma.client.findMany({
    where: { firmId },
    include: { _count: { select: { subscriptions: true, userAssignments: true } } },
    orderBy: { clientName: 'asc' },
  });

  return NextResponse.json(clients);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { clientName, software, contactName, contactEmail, firmId } = await req.json();
  const targetFirmId = session.user.isSuperAdmin ? firmId : session.user.firmId;

  const client = await prisma.client.create({
    data: { clientName, software, contactName, contactEmail, firmId: targetFirmId },
  });

  return NextResponse.json({ id: client.id });
}
