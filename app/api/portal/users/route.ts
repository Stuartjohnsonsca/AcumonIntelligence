import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPortalWelcomeEmail } from '@/lib/email-portal';

/**
 * POST /api/portal/users
 * Create a client portal user. Only accessible by firm users with client access.
 *
 * Body: { clientId, email, name, password? }
 * If password is omitted, a temporary password is generated and emailed.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { clientId, email, name, password, isClientAdmin, role } = await req.json();

    if (!clientId || !email || !name) {
      return NextResponse.json({ error: 'clientId, email, and name are required' }, { status: 400 });
    }

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if user already exists for this client
    const existing = await prisma.clientPortalUser.findFirst({
      where: { clientId, email: email.toLowerCase() },
    });

    if (existing) {
      // Re-activate if deactivated
      if (!existing.isActive) {
        await prisma.clientPortalUser.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
        return NextResponse.json({
          id: existing.id,
          email: existing.email,
          name: existing.name,
          reactivated: true,
          message: 'Portal access re-activated',
        });
      }
      return NextResponse.json({
        id: existing.id,
        email: existing.email,
        name: existing.name,
        message: 'Portal user already exists',
      });
    }

    // Generate temp password if none provided
    const tempPassword = password || crypto.randomBytes(6).toString('base64url').slice(0, 12);
    if (password && password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.clientPortalUser.create({
      data: {
        clientId,
        email: email.toLowerCase(),
        name,
        passwordHash,
        ...(isClientAdmin && { isClientAdmin: true }),
        ...(role && { role }),
      },
    });

    // Send welcome email with temp password
    try {
      await sendPortalWelcomeEmail(email, name, tempPassword);
    } catch (emailErr) {
      console.error('Failed to send portal welcome email:', emailErr);
      // Don't fail the creation — user can reset password
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      message: 'Portal user created. Login credentials sent to their email.',
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A portal user with this email already exists for this client' }, { status: 409 });
    }
    console.error('Create portal user error:', error);
    return NextResponse.json({ error: 'Failed to create portal user' }, { status: 500 });
  }
}

/**
 * GET /api/portal/users?clientId=X
 * List portal users for a client.
 */
export async function GET(req: Request) {
  // Allow both firm users and portal users to list team members
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  // Try firm auth first
  const session = await auth();
  if (session?.user?.twoFactorVerified) {
    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  // If no firm session, allow access (portal users calling from dashboard)

  const users = await prisma.clientPortalUser.findMany({
    where: { clientId },
    select: {
      id: true, email: true, name: true, isActive: true, isClientAdmin: true,
      role: true, allocatedPeriodIds: true, allocatedServices: true,
      lastLoginAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(users);
}

/**
 * DELETE /api/portal/users
 * Deactivate a client portal user.
 *
 * Body: { clientId, email }
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { clientId, email } = await req.json();

    if (!clientId || !email) {
      return NextResponse.json({ error: 'clientId and email are required' }, { status: 400 });
    }

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const user = await prisma.clientPortalUser.findFirst({
      where: { clientId, email: email.toLowerCase(), isActive: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Portal user not found' }, { status: 404 });
    }

    await prisma.clientPortalUser.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: 'Portal access deactivated' });
  } catch (error) {
    console.error('Deactivate portal user error:', error);
    return NextResponse.json({ error: 'Failed to deactivate portal user' }, { status: 500 });
  }
}

/**
 * PATCH /api/portal/users
 * Update portal user fields (role, allocatedPeriodIds).
 * Can be called by firm users or portal client admins.
 */
export async function PATCH(req: Request) {
  try {
    const { userId, role, allocatedPeriodIds, allocatedServices } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData.role = role;
    if (allocatedPeriodIds !== undefined) updateData.allocatedPeriodIds = allocatedPeriodIds;
    if (allocatedServices !== undefined) updateData.allocatedServices = allocatedServices;

    const updated = await prisma.clientPortalUser.update({
      where: { id: userId },
      data: updateData,
    });

    return NextResponse.json({ success: true, user: { id: updated.id, role: updated.role, allocatedPeriodIds: updated.allocatedPeriodIds } });
  } catch (error) {
    console.error('Update portal user error:', error);
    return NextResponse.json({ error: 'Failed to update portal user' }, { status: 500 });
  }
}
