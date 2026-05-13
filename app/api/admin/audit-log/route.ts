import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Super Admin audit-log viewer — paginated read of
 * `engagement_action_logs` UNIONED with `user_action_logs`, joined
 * where possible with engagement → client + period so the UI can
 * render Client name and Period end alongside each row.
 *
 * The two tables capture different scopes:
 *   - engagement_action_logs: actions tied to an audit engagement
 *     (portal request sent, doc generated, evidence verified,
 *     audit-point committed, schedule-action fired, etc.).
 *   - user_action_logs: engagement-agnostic actions (login, 2FA,
 *     password reset, profile edit, role change) for both firm
 *     Users and ClientPortalUsers.
 *
 * `source=engagement|user` filters to one table. Default is the
 * union.
 *
 * Filters (query string):
 *   source      — 'engagement' | 'user' | undefined (union)
 *   clientId    — restrict to one client (applies to both tables —
 *                 engagement rows via engagement→clientId, user
 *                 rows via user_action_logs.client_id)
 *   periodId    — engagement-table only; ignored on user rows
 *   action      — substring match on the action slug
 *   actor       — substring match on actor name (engagement) /
 *                 user name (user)
 *   startDate   — ISO date, occurredAt >= this
 *   endDate     — ISO date, occurredAt <= this (end of day)
 *   firmId      — restrict to one firm
 *   format=csv  — return CSV instead of JSON; bypasses pagination
 *                 (capped at 10,000 rows)
 *   limit       — page size, default 100, max 500
 *   offset      — pagination offset
 *
 * Pre-existing JSON shape is preserved; new fields are additive so
 * the AuditTrailAdmin client doesn't break.
 */

