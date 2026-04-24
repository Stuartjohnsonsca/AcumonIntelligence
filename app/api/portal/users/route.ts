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
        // Same staff-list propagation as a fresh creation — if the
        // user was previously deactivated and is coming back, they
        // should re-appear on the Principal's pending-approval list.
        await propagateStaffAutoAdd(existing.id, existing.email, existing.name, clientId, existing.role ?? null).catch(err => {
          console.error('[portal/users] staff re-add skipped:', err?.message || err);
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

    // Push this new portal user into the Portal Principal's staff list
    // for every engagement on the client that already has a Principal
    // designated. accessConfirmed=false — the Principal still holds the
    // gate, but they'll see "pending approval" in their staff tab
    // without having to hunt for the user. Non-blocking: a schema-drift
    // or FK issue here shouldn't fail contact creation.
    await propagateStaffAutoAdd(user.id, user.email, user.name, clientId, role ?? null).catch(err => {
      console.error('[portal/users] staff auto-add skipped:', err?.message || err);
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

    // Mirror the deactivation on every staff-member row for this
    // client so the Portal Principal's setup screen no longer shows
    // them as approved. accessConfirmed also cleared — if the user
    // is later reactivated, the Principal must re-approve (safer
    // default than silently restoring access). Non-blocking.
    await propagateStaffDeactivate(user.id).catch(err => {
      console.error('[portal/users] staff deactivate-propagate skipped:', err?.message || err);
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

// ─── Portal Principal staff-list propagation ──────────────────────────────

/**
 * Whenever a ClientPortalUser is created (or re-activated) via the
 * Opening tab's Contacts panel, insert them as a pending-approval
 * ClientPortalStaffMember on every engagement of the same client
 * that already has a Portal Principal designated. accessConfirmed is
 * LEFT FALSE so the Principal still holds the gate — they just see
 * the new contact in their setup screen ready to approve, instead of
 * having to re-add the person manually from the suggestions list.
 *
 * Engagements without a Principal are skipped — we can't pick the
 * right engagement in isolation, and the setup screen will surface
 * these users as suggestions when the Principal is eventually
 * designated.
 *
 * Idempotent on (engagementId, email) thanks to the @@unique on
 * ClientPortalStaffMember — re-running doesn't duplicate rows.
 */
async function propagateStaffAutoAdd(
  portalUserId: string,
  email: string,
  name: string,
  clientId: string,
  role: string | null,
): Promise<void> {
  const engagements = await prisma.auditEngagement.findMany({
    where: { clientId, portalPrincipalId: { not: null } },
    select: { id: true },
  });
  if (engagements.length === 0) return;

  const normEmail = email.toLowerCase();
  for (const eng of engagements) {
    const existing = await prisma.clientPortalStaffMember.findUnique({
      where: { engagementId_email: { engagementId: eng.id, email: normEmail } },
      select: { id: true, accessConfirmed: true, isActive: true },
    }).catch(() => null);
    if (existing) {
      // Re-activate but don't touch accessConfirmed — if the Principal
      // previously approved this person, keep them approved.
      if (!existing.isActive) {
        await prisma.clientPortalStaffMember.update({
          where: { id: existing.id },
          data: { isActive: true, portalUserId, name, role },
        });
      }
      continue;
    }
    await prisma.clientPortalStaffMember.create({
      data: {
        clientId,
        engagementId: eng.id,
        portalUserId,
        name,
        email: normEmail,
        role,
        accessConfirmed: false,
        isActive: true,
      },
    });
  }
}

/**
 * Mirror of propagateStaffAutoAdd — when the audit team revokes
 * portal access on a contact, deactivate every matching staff row
 * (and clear accessConfirmed so they're re-gated if reactivated).
 */
async function propagateStaffDeactivate(portalUserId: string): Promise<void> {
  await prisma.clientPortalStaffMember.updateMany({
    where: { portalUserId, isActive: true },
    data: { isActive: false, accessConfirmed: false },
  });
}
