import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resumeExecution } from '@/lib/flow-engine';

// GET: List outstanding items for engagement
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const where: any = { engagementId };
  if (status && status !== 'all') where.status = status;

  const items = await prisma.outstandingItem.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json({ items });
}

// PUT: Mark item complete (triggers flow resumption if linked)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const { itemId, responseData } = await req.json();
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });

  const item = await prisma.outstandingItem.update({
    where: { id: itemId },
    data: { status: 'complete', completedAt: new Date(), responseData: responseData || null },
  });

  // If this item is linked to a test execution, resume the flow
  if (item.executionId) {
    try {
      await resumeExecution(item.executionId, responseData || { completed: true });
    } catch (err: any) {
      console.error('Failed to resume execution:', err.message);
    }
  }

  return NextResponse.json({ item });
}
