import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/portal/evidence?token=X
 * List evidence requests for the authenticated client portal user.
 * Note: In production, use proper JWT/session auth. Token-based for MVP.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // For MVP: find all portal users for this email, then query all their clients
  // In production, use proper JWT/session with specific user ID
  const portalUsers = await prisma.clientPortalUser.findMany({
    where: { isActive: true },
    select: { clientId: true },
  });

  if (portalUsers.length === 0) {
    return NextResponse.json({ error: 'No portal users found' }, { status: 401 });
  }

  const clientIds = [...new Set(portalUsers.map(u => u.clientId))];

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
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(requests);
}
