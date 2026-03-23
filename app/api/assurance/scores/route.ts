import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const subTool = searchParams.get('subTool');
    const sector = searchParams.get('sector');

    // Client scores over time
    if (clientId) {
      const scores = await prisma.assuranceScore.findMany({
        where: {
          clientId,
          ...(subTool ? { subTool } : {}),
        },
        orderBy: { scoredAt: 'asc' },
        include: { engagement: { select: { subTool: true, engagementType: true } } },
      });

      return NextResponse.json(scores);
    }

    // Sector benchmarks
    if (sector && subTool) {
      const benchmarks = await prisma.assuranceScore.groupBy({
        by: ['sector'],
        where: { sector, subTool },
        _avg: { score: true },
        _min: { score: true },
        _max: { score: true },
        _count: { score: true },
      });

      return NextResponse.json(benchmarks);
    }

    // Firm overview - all scores
    const firmScores = await prisma.assuranceScore.findMany({
      where: { firmId: session.user.firmId },
      orderBy: { scoredAt: 'desc' },
      take: 50,
      include: {
        client: { select: { clientName: true } },
        engagement: { select: { subTool: true, engagementType: true } },
      },
    });

    return NextResponse.json(firmScores);
  } catch (err) {
    console.error('[Assurance:Scores] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
