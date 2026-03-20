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

  const assignments = await prisma.periodProductAssignment.findMany({
    where: { periodId },
    include: {
      user: { select: { id: true, name: true, email: true, displayId: true } },
    },
  });

  return NextResponse.json(assignments);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
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
    return NextResponse.json({ error: 'Period not found' }, { status: 404 });
  }

  const body = await req.json();
  const { productKeys, userId, category } = body as {
    productKeys: { key: string; category: string }[];
    userId: string;
    category?: string;
  };

  if (!productKeys || !userId) {
    return NextResponse.json({ error: 'productKeys and userId are required' }, { status: 400 });
  }

  // Verify user belongs to same firm
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { firmId: true } });
  if (!user || (!session.user.isSuperAdmin && user.firmId !== session.user.firmId)) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Upsert each product assignment
  const results = [];
  for (const pk of productKeys) {
    const assignment = await prisma.periodProductAssignment.upsert({
      where: {
        periodId_productKey_userId: {
          periodId,
          productKey: pk.key,
          userId,
        },
      },
      update: {},
      create: {
        periodId,
        productKey: pk.key,
        category: pk.category || category || 'Unknown',
        userId,
      },
    });
    results.push(assignment);
  }

  return NextResponse.json({ created: results.length });
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

  const body = await req.json();
  const { productKeys, userId } = body as { productKeys: string[]; userId?: string };

  if (!productKeys || !productKeys.length) {
    return NextResponse.json({ error: 'productKeys required' }, { status: 400 });
  }

  const where: Record<string, unknown> = {
    periodId,
    productKey: { in: productKeys },
  };
  if (userId) where.userId = userId;

  const result = await prisma.periodProductAssignment.deleteMany({ where });
  return NextResponse.json({ deleted: result.count });
}
