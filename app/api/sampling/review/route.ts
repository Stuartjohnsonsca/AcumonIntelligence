import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

/**
 * GET /api/sampling/review?runId=X
 * Fetch reviews for a sampling run.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const run = await prisma.samplingRun.findUnique({
    where: { id: runId },
    include: { engagement: { select: { clientId: true } } },
  });
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    run.engagement.clientId,
  );
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const reviews = await prisma.samplingReview.findMany({
    where: { runId },
    include: { reviewer: { select: { id: true, name: true, email: true, displayId: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(reviews);
}

/**
 * POST /api/sampling/review
 * Submit a review for a sampling run.
 * Body: { runId, decision: 'approved' | 'rejected' | 'needs_revision', notes? }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { runId, decision, notes } = await req.json();
  if (!runId || !decision) {
    return NextResponse.json({ error: 'runId and decision required' }, { status: 400 });
  }

  if (!['approved', 'rejected', 'needs_revision'].includes(decision)) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  const run = await prisma.samplingRun.findUnique({
    where: { id: runId },
    include: { engagement: { select: { clientId: true, userId: true } } },
  });
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Must have access to the client
  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    run.engagement.clientId,
  );
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Reviewer cannot be the same person who prepared (unless super admin)
  if (run.engagement.userId === session.user.id && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Preparer cannot review their own work' }, { status: 403 });
  }

  // Create review record
  const review = await prisma.samplingReview.create({
    data: {
      runId,
      reviewerId: session.user.id,
      decision,
      notes: notes || null,
    },
    include: { reviewer: { select: { id: true, name: true, email: true, displayId: true } } },
  });

  // If approved, lock the run
  if (decision === 'approved') {
    await prisma.samplingRun.update({
      where: { id: runId },
      data: { status: 'locked' },
    });
    // Also update engagement status
    await prisma.samplingEngagement.update({
      where: { id: run.engagementId },
      data: { status: 'locked', reviewerId: session.user.id },
    });
  }

  return NextResponse.json(review);
}
