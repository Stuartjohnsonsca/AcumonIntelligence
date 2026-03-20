import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { firmId: true } });
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && client.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const periods = await prisma.clientPeriod.findMany({
    where: { clientId },
    orderBy: { startDate: 'desc' },
    include: {
      productAssignments: {
        include: {
          user: { select: { id: true, name: true, email: true, displayId: true } },
        },
      },
    },
  });

  return NextResponse.json(periods);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
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

  const body = await req.json();
  const { startDate, endDate } = body;

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end <= start) {
    return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 });
  }

  // Check for overlapping periods
  const overlapping = await prisma.clientPeriod.findFirst({
    where: {
      clientId,
      OR: [
        { startDate: { lte: end }, endDate: { gte: start } },
      ],
    },
  });

  if (overlapping) {
    return NextResponse.json({ error: 'Period overlaps with an existing period' }, { status: 400 });
  }

  const period = await prisma.clientPeriod.create({
    data: { clientId, startDate: start, endDate: end },
  });

  return NextResponse.json(period);
}
