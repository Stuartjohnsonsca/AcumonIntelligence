import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { processAssuranceChat, calculateAssuranceCost } from '@/lib/assurance-ai';
import { getRelevantLearnings, processChatFeedback } from '@/lib/assurance-feedback';

// POST: Send message to assurance chat
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientId, chatId, message, mode, subTool } = await request.json();

    if (!clientId || !message) {
      return NextResponse.json({ error: 'clientId and message are required' }, { status: 400 });
    }

    // Verify client access
    const client = await prisma.client.findFirst({
      where: { id: clientId, firmId: session.user.firmId },
    });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Create or load chat
    let chat;
    if (chatId) {
      chat = await prisma.assuranceChat.findFirst({
        where: { id: chatId, userId: session.user.id },
        include: { messages: { orderBy: { turnOrder: 'asc' } } },
      });
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }
    } else {
      chat = await prisma.assuranceChat.create({
        data: {
          clientId,
          userId: session.user.id,
          firmId: session.user.firmId,
          status: 'active',
        },
      });
      // New chat has no messages yet
      (chat as Record<string, unknown>).messages = [];
    }

    // Get message count for turn ordering
    const messageCount = await prisma.assuranceChatMessage.count({
      where: { chatId: chat.id },
    });

    // Save user message
    await prisma.assuranceChatMessage.create({
      data: {
        chatId: chat.id,
        role: 'user',
        content: message,
        turnOrder: messageCount,
      },
    });

    // Build history for AI
    const chatWithMessages = chat as typeof chat & { messages?: Array<{ role: string; content: string }> };
    const history = (chatWithMessages.messages || []).map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // Fetch learned patterns from past conversations to enhance AI responses
    const chatMode = mode || (chat.subTool ? 'drill_down' : 'triage');
    const learnedContext = await getRelevantLearnings(
      session.user.firmId,
      client.sector,
      subTool || chat.subTool || undefined,
    );

    // Process with AI (enriched with past learnings)
    const response = await processAssuranceChat(
      history,
      message,
      chatMode,
      subTool || chat.subTool || undefined,
      learnedContext || undefined,
    );

    // Save assistant message
    await prisma.assuranceChatMessage.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: response.content,
        metadata: Object.keys(response.metadata).length > 0 ? response.metadata : undefined,
        turnOrder: messageCount + 1,
      },
    });

    // Update chat sub-tool if recommended
    if (response.metadata.recommendedSubTool) {
      await prisma.assuranceChat.update({
        where: { id: chat.id },
        data: { subTool: response.metadata.recommendedSubTool, status: 'resolved' },
      });

      // Trigger feedback extraction in background (non-blocking)
      processChatFeedback(chat.id, session.user.firmId).catch(err =>
        console.error('[Assurance:Chat] Background feedback extraction failed:', err),
      );
    }

    // Update chat status if booking requested
    if (response.metadata.shouldBook) {
      await prisma.assuranceChat.update({
        where: { id: chat.id },
        data: { status: 'booking_requested' },
      });

      // Also extract learnings from booking-requested chats (useful for understanding gaps)
      processChatFeedback(chat.id, session.user.firmId).catch(err =>
        console.error('[Assurance:Chat] Background feedback extraction failed:', err),
      );
    }

    // Track AI usage
    const cost = calculateAssuranceCost(response.usage, response.model);
    await prisma.aiUsage.create({
      data: {
        clientId,
        userId: session.user.id,
        action: 'Assurance Chat',
        model: response.model,
        operation: chatMode,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        estimatedCostUsd: cost,
      },
    });

    return NextResponse.json({
      chatId: chat.id,
      message: response.content,
      metadata: response.metadata,
    });
  } catch (err) {
    console.error('[Assurance:Chat] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

// GET: Load chat history
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');
    const clientId = searchParams.get('clientId');

    if (chatId) {
      const chat = await prisma.assuranceChat.findFirst({
        where: { id: chatId, userId: session.user.id },
        include: {
          messages: { orderBy: { turnOrder: 'asc' } },
          engagement: true,
        },
      });
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }
      return NextResponse.json(chat);
    }

    if (clientId) {
      // Get recent chats for this client
      const chats = await prisma.assuranceChat.findMany({
        where: { clientId, userId: session.user.id },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: {
          messages: { orderBy: { turnOrder: 'asc' }, take: 1 },
        },
      });
      return NextResponse.json(chats);
    }

    return NextResponse.json({ error: 'chatId or clientId required' }, { status: 400 });
  } catch (err) {
    console.error('[Assurance:Chat:GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
