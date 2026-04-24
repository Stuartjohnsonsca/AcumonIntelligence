import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

/**
 * GET /api/portal/ai-search/featured?token=X&firmId=Y
 *
 * Returns the firm's featured searches so the Principal dashboard
 * can render them as chips alongside the user's own saved searches.
 * Zero-AI replay (interpretedFilters is cached on the log row).
 *
 * firmId is derived server-side from the caller's engagement
 * context — we could accept one from the client, but trusting the
 * Portal Principal's engagement's firm is tighter.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const engagementId = searchParams.get('engagementId');
  if (!token || !engagementId) return NextResponse.json({ error: 'token and engagementId required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  // Verify the engagement belongs to a firm the caller has access to,
  // then pull the firm's featured searches.
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, portalPrincipalId: true, clientId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  // Access check: caller is either the Portal Principal OR an
  // approved staff member on this engagement. Same rule the rest of
  // the portal uses.
  if (eng.portalPrincipalId !== user.id) {
    const staffRow = await prisma.clientPortalStaffMember.findFirst({
      where: { engagementId, portalUserId: user.id, isActive: true, accessConfirmed: true },
      select: { id: true },
    });
    if (!staffRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const featured = await prisma.portalSearchLog.findMany({
    where: { firmId: eng.firmId, featured: true },
    select: {
      id: true,
      query: true,
      featuredLabel: true,
      featuredAt: true,
      interpretedFilters: true,
    },
    orderBy: { featuredAt: 'desc' },
  });

  return NextResponse.json({ featured });
}
