import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Token-auth'd specialist review endpoints.
 *
 *   GET  /api/schedule-reviews/:token
 *     Returns the review + the engagement context the specialist
 *     needs to see the schedule. Public — the token is the auth.
 *
 *   PUT  /api/schedule-reviews/:token
 *     Submit the specialist's decision + comments.
 *     Body: { status: 'accepted' | 'rejected', comments?: string }
 *     Only works once — subsequent submits are blocked.
 */
type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });
  const review = await prisma.scheduleSpecialistReview.findUnique({ where: { token } });
  if (!review) return NextResponse.json({ error: 'Review link not found or has been revoked' }, { status: 404 });

  // Load the engagement's client + period so the page can show what
  // the specialist is reviewing. No sensitive fields exposed.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: review.engagementId },
    include: {
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
      firm: { select: { name: true } },
    },
  });

  return NextResponse.json({
    review: {
      id: review.id,
      scheduleKey: review.scheduleKey,
      role: review.role,
      assigneeName: review.assigneeName,
      assigneeEmail: review.assigneeEmail,
      status: review.status,
      comments: review.comments,
      sentByName: review.sentByName,
      sentAt: review.sentAt.toISOString(),
      decidedAt: review.decidedAt?.toISOString() || null,
    },
    engagement: engagement ? {
      id: engagement.id,
      firmName: engagement.firm.name,
      clientName: engagement.client.clientName,
      periodStart: engagement.period?.startDate?.toISOString() || null,
      periodEnd: engagement.period?.endDate?.toISOString() || null,
    } : null,
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const status = body?.status;
  const comments = typeof body?.comments === 'string' ? body.comments : null;
  if (status !== 'accepted' && status !== 'rejected') {
    return NextResponse.json({ error: "status must be 'accepted' or 'rejected'" }, { status: 400 });
  }

  const review = await prisma.scheduleSpecialistReview.findUnique({ where: { token } });
  if (!review) return NextResponse.json({ error: 'Review link not found' }, { status: 404 });
  if (review.status !== 'pending') {
    return NextResponse.json({
      error: `This review was already ${review.status} on ${review.decidedAt?.toISOString().slice(0, 10) || 'a previous date'}.`,
    }, { status: 409 });
  }

  const updated = await prisma.scheduleSpecialistReview.update({
    where: { id: review.id },
    data: { status, comments: comments || null, decidedAt: new Date() },
  });
  return NextResponse.json({
    ok: true,
    review: {
      id: updated.id,
      status: updated.status,
      comments: updated.comments,
      decidedAt: updated.decidedAt?.toISOString() || null,
    },
  });
}
