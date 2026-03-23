import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST: Submit feedback (thumbs up/down) on a Lyra response
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatId, messageId, rating } = await request.json();

    if (!chatId || !messageId || !rating) {
      return NextResponse.json({ error: 'chatId, messageId, and rating are required' }, { status: 400 });
    }

    if (rating !== 'positive' && rating !== 'negative') {
      return NextResponse.json({ error: 'rating must be "positive" or "negative"' }, { status: 400 });
    }

    // Verify the chat belongs to this user
    const chat = await prisma.riskChat.findFirst({
      where: { id: chatId, userId: session.user.id },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Store the feedback in the message metadata
    // The messageId from the client is a temporary ID (e.g. "assistant-1234567890")
    // We find the message by turn order and update its metadata
    const turnOrder = parseInt(messageId.replace('assistant-', ''), 10);
    if (isNaN(turnOrder)) {
      // If we can't parse the turn order, store feedback on the chat level
      const existingFeedback = (chat.actionPlan as Record<string, unknown>)?.feedback || {};
      await prisma.riskChat.update({
        where: { id: chatId },
        data: {
          actionPlan: {
            ...(chat.actionPlan as Record<string, unknown> || {}),
            feedback: {
              ...(existingFeedback as Record<string, unknown>),
              [messageId]: { rating, userId: session.user.id, timestamp: new Date().toISOString() },
            },
          },
        },
      });
      return NextResponse.json({ success: true });
    }

    // Try to find the assistant message and update its metadata
    const messages = await prisma.riskChatMessage.findMany({
      where: { chatId, role: 'assistant' },
      orderBy: { turnOrder: 'asc' },
    });

    // Find the most recent assistant message (feedback typically applies to the last response)
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
