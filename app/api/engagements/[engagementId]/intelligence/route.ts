import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function getEngagement(engagementId: string) {
  return prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const engagement = await getEngagement(engagementId);
  if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const intelligence = await prisma.clientIntelligence.findMany({
    where: { clientId: engagement.clientId, firmId: engagement.firmId },
    include: {
      reviews: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { reviewedAt: 'asc' },
      },
    },
    orderBy: { category: 'asc' },
  });

  return NextResponse.json({ intelligence });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const engagement = await getEngagement(engagementId);
  if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();

  // AI auto-populate action
  if (body.action === 'ai_populate') {
    const client = await prisma.client.findUnique({
      where: { id: engagement.clientId },
      select: { clientName: true, sector: true },
    });
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    // Keys MUST match INTELLIGENCE_CATEGORIES in types/methodology.ts
    const categories = [
      { key: 'background', prompt: `Provide a brief background of the company "${client.clientName}"${client.sector ? ` in the ${client.sector} sector` : ''}. Include founding details, headquarters, and key business lines.` },
      { key: 'financial', prompt: `Summarise the financial position of "${client.clientName}". Review any publicly available accounts, revenue trends, profitability, and cash position.` },
      { key: 'positive_adverse', prompt: `List positive and adverse news or developments for "${client.clientName}". Include recent press, awards, controversies, or legal matters.` },
      { key: 'competitors', prompt: `Describe the competitive landscape for "${client.clientName}". Who are their main competitors and how do they differentiate?` },
      { key: 'regulatory', prompt: `Identify regulatory issues relevant to "${client.clientName}"${client.sector ? ` in the ${client.sector} sector` : ''}. Include any compliance requirements or regulatory changes.` },
      { key: 'sector', prompt: `Describe recent sector developments relevant to "${client.clientName}"${client.sector ? ` in ${client.sector}` : ''}. Include industry trends and outlook.` },
      { key: 'other', prompt: `Provide any other noteworthy news about "${client.clientName}" not covered above. Include ESG, M&A activity, leadership changes, etc.` },
    ];

    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI API key not configured' }, { status: 500 });
    }

    const results = [];
    for (const cat of categories) {
      try {
        const aiRes = await fetch('https://api.together.xyz/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            messages: [
              { role: 'system', content: 'You are an audit research assistant. Provide concise, factual business intelligence for audit planning. Keep responses to 2-3 paragraphs. If you cannot find specific information, say so briefly.' },
              { role: 'user', content: cat.prompt },
            ],
            max_tokens: 500,
            temperature: 0.3,
          }),
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const aiContent = aiData.choices?.[0]?.message?.content?.trim() || '';
          if (aiContent) {
            const existing = await prisma.clientIntelligence.findFirst({
              where: { clientId: engagement.clientId, firmId: engagement.firmId, category: cat.key },
            });
            if (existing) {
              await prisma.clientIntelligence.update({
                where: { id: existing.id },
                data: { content: aiContent, source: 'ai', significantChange: existing.content.length > 0, lastUpdated: new Date() },
              });
            } else {
              await prisma.clientIntelligence.create({
                data: { clientId: engagement.clientId, firmId: engagement.firmId, category: cat.key, content: aiContent, source: 'ai' },
              });
            }
            results.push({ category: cat.key, status: 'ok' });
          }
        }
      } catch (err) {
        console.error(`AI populate failed for ${cat.key}:`, err);
        results.push({ category: cat.key, status: 'error' });
      }
    }

    return NextResponse.json({ success: true, results });
  }

  const { category, content, source } = body as { category: string; content: string; source?: string };

  if (!category || content === undefined) {
    return NextResponse.json({ error: 'category and content required' }, { status: 400 });
  }

  // Upsert intelligence by client + firm + category
  const existing = await prisma.clientIntelligence.findFirst({
    where: { clientId: engagement.clientId, firmId: engagement.firmId, category },
  });

  let intel;
  if (existing) {
    // Check if content has significantly changed
    const significantChange = existing.content !== content && content.length > 0;
    intel = await prisma.clientIntelligence.update({
      where: { id: existing.id },
      data: {
        content,
        source: source || 'manual',
        significantChange: significantChange && existing.content.length > 0,
        lastUpdated: new Date(),
      },
      include: {
        reviews: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { reviewedAt: 'asc' },
        },
      },
    });
  } else {
    intel = await prisma.clientIntelligence.create({
      data: {
        clientId: engagement.clientId,
        firmId: engagement.firmId,
        category,
        content,
        source: source || 'manual',
      },
      include: {
        reviews: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { reviewedAt: 'asc' },
        },
      },
    });
  }

  return NextResponse.json({ intelligence: intel });
}

// POST for review actions
export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const engagement = await getEngagement(engagementId);
  if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const { action, intelligenceId } = body as { action: 'review'; intelligenceId: string };

  if (action === 'review' && intelligenceId) {
    // Add review and reset significant change flag
    await prisma.clientIntelligenceReview.upsert({
      where: { intelligenceId_userId: { intelligenceId, userId: session.user.id } },
      create: { intelligenceId, userId: session.user.id },
      update: { reviewedAt: new Date() },
    });

    // Reset significant change after review
    await prisma.clientIntelligence.update({
      where: { id: intelligenceId },
      data: { significantChange: false },
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
