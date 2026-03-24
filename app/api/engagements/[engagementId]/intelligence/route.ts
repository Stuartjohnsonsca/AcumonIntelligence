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
