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
    // Explicit select — must not use implicit-all-fields because the
    // 2026-04-24 Portal Principal migration added columns (portal_principal_id
    // etc) that a freshly-deployed build expects but prod may not yet have.
    // Without explicit select, Prisma emits SELECT * and blows up with
    // P2022 ("column not in DB") → the catch below returned an empty
    // list silently → portal showed "No open periods" even when
    // engagements were clearly active.
    const engagements = await prisma.auditEngagement.findMany({
      where: {
        clientId,
        status: { in: ['active', 'review'] }, // Started but not complete/archived
      },
      select: {
        id: true,
        status: true,
        period: { select: { id: true, startDate: true, endDate: true } },
        createdAt: true,
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
    // Surface the error detail in logs — previous version swallowed
    // every error into `[]` which made the "No open periods" bug
    // invisible. We still return an empty list because breaking the
    // portal shell over a schema blip is worse, but at least the
    // server logs now tell us what happened.
    console.error('[portal/periods] findMany failed:', {
      message: (err as any)?.message,
      code: (err as any)?.code,
      meta: (err as any)?.meta,
    });
    return NextResponse.json({ periods: [], error: (err as any)?.code || 'load-failed' });
  }
}
