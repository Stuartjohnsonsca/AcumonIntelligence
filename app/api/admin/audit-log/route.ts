import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Super Admin audit-log viewer — paginated read of
 * `engagement_action_logs`, joined with engagement → client + period
 * so the UI can render Client name and Period end alongside each row.
 *
 * Filters (query string):
 *   clientId    — restrict to one client
 *   periodId    — restrict to one period
 *   action      — substring match on the action slug (e.g. "specialist")
 *   actor       — substring match on actor name / email
 *   startDate   — ISO date, occurredAt >= this
 *   endDate     — ISO date, occurredAt <= this (end of day)
 *   firmId      — restrict to one firm (super admin can see across all)
 *   limit       — page size, default 100, max 500
 *   offset      — pagination offset
 *
 * The endpoint also returns:
 *   - distinct list of clients with at least one action-log row
 *   - for the currently filtered client (if any), the periods they have
 *     action-log rows in
 *   - distinct list of action slugs (for a dropdown filter)
 * so the UI can build dependent dropdowns without a second round trip.
 */

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') || undefined;
  const periodId = searchParams.get('periodId') || undefined;
  const action = searchParams.get('action') || undefined;
  const actor = searchParams.get('actor') || undefined;
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const firmId = searchParams.get('firmId') || undefined;
  const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const offsetRaw = parseInt(searchParams.get('offset') || '0', 10);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

  // The action log lives at the engagement level — to filter by client
  // / period we need a join, so we filter on the engagement relation.
  const where: any = {};
  if (firmId) where.firmId = firmId;
  if (action) where.action = { contains: action, mode: 'insensitive' };
  if (actor) {
    where.OR = [
      { actorName: { contains: actor, mode: 'insensitive' } },
    ];
  }
  if (startDate || endDate) {
    where.occurredAt = {};
    if (startDate) where.occurredAt.gte = new Date(startDate);
    if (endDate) {
      // Treat endDate as inclusive end-of-day so a one-day window
      // ('2026-05-07' to '2026-05-07') captures everything that day.
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.occurredAt.lte = end;
    }
  }
  if (clientId || periodId) {
    where.engagement = {};
    if (clientId) where.engagement.clientId = clientId;
    if (periodId) where.engagement.periodId = periodId;
  }

  const [rows, total, clientsRaw, periodsRaw, actionsRaw] = await Promise.all([
    prisma.engagementActionLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        engagement: {
          select: {
            id: true,
            auditType: true,
            client: { select: { id: true, clientName: true } },
            period: { select: { id: true, startDate: true, endDate: true } },
          },
        },
      },
    }),
    prisma.engagementActionLog.count({ where }),
    // Distinct clients with any action-log row. Reach via
    // periods → auditEngagements → actionLogs because Client doesn't
    // have a direct engagements relation.
    prisma.client.findMany({
      where: {
        periods: { some: { auditEngagements: { some: { actionLogs: { some: {} } } } } },
        ...(firmId ? { firmId } : {}),
      },
      select: { id: true, clientName: true },
      orderBy: { clientName: 'asc' },
    }),
    // Periods scoped to the selected client, to populate the
    // dependent Period dropdown. The model is ClientPeriod (no
    // human-friendly label field), so the response renders the
    // period as "Period ended <endDate>".
    clientId
      ? prisma.clientPeriod.findMany({
        where: {
          clientId,
          auditEngagements: { some: { actionLogs: { some: {} } } },
        },
        select: { id: true, startDate: true, endDate: true },
        orderBy: { endDate: 'desc' },
      })
      : Promise.resolve([] as Array<{ id: string; startDate: Date; endDate: Date }>),
    // Distinct action slugs — small, one-shot list. Postgres groupBy.
    prisma.engagementActionLog.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { action: 'asc' },
    }),
  ]);

  return NextResponse.json({
    total,
    rows: rows.map((r: typeof rows[number]) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      actorName: r.actorName,
      actorUserId: r.actorUserId,
      action: r.action,
      summary: r.summary,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      engagementId: r.engagementId,
      firmId: r.firmId,
      client: r.engagement?.client
        ? { id: r.engagement.client.id, name: r.engagement.client.clientName }
        : null,
      period: r.engagement?.period
        ? {
          id: r.engagement.period.id,
          startDate: r.engagement.period.startDate?.toISOString() || null,
          endDate: r.engagement.period.endDate?.toISOString() || null,
        }
        : null,
      auditType: r.engagement?.auditType || null,
    })),
    clients: clientsRaw.map((c: { id: string; clientName: string }) => ({ id: c.id, name: c.clientName })),
    periods: periodsRaw.map((p: { id: string; startDate: Date; endDate: Date }) => ({
      id: p.id,
      startDate: p.startDate?.toISOString() || null,
      endDate: p.endDate?.toISOString() || null,
    })),
    actions: actionsRaw.map((a: { action: string; _count: { action: number } }) => ({ slug: a.action, count: a._count.action })),
  });
}
