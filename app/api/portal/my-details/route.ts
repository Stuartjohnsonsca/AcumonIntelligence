import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { resolvePortalUserFromToken, resolvePortalUserFromTokenDetailed } from '@/lib/portal-session';

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
  const { user: me, reason } = await resolvePortalUserFromTokenDetailed(token);
  if (!me) {
    // Extra diagnostic — why couldn't we resolve the token?
    // Surface the DB-side signal so the root cause is visible in the
    // browser network tab. Only revealed on 401, so no user data leaks.
    const diag: Record<string, unknown> = { reason };
    try {
      const colCheck = await prisma.$queryRaw<Array<{ session_token_exists: boolean; session_expires_at_exists: boolean }>>`
        SELECT
          EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'client_portal_users' AND column_name = 'session_token') AS session_token_exists,
          EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'client_portal_users' AND column_name = 'session_expires_at') AS session_expires_at_exists
      `;
      diag.sessionTokenColumn = colCheck[0]?.session_token_exists ?? null;
      diag.sessionExpiresAtColumn = colCheck[0]?.session_expires_at_exists ?? null;
    } catch (e) {
      diag.columnCheckError = (e as any)?.message || 'unknown';
    }
    if (diag.sessionTokenColumn) {
      try {
        // How many rows have ANY non-null session_token? Non-zero
        // means persistence is working for somebody even if not for
        // this caller.
        const withToken = await prisma.clientPortalUser.count({ where: { sessionToken: { not: null } } });
        diag.rowsWithAnyToken = withToken;
        // Is THIS token in the DB (without the isActive filter)?
        if (token && typeof token === 'string' && token.length >= 16) {
          const thisToken = await prisma.clientPortalUser.findFirst({
            where: { sessionToken: token },
            select: { id: true, isActive: true, sessionExpiresAt: true },
          });
          diag.thisTokenFound = !!thisToken;
          if (thisToken) {
            diag.thisTokenUserActive = thisToken.isActive;
            diag.thisTokenExpiresAt = thisToken.sessionExpiresAt?.toISOString() || null;
          }
        }
      } catch (e) {
        diag.rowQueryError = (e as any)?.message || 'unknown';
      }
    }
    return NextResponse.json({ error: 'Invalid or expired session', ...diag }, { status: 401 });
  }

  // Every ClientPortalUser row is scoped to one (clientId, email) pair.
  // A real person with access to multiple clients has multiple rows —
  // one per client — all sharing the same email. Look them up by email
  // so the "My Clients" list only shows clients the caller genuinely
  // has access to.
  const siblingRows = await prisma.clientPortalUser.findMany({
    where: { email: me.email, isActive: true },
    select: {
      id: true,
      clientId: true,
      email: true,
      isClientAdmin: true,
      client: { select: { id: true, clientName: true } },
    },
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
    // current password. Explicit select keeps this safe across
    // migration states (no accidental SELECTs on session_token).
    const full = await prisma.clientPortalUser.findUnique({
      where: { id: me.id },
      select: { id: true, passwordHash: true },
    });
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
