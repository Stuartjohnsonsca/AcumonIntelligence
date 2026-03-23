import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: Poll review progress for an engagement
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const engagementId = request.nextUrl.searchParams.get('engagementId');
    if (!engagementId) {
      return NextResponse.json({ error: 'engagementId required' }, { status: 400 });
    }

    const engagement = await prisma.assuranceEngagement.findFirst({
      where: { id: engagementId, firmId: session.user.firmId },
      select: {
        status: true,
        score: true,
        reportGeneratedAt: true,
        documents: {
          select: {
            id: true,
            originalName: true,
            documentCategory: true,
            aiReviewStatus: true,
            aiScore: true,
          },
        },
      },
    });

    if (!engagement) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    const total = engagement.documents.length;
    const reviewed = engagement.documents.filter(d => d.aiReviewStatus === 'reviewed').length;
    const reviewing = engagement.documents.filter(d => d.aiReviewStatus === 'reviewing').length;
    const pending = engagement.documents.filter(d => d.aiReviewStatus === 'pending').length;

    return NextResponse.json({
      status: engagement.status,
      progress: {
        total,
        reviewed,
        reviewing,
        pending,
        percentage: total > 0 ? Math.round((reviewed / total) * 100) : 0,
      },
      overallScore: engagement.score,
      reportReady: engagement.status === 'complete' && engagement.reportGeneratedAt !== null,
      documents: engagement.documents.map(d => ({
        id: d.id,
        name: d.originalName,
        category: d.documentCategory,
        status: d.aiReviewStatus,
        score: d.aiScore,
      })),
    });
  } catch (err) {
    console.error('[Assurance:ReviewProgress]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
