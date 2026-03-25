import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const period = searchParams.get('period') || 'all';
  const firmId = (session.user as { firmId: string }).firmId;

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

  if (clientId) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { firmId: true },
    });
    if (!client || (client.firmId !== firmId && !session.user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const createdAtFilter: Record<string, Date> = {};
    if (dateFilter) createdAtFilter.gte = dateFilter;
    if (dateFilterEnd) createdAtFilter.lte = dateFilterEnd;
    const where = {
      clientId,
      ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
    };

    const [records, aggregation, byAction, byModel] = await Promise.all([
      prisma.aiUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          action: true,
          model: true,
          operation: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          createdAt: true,
        },
      }),
      prisma.aiUsage.aggregate({
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
        },
        _count: true,
      }),
      prisma.aiUsage.groupBy({
        by: ['action', 'operation'],
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
        },
        _count: true,
      }),
      prisma.aiUsage.groupBy({
        by: ['model'],
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
        },
        _count: true,
      }),
    ]);

    return NextResponse.json({
      clientId,
      period,
      summary: {
        totalCalls: aggregation._count,
        promptTokens: aggregation._sum.promptTokens || 0,
        completionTokens: aggregation._sum.completionTokens || 0,
        totalTokens: aggregation._sum.totalTokens || 0,
        estimatedCostUsd: Math.round((aggregation._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
      },
      byAction: byAction.map(a => ({
        action: a.action,
        operation: a.operation,
        calls: a._count,
        promptTokens: a._sum.promptTokens || 0,
        completionTokens: a._sum.completionTokens || 0,
        totalTokens: a._sum.totalTokens || 0,
        estimatedCostUsd: Math.round((a._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
      })),
      byModel: byModel.map(m => ({
        model: m.model,
        calls: m._count,
        promptTokens: m._sum.promptTokens || 0,
        completionTokens: m._sum.completionTokens || 0,
        totalTokens: m._sum.totalTokens || 0,
        estimatedCostUsd: Math.round((m._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
      })),
      recentRecords: records,
    });
  }

  // Firm-wide summary
  const firmClients = await prisma.client.findMany({
    where: { firmId },
    select: { id: true, clientName: true },
  });
  const clientIds = firmClients.map(c => c.id);
  const clientNameMap = new Map(firmClients.map(c => [c.id, c.clientName]));

  const firmCreatedAtFilter: Record<string, Date> = {};
  if (dateFilter) firmCreatedAtFilter.gte = dateFilter;
  if (dateFilterEnd) firmCreatedAtFilter.lte = dateFilterEnd;
  const where = {
    clientId: { in: clientIds },
    ...(Object.keys(firmCreatedAtFilter).length > 0 ? { createdAt: firmCreatedAtFilter } : {}),
  };

  const [firmTotal, perClient, firmByAction, firmByModel] = await Promise.all([
    prisma.aiUsage.aggregate({
      where,
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
      _count: true,
    }),
    prisma.aiUsage.groupBy({
      by: ['clientId'],
      where,
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
      _count: true,
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    }),
    prisma.aiUsage.groupBy({
      by: ['action'],
      where,
      _sum: { estimatedCostUsd: true },
      _count: true,
    }),
    prisma.aiUsage.groupBy({
      by: ['model'],
      where,
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: true,
    }),
  ]);

  return NextResponse.json({
    period,
    firmSummary: {
      totalCalls: firmTotal._count,
      promptTokens: firmTotal._sum.promptTokens || 0,
      completionTokens: firmTotal._sum.completionTokens || 0,
      totalTokens: firmTotal._sum.totalTokens || 0,
      estimatedCostUsd: Math.round((firmTotal._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
    },
    byAction: firmByAction.map(a => ({
      action: a.action,
      calls: a._count,
      estimatedCostUsd: Math.round((a._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
    })),
    byModel: firmByModel.map(m => ({
      model: m.model,
      calls: m._count,
      totalTokens: m._sum.totalTokens || 0,
      estimatedCostUsd: Math.round((m._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
    })),
    clients: perClient.map(c => ({
      clientId: c.clientId,
      clientName: clientNameMap.get(c.clientId) || 'Unknown',
      totalCalls: c._count,
      promptTokens: c._sum.promptTokens || 0,
      completionTokens: c._sum.completionTokens || 0,
      totalTokens: c._sum.totalTokens || 0,
      estimatedCostUsd: Math.round((c._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
    })),
  });
}
