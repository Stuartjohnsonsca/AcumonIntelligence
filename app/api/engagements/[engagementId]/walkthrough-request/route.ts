import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/walkthrough-request
 * Creates a portal request for walkthrough documentation or verification
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { question, section, title } = await req.json();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  const portalRequest = await prisma.portalRequest.create({
    data: {
      clientId: engagement.clientId,
      engagementId,
      section: section || 'walkthroughs',
      question,
      status: 'outstanding',
      requestedById: session.user.id,
      requestedByName: session.user.name || 'Audit Team',
    },
  });

  return NextResponse.json({ id: portalRequest.id, status: 'outstanding', clientId: engagement.clientId, section: section || 'walkthroughs' });
}