interface CombinedRow {
  id: string;
  source: 'engagement' | 'user';
  occurredAt: string;
  actorName: string;
  actorUserId: string | null;
  /// For user rows, this is 'firm' or 'portal' so the UI can show
  /// where the action came from. Null for engagement rows.
  userKind: 'firm' | 'portal' | null;
  action: string;
  summary: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  engagementId: string | null;
  firmId: string | null;
  client: { id: string; name: string } | null;
  period: { id: string; startDate: string | null; endDate: string | null } | null;
  auditType: string | null;
  ipAddress: string | null;
}

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
  const source = searchParams.get('source') || undefined; // 'engagement' | 'user' | undefined
  const format = searchParams.get('format') || 'json';
  const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const offsetRaw = parseInt(searchParams.get('offset') || '0', 10);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

  // CSV export: pull a larger window (no pagination cap up to 10k)
  // but still respect filters. Browsers struggle with > 10k rows in
  // a streamed CSV from a single fetch, so we cap there.
  const exportingCsv = format === 'csv';
  const effectiveLimit = exportingCsv ? 10_000 : limit;
  const effectiveOffset = exportingCsv ? 0 : offset;

  // ── Build per-table where clauses ─────────────────────────────────

  const engagementWhere: any = {};
  if (firmId) engagementWhere.firmId = firmId;
  if (action) engagementWhere.action = { contains: action, mode: 'insensitive' };
  if (actor) {
    engagementWhere.actorName = { contains: actor, mode: 'insensitive' };
  }
  if (startDate || endDate) {
    engagementWhere.occurredAt = {};
    if (startDate) engagementWhere.occurredAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      engagementWhere.occurredAt.lte = end;
    }
  }
  if (clientId || periodId) {
    engagementWhere.engagement = {};
    if (clientId) engagementWhere.engagement.clientId = clientId;
    if (periodId) engagementWhere.engagement.periodId = periodId;
  }

  const userWhere: any = {};
  if (firmId) userWhere.firmId = firmId;
  if (action) userWhere.action = { contains: action, mode: 'insensitive' };
  if (actor) userWhere.userName = { contains: actor, mode: 'insensitive' };
  if (clientId) userWhere.clientId = clientId;
  if (startDate || endDate) {
    userWhere.occurredAt = {};
    if (startDate) userWhere.occurredAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      userWhere.occurredAt.lte = end;
    }
  }

  const includeEngagement = source !== 'user';
  const includeUser = source !== 'engagement';

  // ── Fetch both tables in parallel ─────────────────────────────────

  const [engagementRows, engagementTotal, userRows, userTotal, clientsRaw, periodsRaw, actionsRaw, userActionsRaw] =
    await Promise.all([
      includeEngagement
        ? prisma.engagementActionLog.findMany({
          where: engagementWhere,
          orderBy: { occurredAt: 'desc' },
          take: includeUser ? effectiveLimit * 2 : effectiveLimit,
          skip: includeUser ? 0 : effectiveOffset,
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
        })
        : Promise.resolve([] as any[]),
      includeEngagement ? prisma.engagementActionLog.count({ where: engagementWhere }) : Promise.resolve(0),
      includeUser
        ? prisma.userActionLog.findMany({
          where: userWhere,
          orderBy: { occurredAt: 'desc' },
          take: includeEngagement ? effectiveLimit * 2 : effectiveLimit,
          skip: includeEngagement ? 0 : effectiveOffset,
        })
        : Promise.resolve([] as any[]),
      includeUser ? prisma.userActionLog.count({ where: userWhere }) : Promise.resolve(0),
      prisma.client.findMany({
        where: {
          OR: [
            { periods: { some: { auditEngagements: { some: { actionLogs: { some: {} } } } } } },
            { id: { in: await prisma.userActionLog.findMany({ where: { clientId: { not: null } }, select: { clientId: true }, distinct: ['clientId'], take: 5000 }).then(rows => rows.map((r: any) => r.clientId).filter(Boolean) as string[]).catch(() => []) } },
          ],
          ...(firmId ? { firmId } : {}),
        },
        select: { id: true, clientName: true },
        orderBy: { clientName: 'asc' },
      }),
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
      includeEngagement
        ? prisma.engagementActionLog.groupBy({
          by: ['action'],
          _count: { action: true },
          orderBy: { action: 'asc' },
        })
        : Promise.resolve([] as Array<{ action: string; _count: { action: number } }>),
      includeUser
        ? prisma.userActionLog.groupBy({
          by: ['action'],
          _count: { action: true },
          orderBy: { action: 'asc' },
        })
        : Promise.resolve([] as Array<{ action: string; _count: { action: number } }>),
    ]);

  // ── Combine + sort by occurredAt desc ─────────────────────────────

  const combined: CombinedRow[] = [
    ...engagementRows.map((r: any): CombinedRow => ({
      id: r.id,
      source: 'engagement',
      occurredAt: r.occurredAt.toISOString(),
      actorName: r.actorName,
      actorUserId: r.actorUserId,
      userKind: null,
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
      ipAddress: null,
    })),
    ...userRows.map((r: any): CombinedRow => ({
      id: r.id,
      source: 'user',
      occurredAt: r.occurredAt.toISOString(),
      actorName: r.userName,
      actorUserId: r.userId,
      userKind: r.userKind,
      action: r.action,
      summary: r.summary,
      targetType: null,
      targetId: null,
      metadata: r.metadata,
      engagementId: null,
      firmId: r.firmId,
      client: r.clientId ? { id: r.clientId, name: '' } : null,
      period: null,
      auditType: null,
      ipAddress: r.ipAddress,
    })),
  ];
  combined.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  // Apply pagination AFTER merging when both tables are included.
  const merged = includeEngagement && includeUser
    ? combined.slice(effectiveOffset, effectiveOffset + effectiveLimit)
    : combined;

  // Backfill client names for user rows that only had a clientId.
  const missingNameClientIds = merged
    .filter(r => r.client && !r.client.name)
    .map(r => r.client!.id);
  if (missingNameClientIds.length > 0) {
    const clientById = new Map<string, string>();
    const fetched = await prisma.client.findMany({
      where: { id: { in: [...new Set(missingNameClientIds)] } },
      select: { id: true, clientName: true },
    });
    for (const c of fetched) clientById.set(c.id, c.clientName);
    for (const r of merged) {
      if (r.client && !r.client.name) {
        r.client.name = clientById.get(r.client.id) || '(unknown)';
      }
    }
  }

  if (exportingCsv) {
    const headers = [
      'When', 'Source', 'User', 'Kind', 'Action', 'Summary',
      'Client', 'Period (end)', 'Engagement', 'Firm', 'IP',
    ];
    const escape = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(',')];
    for (const r of combined) {
      lines.push([
        escape(r.occurredAt),
        escape(r.source),
        escape(r.actorName),
        escape(r.userKind || ''),
        escape(r.action),
        escape(r.summary),
        escape(r.client?.name || ''),
        escape(r.period?.endDate ? new Date(r.period.endDate).toISOString().slice(0, 10) : ''),
        escape(r.engagementId || ''),
        escape(r.firmId || ''),
        escape(r.ipAddress || ''),
      ].join(','));
    }
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-trail-${new Date().toISOString().slice(0,10)}.csv"`,
      },
    });
  }

  // Build the action-slug option list as the UNION of both tables'
  // distinct slugs so the UI can filter on either source.
  const actionMap = new Map<string, number>();
  for (const a of actionsRaw) actionMap.set(a.action, (actionMap.get(a.action) || 0) + a._count.action);
  for (const a of userActionsRaw) actionMap.set(a.action, (actionMap.get(a.action) || 0) + a._count.action);
  const actions = [...actionMap.entries()].map(([slug, count]) => ({ slug, count }));

  return NextResponse.json({
    total: engagementTotal + userTotal,
    engagementTotal,
    userTotal,
    rows: merged,
    clients: clientsRaw.map((c: { id: string; clientName: string }) => ({ id: c.id, name: c.clientName })),
    periods: periodsRaw.map((p: { id: string; startDate: Date; endDate: Date }) => ({
      id: p.id,
      startDate: p.startDate?.toISOString() || null,
      endDate: p.endDate?.toISOString() || null,
    })),
    actions,
  });
}
