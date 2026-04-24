import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal } from '@/lib/portal-principal';

/**
 * POST /api/portal/setup/staff?token=X
 * Body: { engagementId, name, email, role?, accessConfirmed?, inheritedFromEngagementId? }
 *
 * Add (or re-activate) a staff member on the Portal Principal's
 * curated list. Resolves the ClientPortalUser by email — creates a
 * new one with a random temp password if none exists. The Portal
 * Principal can also pre-tick `accessConfirmed` at creation time to
 * save a second click; if left false, the row is shown in "pending
 * approval" on the setup screen.
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { engagementId, name, email, role, accessConfirmed, inheritedFromEngagementId } = body;
  if (!engagementId || !name || !email) {
    return NextResponse.json({ error: 'engagementId, name and email are required' }, { status: 400 });
  }

  const guard = await assertPortalPrincipal(user.id, engagementId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status || 403 });

  const normEmail = String(email).toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(normEmail)) {
    return NextResponse.json({ error: 'Email looks invalid.' }, { status: 400 });
  }

  // Resolve / create the underlying ClientPortalUser. A brand-new
  // user gets a random hashed password; they'll reset it via the
  // normal "forgot password" flow on first login.
  let portalUserRecord = await prisma.clientPortalUser.findFirst({
    where: { clientId: guard.clientId!, email: normEmail },
    select: { id: true, isActive: true },
  });
  if (!portalUserRecord) {
    const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
    portalUserRecord = await prisma.clientPortalUser.create({
      data: {
        clientId: guard.clientId!,
        email: normEmail,
        name: String(name).trim(),
        passwordHash: tempHash,
        role: role || null,
        isActive: true,
        isClientAdmin: false,
      },
      select: { id: true, isActive: true },
    });
  } else if (!portalUserRecord.isActive) {
    await prisma.clientPortalUser.update({
      where: { id: portalUserRecord.id },
      data: { isActive: true, name: String(name).trim(), role: role || null },
    });
  }

  // Upsert the staff-member row. Idempotent on (engagementId, email).
  const existing = await prisma.clientPortalStaffMember.findUnique({
    where: { engagementId_email: { engagementId, email: normEmail } },
    select: { id: true },
  }).catch(() => null);

  const data = {
    clientId: guard.clientId!,
    engagementId,
    portalUserId: portalUserRecord.id,
    name: String(name).trim(),
    email: normEmail,
    role: role ? String(role) : null,
    accessConfirmed: accessConfirmed === true,
    isActive: true,
    inheritedFromEngagementId: inheritedFromEngagementId || null,
    addedByPortalUserId: user.id,
  };

  const row = existing
    ? await prisma.clientPortalStaffMember.update({ where: { id: existing.id }, data })
    : await prisma.clientPortalStaffMember.create({ data });

  return NextResponse.json({ ok: true, staff: row });
}
