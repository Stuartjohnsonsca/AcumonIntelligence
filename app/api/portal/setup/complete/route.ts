import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal } from '@/lib/portal-principal';

/**
 * POST /api/portal/setup/complete?token=X
 * Body: { engagementId }
 *
 * Portal Principal flips the switch that says "setup is done — staff
 * can now log in". Until this is called, any staff member attempting
 * to log in gets blocked at /api/portal/auth/login with
 * reason='awaiting-setup'.
 *
 * Requires that at least ONE staff member has been approved (access
 * confirmed) — otherwise completion is pointless. The Portal Principal
 * can always flip individual access grants later; this action is
 * reversible via POST again with body.undo = true.
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { engagementId, undo } = body;
  if (!engagementId) return NextResponse.json({ error: 'engagementId required' }, { status: 400 });

  const guard = await assertPortalPrincipal(user.id, engagementId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status || 403 });

  if (undo === true) {
    await prisma.auditEngagement.update({
      where: { id: engagementId },
      data: { portalSetupCompletedAt: null },
    });
    return NextResponse.json({ ok: true, setupCompletedAt: null });
  }

  // Sanity check — don't complete with zero approved staff.
  const approvedCount = await prisma.clientPortalStaffMember.count({
    where: { engagementId, isActive: true, accessConfirmed: true },
  });
  if (approvedCount === 0) {
    return NextResponse.json({
      error: 'You have not approved any staff yet. Approve at least one staff member before completing setup — otherwise no-one will be able to log in.',
    }, { status: 400 });
  }

  const now = new Date();
  await prisma.auditEngagement.update({
    where: { id: engagementId },
    data: { portalSetupCompletedAt: now },
  });
  return NextResponse.json({ ok: true, setupCompletedAt: now.toISOString() });
}
