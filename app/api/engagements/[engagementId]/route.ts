import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fireTrigger } from '@/lib/trigger-engine';

// GET /api/engagements/[engagementId] - Full engagement with all relations
export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;

  try {
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      include: {
        teamMembers: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        specialists: { orderBy: { specialistType: 'asc' } },
        contacts: { orderBy: [{ isMainContact: 'desc' }, { name: 'asc' }] },
        agreedDates: { orderBy: { sortOrder: 'asc' } },
        informationRequests: { orderBy: { sortOrder: 'asc' } },
        client: { select: { id: true, clientName: true, contactFirstName: true, contactSurname: true, contactEmail: true } },
        period: { select: { id: true, startDate: true, endDate: true } },
      },
    });

    if (!engagement) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    // Verify firm access
    if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check if prior engagement exists (for continuance vs new client logic)
    const url = new URL(req.url);
    if (url.searchParams.get('checkPriorAuditor') === 'true') {
      const priorEngagement = await prisma.auditEngagement.findFirst({
        where: {
          clientId: engagement.clientId,
          firmId: engagement.firmId,
          id: { not: engagement.id },
          status: { in: ['active', 'review', 'complete', 'archived'] },
        },
        select: { id: true },
      });
      return NextResponse.json({ engagement, hasPriorEngagement: !!priorEngagement });
    }

    return NextResponse.json({ engagement });
  } catch (err) {
    console.error('Error fetching engagement:', err);
    return NextResponse.json({ error: 'Failed to fetch engagement' }, { status: 500 });
  }
}

// PUT /api/engagements/[engagementId] - Update engagement fields
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;

  try {
    const body = await req.json();
    const { status, infoRequestType, hardCloseDate, isGroupAudit, planCreated } = body;

    // Verify ownership
    const existing = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { firmId: true, status: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    if (existing.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'active' && existing.status === 'pre_start') {
        updateData.startedAt = new Date();
      }
      if (status === 'complete') {
        updateData.completedAt = new Date();
      }
    }
    if (infoRequestType !== undefined) updateData.infoRequestType = infoRequestType;
    if (hardCloseDate !== undefined) updateData.hardCloseDate = hardCloseDate ? new Date(hardCloseDate) : null;
    if (isGroupAudit !== undefined) updateData.isGroupAudit = isGroupAudit;
    if (planCreated !== undefined) updateData.planCreated = planCreated;

    const engagement = await prisma.auditEngagement.update({
      where: { id: engagementId },
      data: updateData,
      include: {
        teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
        specialists: true,
        contacts: true,
        agreedDates: { orderBy: { sortOrder: 'asc' } },
        informationRequests: { orderBy: { sortOrder: 'asc' } },
        client: { select: { id: true, clientName: true } },
        period: { select: { id: true, startDate: true, endDate: true } },
      },
    });

    // Fire "On Start" trigger when engagement transitions from pre_start to active
    if (status === 'active' && existing.status === 'pre_start') {
      fireTrigger({
        triggerName: 'On Start',
        engagementId,
        clientId: engagement.clientId,
        auditType: engagement.auditType,
        firmId: engagement.firmId,
        userId: session.user.id,
      }).catch(err => console.error('[Trigger] On Start failed:', err));
    }

    return NextResponse.json({ engagement });
  } catch (err) {
    console.error('Error updating engagement:', err);
    return NextResponse.json({ error: 'Failed to update engagement' }, { status: 500 });
  }
}
