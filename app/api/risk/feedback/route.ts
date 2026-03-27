import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: Check if current user is an authorised feedback tester
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
    console.error('[Risk:Feedback:GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Submit feedback on a Lyra response
// Two modes:
//   1. Quick feedback (thumbs up/down) — any user, stored in message metadata
//   2. Detailed feedback (rating + comment) — IAFeedbackUser only, stored in RiskFeedback table
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // --- Mode 2: Detailed feedback (has targetType) ---
    if (body.targetType) {
      // Verify user is an authorised feedback tester
      const feedbackUser = await prisma.iAFeedbackUser.findUnique({
        where: {
          userId_firmId: {
            userId: session.user.id,
            firmId: session.user.firmId,
          },
        },
      });

      if (!feedbackUser?.isActive) {
        return NextResponse.json({ error: 'Not authorised as feedback user' }, { status: 403 });
      }

      const { targetType, targetId, chatId, rating, comment } = body;

      if (!targetType || !targetId || !rating) {
        return NextResponse.json({ error: 'targetType, targetId, and rating are required' }, { status: 400 });
      }

      if (!['helpful', 'unhelpful', 'needs_improvement'].includes(rating)) {
        return NextResponse.json({ error: 'Invalid rating' }, { status: 400 });
      }

      if (!['chat_message', 'action_plan'].includes(targetType)) {
        return NextResponse.json({ error: 'Invalid targetType' }, { status: 400 });
      }

      // Upsert — update existing feedback or create new
      const existing = await prisma.riskFeedback.findFirst({
        where: {
          targetType,
          targetId,
          userId: session.user.id,
        },
      });

      if (existing) {
        await prisma.riskFeedback.update({
          where: { id: existing.id },
          data: { rating, comment: comment || null },
        });
        return NextResponse.json({ success: true, updated: true });
      }

      await prisma.riskFeedback.create({
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
    }

    // --- Mode 1: Quick thumbs up/down (any user) ---
    const { chatId, messageId, rating } = body;

    if (!chatId || !messageId || !rating) {
      return NextResponse.json({ error: 'chatId, messageId, and rating are required' }, { status: 400 });
    }

    if (rating !== 'positive' && rating !== 'negative') {
      return NextResponse.json({ error: 'rating must be "positive" or "negative"' }, { status: 400 });
    }

    const chat = await prisma.riskChat.findFirst({
      where: { id: chatId, userId: session.user.id },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Store quick feedback in message metadata
    const messages = await prisma.riskChatMessage.findMany({
      where: { chatId, role: 'assistant' },
      orderBy: { turnOrder: 'asc' },
    });

    const targetMessage = messages[messages.length - 1];
    if (targetMessage) {
      const existingMetadata = (targetMessage.metadata as Record<string, unknown>) || {};
      await prisma.riskChatMessage.update({
        where: { id: targetMessage.id },
        data: {
          metadata: {
            ...existingMetadata,
            userFeedback: { rating, timestamp: new Date().toISOString() },
          },
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Risk:Feedback] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
