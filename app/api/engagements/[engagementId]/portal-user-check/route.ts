import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/:id/portal-user-check?email=foo@bar.com
 *
 * Probe used by the Documents tab when the user picks 'Portal' as the
 * delivery method on a request — tells them up-front whether the
 * 'Requested To' email actually maps to a registered Client Portal
 * user for this engagement's client. If not, the UI flags it and the
 * user can either invite that person to the portal first or switch
 * to email/download.
 *
 * Read-only. Looks up by (clientId, email) — the same compound unique
 * the ClientPortalUser model declares. Returns 200 with a structured
 * result regardless of match status (200 + isPortalUser: false rather
 * than 404) so the client can render the inline flag without
 * branching on HTTP status.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ isPortalUser: false, reason: 'No email supplied' });
  }

  const portalUser = await prisma.clientPortalUser.findFirst({
    where: { clientId: eng.clientId, email: { equals: email, mode: 'insensitive' }, isActive: true },
    select: { id: true, name: true, role: true },
  });

  if (!portalUser) {
    return NextResponse.json({
      isPortalUser: false,
      reason: 'No active Client Portal user with that email belongs to this engagement’s client. Add them via the Portal tab → Manage Staff before sending a portal request, or use Email / Download.',
    });
  }

  return NextResponse.json({
    isPortalUser: true,
    portalUserId: portalUser.id,
    portalUserName: portalUser.name,
    portalUserRole: portalUser.role || null,
  });
}
