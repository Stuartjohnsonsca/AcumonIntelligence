import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/land-registry-costs
 *
 * Platform-level HMLR Business Gateway spend aggregation. Mirrors the shape
 * of /api/ai-usage but:
 *   - Costs are in GBP (HMLR fees), not USD (AI tokens).
 *   - Scoped firm-wide for normal users; Super Admin sees cross-firm totals.
 *   - The HMLR account is held by Super Admin, so the platform-level view is
 *     the one that matters for billing reconciliation.
 *
 * Query params:
 *   - clientId: scope to a specific client (firm admins see their firm's
 *               clients; Super Admin can query any client).
 *   - firmId:   Super Admin only — scope to a specific firm.
 *   - period:   'all' | 'week' | 'month' | 'custom'
 *   - from,to:  ISO dates when period='custom'
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const firmIdParam = searchParams.get('firmId');
  const period = searchParams.get('period') || 'all';
  const sessionFirmId = (session.user as { firmId: string }).firmId;
  const isSuperAdmin = !!session.user.isSuperAdmin;

  // Super Admin can query any firm; normal users are always scoped to their firm.
  const firmScope: string | undefined = isSuperAdmin ? (firmIdParam || undefined) : sessionFirmId;

  // Date filter
  let dateFilter: Date | undefined;
  let dateFilterEnd: Date | undefined;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  if (period === 'custom' && fromParam) {
    dateFilter = new Date(fromParam);
    if (toParam) {
      const end = new Date(toParam);
      end.setHours(23, 59, 59, 999);
      dateFilterEnd = end;
    }
  } else if (period === 'month') {
    dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  } else if (period === 'week') {
    dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  const createdAtFilter: Record<string, Date> = {};
  if (dateFilter) createdAtFilter.gte = dateFilter;
  if (dateFilterEnd) createdAtFilter.lte = dateFilterEnd;

  const where: Record<string, unknown> = {};
  if (Object.keys(createdAtFilter).length > 0) where.createdAt = createdAtFilter;
  if (firmScope) where.firmId = firmScope;
  if (clientId) where.clientId = clientId;

  // If a firm admin queries a specific client, make sure it belongs to their firm.
  if (clientId && !isSuperAdmin) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { firmId: true },
    });
    if (!client || client.firmId !== sessionFirmId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const [records, aggregation, byApi, byStatus] = await Promise.all([
    prisma.landRegistryCost.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.landRegistryCost.aggregate({
      where: where as any,
      _sum: { costGbp: true },
      _count: true,
    }),
    prisma.landRegistryCost.groupBy({
      by: ['apiName'],
      where: where as any,
      _sum: { costGbp: true },
      _count: true,
    }),
    prisma.landRegistryCost.groupBy({
      by: ['status'],
      where: where as any,
      _sum: { costGbp: true },
      _count: true,
    }),
  ]);

  // Super Admin gets a per-firm breakdown; firm admins don't need it.
  let byFirm: Array<{ firmId: string; calls: number; costGbp: number }> = [];
  if (isSuperAdmin) {
    const byFirmRaw = await prisma.landRegistryCost.groupBy({
      by: ['firmId'],
      where: where as any,
      _sum: { costGbp: true },
      _count: true,
    });
    byFirm = byFirmRaw.map(r => ({
      firmId: r.firmId,
      calls: r._count,
      costGbp: Math.round((r._sum.costGbp || 0) * 100) / 100,
    }));
  }

  return NextResponse.json({
    scope: {
      firmId: firmScope || null,
      clientId: clientId || null,
      superAdmin: isSuperAdmin,
    },
    period,
    summary: {
      totalCalls: aggregation._count,
      totalCostGbp: Math.round((aggregation._sum.costGbp || 0) * 100) / 100,
    },
    byApi: byApi.map(r => ({
      apiName: r.apiName,
      calls: r._count,
      costGbp: Math.round((r._sum.costGbp || 0) * 100) / 100,
    })),
    byStatus: byStatus.map(r => ({
      status: r.status,
      calls: r._count,
      costGbp: Math.round((r._sum.costGbp || 0) * 100) / 100,
    })),
    byFirm,
    recentRecords: records.map(r => ({
      id: r.id,
      firmId: r.firmId,
      clientId: r.clientId,
      engagementId: r.engagementId,
      executionId: r.executionId,
      apiName: r.apiName,
      titleNumber: r.titleNumber,
      propertyAddress: r.propertyAddress,
      costGbp: r.costGbp,
      status: r.status,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
