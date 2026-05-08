// POST /api/engagements/:engagementId/interrogate/:interactionId/rating
// Body: { rating: 'up' | 'down' | null, correction?: string }
//
// Reviewers grade an InterrogateBot answer thumbs-up / thumbs-down and
// can optionally write a correction (what the answer SHOULD have been).
// Phase 2 retrieves rating='up' interactions as few-shot examples for
// future similar questions; rating='down' interactions are excluded.
//
// Anyone with read access to the engagement (firm member or super
// admin) can rate. We don't insist the rater be the original asker —
// a reviewer can correct a junior's bot session.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const VALID_RATINGS = new Set(['up', 'down', null]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ engagementId: string; interactionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId, interactionId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rating = body.rating === undefined ? null : body.rating;
  const correction = typeof body.correction === 'string' ? body.correction.trim().slice(0, 4000) : null;
  if (!VALID_RATINGS.has(rating)) {
    return NextResponse.json({ error: 'rating must be "up" | "down" | null' }, { status: 400 });
  }

  const existing = await prisma.interrogateInteraction.findUnique({
    where: { id: interactionId },
    select: { id: true, engagementId: true, firmId: true },
  });
  if (!existing
    || existing.engagementId !== engagementId
    || (existing.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  await prisma.interrogateInteraction.update({
    where: { id: interactionId },
    data: {
      rating,
      correction: correction || null,
      ratingAt: rating !== null ? new Date() : null,
      ratedById: rating !== null ? session.user.id : null,
    },
  });

  return NextResponse.json({ ok: true });
}
