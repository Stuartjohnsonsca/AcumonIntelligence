import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromTokenDetailed } from '@/lib/portal-session';

/**
 * GET /api/portal/evidence?token=X
 * List evidence requests visible to the caller. Scoped to the set of
 * clients the caller's email is registered against — previously the
 * endpoint returned every active portal user's clients, which leaked
 * evidence across tenants.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const { user: me, reason } = await resolvePortalUserFromTokenDetailed(token);
    if (!me) return NextResponse.json({ error: 'Invalid or expired session', reason }, { status: 401 });

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

    // Include the client relation so the audit-portal UI can build
    // its client-picker. Previously the client name was missing which
    // kept the picker empty even when requests came back OK.
    const requests = await prisma.auditEvidenceRequest.findMany({
      where: { clientId: { in: clientIds } },
      include: {
        client: { select: { clientName: true } },
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

    // Flatten client.clientName onto each request so the existing
    // audit-portal code (`req.clientName`) works without changes.
    const shaped = requests.map(r => ({
      ...r,
      clientName: r.client?.clientName || '',
    }));

    return NextResponse.json(shaped);
  } catch (err: any) {
    console.error('[Portal Evidence] error:', {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack,
    });
    return NextResponse.json({
      error: 'Failed to load evidence requests',
      detail: err?.message || 'unknown error',
      code: err?.code || null,
    }, { status: 500 });
  }
}
