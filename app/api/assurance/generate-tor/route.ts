import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateTermsOfReference } from '@/lib/assurance-tor';
import { calculateAssuranceCost } from '@/lib/assurance-ai';
import { SUB_TOOL_NAMES } from '@/lib/assurance-ai';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { engagementId, sector } = await request.json();

    if (!engagementId) {
      return NextResponse.json({ error: 'engagementId is required' }, { status: 400 });
    }

    const engagement = await prisma.assuranceEngagement.findFirst({
      where: { id: engagementId, firmId: session.user.firmId },
      include: {
        chat: { include: { messages: { orderBy: { turnOrder: 'asc' } } } },
        client: true,
      },
    });

    if (!engagement) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    // Build chat history context
    const chatHistory = engagement.chat.messages
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    const effectiveSector = sector || engagement.sector || engagement.client.sector || 'General';
    const subToolName = SUB_TOOL_NAMES[engagement.subTool] || engagement.subTool;

    // Generate Terms of Reference
    const torResult = await generateTermsOfReference(
      engagement.subTool,
      subToolName,
      effectiveSector,
      (engagement.projectDetails as Record<string, string>) || {},
      chatHistory,
    );

    // Store ToR in engagement
    await prisma.assuranceEngagement.update({
      where: { id: engagementId },
      data: {
        termsOfReference: JSON.stringify({
          sections: torResult.sections,
          evidenceChecklist: torResult.evidenceChecklist,
          keyRisks: torResult.keyRisks,
          estimatedDuration: torResult.estimatedDuration,
        }),
        sector: effectiveSector,
        torGeneratedAt: new Date(),
        status: 'tor_generated',
      },
    });

    // Track AI usage
    const cost = calculateAssuranceCost(torResult.usage, torResult.model);
    await prisma.aiUsage.create({
      data: {
        clientId: engagement.clientId,
        userId: session.user.id,
        action: 'Assurance ToR Generation',
        model: torResult.model,
        operation: 'generate_tor',
        promptTokens: torResult.usage.promptTokens,
        completionTokens: torResult.usage.completionTokens,
        totalTokens: torResult.usage.totalTokens,
        estimatedCostUsd: cost,
      },
    });

    return NextResponse.json({
      sections: torResult.sections,
      evidenceChecklist: torResult.evidenceChecklist,
      keyRisks: torResult.keyRisks,
      estimatedDuration: torResult.estimatedDuration,
    });
  } catch (err) {
    console.error('[Assurance:GenerateToR] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
