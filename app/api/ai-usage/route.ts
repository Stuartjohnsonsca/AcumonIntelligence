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
  const period = searchParams.get('period') || 'all'; // all | month | week
  const firmId = (session.user as { firmId: string }).firmId;

  let dateFilter: Date | undefined;
  if (period === 'month') dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  else if (period === 'week') dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // If requesting a specific client, verify access
  if (clientId) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { firmId: true },
    });
    if (!client || (client.firmId !== firmId && !session.user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const where = {
      clientId,
      ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
    };

    const [records, aggregation, byOperation] = await Promise.all([
      prisma.aiUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
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
        by: ['operation'],
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
      byOperation: byOperation.map(op => ({
        operation: op.operation,
        calls: op._count,
        promptTokens: op._sum.promptTokens || 0,
        completionTokens: op._sum.completionTokens || 0,
        totalTokens: op._sum.totalTokens || 0,
        estimatedCostUsd: Math.round((op._sum.estimatedCostUsd || 0) * 1_000_000) / 1_000_000,
      })),
      recentRecords: records,
    });
  }

  // No specific client — return summary per client for the firm
  const firmClients = await prisma.client.findMany({
    where: { firmId },
    select: { id: true, clientName: true },
  });
  const clientIds = firmClients.map(c => c.id);
  const clientNameMap = new Map(firmClients.map(c => [c.id, c.clientName]));

  const where = {
    clientId: { in: clientIds },
    ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
  };

  const [firmTotal, perClient] = await Promise.all([
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
