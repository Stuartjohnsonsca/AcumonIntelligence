import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

/**
 * GET /api/portal/my-details?token=X
 * Get the portal user's details and their clients.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 401 });

  // Find all active portal users (MVP — in production, validate token against session)
  const portalUsers = await prisma.clientPortalUser.findMany({
    where: { isActive: true },
    include: {
      client: { select: { id: true, clientName: true } },
    },
  });

  if (portalUsers.length === 0) {
    return NextResponse.json({ error: 'No portal users found' }, { status: 404 });
  }

  // Get the first user as the "current" user (MVP)
  const currentUser = portalUsers[0];

  // Get all clients this user has access to
  // Auto-promote to admin if they're the only active user for a client
  const clients = portalUsers.map(pu => ({
    id: pu.client.id,
    clientName: pu.client.clientName,
    isClientAdmin: pu.isClientAdmin || portalUsers.filter(p => p.clientId === pu.clientId && p.isActive).length === 1,
  }));

  // Deduplicate
  const uniqueClients = Array.from(new Map(clients.map(c => [c.id, c])).values());

  return NextResponse.json({
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
    },
    clients: uniqueClients,
  });
}

/**
 * PUT /api/portal/my-details
 * Change password for the portal user.
 */
export async function PUT(req: Request) {
  try {
    const { token, currentPassword, newPassword } = await req.json();
    if (!token || !currentPassword || !newPassword) {
      return NextResponse.json({ error: 'All fields required' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Find portal user (MVP — validate token properly in production)
    const portalUser = await prisma.clientPortalUser.findFirst({
      where: { isActive: true },
    });
    if (!portalUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, portalUser.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.clientPortalUser.update({
      where: { id: portalUser.id },
      data: { passwordHash },
    });

    return NextResponse.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
