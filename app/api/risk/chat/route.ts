import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { processRiskChat, calculateRiskCost } from '@/lib/risk-ai';

// POST: Send message to risk chat (Lyra)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientId, chatId, message } = await request.json();

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
      chat = await prisma.riskChat.findFirst({
        where: { id: chatId, userId: session.user.id },
        include: { messages: { orderBy: { turnOrder: 'asc' } } },
      });
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }
    } else {
      chat = await prisma.riskChat.create({
        data: {
          clientId,
          userId: session.user.id,
          firmId: session.user.firmId,
          status: 'active',
        },
      });
      (chat as Record<string, unknown>).messages = [];
    }

    // Get message count for turn ordering
    const messageCount = await prisma.riskChatMessage.count({
      where: { chatId: chat.id },
    });

    // Save user message
    await prisma.riskChatMessage.create({
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

    // Process with AI
    const response = await processRiskChat(history, message);

    // Save assistant message
    await prisma.riskChatMessage.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: response.content,
        metadata: Object.keys(response.metadata).length > 0 ? response.metadata : undefined,
        turnOrder: messageCount + 1,
      },
    });

    // Update chat if action plan generated
    if (response.metadata.actionPlan) {
      await prisma.riskChat.update({
        where: { id: chat.id },
        data: {
          status: 'action_plan_generated',
          commitmentType: response.metadata.commitmentType || null,
          actionPlan: response.metadata.actionPlan as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // Update chat status if booking requested
    if (response.metadata.shouldBook) {
      await prisma.riskChat.update({
        where: { id: chat.id },
        data: { status: 'booking_requested' },
      });
    }

    // Track AI usage
    const cost = calculateRiskCost(response.usage, response.model);
    await prisma.aiUsage.create({
      data: {
        clientId,
        userId: session.user.id,
        action: 'Risk Chat',
        model: response.model,
        operation: 'risk_advisory',
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
    console.error('[Risk:Chat] Error:', err);
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
      const chat = await prisma.riskChat.findFirst({
        where: { id: chatId, userId: session.user.id },
        include: {
          messages: { orderBy: { turnOrder: 'asc' } },
        },
      });
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }
      return NextResponse.json(chat);
    }

    if (clientId) {
      const chats = await prisma.riskChat.findMany({
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
    console.error('[Risk:Chat:GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Accept or reject action plan
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatId, action } = await request.json();

    if (!chatId || !action) {
      return NextResponse.json({ error: 'chatId and action are required' }, { status: 400 });
    }

    const chat = await prisma.riskChat.findFirst({
      where: { id: chatId, userId: session.user.id },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    if (action === 'accept') {
      await prisma.riskChat.update({
        where: { id: chatId },
        data: { status: 'accepted' },
      });
      return NextResponse.json({ status: 'accepted' });
    }

    if (action === 'reject') {
      await prisma.riskChat.update({
        where: { id: chatId },
        data: { status: 'active', actionPlan: Prisma.DbNull, commitmentType: null },
      });
      return NextResponse.json({ status: 'active' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[Risk:Chat:PATCH] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
