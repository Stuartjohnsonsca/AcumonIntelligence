import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const where: any = { firmId };
  if (from && to) {
    where.startDate = { lte: new Date(to) };
    where.endDate = { gte: new Date(from) };
  }

  const allocations = await prisma.resourceAllocation.findMany({
    where,
    include: {
      user: { select: { name: true } },
    },
    orderBy: { startDate: 'asc' },
  });

  const mapped = allocations.map((a) => ({
    id: a.id,
    engagementId: a.engagementId,
    userId: a.userId,
    userName: a.user.name,
    role: a.role,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate.toISOString(),
    hoursPerDay: a.hoursPerDay,
    totalHours: a.totalHours,
    notes: a.notes,
  }));

  return Response.json({ allocations: mapped });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const body = await request.json();
  const { engagementId, userId, role, startDate, endDate, hoursPerDay, totalHours, notes } = body;

  if (!engagementId || !userId || !role || !startDate || !endDate) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const allocation = await prisma.resourceAllocation.create({
    data: {
      firmId: session.user.firmId,
      engagementId,
      userId,
      role,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      hoursPerDay: hoursPerDay ?? 7.5,
      totalHours: totalHours ?? null,
      notes: notes ?? null,
    },
    include: {
      user: { select: { name: true } },
    },
  });

  return Response.json({
    allocation: {
      id: allocation.id,
      engagementId: allocation.engagementId,
      userId: allocation.userId,
      userName: allocation.user.name,
      role: allocation.role,
      startDate: allocation.startDate.toISOString(),
      endDate: allocation.endDate.toISOString(),
      hoursPerDay: allocation.hoursPerDay,
      totalHours: allocation.totalHours,
      notes: allocation.notes,
    },
  });
}
