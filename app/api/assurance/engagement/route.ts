import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST: Create engagement from chat
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatId, clientId, subTool, engagementType, sector } = await request.json();

    if (!clientId || !subTool || !engagementType) {
      return NextResponse.json({ error: 'clientId, subTool, and engagementType are required' }, { status: 400 });
    }

    // Verify client access
    const client = await prisma.client.findFirst({
      where: { id: clientId, firmId: session.user.firmId },
    });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // If chatId provided, check it doesn't already have an engagement
    if (chatId) {
      const existingEngagement = await prisma.assuranceEngagement.findUnique({
        where: { chatId },
      });
      if (existingEngagement) {
        return NextResponse.json(existingEngagement);
      }
    }

    // Create a chat if none exists
    let finalChatId = chatId;
    if (!finalChatId) {
      const chat = await prisma.assuranceChat.create({
        data: {
          clientId,
          userId: session.user.id,
          firmId: session.user.firmId,
          subTool,
          status: 'resolved',
        },
      });
      finalChatId = chat.id;
    } else {
      // Update the chat's subTool if not set
      await prisma.assuranceChat.update({
        where: { id: finalChatId },
        data: { subTool, status: 'resolved' },
      });
    }

    // Gather project details from chat messages
    const chatMessages = await prisma.assuranceChatMessage.findMany({
      where: { chatId: finalChatId },
      orderBy: { turnOrder: 'asc' },
    });

    const projectDetails: Record<string, string> = {};
    for (const msg of chatMessages) {
      if (msg.metadata && typeof msg.metadata === 'object') {
        const meta = msg.metadata as Record<string, unknown>;
        if (meta.projectDetails && typeof meta.projectDetails === 'object') {
          Object.assign(projectDetails, meta.projectDetails);
        }
      }
    }

    const engagement = await prisma.assuranceEngagement.create({
      data: {
        chatId: finalChatId,
        clientId,
        firmId: session.user.firmId,
        userId: session.user.id,
        subTool,
        engagementType,
        sector: sector || client.sector,
        projectDetails: Object.keys(projectDetails).length > 0 ? projectDetails : undefined,
        status: 'draft',
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        firmId: session.user.firmId,
        clientId,
        action: 'create_engagement',
        tool: 'assurance',
        detail: JSON.stringify({ engagementId: engagement.id, subTool, engagementType }),
      },
    });

    return NextResponse.json(engagement);
  } catch (err) {
    console.error('[Assurance:Engagement] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

// GET: Get engagement or frequent actions
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const frequent = searchParams.get('frequent');
    const engagementId = searchParams.get('engagementId');

    if (engagementId) {
      const engagement = await prisma.assuranceEngagement.findFirst({
        where: { id: engagementId, firmId: session.user.firmId },
        include: { documents: true, reports: true },
      });
      if (!engagement) {
        return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
      }
      return NextResponse.json(engagement);
    }

    if (frequent === 'true' && clientId) {
      // Get most frequent engagement types for this firm
      const engagements = await prisma.assuranceEngagement.groupBy({
        by: ['engagementType'],
        where: { firmId: session.user.firmId },
        _count: { engagementType: true },
        orderBy: { _count: { engagementType: 'desc' } },
        take: 5,
      });

      return NextResponse.json(
        engagements.map((e: { engagementType: string; _count: { engagementType: number } }) => ({
          engagementType: e.engagementType,
          count: e._count.engagementType,
        })),
      );
    }

    return NextResponse.json({ error: 'engagementId or clientId with frequent=true required' }, { status: 400 });
  } catch (err) {
    console.error('[Assurance:Engagement:GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
