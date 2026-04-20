import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

/**
 * GET /api/portal/my-details?token=X
 * Returns the *caller's* portal-user record and the list of clients
 * they are directly a member of. The session token is validated
 * server-side — an unknown / expired token returns 401. This replaces
 * the prior MVP behaviour which ignored the token and returned the
 * first active portal user in the database regardless of who was
 * asking (a tenant-data leak).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const me = await resolvePortalUserFromToken(token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  // Every ClientPortalUser row is scoped to one (clientId, email) pair.
  // A real person with access to multiple clients has multiple rows —
  // one per client — all sharing the same email. Look them up by email
  // so the "My Clients" list only shows clients the caller genuinely
  // has access to.
  const siblingRows = await prisma.clientPortalUser.findMany({
    where: { email: me.email, isActive: true },
    include: { client: { select: { id: true, clientName: true } } },
  });

  // Auto-promote to admin if they are the sole active user on a
  // client — unchanged from prior behaviour, but scoped now to the
  // clients they actually belong to.
  const counts: Record<string, number> = {};
  for (const row of siblingRows) {
    counts[row.clientId] = (counts[row.clientId] || 0) + 1;
  }
  const clientsMap = new Map<string, { id: string; clientName: string; isClientAdmin: boolean }>();
  for (const row of siblingRows) {
    if (!clientsMap.has(row.clientId)) {
      // We need a full count of active users on this client to decide
      // the "sole user" promotion — can't rely on just my own rows.
      clientsMap.set(row.clientId, {
        id: row.client.id,
        clientName: row.client.clientName,
        isClientAdmin: row.isClientAdmin,
      });
    }
  }
  // Second pass: sole-active-user promotion.
  for (const [clientId, info] of clientsMap) {
    if (info.isClientAdmin) continue;
    const total = await prisma.clientPortalUser.count({
      where: { clientId, isActive: true },
    });
    if (total === 1) info.isClientAdmin = true;
  }

  return NextResponse.json({
    user: { id: me.id, name: me.name, email: me.email },
    clients: Array.from(clientsMap.values()),
  });
}

/**
 * PUT /api/portal/my-details
 * Change password for the caller. Validates the token + current
 * password before writing anything.
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

    const me = await resolvePortalUserFromToken(token);
    if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

    // Load the full user record — resolvePortalUserFromToken only
    // returns the safe subset; we need passwordHash to verify the
    // current password.
    const full = await prisma.clientPortalUser.findUnique({ where: { id: me.id } });
    if (!full) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const valid = await bcrypt.compare(currentPassword, full.passwordHash);
    if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.clientPortalUser.update({
      where: { id: full.id },
      data: { passwordHash },
    });

    return NextResponse.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
