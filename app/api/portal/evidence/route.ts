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

  // For MVP: find portal user by token (which encodes the userId after 2FA)
  // Fallback: find most recent active portal user
  const portalUser = await prisma.clientPortalUser.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!portalUser) {
    return NextResponse.json({ error: 'No authenticated portal user found' }, { status: 401 });
  }

  const requests = await prisma.auditEvidenceRequest.findMany({
    where: { clientId: portalUser.clientId },
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
