import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { engagementId, userId, role, startDate, endDate, hoursPerDay, notes } = body;

  const allocation = await prisma.resourceAllocation.update({
    where: { id },
    data: {
      ...(engagementId !== undefined && { engagementId }),
      ...(userId !== undefined && { userId }),
      ...(role !== undefined && { role }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(hoursPerDay !== undefined && { hoursPerDay }),
      ...(notes !== undefined && { notes }),
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
      notes: allocation.notes,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { id } = await params;

  await prisma.resourceAllocation.delete({ where: { id } });

  return Response.json({ ok: true });
}
