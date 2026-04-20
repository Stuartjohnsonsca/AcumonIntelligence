import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authorisePortalTenant } from '@/lib/portal-endpoint-auth';

/**
 * GET /api/portal/periods?token=X&clientId=Y
 * Returns open periods for a client — where an engagement has been started
 * (status = 'active' or 'review') but not archived (status != 'complete').
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const guard = await authorisePortalTenant(req, { clientId });
  if (!guard.ok) return guard.response;

  try {
    // Find engagements for this client that are active (started but not archived)
    const engagements = await prisma.auditEngagement.findMany({
      where: {
        clientId,
        status: { in: ['active', 'review'] }, // Started but not complete/archived
      },
      include: {
        period: { select: { id: true, startDate: true, endDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const periods = engagements
      .filter(e => e.period)
      .map(e => ({
        id: e.period!.id,
        startDate: e.period!.startDate.toISOString(),
        endDate: e.period!.endDate.toISOString(),
        engagementId: e.id,
        status: e.status,
      }));

    // Deduplicate by period id (same period might have multiple audit types)
    const seen = new Set<string>();
    const unique = periods.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    return NextResponse.json({ periods: unique });
  } catch (err) {
    console.error('Failed to load portal periods:', err);
    return NextResponse.json({ periods: [] });
  }
}
