import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getEngagementUserRole, isReadOnlyRole } from '@/lib/auth/engagement-auth';

/**
 * GET /api/engagements/:engagementId/my-role
 *
 * Light-weight read-only endpoint that returns the caller's role on
 * this engagement, plus a derived `isReadOnly` flag. Used by the
 * methodology UI to render a read-only banner for EQR / Regulatory
 * Reviewers without each tab having to know about the role lookup.
 *
 * Response:
 *   { role: string | null, isReadOnly: boolean,
 *     isMethodologyAdmin: boolean, isSuperAdmin: boolean }
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  // Tenant guard. Super-admins can see any engagement; everyone else
  // must be on the same firm. Without this, a regulator could probe
  // other firms' engagement IDs to leak roles.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const role = await getEngagementUserRole(engagementId, session.user.id!);
  return NextResponse.json({
    role,
    isReadOnly: isReadOnlyRole(role),
    isMethodologyAdmin: Boolean(session.user.isMethodologyAdmin),
    isSuperAdmin: Boolean(session.user.isSuperAdmin),
  });
}
