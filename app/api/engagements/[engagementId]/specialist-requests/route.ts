import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Engagement-level Specialist Requests aggregation.
 *
 *   GET /api/engagements/:id/specialist-requests
 *     List every specialist review request for the engagement —
 *     across all schedules — with the data the hub button + modal
 *     need to render: status, response, attachments, scheduleKey, who
 *     sent and decided. Powers the red/green dots next to RI Matters.
 *
 * The "actioned" flag drives the green dot: a response is green once
 * an auditor has spawned a follow-up (RI Matter / Error / Review
 * Point) from it. Unactioned responses (status='accepted' or
 * 'rejected' but actioned=false) are red so they stand out in the
 * count.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const reviews = await prisma.scheduleSpecialistReview.findMany({
    where: { engagementId },
    orderBy: { sentAt: 'desc' },
  });

  // Count rules:
  //   pending      — neither outstanding nor closed (still awaiting decision)
  //   actioned     — auditor has spawned a follow-up: counts towards "closed" (green)
  //   responded    — accepted/rejected but no follow-up yet: counts towards "outstanding" (red)
  let outstanding = 0;
  let closed = 0;
  let pending = 0;
  for (const r of reviews) {
    if (r.status === 'pending') {
      pending += 1;
    } else if (r.actioned) {
      closed += 1;
    } else {
      outstanding += 1;
    }
  }

  return NextResponse.json({
    counts: { outstanding, closed, pending, total: reviews.length },
    requests: reviews.map(r => ({
      id: r.id,
      scheduleKey: r.scheduleKey,
      role: r.role,
      assigneeName: r.assigneeName,
      assigneeEmail: r.assigneeEmail,
      status: r.status,
      comments: r.comments,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      sentByName: r.sentByName,
      sentAt: r.sentAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() || null,
      actioned: r.actioned,
      actionedAt: r.actionedAt?.toISOString() || null,
      actionedByName: r.actionedByName,
    })),
  });
}

/**
 * POST /api/engagements/:id/specialist-requests
 *   Mark a specialist review as actioned. Body: { id }
 *   Called from the hub modal after the auditor spawns an RI Matter /
 *   Error / Review Point from a response. The dot turns green and the
 *   row sorts to the bottom of the unactioned list.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const existing = await prisma.scheduleSpecialistReview.findUnique({
    where: { id },
    select: { id: true, engagementId: true },
  });
  if (!existing || existing.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.scheduleSpecialistReview.update({
    where: { id },
    data: {
      actioned: true,
      actionedAt: new Date(),
      actionedById: session.user.id,
      actionedByName: session.user.name || session.user.email || null,
    },
  });

  return NextResponse.json({ ok: true });
}
