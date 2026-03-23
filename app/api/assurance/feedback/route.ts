import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: Check if current user is an IA Feedback User
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const feedbackUser = await prisma.iAFeedbackUser.findUnique({
      where: {
        userId_firmId: {
          userId: session.user.id,
          firmId: session.user.firmId,
        },
      },
    });

    return NextResponse.json({
      isFeedbackUser: feedbackUser?.isActive === true,
    });
  } catch (err) {
    console.error('[Feedback:GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Submit feedback on an AI response
export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: 'Not authorized as feedback user' }, { status: 403 });
    }

    const { targetType, targetId, chatId, rating, comment } = await request.json();

    if (!targetType || !targetId || !rating) {
      return NextResponse.json({ error: 'targetType, targetId, and rating are required' }, { status: 400 });
    }

    if (!['helpful', 'unhelpful', 'needs_improvement'].includes(rating)) {
      return NextResponse.json({ error: 'Invalid rating' }, { status: 400 });
    }

    if (!['chat_message', 'report_section', 'recommendation'].includes(targetType)) {
      return NextResponse.json({ error: 'Invalid targetType' }, { status: 400 });
    }

    // Check for existing feedback on same target by same user
    const existing = await prisma.assuranceFeedback.findFirst({
      where: {
        targetType,
        targetId,
        userId: session.user.id,
      },
    });

    if (existing) {
      // Update existing feedback
      await prisma.assuranceFeedback.update({
        where: { id: existing.id },
        data: { rating, comment: comment || null },
      });
      return NextResponse.json({ success: true, updated: true });
    }

    // Create new feedback
    await prisma.assuranceFeedback.create({
      data: {
        targetType,
        targetId,
        chatId: chatId || null,
        userId: session.user.id,
        firmId: session.user.firmId,
        rating,
        comment: comment || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Feedback:POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
