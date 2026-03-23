import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: Get all feedback for a specific chat (feedback users only)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is a feedback user
    const feedbackUser = await prisma.iAFeedbackUser.findUnique({
      where: {
        userId_firmId: {
          userId: session.user.id,
          firmId: session.user.firmId,
        },
      },
    });

    if (!feedbackUser?.isActive) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { chatId } = await params;

    const feedback = await prisma.assuranceFeedback.findMany({
      where: { chatId },
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      feedback: feedback.map(f => ({
        id: f.id,
        targetType: f.targetType,
        targetId: f.targetId,
        rating: f.rating,
        comment: f.comment,
        userName: f.user.name,
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    console.error('[Feedback:ChatGet]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
