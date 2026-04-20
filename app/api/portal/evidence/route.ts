import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

/**
 * GET /api/portal/evidence?token=X
 * List evidence requests visible to the caller. Scoped to the set of
 * clients the caller's email is registered against — previously the
 * endpoint returned every active portal user's clients, which leaked
 * evidence across tenants.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const me = await resolvePortalUserFromToken(token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  // Every ClientPortalUser row is (clientId, email). The same person
  // accessing multiple clients has one row per client, sharing the
  // same email. We scope by email so cross-client access only works
  // where the caller is actually registered.
  const myRows = await prisma.clientPortalUser.findMany({
    where: { email: me.email, isActive: true },
    select: { clientId: true },
  });
  const clientIds = [...new Set(myRows.map(u => u.clientId))];
  if (clientIds.length === 0) return NextResponse.json([]);

  const requests = await prisma.auditEvidenceRequest.findMany({
    where: { clientId: { in: clientIds } },
    include: {
      uploads: {
        select: {
          id: true,
          evidenceType: true,
          aiVerified: true,
          firmAccepted: true,
          originalName: true,
          createdAt: true,
        },
      },
      run: {
        select: {
          engagement: {
            select: { auditArea: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(requests);
}
