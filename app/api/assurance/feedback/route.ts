import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST: Submit feedback (thumbs up/down) on an assurance AI response
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
    const chat = await prisma.assuranceChat.findFirst({
      where: { id: chatId, userId: session.user.id },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Find the most recent assistant message and update its metadata with feedback
    const messages = await prisma.assuranceChatMessage.findMany({
      where: { chatId, role: 'assistant' },
      orderBy: { turnOrder: 'asc' },
    });

    const targetMessage = messages[messages.length - 1];
    if (targetMessage) {
      const existingMetadata = (targetMessage.metadata as Record<string, unknown>) || {};
      await prisma.assuranceChatMessage.update({
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
    console.error('[Assurance:Feedback] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
