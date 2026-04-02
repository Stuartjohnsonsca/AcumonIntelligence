import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: list all users across all firms (Super Admin only)
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    include: { firm: { select: { id: true, name: true } } },
    orderBy: [{ isSuperAdmin: 'desc' }, { name: 'asc' }],
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      displayId: u.displayId,
      firmId: u.firmId,
      firmName: u.firm.name,
      isSuperAdmin: u.isSuperAdmin,
      isFirmAdmin: u.isFirmAdmin,
      isMethodologyAdmin: u.isMethodologyAdmin,
      isActive: u.isActive,
      jobTitle: u.jobTitle,
    })),
  });
}

// PATCH: promote or demote a user's Super Admin status
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId, isSuperAdmin } = await request.json();

  if (!userId || typeof isSuperAdmin !== 'boolean') {
    return NextResponse.json({ error: 'userId and isSuperAdmin (boolean) are required' }, { status: 400 });
  }

  // Cannot demote yourself
  if (userId === session.user.id && !isSuperAdmin) {
    return NextResponse.json({ error: 'You cannot remove your own Super Admin access' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      isSuperAdmin,
      // When promoting, also grant firm admin + methodology admin
      ...(isSuperAdmin ? { isFirmAdmin: true, isMethodologyAdmin: true } : {}),
    },
    include: { firm: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      displayId: updated.displayId,
      firmId: updated.firmId,
      firmName: updated.firm.name,
      isSuperAdmin: updated.isSuperAdmin,
      isFirmAdmin: updated.isFirmAdmin,
      isMethodologyAdmin: updated.isMethodologyAdmin,
      isActive: updated.isActive,
      jobTitle: updated.jobTitle,
    },
  });
}
